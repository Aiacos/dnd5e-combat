/**
 * What each player sees on screen (§62), aligned with the simulated vision of the rules (adapter/vision.mjs):
 *  - an area that blocks sight (Fog Cloud, Darkness: `blockedBetween`) hides, for the sight-based detection modes, what is
 *    inside or behind it — except for the senses that pierce it (`sensesThrough`);
 *  - a creature that is not seen but HEARD (invisible, in fog; not hidden, not dead, not behind a wall that
 *    stops sound, observer not Deafened: adapter/hearing.mjs) is shown with a wavy outline, like the Tremorsense of the
 *    core: its position is known, and it can be targeted (at Disadvantage).
 *
 * Through the core's extension points: each detection mode of `CONFIG.Canvas.detectionModes` is replaced, at `setup`, by
 * a subclass of its own class (same id, same data) — nothing is patched. Basic sight and light perception
 * are tested for each source before the special modes (canvas/groups/visibility.mjs, `testVisibility`): hearing goes through
 * light perception, as a last resort, after letting the observer's special modes answer. The disposable sources
 * of the simulated vision (`dnd5e-combat.…`) do not hear: for the rules, hearing is not seeing.
 *
 * Issue #42:
 *  - the senses that pierce Darkness (Blindsight, Truesight) are judged here by their range and a line of sight WITHOUT the
 *    edges of the Darkness sources: the core's test counted them, and nothing could be seen inside Darkness;
 *  - a "Devil's Sight" detection mode (`devilsSight`), registered at `setup` and given IN MEMORY (nothing is written) to the
 *    tokens whose actor has the summon (`devils-sight`), at each setup of the vision sources (`initializeVisionSources`): the
 *    target at 120 ft is shown sharp, as if seen normally — the rule is that of `canSee` (adapter/vision.mjs,
 *    `devilsSightSeesToken`);
 *  - the hearing of a Blinded observer goes through a special mode given in memory (`dasHearing`): the core skips the light
 *    perception of a blinded source, and a Blinded character no longer saw what it hears;
 *  - a heard creature (outline) carries a small ear above its token, and, on hover, "Heard, not seen": from afar, the
 *    outline of a ring token passed for a seen creature. (The dynamic ring cannot be removed client-side without patching
 *    the core.)
 */

import { MODULE_ID } from "../constants.mjs";
import { blockedBetween, isVisionAvailable, devilsSightRange, ownDarknessSight, devilsSightSeesToken, senseReachesToken, asSeenBy,
  isSenseless, sensedThrough } from "../adapter/vision.mjs";
import { declaredSensesOf, mutedSensesOf } from "../adapter/senses.mjs";
import { hiddenFrom } from "../adapter/stealth.mjs";
import { canHear } from "../adapter/hearing.mjs";
import { sensesThrough, CORE_JUDGED, DEVILS_SIGHT, DEVILS_SIGHT_OUTLINE, HEARING_MODE, SENSE_MODE, SENSE_OUTLINE,
  grantInMemoryModes, tintOutlineShader, FIELD_MODES, fieldOfView } from "../core/light.mjs";
import { hidesIdentity, onlyLocated, drawsSensed } from "../core/senses.mjs";
import { route } from "../runtime/router.mjs";
import { theaterActive } from "../runtime/theater-state.mjs";
import { perceivesPlane } from "../adapter/plane.mjs";
import { loc } from "../runtime/shared.mjs";

const SIMULATED = `${MODULE_ID}.`;   // prefix of the disposable vision sources (adapter/vision.mjs, SOURCE_PREFIX)
const SIGHT = 0;                      // DetectionMode.DETECTION_TYPES.SIGHT
const OWN_DARKNESS_RANGE = 9999;      // §447: range of the "Devil's Sight" mode of one who only sees through their own Darkness

let hearingFilter = null;
function filter() {
  return hearingFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
    outlineColor: [0.55, 0.8, 1, 1], knockout: true, wave: true
  });
}

let senseFilter = null;
function sensedFilter() {
  return senseFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
    outlineColor: [...SENSE_OUTLINE.outlineColor], knockout: SENSE_OUTLINE.knockout, wave: SENSE_OUTLINE.wave
  });
}

/** The two documents of a test: the observer (its vision source) and the target, if it is a token. */
function pair(visionSource, object) {
  const Token = foundry.canvas.placeables.Token;
  if ( !(object instanceof Token) ) return null;
  const observer = visionSource?.object?.document;
  return (observer && object.document) ? { observer, target: object.document } : null;
}

/**
 * What a fog or darkness between the observer and the target does to this mode: `"blocked"` (sight does not pass),
 * `"pierce"` (a sense that pierces darkness, judged by the engine: range and line of sight without the edges of the darkness —
 * issue #42), or null (nothing between the two, or the core's test is enough: the modes without walls, `CORE_JUDGED` —
 * vibrations, Sense All, Sense Invisibility; a sense that pierces fog alone).
 */
function blockFor(id, visionSource, object) {
  if ( !isVisionAvailable() ) return null;
  const p = pair(visionSource, object);
  if ( !p ) return null;
  const blocked = blockedBetween(p.observer, p.target);
  if ( !blocked.fog && !blocked.darkness ) return null;
  if ( !(sensesThrough(blocked) ?? []).includes(id) ) return "blocked";
  return (CORE_JUDGED.includes(id) || !blocked.darkness) ? null : "pierce";
}

/** Does a special mode of the observer (Blindsight, seeing the invisible…) detect it? It has priority: its own rendering. */
function specialDetects(visionSource, config) {
  const doc = visionSource.object.document;
  const modes = CONFIG.Canvas.detectionModes;
  return Object.entries(doc.detectionModes ?? {}).some(([id, mode]) => (id !== "basicSight") && (id !== "lightPerception")
    && (modes[id]?.testVisibility(visionSource, mode, config) === true));
}

/** It is not seen, but it is heard: wavy outline. */
function heard(visionSource, config) {
  if ( !isVisionAvailable() || String(visionSource?.sourceId ?? "").startsWith(SIMULATED) ) return false;
  const p = pair(visionSource, config.object);
  if ( !p || !canHear(p.observer, p.target) ) return false;
  if ( specialDetects(visionSource, config) ) return false;
  config.object.detectionFilter = filter();
  return true;
}

const reported = new Set();
/** An error from the fog or from hearing, reported once (with its stack): the display falls back to the core. */
function reportOnce(err) {
  const key = String(err?.message ?? err);
  if ( reported.has(key) ) return;
  reported.add(key);
  console.error(`${MODULE_ID} | perception (mist, hearing, plane): ${key}\n${err?.stack ?? ""}`);
}

/** §225: is the target out of the observer's perception range, from one plane to another (Ethereal)? */
function offPlane(visionSource, object) {
  const p = pair(visionSource, object);
  return !!p && !perceivesPlane(p.observer, p.target);
}

/**
 * The subclass of a detection mode: none perceives from one plane to another without sight of the Ethereal (§225); sight stops
 * at fog; light perception hears as a last resort.
 */
function extend(id, mode) {
  const Base = mode.constructor;
  const sight = mode.type === SIGHT;
  const listens = id === "lightPerception";
  const Extended = class extends Base {
    testVisibility(visionSource, tokenMode, config) {
      // §220: Theater of the Mind — the core's test alone.
      if ( theaterActive() ) return super.testVisibility(visionSource, tokenMode, config);
      try { if ( offPlane(visionSource, config.object) ) return false; }
      catch(err) { reportOnce(err); }
      // Setting `unconsciousSenses`: an Unconscious observer perceives nothing any more, by any mode.
      try { if ( isSenseless(visionSource?.object?.document) ) return false; }
      catch(err) { reportOnce(err); }
      // `senseNeeds`: this sheet sense depends on the hearing or sight of its bearer, Deafened or Blinded — switched off.
      try { if ( mutedSensesOf(visionSource?.object?.document).includes(id) ) return false; }
      catch(err) { reportOnce(err); }
      // What the engine adds must never break the core's display: an error → the core's test alone, and the stack once.
      let block = null;
      try { block = blockFor(id, visionSource, config.object); }
      catch(err) { reportOnce(err); }
      // Issue #42: a sense that pierces darkness (Blindsight, Truesight) — the core's test counts their edges as walls.
      if ( (block === "pierce") && (id !== DEVILS_SIGHT.mode) ) {
        if ( !tokenMode.enabled ) return false;
        try {
          const p = pair(visionSource, config.object);
          return !!p && senseReachesToken(p.observer, p.target, tokenMode.range, id);
        }
        catch(err) { reportOnce(err); }
      }
      if ( !sight && !listens ) return super.testVisibility(visionSource, tokenMode, config);
      // Issue #42: an observer who sees the Invisible ("Detection of Invisibility") — the core's basic sight refuses any
      // Invisible target (detection-mode.mjs `_canDetect`); the target is presented unveiled, as in the rules (`asSeenBy`).
      const original = config;   // hearing puts its filter on the real token, never on the unveiled view
      if ( sight ) {
        try {
          const p = pair(visionSource, config.object);
          const seen = p ? asSeenBy(p.observer, config.object) : config.object;
          if ( seen !== config.object ) config = { ...config, object: seen };
        }
        catch(err) { reportOnce(err); }
      }
      const blocked = sight && (block === "blocked");
      if ( !blocked && super.testVisibility(visionSource, tokenMode, config) ) return true;
      if ( !listens || !tokenMode.enabled ) return false;
      try { return heard(visionSource, original); }
      catch(err) { reportOnce(err); return false; }
    }
  };
  Object.defineProperty(Extended, "name", { value: `${Base.name}${MODULE_ID.replace(/\W/g, "")}` });
  return new Extended(mode.toObject());
}

/**
 * Issue #42: the "Devil's Sight" detection mode. A sight (`SIGHT`) bounded by walls, which does not stop at darkness: its
 * test is that of the rules (`devilsSightSeesToken`: 120 ft, line of sight without the edges of the darkness, not Invisible,
 * not Blinded, no fog). Not offered in the token configuration (given by the summon).
 *
 * Issue #42, follow-up (0.281.1): a filter — the token tinted red, with a dark red edge (`DEVILS_SIGHT_OUTLINE`,
 * `devilsSightFilter`): a sharp token means "normal sight" (the user's choice). Without a filter, the core only
 * drew it under the vision veil: the area seen by the observer stops at the edge of the Darkness (its edges are sight
 * walls), and the target stayed a black silhouette, although "visible" and targetable. The core consults this mode only if
 * basic sight and light perception have failed: in full sight, no edge.
 */
/**
 * The Devil's Sight filter: the core's outline (`OutlineOverlayFilter`, without knockout or waviness, fixed thickness) whose
 * shader also tints the token red (`tintOutlineShader`). If the core's shader has changed, the outline alone (and a warning,
 * once).
 */
function devilsSightFilter() {
  const Outline = foundry.canvas.rendering.filters.OutlineOverlayFilter;
  const tinted = tintOutlineShader(Outline._createFragmentShader());
  if ( !tinted ) reportOnce(new Error("Devil's Sight: core outline shader changed, red tint not applied"));
  const Filter = !tinted ? Outline : class DevilsSightFilter extends Outline {
    static get defaultUniforms() {
      return { ...super.defaultUniforms, tintColor: [...DEVILS_SIGHT_OUTLINE.tintColor], tintStrength: DEVILS_SIGHT_OUTLINE.tintStrength };
    }
    static _createFragmentShader() { return tinted; }
  };
  const filter = Filter.create({
    outlineColor: [...DEVILS_SIGHT_OUTLINE.outlineColor], knockout: DEVILS_SIGHT_OUTLINE.knockout, wave: DEVILS_SIGHT_OUTLINE.wave
  });
  filter.thickness = DEVILS_SIGHT_OUTLINE.thickness;   // a filter accessor, not a uniform (rendering/filters/outline-overlay.mjs:156)
  filter.animated = false;                              // fixed thickness: else the core's outline "breathes" (outline-overlay.mjs:170)
  return filter;
}

function devilsSightMode() {
  const DetectionMode = foundry.canvas.perception.DetectionMode;
  class DetectionModeDevilsSight extends DetectionMode {
    static getDetectionFilter() {
      return this._detectionFilter ??= devilsSightFilter();
    }
    testVisibility(visionSource, mode, config) {
      if ( !mode?.enabled ) return false;
      const p = pair(visionSource, config.object);
      if ( !p ) return false;
      return devilsSightSeesToken(p.observer, p.target);
    }
  }
  return new DetectionModeDevilsSight({ id: DEVILS_SIGHT.mode, label: "DND5ECOMBAT.Vision.DevilsSight", tokenConfig: false,
    type: DetectionMode.DETECTION_TYPES.SIGHT, walls: true, angle: true });
}

/**
 * Issue #42: the "Devil's Sight" mode given in memory to the tokens that have a vision source and whose actor has the summon
 * — as dnd5e projects the sheet's senses (documents/token.mjs `applySenseOverrides`), writing nothing. The token's prepared
 * data is redone at each update; the core calls this hook again at each setup of the sources (groups/visibility.mjs:192).
 */
function grantModes(sources) {
  for ( const source of sources?.values?.() ?? [] ) grantOn(source.object?.document);
}

/**
 * The in-memory modes of a token. Also replayed on ALL the tokens of the scene at each vision refresh (`grantAll`,
 * `sightRefresh`): a condition set or removed (Blinded: `Token#_onApplyStatusEffect` only redoes that token's source),
 * an actor or a token updated redo the prepared data without setting up all the sources again —
 * these modes disappeared until the next setup (seen on 2026-11-08: a Blinded Ranger set by hand heard nothing).
 */
function grantOn(doc) {
  if ( !doc?.detectionModes || !doc.sight?.enabled ) return false;
  blindIfSenseless(doc.object);
  // Before the in-memory modes: it reads those that dnd5e projected from the sheet.
  grantField(doc);
  // The hearing of a Blinded observer LAST (core/light.mjs `grantInMemoryModes`): the core tries the special modes in order.
  return grantInMemoryModes(doc.detectionModes, grantedSenses(doc));
}

/**
 * §527 (baileywiki's report, 2026-11-24): what a token's in-memory modes need from its sheet (Devil's Sight, Shadow's own darkness,
 * declared senses) — read once per preparation of the token's data, not on every vision refresh: while a token walks,
 * `sightRefresh` comes every frame, for ALL tokens, and re-reading every item of every sheet took over 2 s of a 6 s walk on the bench.
 * Preparing the token's data rebuilds `detectionModes` (a new object): that is the sign to read again. A changed item, effect or
 * actor (`regrant`) also drops what was read.
 */
const sensesRead = new WeakMap();

function grantedSenses(doc) {
  const memo = sensesRead.get(doc);
  if ( memo && (memo.modes === doc.detectionModes) ) return memo.senses;
  const modes = CONFIG.Canvas.detectionModes;
  const devilsRange = devilsSightRange(doc);
  const senses = {
    // §447: whoever sees through their own Darkness also gets this mode (its rule, `devilsSightSeesToken`, sets no limit).
    devilsSight: modes[DEVILS_SIGHT.mode] ? (devilsRange || (ownDarknessSight(doc) ? OWN_DARKNESS_RANGE : 0)) : 0,
    sense: !!modes[SENSE_MODE] && (declaredSensesOf(doc.actor).length > 0),
    hearing: !!modes[HEARING_MODE],
    // Devil's Sight range for the field of view (`grantField`), even when its detection mode is missing.
    devilsRange
  };
  sensesRead.set(doc, { modes: doc.detectionModes, senses });
  return senses;
}

/**
 * The field of view of a sense (core/light.mjs `fieldOfView`), set in memory on the token's PREPARED sight — range, vision
 * mode, image — as dnd5e projects Darkvision there: the map is seen up to the range of Truesight, Blindsight
 * or Devil's Sight. Nothing is written; the preparation of the token's data erases everything, this hook puts it back. When
 * changed, this token's vision source is redone (it alone). What this field does not do, for lack of replacing the core's
 * vision source: pierce a darkness source, or serve a Blinded observer — there, only the tokens are shown, as before.
 */
function grantField(doc) {
  const modes = doc.detectionModes;
  // A switched-off sense (`senseNeeds`: a Blindsight through hearing, its bearer Deafened) makes no field of view either.
  const muted = mutedSensesOf(doc);
  const enabled = id => (!muted.includes(id) && (modes[id]?.enabled ?? true) && (modes[id]?.range > 0)) ? modes[id].range : 0;
  const field = fieldOfView({ darkvision: enabled("basicSight"), seeAll: enabled("seeAll"), blindsight: enabled("blindsight"),
    devilsSight: CONFIG.Canvas.visionModes?.[FIELD_MODES.devilsSight.id] ? grantedSenses(doc).devilsRange : 0 });
  if ( !field || !CONFIG.Canvas.visionModes?.[field.visionMode] ) {
    // The sense is no longer there (the token's preparation put back the sheet's sight): the source that still carries its field
    // is redone.
    const stale = doc.object?.vision?.visionMode?.id;
    if ( stale && FIELD_IDS.includes(stale) && !doc.object.destroyed ) doc.object.initializeVisionSource();
    return;
  }
  const sight = doc.sight;
  const range = Number.isFinite(field.range) ? field.range : (canvas.dimensions?.maxR ?? sight.range);
  if ( (sight.visionMode === field.visionMode) && (sight.range === range) ) return;
  Object.assign(sight, { range, visionMode: field.visionMode, contrast: field.contrast, saturation: field.saturation,
    brightness: field.brightness });
  if ( doc.object?.vision && !doc.object.destroyed ) doc.object.initializeVisionSource();
}

const FIELD_IDS = Object.values(FIELD_MODES).map(mode => mode.id);

/** The vision modes of the fields of view (`FIELD_MODES`), absent from the token configuration: the engine chooses them. */
function fieldModes() {
  const VisionMode = foundry.canvas.perception.VisionMode;
  const shader = foundry.canvas.rendering.shaders.ColorAdjustmentsSamplerShader;
  const out = {};
  for ( const { id, label, contrast, saturation, brightness, grey } of Object.values(FIELD_MODES) ) {
    out[id] = new VisionMode({
      id, label, tokenConfig: false,
      ...(grey ? { canvas: { shader, uniforms: { contrast: 0, saturation: -1, exposure: 0 } },
        lighting: { background: { visibility: VisionMode.LIGHTING_VISIBILITY.REQUIRED } } } : {}),
      vision: { darkness: { adaptive: false }, defaults: { contrast, saturation, brightness } }
    });
  }
  return out;
}

/**
 * Issue #42, follow-up (Archibald, 0.281.0): the preparation of a token's data (`TokenDocument#reset`) redoes
 * `detectionModes` from the source — the in-memory modes disappear, and nothing redoes the view before the next
 * `sightRefresh` (a moving target does not trigger it): the target in Darkness fell back to the hearing outline. An effect
 * that targets the token (`token.…`, the player's one on `token.detectionModes.devilsSight.range`) makes the token redo at
 * EACH update of the actor (`_onRelatedUpdate`, documents/token.mjs:3810) and left `{ range }` without `enabled`. The update
 * hook comes after this preparation: the modes are given again to the touched tokens, and, if any were missing, the view is
 * redone.
 */
function regrant(docs) {
  if ( !canvas?.ready ) return;
  for ( const doc of docs ) if ( doc ) sensesRead.delete(doc);
  let changed = false;
  for ( const doc of docs ) if ( doc?.parent === canvas.scene ) changed = grantOn(doc) || changed;
  if ( changed ) refreshVisibility();
}

/**
 * The documents a scene carries. The client redoes the whole scene (`Scene#reset`, so the prepared data of ALL its
 * tokens) after the creation, update or deletion of one of them — a moved drawing, another token that moves —, without
 * always redoing the view: the in-memory modes of each token disappeared until the next `sightRefresh`, and the heard creature
 * was no longer drawn (seen on 2026-11-19: a moved token, a created drawing).
 */
function sceneDocumentNames() {
  const embedded = Object.keys(CONFIG.Scene?.documentClass?.metadata?.embedded ?? {});
  return embedded.length ? embedded : ["AmbientLight", "AmbientSound", "Drawing", "Note", "Region", "Tile", "Token", "Wall"];
}

/** The in-memory modes of all the tokens of the displayed scene, given again without redoing the view: the hook precedes render. */
function regrantScene(doc) {
  if ( !canvas?.ready || (doc?.parent !== canvas.scene) ) return;
  for ( const token of canvas.scene.tokens ?? [] ) if ( token !== doc ) grantOn(token);
}

function tokensOfActor(actor) {
  return actor?.getActiveTokens?.(false, true) ?? [];
}

/**
 * Setting `unconsciousSenses`: an Unconscious creature's vision source is blinded (`blinded.unconscious`,
 * point-vision-source.mjs:172-182) — its screen goes into "blindness" mode, like Blinded. The core only puts back its own keys
 * (`blind`, `burrow`, placeables/token.mjs:936): ours stays until waking; when changed, the source is redone (it alone).
 */
function blindIfSenseless(token) {
  const vision = token?.vision;
  if ( !vision?.blinded ) return;
  const want = isSenseless(token.document);
  if ( !!vision.blinded.unconscious === want ) return;
  vision.blinded.unconscious = want;
  token.initializeVisionSource();
}

function grantAll() {
  if ( !canvas?.ready ) return;
  for ( const token of canvas.tokens.placeables ) grantOn(token.document);
}

/**
 * Issue #42: the hearing of a Blinded observer. The core skips basic sight and the light perception of a blinded source
 * (groups/visibility.mjs, `if ( visionSource.isBlinded ) continue`) — yet hearing goes through light perception (`heard`): a
 * Blinded character no longer saw on screen the creatures it hears. This special mode (SOUND, no walls or angle: `canHear`
 * judges sound walls, deafness, hidden or dead target), given in memory to each token with a vision source, only acts for a
 * blinded source and never for the rules' disposable sources (hearing is not seeing); the core puts its filter, the hearing
 * outline.
 */
function hearingMode() {
  const DetectionMode = foundry.canvas.perception.DetectionMode;
  class DetectionModeHearing extends DetectionMode {
    static getDetectionFilter() { return filter(); }
    testVisibility(visionSource, mode, config) {
      if ( !mode?.enabled || !visionSource?.isBlinded || !isVisionAvailable() ) return false;
      if ( String(visionSource.sourceId ?? "").startsWith(SIMULATED) ) return false;
      const p = pair(visionSource, config.object);
      return !!p && canHear(p.observer, p.target);
    }
  }
  return new DetectionModeHearing({ id: HEARING_MODE, label: "DND5ECOMBAT.Vision.Ouie", tokenConfig: false,
    type: DetectionMode.DETECTION_TYPES.SOUND, walls: false, angle: false });
}

/**
 * The senses declared by content (key `sense`: Detect Evil and Good, "Divine Perception"…). Their rule is the engine's
 * (`sensedThrough`: range, what the sense detects, wall if it counts it, the target's protections): the creature whose
 * position is known is drawn with an outline, wherever it is — these senses are not sight, neither fog nor darkness stops them.
 * A mere presence (`reveals: "presence"`) draws nothing: the position is not known; an aura
 * (`reveals: "aura"`) marks the creature already seen (`refreshMark`). A creature hidden from the observer is only shown by a
 * sense that locates it (issue #107: its cell is known, it stays unseen and Hidden), never by a declared sight. Never for the
 * rules' disposable sources, which read `sensedBy` themselves.
 */
function senseMode() {
  const DetectionMode = foundry.canvas.perception.DetectionMode;
  class DetectionModeDeclaredSense extends DetectionMode {
    static getDetectionFilter() { return sensedFilter(); }
    testVisibility(visionSource, mode, config) {
      if ( !mode?.enabled || !isVisionAvailable() ) return false;
      if ( String(visionSource?.sourceId ?? "").startsWith(SIMULATED) ) return false;
      const p = pair(visionSource, config.object);
      if ( !p ) return false;
      // Issue #107: a sense that locates still draws a Hidden creature (its square is known); a declared sight does not.
      return drawsSensed(sensedThrough(p.observer, p.target), hiddenFrom(p.observer, p.target));
    }
  }
  return new DetectionModeDeclaredSense({ id: SENSE_MODE, label: "DND5ECOMBAT.Vision.Sens", tokenConfig: false,
    type: DetectionMode.DETECTION_TYPES.OTHER, walls: false, angle: false });
}

/** At `setup`: after the core and the system (dnd5e adds its modes at `init`). */
function installModes() {
  const modes = CONFIG.Canvas.detectionModes;
  modes[DEVILS_SIGHT.mode] ??= devilsSightMode();
  modes[SENSE_MODE] ??= senseMode();
  modes[HEARING_MODE] ??= hearingMode();
  const visionModes = CONFIG.Canvas.visionModes;
  if ( visionModes && foundry.canvas.perception.VisionMode ) {
    for ( const [id, mode] of Object.entries(fieldModes()) ) visionModes[id] ??= mode;
  }
  for ( const [id, mode] of Object.entries(modes) ) {
    const extended = mode ? extend(id, mode) : null;
    if ( extended ) modes[id] = extended;
  }
}

/** What changes what is seen or heard without moving a token: a fog placed or lifted, hiding, being deafened. */
function refreshVisibility() {
  if ( !canvas?.ready ) return;
  canvas.perception.update({ refreshVision: true });
  for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshVisibility: true });
}

export function registerPerception() {
  route("setup", installModes, { label: "perception: detection modes not installed" });
  route("initializeVisionSources", grantModes, { label: "perception: Devil's Sight or blind hearing not granted" });
  // At each vision refresh: `restrictVisibility` asks each token for `refreshVisibility` then calls
  // `sightRefresh` (groups/visibility.mjs:809-828) — the tokens only apply this flag afterwards. The in-memory modes are
  // therefore there at the time of the test, whatever the core redid in the meantime (prepared data redone after a condition,
  // an actor, a token updated).
  route("sightRefresh", grantAll, { label: "perception: Devil's Sight or blind hearing not granted again" });
  const again = { label: "perception: Devil's Sight or blind hearing not granted after an update" };
  route("updateActor", actor => regrant(tokensOfActor(actor)), again);
  route("updateToken", doc => regrant([doc]), again);
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) route(hook, item => regrant(tokensOfActor(item?.parent)), again);
  // §527: an effect changes what the sheet grants (an item switched on or off) — its tokens read their senses again.
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => regrant(tokensOfActor(effect?.parent?.documentName === "Actor" ? effect.parent : effect?.parent?.parent)), again);
  }
  for ( const name of sceneDocumentNames() ) {
    for ( const action of ["create", "update", "delete"] ) route(`${action}${name}`, regrantScene, again);
  }
  registerHeardMarks();
  const refresh = { label: "perception: display not refreshed" };
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, refreshVisibility, refresh);
  }
}

/* -------------------------------------------- */
/*  Issue #42: the ear of the heard creatures */
/* -------------------------------------------- */

/** Font Awesome 6's ear (`ear-listen`); the target of a creature located by a declared sense (`location-crosshairs`). */
const EAR = "\uf2a2";
const LOCATED = "\uf601";
const MAGIC = "\uf0d0";   // `wand-magic`: the aura of a seen creature that carries magic (`reveals: "aura"`)
const MARKS = Object.freeze({
  heard: Object.freeze({ glyph: EAR, label: "Vision.Entendu", line: 0x8ccdff, fill: 0xd6ecff }),
  located: Object.freeze({ glyph: LOCATED, label: "Vision.Localise", line: 0xc79bff, fill: 0xe8d9ff }),
  aura: Object.freeze({ glyph: MAGIC, label: "Vision.Aura", line: 0xff7ad9, fill: 0xffd6f3, ring: true })
});
const marks = new Map();   // id du token → { root, label, r, kind }
let markLayer = null;

function markLayerOf() {
  if ( !markLayer || markLayer.destroyed || (markLayer.parent !== canvas.interface) ) {
    markLayer = canvas.interface.addChild(new PIXI.Container());
    markLayer.eventMode = "none";
    markLayer.zIndex = 1040;   // above the tokens layer (200), below the hourglass (1050, ui/awaiting.mjs)
  }
  return markLayer;
}

/** A dark badge with a rim in the outline's color (hearing, declared sense), its sign; on hover, "Heard, not seen". */
function buildMark(kind) {
  const look = MARKS[kind];
  const r = Math.max(9, canvas.grid.size * 0.13);
  const root = new PIXI.Container();
  const back = new PIXI.Graphics().beginFill(0x000000, 0.6).drawCircle(0, 0, r).endFill()
    .lineStyle(2, look.line, 0.95).drawCircle(0, 0, r);
  const ear = new PIXI.Text(look.glyph, {
    fontFamily: ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"], fontWeight: "900", fontSize: Math.round(r * 1.1),
    fill: look.fill, stroke: 0x000000, strokeThickness: 2
  });
  ear.anchor.set(0.5);
  const label = new PIXI.Text(loc(look.label), {
    fontFamily: "Signika", fontSize: Math.round(Math.max(12, r * 1.05)), fill: 0xffffff, stroke: 0x000000, strokeThickness: 4,
    align: "left"
  });
  label.anchor.set(0, 0.5);
  label.position.set(r + 4, 0);
  label.visible = false;
  // An aura: a pale halo around the token, drawn at its size at each refresh (`refreshMark`).
  const ring = look.ring ? new PIXI.Graphics() : null;
  if ( ring ) root.addChild(ring);
  // Setting `anonymousLocated`: the silhouette that stands in for the image of a creature perceived without being seen —
  // the core's default token icon, at the token's size, under the sense's outline: whoever perceives it without seeing it
  // knows where it is, not what it is.
  const stand = look.ring ? null : new PIXI.Sprite(PIXI.Texture.from(CONFIG.Token.documentClass.DEFAULT_ICON));
  if ( stand ) { stand.anchor.set(0.5); stand.visible = false; root.addChild(stand); }
  root.addChild(back, ear, label);
  return { root, label, r, kind, ring, ringSize: null, stand };
}

function dropMark(id) {
  const mark = marks.get(id);
  if ( !mark ) return;
  marks.delete(id);
  if ( !mark.root.destroyed ) mark.root.destroy({ children: true });
}

/**
 * Is the token shown because it is heard (the hearing outline) or because a declared sense locates it (its outline), on this
 * client? The filter first: as long as nothing has been heard or located it does not exist, and `Token#isVisible` reruns the
 * core's whole visibility test at each read — and we come through here at each `refreshToken` and `hoverToken` of each token.
 */
function perceivedAs(token) {
  if ( !token || token.destroyed ) return null;
  const watchers = auraWatchers();
  if ( (!hearingFilter && !senseFilter && !watchers.length) || (token.isVisible !== true) ) return null;
  if ( hearingFilter && (token.detectionFilter === hearingFilter) ) return "heard";
  // Seen through a wall by a declared sight (`kind: "sight"`): the outline, not the "not seen" mark.
  if ( senseFilter && (token.detectionFilter === senseFilter) ) {
    const verdicts = viewers().map(doc => (doc === token.document) ? null : sensedThrough(doc, token.document));
    return onlyLocated(verdicts) ? "located" : null;
  }
  // An aura is only placed on what is seen: not on a token shown by a special mode (its filter), not on the observer.
  if ( !watchers.length || token.detectionFilter ) return null;
  return watchers.some(doc => (doc !== token.document) && (sensedThrough(doc, token.document) === "aura")) ? "aura" : null;
}

/**
 * The tokens through which this client sees and whose actor has a sense that shows an aura (`reveals: "aura"`, Detect Magic).
 * Read again when the view, an effect or an item changes (`forgetAuraWatchers`): `refreshMark` comes through here for each
 * token at each refresh, and almost no actor has such a sense.
 */
let watchers = null;
function auraWatchers() {
  return watchers ??= viewers().filter(doc => declaredSensesOf(doc.actor).some(sense => sense.reveals === "aura"));
}

/** The tokens through which this client sees (its vision sources, without the rules' disposable sources). */
let viewing = null;
function viewers() {
  if ( viewing ) return viewing;
  viewing = [];
  for ( const source of canvas.effects?.visionSources ?? [] ) {
    const doc = source.object?.document;
    if ( doc?.actor && !String(source.sourceId ?? "").startsWith(SIMULATED) && !viewing.includes(doc) ) viewing.push(doc);
  }
  return viewing;
}
function forgetAuraWatchers() {
  watchers = null;
  viewing = null;
}

/** World setting `anonymousLocated`; false as long as it is not readable. */
function anonymousRule() {
  try { return game.settings.get(MODULE_ID, "anonymousLocated") === true; } catch { return false; }
}

/**
 * Setting `anonymousLocated`: the image, name, bars, condition icons and border of a token perceived without being seen are
 * removed from this client's display, at each refresh (the core puts part of them back at each `refreshState`). Nothing is
 * written, the token's class is not replaced; as soon as it is no longer anonymous, the core is asked to redraw everything.
 */
const veiled = new Set();
const VEILED_PARTS = ["nameplate", "bars", "effects", "border"];   // the border: its color tells the creature's attitude
function veil(token, on) {
  if ( on ) {
    veiled.add(token.id);
    // Not its alpha: the core's mesh recomputes it at each frame (occlusion).
    if ( token.mesh ) token.mesh.visible = false;
    for ( const part of VEILED_PARTS ) if ( token[part] ) token[part].visible = false;
    return;
  }
  if ( !veiled.delete(token.id) || token.destroyed ) return;
  if ( token.mesh ) token.mesh.visible = token.visible;   // comme `Token#_refreshVisibility`
  for ( const part of VEILED_PARTS ) if ( token[part] ) token[part].visible = true;
  const known = token.constructor.RENDER_FLAGS ?? {};
  const flags = Object.fromEntries(["refreshState", "refreshNameplate", "refreshBars", "refreshEffects", "refreshBorder"]
    .filter(flag => flag in known).map(flag => [flag, true]));
  token.renderFlags?.set(flags);
}

function refreshMark(token) {
  if ( !canvas?.ready || !token?.document ) return;
  const kind = perceivedAs(token);
  if ( !kind ) { veil(token, false); dropMark(token.id); return; }
  let mark = marks.get(token.id);
  if ( mark && (mark.kind !== kind) ) { dropMark(token.id); mark = null; }
  if ( !mark ) marks.set(token.id, mark = buildMark(kind));
  if ( mark.root.parent !== markLayerOf() ) markLayerOf().addChild(mark.root);
  // Top left corner of the token (the hourglass takes the top right, the timers the top).
  mark.root.position.set(token.x + (mark.r * 0.6), token.y + (mark.r * 0.6));
  mark.label.visible = !!token.hover;
  const anonymous = hidesIdentity(kind, anonymousRule());
  veil(token, anonymous);
  if ( mark.stand ) {
    mark.stand.visible = anonymous;
    if ( anonymous ) {
      mark.stand.width = token.w ?? 0;
      mark.stand.height = token.h ?? 0;
      mark.stand.position.set(((token.w ?? 0) / 2) - (mark.r * 0.6), ((token.h ?? 0) / 2) - (mark.r * 0.6));
      // The outline with which the core draws this token (hearing, declared sense): the same one, on the silhouette.
      const outline = token.detectionFilter ?? null;
      if ( mark.stand.filters?.[0] !== outline ) mark.stand.filters = outline ? [outline] : null;
    }
  }
  if ( mark.ring ) {
    const size = Math.max(token.w ?? 0, token.h ?? 0);
    if ( size !== mark.ringSize ) {
      mark.ringSize = size;
      mark.ring.clear().lineStyle(Math.max(3, size * 0.04), MARKS.aura.line, 0.45).drawCircle(0, 0, size * 0.56);
    }
    mark.ring.position.set(((token.w ?? 0) / 2) - (mark.r * 0.6), ((token.h ?? 0) / 2) - (mark.r * 0.6));
  }
}

function clearMarks() {
  for ( const id of [...marks.keys()] ) dropMark(id);
  markLayer = null;
}

/** Issue #42: each client puts the ear on the tokens it hears, at their displayed position; nothing is written. */
function registerHeardMarks() {
  const opts = { label: "perception: hearing mark not drawn" };
  route("refreshToken", token => refreshMark(token), opts);
  route("hoverToken", token => refreshMark(token), opts);
  route("destroyToken", token => dropMark(token.id), opts);
  route("canvasTearDown", clearMarks, opts);
  for ( const hook of ["sightRefresh", "initializeVisionSources", "canvasTearDown", "createActiveEffect", "updateActiveEffect",
    "deleteActiveEffect", "createItem", "updateItem", "deleteItem"] ) route(hook, forgetAuraWatchers, opts);
}
