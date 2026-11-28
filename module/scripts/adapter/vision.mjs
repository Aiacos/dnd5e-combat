/**
 * Simulated vision (SPEC §14.1, P1): "does THIS token see THIS token?", on any client,
 * for any pair, without changing anything about what is displayed.
 *
 * `canvas.visibility.testVisibility` answers for the client's ACTIVE vision sources (its
 * controlled tokens). Here, each observer gets a DISPOSABLE vision source, not attached
 * to the canvas — exactly what the core does for shared fog
 * (client/canvas/groups/visibility.mjs:668-690: `_createSharedFogVisionSource`, blindness states
 * copied, `initialize(_getVisionSourceData())`, memoized by `_visionSourceVersion`). Then we
 * replay the `testVisibility` loop (visibility.mjs:843-903) for that single source: lights
 * that grant sight, basic sight, light perception, special modes (Blindsight…).
 * The detection modes already judge Invisible and Blinded through the senses (detection-mode.mjs:106-130).
 *
 * Positions: the VALIDATED ones (`_source`, foundry-core-notes/v14-migration.md), never the visual
 * position — the vision origin as well as the target's test points.
 *
 * Fallback for NPCs without sight enabled on the token (most MM monsters): dnd5e 6
 * projects the sheet's senses onto `sight.range` and the special modes (documents/token.mjs:74-131,
 * setting `senseVisionSync`), but does not enable sight; the core then adds neither basic sight nor
 * light perception (documents/token.mjs, _prepareDetectionModes). We add them here, as
 * if sight were enabled: a creature without configured vision sees as its sheet says.
 *
 * Memoization: one source per observer, rebuilt when its vision version, position or
 * blindness states change; everything is discarded when walls, lights or the scene change
 * (runtime/vision.mjs), and destroyed on canvas teardown.
 */

import { committedPosition, distanceBetween, tokenCenter } from "./turn.mjs";
import { contentOf, identifierOf, declaresKey, worldOverrides } from "./content.mjs";
import { isPlainDarkness, discNearSegment, sensesThrough, CORE_JUDGED, DEVILS_SIGHT,
  devilsSightSees, senseReaches, senseless, countsAsSight, judgedModes } from "../core/light.mjs";
import { MODULE_ID } from "../constants.mjs";
import { fromPulseReached } from "../core/area.mjs";
import { revealedInvisible, seesInvisible } from "./facts.mjs";
import { outsideCone } from "./cone.mjs";
import { hiddenFrom } from "./stealth.mjs";
import { pinpoints } from "../core/senses.mjs";
import { lengthIn } from "./units.mjs";
import { perceivesPlane } from "./plane.mjs";
import { sensedBy, mutedSensesOf } from "./senses.mjs";
import { lightOnToken } from "./illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";

const SOURCE_PREFIX = "dnd5e-combat";

/** What this file asks of the core, checked once at `ready` (SPEC §13.3: fragile APIs isolated). */
export function checkVisionApi() {
  const missing = [];
  const Token = foundry.canvas.placeables.Token;
  if ( !CONFIG.Canvas?.visionSourceClass ) missing.push("CONFIG.Canvas.visionSourceClass");
  if ( typeof Token.prototype._getVisionSourceData !== "function" ) missing.push("Token#_getVisionSourceData");
  if ( typeof Token.prototype._getVisionBlindedStates !== "function" ) missing.push("Token#_getVisionBlindedStates");
  if ( typeof foundry.documents.TokenDocument.prototype.getVisibilityTestPoints !== "function" ) missing.push("TokenDocument#getVisibilityTestPoints");
  if ( typeof foundry.canvas.perception.DetectionMode.prototype.testVisibility !== "function" ) missing.push("DetectionMode#testVisibility");
  return missing;
}

/** Vision in service: the core API is there (check at `ready`) and the world setting wants it. */
let available = false;
export function setVisionAvailable(value) { available = !!value; }
export function isVisionAvailable() { return available; }

/* -------------------------------------------- */
/*  Sources jetables                            */
/* -------------------------------------------- */

const sources = new Map();   // token id → { source, key }
let generation = 0;          // walls, lights, scene: everything has to be redone

/** To call when the environment changes (walls, lights, scene, actors). */
export function invalidateVision() {
  generation++;
}

/** On canvas teardown: the sources are destroyed, nothing survives. */
export function disposeVision() {
  for ( const { source } of sources.values() ) source.destroy?.();
  sources.clear();
  generation++;
}

function blindedStates(token) {
  return token._getVisionBlindedStates();
}

function sourceKey(doc, token, pos, blinded) {
  return `${generation}|${token._visionSourceVersion ?? 0}|${pos.x},${pos.y},${pos.elevation}|${blinded.blind ? 1 : 0}${blinded.burrow ? 1 : 0}|${doc.sight.range}|${doc.sight.angle}|${doc.rotation}`;
}

/** This observer's vision source, at its validated position. null if the token is not drawn. */
function sourceFor(doc) {
  const token = doc.object;
  if ( !token || token.destroyed ) return null;
  const pos = committedPosition(doc);
  const blinded = blindedStates(token);
  const key = sourceKey(doc, token, pos, blinded);
  let entry = sources.get(doc.id);
  if ( entry?.key === key ) return entry.source;
  entry?.source.destroy?.();
  const source = new CONFIG.Canvas.visionSourceClass({ sourceId: `${SOURCE_PREFIX}.${doc.id}`, object: token });
  for ( const state in blinded ) source.blinded[state] = blinded[state];
  const data = token._getVisionSourceData();
  Object.assign(data, doc.getVisionOrigin(pos));   // validated position, not visual
  // Fallback without sight enabled (see detectionModesOf): the core then gives `lightRadius: 0` (Token#lightPerceptionRange,
  // placeables/token.mjs:772-775, for lack of a lightPerception mode on the document) and the source's light
  // polygon is empty — a human without Darkvision saw nothing, even in full light (seen on 2026-09-24,
  // MM Mage). null → the scene's maximum range (point-vision-source.mjs:211), bounded by walls.
  if ( !doc.sight.enabled && !(data.lightRadius > 0) ) data.lightRadius = null;
  source.initialize(data);
  sources.set(doc.id, { source, key });
  return source;
}

/**
 * The observer's detection modes, basic sight and light perception included even
 * without sight enabled. Normalized as `TokenDocument#_prepareDetectionModes` does (`enabled`
 * true by default, `range` null = unlimited): read on the document, a `range: null` goes through
 * to the core's range test, which takes it as "out of range" (`null <= 0`). Seen in play.
 * Issue #104: only the modes that the engine judges (`judgedModes`) — not the one another module registered on the token.
 */
function detectionModesOf(doc) {
  const modes = {};
  for ( const [id, mode] of Object.entries(judgedModes(doc.detectionModes)) ) {
    modes[id] = { ...mode, enabled: mode.enabled ?? true, range: (mode.range === null || mode.range === undefined) ? Infinity : mode.range };
  }
  if ( !doc.sight.enabled ) {
    modes.lightPerception ??= { enabled: true, range: Infinity };
    modes.basicSight ??= { enabled: true, range: doc.sight.range };
  }
  // `senseNeeds`: a sheet sense that depends on its bearer's hearing or sight, Deafened or Blinded — turned off.
  for ( const id of mutedSensesOf(doc) ) delete modes[id];
  return modes;
}

/** A target's test points at its validated position, in the shape expected by the detection modes. */
function testsFor(target, observer=null) {
  const pos = committedPosition(target);
  const level = canvas.scene.levels?.get?.(target.level) ?? canvas.level;
  const tests = target.getVisibilityTestPoints(pos).map(point => ({ point, level, los: new Map() }));
  // §161: the observer who sees the Invisible (See Invisibility) sees it like any other creature.
  return { object: asSeenBy(observer, target.object), level, tests };
}

/**
 * §161, issue #42: the target as to present it to the observer's detection modes — unveiled (`unveiled`) when it sees
 * the Invisible (See Invisibility, Third Eye) or when it cannot benefit from the condition (Faerie Fire, Stardust);
 * otherwise as is. Shared by the rules (`testsFor`) and the screen (ui/perception.mjs): on screen, basic sight refused
 * the Invisible while the rules saw it.
 * @param {TokenDocument|null} observer
 * @param {Token} target  The drawn token.
 */
export function asSeenBy(observer, target) {
  if ( !target?.document ) return target;
  return (revealedInvisible(target.document.actor, observer?.actor) || seesInvisible(observer?.actor)) ? unveiled(target) : target;
}

/**
 * §16.36: the target as the detection modes see it when it "cannot benefit from the Invisible condition"
 * (Stardust, Faerie Fire). Each core mode refuses an invisible target in its `_canDetect`
 * (detection-mode.mjs:118-121, detection-modes/darkvision.mjs:20-24…), via `target.document.hasStatusEffect`; we present it
 * a view of the token whose document does not carry Invisible — same prototype (`instanceof Token` holds), nothing is modified.
 */
function unveiled(token) {
  if ( !token ) return token;
  const invisible = CONFIG.specialStatusEffects.INVISIBLE;
  const doc = token.document;
  const view = Object.create(doc, { hasStatusEffect: { value: id => (id !== invisible) && doc.hasStatusEffect(id) } });
  return Object.create(token, { document: { value: view } });
}

/* -------------------------------------------- */

/**
 * Does the observer see the target? Vision, light, walls, special modes, Invisible and Blinded included,
 * at the validated positions.
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{ignoreHidden?: boolean, locating?: boolean, senseOnly?: boolean}} [options]  §185: judge as if the target were not
 *   hidden (the detection itself). `locating`: also count the senses that locate without seeing (`canLocate`). `senseOnly`
 *   (issue #107, with `locating`): ONLY those senses — no light, no sight mode, no declared sight (`pinpointsTarget`).
 * @returns {boolean|null}  null: cannot tell here (no canvas, token not drawn).
 */
export function canSee(observer, target, { ignoreHidden=false, locating=false, senseOnly=false }={}) {
  if ( !canvas?.ready || !observer || !target ) return null;
  if ( observer === target ) return true;
  if ( isSenseless(observer) ) return false;   // `unconsciousSenses` setting: Unconscious, no sight or hearing
  if ( !target.object || target.hidden ) return false;   // a token hidden by the GM is out of play for everyone
  if ( outsideCone(observer, target) ) return false;   // §182: out of combat, a GM creature only sees in front of it
  if ( !ignoreHidden && hiddenFrom(observer, target) ) return false;   // §185: Hidden, for an enemy that has not spotted it
  if ( !perceivesPlane(observer, target) ) return false;   // §225: from one plane to the other, only with Ethereal sight
  // §16.24 and §16.31: an area that blocks sight (Fog Cloud, Darkness) between the two, or around one of them. Read once,
  // and only if someone asks for it (a declared sight, then the sheet's sights).
  let zone = null;
  const between = () => (zone ??= blockedBetween(observer, target));
  // A sense declared by content (`sense`): it either locates without seeing — neither fog nor darkness stops it —, or it counts
  // as a sight: not of an Invisible target, not through fog, and through darkness only if it pierces it.
  const declared = sensedBy(observer, target, sceneBetween(observer, target, between));
  if ( (declared === "sight") && !senseOnly ) return true;
  if ( locating && (declared === "locate") ) return true;
  const source = sourceFor(observer);
  if ( !source ) return null;
  const config = testsFor(target, observer);

  // Sight does not pass the area — only the senses that do not see judge, and, in darkness, Truesight and
  // Devil's Sight.
  const blocked = between();
  if ( blocked.fog || blocked.darkness ) return seesThroughBlock(observer, target, source, config, blocked, locating, senseOnly);
  // §447: only Darkness cast by the observer, who sees through it (`seesThroughOwnDarkness`): "sees normally".
  if ( !senseOnly && blocked.ownDarkness && devilsSightSeesToken(observer, target, blocked) ) return true;

  // Lights that grant sight (the core tests them first, for everyone).
  for ( const light of senseOnly ? [] : canvas.effects.lightSources ) {
    if ( !light.data.vision || !light.active ) continue;
    if ( light.testVisibility(config) === true ) return true;
  }

  const modes = CONFIG.Canvas.detectionModes;
  const own = detectionModesOf(observer);
  // C12-e: Umbral Sight — "fully in Darkness, you are Invisible to anyone who relies on Darkvision to see you":
  // base sight (dnd5e's Darkvision) does not find it; light, Blindsight and Truesight do.
  const umbral = umbralTo(target);
  if ( umbral ) delete own.basicSight;
  if ( !source.isBlinded && !senseOnly ) {
    for ( const id of ["basicSight", "lightPerception"] ) {
      const mode = own[id];
      if ( mode && (modes[id]?.testVisibility(source, mode, config) === true) ) return true;
    }
  }
  for ( const [id, mode] of Object.entries(own) ) {
    if ( (id === "basicSight") || (id === "lightPerception") ) continue;
    if ( !locating && !countsAsSight(id) ) continue;   // Tremorsense locates, it does not see
    if ( senseOnly && countsAsSight(id) ) continue;    // issue #107: only the senses that locate without sight
    if ( modes[id]?.testVisibility(source, mode, config) === true ) return true;
  }
  return false;
}

/**
 * Does the observer know where the target is: do they see it, or does a non-sight sense locate it (Tremorsense)?
 * For what needs a known position and not sight: hiding, searching, aiming at a cell. Same safeguards as `canSee`.
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{ignoreHidden?: boolean}} [options]
 * @returns {boolean|null}
 */
export function canLocate(observer, target, { ignoreHidden=false }={}) {
  return canSee(observer, target, { ignoreHidden, locating: true });
}

/**
 * Issue #107: does the observer know the target's square? As `canLocate`, except that a sense which locates without sight
 * (Tremorsense, a declared `locate` sense) also pinpoints a creature Hidden from it (core/senses.mjs `pinpoints`). The creature
 * stays unseen (`canSee`) and Hidden: this is only for what needs a known position — aiming at its square, drawing it.
 * Hiding, Search and passive Perception keep `canLocate`.
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {boolean|null}
 */
export function pinpointsTarget(observer, target) {
  const located = canLocate(observer, target);
  const hidden = (located === false) && hiddenFrom(observer, target);
  const sensed = hidden ? canSee(observer, target, { ignoreHidden: true, locating: true, senseOnly: true }) : false;
  return pinpoints({ located, hidden, sensed });
}

/**
 * What the senses declared by content say about the target, with the safeguards of `canSee` (senses off, token hidden by the GM,
 * plane): `"sight"`, `"locate"`, `"presence"`, `"aura"`, or null. For display and for a neighbor (`api.vision.sensed`).
 */
export function sensedThrough(observer, target) {
  if ( !canvas?.ready || !observer || !target || (observer === target) ) return null;
  if ( isSenseless(observer) || !target.object || target.hidden || !perceivesPlane(observer, target) ) return null;
  return sensedBy(observer, target, sceneBetween(observer, target));
}

/**
 * What `sensedBy` reads from the scene between two tokens: the distance, a sight wall (darkness set aside), the observer Blinded
 * or Deafened, the target Invisible to it, the area that blocks sight between them (`blocked`: the one the caller already read).
 */
function sceneBetween(observer, target, blocked=() => blockedBetween(observer, target)) {
  return {
    distance: () => distanceBetween(observer, target).value,
    walled: () => !lineOfSightThrough(observer, target),
    blind: () => isBlind(observer),
    deaf: () => observer.actor?.statuses?.has?.("deafened") ?? false,
    invisible: () => invisibleTo(observer, target),
    blocked
  };
}

/** Is the target Invisible to this observer: it has the condition, the observer cannot see Invisible, nothing reveals it? */
function invisibleTo(observer, target) {
  if ( !target.hasStatusEffect?.(CONFIG.specialStatusEffects.INVISIBLE) ) return false;
  return !(revealedInvisible(target.actor, observer?.actor) || seesInvisible(observer?.actor));
}

/** C12-e: the target has Umbral Sight and stands in Darkness. */
function umbralTo(target) {
  if ( !Array.from(target.actor?.items ?? []).some(i => identifierOf(i).id === "umbral-sight") ) return false;
  const light = lightOnToken(target);
  return !!light && (light.level === LIGHT.DARK);
}

/**
 * The scene regions that block sight: fog (`obscures`, §16.24) or magical darkness (`light.darkness`,
 * §16.31), placed by an item's activity (`flags.dnd5e.activity`) — and those that block sound (Silence, `silences`, issue #42).
 * §447: `caster` — the actor whose SPELL placed the darkness (`seesThroughOwnDarkness`), otherwise null.
 * @returns {Array<{region: RegionDocument, kind: "fog"|"darkness"|"silence", caster?: Actor|null}>}
 */
export function blockingRegions(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    if ( !activity?.item ) continue;
    const entry = contentOf(activity.item).entry;
    if ( fromPulseReached(entry?.obscures, region.getFlag?.(MODULE_ID, "area")?.pulses) ) out.push({ region, kind: "fog" });
    else if ( entry?.light?.darkness === true ) out.push({ region, kind: "darkness", caster: (activity.item.type === "spell") ? (activity.item.actor ?? null) : null });
    if ( entry?.silences === true ) out.push({ region, kind: "silence" });   // issue #42: blocks sound, not sight (adapter/hearing.mjs)
  }
  return out;
}

/**
 * The darkness sources of the displayed scene that do not come from an engine area: a hand-placed darkness light,
 * a token that emits one (`isPlainDarkness`). Those of the engine's areas carry `flags.<module>.region` (adapter/lights.mjs).
 */
function plainDarknessSources(scene, observer=null, from=null, to=null) {
  if ( !canvas?.ready || (scene !== canvas.scene) ) return [];
  const out = [];
  for ( const source of canvas.effects?.darknessSources ?? [] ) {
    const engineZone = !!source.object?.document?.flags?.[MODULE_ID]?.region;
    const onLevel = sourceOnLevel(source, observer?.level ?? null);
    if ( !isPlainDarkness({ active: source.active, preview: source.isPreview, engineZone, onLevel }) ) continue;
    // A source whose circle is far from the line need not be sampled.
    if ( from && to && !discNearSegment({ x: source.x, y: source.y, radius: source.radius }, from, to) ) continue;
    out.push(source);
  }
  return out;
}

/**
 * Is the darkness source on the observer's level (V14 multi-level scenes)? Its document says so (`includedInLevel`:
 * a light with no levels ticked belongs to all, a token to its own); failing that, the level the source carries. With no
 * observer level, or nothing that says: yes.
 */
function sourceOnLevel(source, levelId) {
  if ( !levelId ) return true;
  const doc = source.object?.document;
  if ( typeof doc?.includedInLevel === "function" ) return doc.includedInLevel(levelId) !== false;
  const own = source.data?.level ?? null;
  return !own || (own === levelId);
}

/**
 * What blocks sight along a line (sampled every half-square), endpoints included: fog, darkness,
 * both, or nothing.
 * §447: `observer` — if it sees through the darkness of its own spells: it counts in `ownDarkness`, not in `darkness`.
 * @returns {{fog: boolean, darkness: boolean, silence: boolean, ownDarkness: boolean}}
 */
function blockedAlong(scene, from, to, observer=null) {
  const out = { fog: false, darkness: false, silence: false, ownDarkness: false };
  let regions = blockingRegions(scene);
  // Its items are read only if the observer itself has placed Darkness (this test runs on every sight refresh).
  const mine = r => (r.kind === "darkness") && observer?.actor && (r.caster?.uuid === observer.actor.uuid);
  if ( regions.some(mine) && ownDarknessSight(observer) ) regions = regions.map(r => mine(r) ? { ...r, kind: "ownDarkness" } : r);
  const plain = plainDarknessSources(scene, observer, from, to);
  if ( !regions.length && !plain.length ) return out;
  const grid = scene.grid;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (grid.size / 2)));
  for ( let k = 0; k <= steps; k++ ) {
    const t = k / steps;
    const point = { x: from.x + ((to.x - from.x) * t), y: from.y + ((to.y - from.y) * t),
      elevation: (from.elevation ?? 0) + (((to.elevation ?? 0) - (from.elevation ?? 0)) * t) };
    for ( const { region, kind } of regions ) if ( !out[kind] && region.testPoint?.(point) ) out[kind] = true;
    if ( !out.darkness && plain.some(source => source.testPoint(point)) ) out.darkness = true;
    if ( out.fog && out.darkness && out.silence && out.ownDarkness ) break;
  }
  return out;
}

/**
 * Does an area that blocks sight cut sight between two tokens — one of them inside, or the line joining them
 * crossing it? Validated positions. `{ fog, darkness }`.
 */
export function blockedBetween(a, b) {
  return blockedAlong(a.parent, tokenCenter(a), tokenCenter(b), a);
}

/**
 * §447: does the observer see normally through the Darkness of their own spells (`seesThroughOwnDarkness`: "Shadow Power")?
 * Its actor, or null.
 * @param {TokenDocument} observer
 */
export function ownDarknessSight(observer) {
  const actor = observer?.actor;
  if ( !actor ) return null;
  // Called for each token with sight on every sight refresh (ui/perception.mjs, `grantAll`): almost no
  // item declares this key — the entry (`contentOf`) is composed only for the one that has a layer carrying it.
  const overrides = worldOverrides();
  const key = "seesThroughOwnDarkness";
  const sees = item => declaresKey(item, key, overrides) && (contentOf(item).entry?.[key] === true);
  return Array.from(actor.items ?? []).some(sees) ? actor : null;
}

/** §447: is this point in Darkness that a spell of the observer placed, and does the observer see in it (`seesThroughOwnDarkness`)? */
export function inOwnDarkness(observer, point) {
  const actor = observer?.actor;
  if ( !actor || !point ) return false;
  const here = blockingRegions(observer.parent).some(r => (r.kind === "darkness") && (r.caster?.uuid === actor.uuid) && r.region.testPoint?.(point));
  return here && !!ownDarknessSight(observer);
}

/** A radius read in a rule's unit, converted to the grid's (the value as is if the unit is unknown). */
function toGridUnits(value, units, grid) {
  return lengthIn(value, units, grid.units);
}

/** The range of the observer's Devil's Sight, in grid units, or 0. */
export function devilsSightRange(observer) {
  const items = observer.actor?.items ?? [];
  if ( !items.some?.(i => identifierOf(i).id === DEVILS_SIGHT.identifier) ) return 0;
  return toGridUnits(DEVILS_SIGHT.range, DEVILS_SIGHT.units, observer.parent.grid);
}

/**
 * Through an area that blocks sight, does the observer perceive the target? The senses that pierce (core/light.mjs,
 * `sensesThrough`) are judged here on range and walls alone: in darkness, the core treats the source as blinded
 * (`blinded.darkness`, point-vision-source.mjs:186-190) and its own modes would fail. Tremorsense,
 * which ignores walls and blinding, is still judged by the core. Devil's Sight "sees normally": not an
 * Invisible target.
 */
function seesThroughBlock(observer, target, source, config, blocked, locating=false, senseOnly=false) {
  const own = detectionModesOf(observer);
  const distance = distanceBetween(observer, target).value;
  for ( const id of sensesThrough(blocked) ) {
    if ( id === DEVILS_SIGHT.mode ) continue;   // judged by the call itself, below (an NPC need not have the mode)
    if ( senseOnly && countsAsSight(id) ) continue;   // issue #107: only the senses that locate without sight
    const mode = own[id];
    if ( !mode || (mode.enabled === false) ) continue;
    if ( CORE_JUDGED.includes(id) ) {
      if ( !locating && !countsAsSight(id) ) continue;
      if ( CONFIG.Canvas.detectionModes[id]?.testVisibility(source, mode, config) === true ) return true;
      continue;
    }
    // Issue #42: line of sight without the darkness edges — otherwise neither Blindsight nor Truesight saw into it.
    if ( senseReaches({ distance, range: mode.range, lineOfSight: lineOfSightThrough(observer, target), sense: id, blind: isBlind(observer) }) ) return true;
  }
  return !senseOnly && devilsSightSeesToken(observer, target, blocked);
}

/**
 * `unconsciousSenses` setting: is the observer Unconscious, and does the world setting remove their senses?
 * @param {TokenDocument} observer
 */
export function isSenseless(observer) {
  const unconscious = observer?.actor?.statuses?.has?.("unconscious") ?? false;
  if ( !unconscious ) return false;
  let rule = false;
  try { rule = !!game.settings.get(MODULE_ID, "unconsciousSenses"); } catch { rule = false; }
  return senseless({ unconscious, rule });
}

/** Is the observer Blinded (core condition)? */
function isBlind(observer) {
  return !!observer?.hasStatusEffect?.(CONFIG.specialStatusEffects.BLIND);
}

/** Issue #42: from the observer's eyes, the line of sight to the target, without the edges of darkness sources. */
function lineOfSightThrough(observer, target) {
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenCenter(observer);
  return hasLineOfSight(eye, target, canvas.scene.levels?.get?.(observer.level), { throughDarkness: true, externalRadius: observer.object?.externalRadius ?? 0 });
}

/**
 * Issue #42: does the observer's Devil's Sight see the target ("sees normally in Darkness, magical or otherwise, to 120 ft")?
 * For the rules (`canSee`) as for the screen (the `devilsSight` detection mode, ui/perception.mjs). Validated positions.
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{fog: boolean}} [blocked]  What cuts sight between the two, if already known.
 */
export function devilsSightSeesToken(observer, target, blocked=null) {
  if ( !observer || !target ) return false;
  blocked ??= blockedBetween(observer, target);
  // §447: only its own Darkness between the two (`seesThroughOwnDarkness`) — "sees normally", with no range limit.
  const range = (blocked.ownDarkness && !blocked.darkness) ? Infinity : devilsSightRange(observer);
  if ( !range ) return false;
  const fog = blocked.fog;
  const invisible = !!target.hasStatusEffect?.(CONFIG.specialStatusEffects.INVISIBLE)
    && !revealedInvisible(target.actor, observer.actor) && !seesInvisible(observer.actor);
  const blind = isBlind(observer);
  const distance = distanceBetween(observer, target).value;
  if ( !devilsSightSees({ distance, range, invisible, blind, fog }) ) return false;
  return lineOfSightThrough(observer, target);
}

/**
 * Issue #42: does a sense that pierces darkness (Blindsight, Truesight) reach the target, for the screen? Mode range and
 * line of sight without the darkness edges; Blinded, only Blindsight still pierces.
 */
export function senseReachesToken(observer, target, range, sense=null) {
  return senseReaches({ distance: distanceBetween(observer, target).value, range: range ?? null, lineOfSight: lineOfSightThrough(observer, target),
    sense, blind: isBlind(observer) });
}

/**
 * Does the observer see this point ("an unoccupied space you can see", Misty Step)? Same test as `canSee`
 * — lights, sight, light perception, special modes, walls —, on the point alone, at the observer's level.
 * @param {TokenDocument} observer
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {boolean|null}  null: cannot tell (vision out of service, no canvas).
 */
export function canSeePoint(observer, point) {
  if ( !available || !canvas?.ready || !observer ) return null;
  if ( isSenseless(observer) ) return false;
  const source = sourceFor(observer);
  if ( !source ) return null;
  const level = canvas.scene.levels?.get?.(observer.level) ?? canvas.level;
  const config = { object: null, level, tests: [{ point: { x: point.x, y: point.y, elevation: point.elevation ?? 0 }, level, los: new Map() }] };
  // §16.31: a point in fog or darkness, or seen through it, is not seen — except by the senses that pierce them.
  const blocked = blockedAlong(observer.parent, tokenCenter(observer), point, observer);
  // §447: only its own Darkness (`seesThroughOwnDarkness`): normal sight, without their edges.
  if ( blocked.ownDarkness && !blocked.fog && !blocked.darkness ) {
    const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenCenter(observer);
    return CONFIG.Canvas.polygonBackends.sight.testCollision(eye, { x: point.x, y: point.y, elevation: point.elevation ?? eye.elevation },
      { type: "sight", mode: "any", level: level ?? undefined, edgeTypes: { source: false } }) !== true;
  }
  if ( blocked.fog || blocked.darkness ) {
    const own = detectionModesOf(observer);
    const grid = observer.parent.grid;
    const from = tokenCenter(observer);
    const distance = grid.measurePath([from, { x: point.x, y: point.y, elevation: point.elevation ?? from.elevation }]).distance;
    // A point ("a space you can see") is seen: the core's modes without walls (Tremorsense, Sense All, Sense Invisibility) do not
    // count.
    const ranges = sensesThrough(blocked).filter(id => !CORE_JUDGED.includes(id) && own[id] && (own[id].enabled !== false))
      .map(id => own[id].range);
    if ( blocked.darkness && !blocked.fog ) ranges.push(devilsSightRange(observer));
    if ( !ranges.some(r => r && (distance <= r)) ) return false;
    const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? from;
    // Issue #42: without the edges of darkness sources (clockwise-sweep.mjs:116-124, 163-175) — they cut every ray entering them.
    return CONFIG.Canvas.polygonBackends.sight.testCollision(eye, { x: point.x, y: point.y, elevation: point.elevation ?? eye.elevation },
      { type: "sight", mode: "any", level: level ?? undefined, edgeTypes: { source: false } }) !== true;
  }
  for ( const light of canvas.effects.lightSources ) {
    if ( !light.data.vision || !light.active ) continue;
    if ( light.testVisibility(config) === true ) return true;
  }
  const modes = CONFIG.Canvas.detectionModes;
  const own = detectionModesOf(observer);
  if ( source.isBlinded ) return Object.entries(own).some(([id, mode]) => !["basicSight", "lightPerception"].includes(id)
    && (modes[id]?.testVisibility(source, mode, config) === true));
  return Object.entries(own).some(([id, mode]) => modes[id]?.testVisibility(source, mode, config) === true);
}

/**
 * The two facts of an attack, or null if either cannot be established.
 * @returns {{attackerSees: boolean, targetSees: boolean}|null}
 */
export function visionFacts(attacker, target) {
  const attackerSees = canSee(attacker, target);
  const targetSees = canSee(target, attacker);
  if ( (attackerSees === null) || (targetSees === null) ) return null;
  return { attackerSees, targetSees };
}

/* -------------------------------------------- */
/*  Depuis un acteur, depuis un point           */
/* -------------------------------------------- */

/** An actor's token on the displayed scene: its own (unlinked), otherwise the first of its tokens. */
export function tokenOnViewedScene(actor) {
  if ( !actor ) return null;
  if ( actor.token?.parent === canvas?.scene ) return actor.token;
  return actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/**
 * Does one actor see another? For Reactions ("that you can see") and Frightened
 * ("as long as the source is in sight"). null: cannot tell (vision out of service, no token).
 */
export function seesBetween(observerActor, targetActor) {
  if ( !available ) return null;
  return canSee(tokenOnViewedScene(observerActor), tokenOnViewedScene(targetActor));
}

/**
 * From this point, is there a LINE OF SIGHT to the target? `sight` walls only — neither
 * light nor sense range: it is the cheap test of the approach ("a cell from which the target
 * is seen", SPEC §14.1), played on many candidate cells by the pathfinder.
 * @param {{x: number, y: number, elevation?: number}} point
 * @param {TokenDocument} target
 * @param {Level} [level]  Level whose walls are used (the observer's); otherwise the displayed level.
 * @param {{throughDarkness?: boolean, externalRadius?: number}} [options]  Issue #42: without the edges of darkness sources.
 *        `externalRadius` (§518): the observer's radius, for the window threshold (`Token#externalRadius`, token.mjs:3928).
 */
export function hasLineOfSight(point, target, level=undefined, { throughDarkness=false, externalRadius=0 }={}) {
  if ( !canvas?.ready || !target?.object ) return true;
  const backend = CONFIG.Canvas.polygonBackends.sight;
  const origin = { x: point.x, y: point.y, elevation: point.elevation ?? committedPosition(target).elevation ?? 0 };
  // P2: the walls of the observer's level (without `level`, the core takes the displayed level, source-polygon.mjs:187).
  // Issue #42: a core `sight` ray also counts the edges of darkness sources (clockwise-sweep.mjs:163-175, `sight` edges
  // of point-darkness-source.mjs:98-107) — every ray entering Darkness was cut. For a sense that pierces them (Devil's
  // Sight, Truesight, Blindsight), `throughDarkness` sets them aside (`edgeTypes`, clockwise-sweep.mjs:116-124): walls and
  // floors still count.
  // §518 (Discord, SpitFire): the threshold of "proximity" walls (windows) as for a token's vision (`useThreshold`,
  // sources/point-vision-source.mjs:293; `Edge#applyThreshold`, edges/edge.mjs:220) — without it, a window cut sight even
  // pressed against the pane, and an archer at their window was refused "out of sight".
  const config = { type: "sight", mode: "any", level: level ?? undefined, useThreshold: true, externalRadius,
    ...(throughDarkness ? { edgeTypes: { source: false } } : {}) };
  // P2: a floor or ceiling (`sight` Surface) cuts the line of sight like a wall — between the height
  // of the point and that of the target's eyes (Scene#testSurfaceCollision, a 3D ray cast).
  const scene = target.parent;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  return target.getVisibilityTestPoints(committedPosition(target)).some(p => {
    const end = { x: p.x, y: p.y, elevation: p.elevation ?? origin.elevation };
    if ( backend.testCollision(origin, end, config) === true ) return false;
    return !(surfaces && (scene.testSurfaceCollision(origin, end, { type: "sight", mode: "any" }) === true));
  });
}
