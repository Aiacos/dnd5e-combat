/**
 * Light and darkness of spells (SPEC §16.31, `light` key of core/content.mjs). dnd5e 6 and the PHB 2.2.0 give these spells no
 * light source at all (Darkness and Daylight: utility activity with a Sphere; "Stardust" and Faerie Fire: effect without changes);
 * yet the V14 core can do everything — ambient light, darkness source
 * (`config.negative`), and `token.light.*` changes carried by an Active Effect (client/documents/actor.mjs:248).
 * Here: the calculations, without Foundry.
 *
 * Radii in Foundry's convention: `bright` = radius of the Bright Light, `dim` = OUTER radius of the Dim Light
 * (Daylight: bright for 60 feet and dim for 60 feet more → bright 60, dim 120).
 */

/** Les modes de `light.on`. */
export const LIGHT_ON = Object.freeze(["area", "effect", "summon", "wall", "caster"]);

/**
 * The radii of an area's source: those of the rule, otherwise (darkness) the radius of the area itself.
 * @param {{bright?: number, dim?: number, darkness?: boolean}} rule   Radii already in the grid unit.
 * @param {number} areaRadius                                         Radius of the area, grid unit.
 * @returns {{bright: number, dim: number, negative: boolean}}
 */
export function areaLightRadii(rule, areaRadius) {
  if ( rule.darkness ) return { bright: areaRadius, dim: areaRadius, negative: true };
  const bright = rule.bright ?? 0;
  return { bright, dim: Math.max(rule.dim ?? bright, bright), negative: false };
}

/**
 * The Active Effect changes that make the bearer shine (`token.light.*`, applied by the V14 core). `upgrade`: a
 * stronger light already carried (torch, another spell) is not reduced.
 * @param {{bright?: number, dim?: number, color?: string|null, animation?: object|null}} light  Radii, grid unit.
 */
export function tokenLightChanges({ bright=0, dim=0, color=null, animation=null, alpha=null, angle=null }) {
  const changes = [];
  const push = (key, value, type) => changes.push({ key: `token.light.${key}`, type, value: String(value), phase: "initial" });
  if ( bright > 0 ) push("bright", bright, "upgrade");
  push("dim", Math.max(dim, bright), "upgrade");
  if ( color ) push("color", color, "override");
  if ( Number.isFinite(alpha) ) push("alpha", alpha, "override");
  // §52: a Cone (bullseye lantern), oriented like the token.
  if ( Number.isFinite(angle) && (angle > 0) && (angle < 360) ) push("angle", angle, "override");
  if ( animation?.type ) {
    push("animation.type", animation.type, "override");
    if ( Number.isFinite(animation.speed) ) push("animation.speed", animation.speed, "override");
    if ( Number.isFinite(animation.intensity) ) push("animation.intensity", animation.intensity, "override");
  }
  return changes;
}

/**
 * The darkness that a light dispels (Daylight: "if any of this spell's area overlaps with an area of Darkness created by a
 * spell of level 3 or lower, the spell that created the Darkness is dispelled"). Two Spheres overlap when their centers are
 * closer than the sum of the radii.
 * @param {{x: number, y: number, radius: number}} light
 * @param {number} maxLevel
 * @param {Array<{id: string, x: number, y: number, radius: number, level: number|null}>} darkness
 * @returns {string[]}  The dispelled ids.
 */
export function dispelledBy(light, maxLevel, darkness) {
  return darkness.filter(d => {
    if ( Number.isFinite(d.level) && (d.level > maxLevel) ) return false;
    return Math.hypot(d.x - light.x, d.y - light.y) < (d.radius + light.radius);
  }).map(d => d.id);
}

/**
 * Does a darkness source of the scene count as Darkness for the rules? Yes for one that a GM placed by hand
 * (or that a token emits): the core already opposes it to Darkvision, and its edges stop all of its detection modes — so Blindsight
 * and Truesight, which darkness does not stop, must be judged by the engine. Not for the light of an engine area
 * (`engineZone`): its region already represents it, and knows who cast it. Nor for a source on a different level of the scene
 * than the observer's (`onLevel: false`): the core's test (`PointDarknessSource#testPoint`) ignores
 * elevation — a darkness light on the ground floor would otherwise cover two tokens upstairs.
 * @param {{active: boolean, preview?: boolean, engineZone?: boolean, onLevel?: boolean}} source
 */
export function isPlainDarkness({ active, preview=false, engineZone=false, onLevel=true }) {
  return !!active && !preview && !engineZone && (onLevel !== false);
}

/**
 * Can a disc touch a segment? To rule out, before sampling the line of sight, a source whose circle is far
 * from it. `margin`: the tolerance (the core tests a point at ±1 px, and a source's polygon never exceeds its radius).
 * With no known radius: yes (we sample).
 * @param {{x: number, y: number, radius?: number}} disc
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {number} [margin]
 */
export function discNearSegment(disc, from, to, margin=2) {
  if ( !Number.isFinite(disc?.radius) || !Number.isFinite(disc?.x) || !Number.isFinite(disc?.y) ) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length2 = (dx * dx) + (dy * dy);
  const t = length2 ? Math.max(0, Math.min(1, (((disc.x - from.x) * dx) + ((disc.y - from.y) * dy)) / length2)) : 0;
  return Math.hypot(disc.x - (from.x + (dx * t)), disc.y - (from.y + (dy * t))) <= (disc.radius + margin);
}

/**
 * The senses that pierce an area that blocks sight. Fog (`obscures`): those that do not see (Blindsight, and the core modes without
 * walls: `CORE_JUDGED`). Magical Darkness: those, plus Truesight (`seeAll` of dnd5e) and Devil's Sight — Darkvision
 * sees nothing in it (PHB 2024, Darkness).
 * Devil's Sight is judged separately (range, adapter/vision.mjs).
 * @param {{fog: boolean, darkness: boolean}} blocked
 */
export function sensesThrough({ fog, darkness }) {
  if ( fog ) return ["blindsight", ...CORE_JUDGED];
  if ( darkness ) return ["blindsight", ...CORE_JUDGED, "seeAll", DEVILS_SIGHT_MODE];
  return null;
}

/**
 * The core's detection modes without walls or light (`walls: false`, client/config.mjs:1312-1337): Tremorsense, and
 * the generic "Sense All" / "Sense Invisibility" modes that a GM ticks by hand. They pierce fog and darkness, and the
 * core's test judges them as they are (neither darkness edges nor blinding: `DetectionMode#_canDetect`, detection-mode.mjs).
 * Issue #42: the last two were perceived on screen through Darkness, but not by the rules.
 */
export const CORE_JUDGED = Object.freeze(["feelTremor", "senseAll", "senseInvisibility"]);

/**
 * The modes that locate without seeing. Tremorsense gives the position of a creature in contact with the same
 * surface, but is not sight (PHB 2024, glossary): the target stays "unseen" — Disadvantage to attack it, Advantage for
 * it, and anything that requires seeing its target does not take it. Its position, however, is known.
 */
export const LOCATING = Object.freeze(["feelTremor"]);

/** Does this detection mode count as sight? */
export const countsAsSight = id => !LOCATING.includes(id);

/**
 * Range of Devil's Sight ("within 120 feet"), in feet. `mode`: the id of the detection mode that the engine registers
 * (issue #42, ui/perception.mjs) and gives in memory to the tokens whose actor has the summoning.
 */
export const DEVILS_SIGHT_MODE = "devilsSight";
export const DEVILS_SIGHT = Object.freeze({ identifier: "devils-sight", range: 120, units: "ft", mode: DEVILS_SIGHT_MODE });

/**
 * The detection modes that the engine knows and judges for "does it see?": basic sight, the core's light perception and "See
 * Invisibility" (a sight mode, with walls, that a GM ticks by hand: it lets one see an Invisible target), dnd5e's Truesight
 * and Blindsight, the engine's Devil's Sight, and the core's modes without walls (`CORE_JUDGED`).
 * A mode registered by another module — a ranged "hearing", a house-rule sense — is not one: the engine does not know
 * whether it lets one see or only locate, and counting it made an Invisible creature that was merely heard "seen" (issue #104).
 */
export const JUDGED_MODES = Object.freeze(["basicSight", "lightPerception", "seeInvisibility", "seeAll", "blindsight",
  DEVILS_SIGHT_MODE, ...CORE_JUDGED]);

/** These modes of a token, without those the engine does not judge (`JUDGED_MODES`). Same shape: `{ id: mode }`. */
export function judgedModes(modes) {
  return Object.fromEntries(Object.entries(modes ?? {}).filter(([id]) => JUDGED_MODES.includes(id)));
}

/**
 * Issue #42, continued (0.281.1): the filter of a creature seen by Devil's Sight (ui/perception.mjs): token tinted red, dark red
 * border. A special mode WITHOUT a filter is only drawn under the core's vision veil: in Darkness seen from outside,
 * the "visible" token stayed a black silhouette. With a filter, the core redraws it above the veil (placeables/token.mjs,
 * `detectionFilterMesh`).
 */
export const DEVILS_SIGHT_OUTLINE = Object.freeze({ outlineColor: Object.freeze([0.6, 0.08, 0.08, 1]), thickness: 2, knockout: false, wave: false,
  // User's choice (2026-11-11): a sharp token must mean "normal sight" — Devil's Sight also tints the token red.
  tintColor: Object.freeze([1, 0.22, 0.18]), tintStrength: 0.65 });

/** The line of the core's outline shader (rendering/filters/outline-overlay.mjs) where the token's color is composed. */
const OUTLINE_TEXCOLOR = "vec4 texColor = mix(baseColor, wColor, k) * texAlpha;";

/**
 * Issue #42, continued: the core's outline shader, with the red tint of Devil's Sight on the token (luminance × tint, blended
 * with the original color according to `tintStrength`; premultiplied colors, the alpha is not touched). Null if the expected
 * line is no longer there (core changed): the caller then keeps the outline alone.
 * @param {string} source  The fragment shader of `OutlineOverlayFilter`.
 * @returns {string|null}
 */
export function tintOutlineShader(source) {
  if ( (typeof source !== "string") || !source.includes(OUTLINE_TEXCOLOR) || !source.includes("void main(void)") ) return null;
  return source
    .replace("void main(void)", `uniform vec3 tintColor;
    uniform float tintStrength;

    void main(void)`)
    .replace(OUTLINE_TEXCOLOR, `${OUTLINE_TEXCOLOR}
      float tintLum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
      texColor.rgb = mix(texColor.rgb, tintLum * tintColor, tintStrength);`);
}

/**
 * Issue #42, continued: a token judged visible by this client, but drawn UNDER the vision veil — shown without a detection
 * filter, outside its own sight, and outside the area that each active source sees (the sight polygon). What the player then
 * sees: nothing, or a black silhouette. A display defect (runtime/testing-vision.mjs, "veiled" state).
 * @param {{visible: boolean, filtered: boolean, ownVision?: boolean, inSight: boolean}} state
 */
export function drawnUnderVeil({ visible, filtered, ownVision=false, inSight }) {
  return !!visible && !filtered && !ownVision && !inSight;
}

/** Issue #42: the special hearing mode of a Blinded observer (ui/perception.mjs), given in memory like Devil's Sight. */
export const HEARING_MODE = "dasHearing";

/**
 * The special mode of the senses declared by content (`sense` key: detections, Divine Sense), given in memory to the tokens whose
 * actor has one (ui/perception.mjs): the located creature is drawn with an outline, like one that is heard.
 */
export const SENSE_MODE = "dasSense";

/** The outline of a creature located by a declared sense: pale violet, undulating (hearing is pale blue). */
export const SENSE_OUTLINE = Object.freeze({ outlineColor: Object.freeze([0.78, 0.6, 1, 1]), knockout: true, wave: true });

/**
 * The vision modes that the engine registers for a sense's field of view (ui/perception.mjs): the map is seen up to its
 * range, in its own way — in color for Truesight and Devil's Sight ("sees normally"), without color for
 * Blindsight. The image settings of these three modes (contrast, saturation, brightness, and for Blindsight the colorless image
 * that requires a lit background) are those of the Vision 5e module, `scripts/vision-modes/`; ui/perception.mjs
 * (`fieldModes`) makes them the vision modes. Their notice:
 *
 * MIT License
 *
 * Copyright (c) 2023 dev7355608
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export const FIELD_MODES = Object.freeze({
  seeAll: Object.freeze({ id: "dasTruesight", label: "DND5E.SenseTruesight", contrast: 0, saturation: 0, brightness: 1 }),
  blindsight: Object.freeze({ id: "dasBlindsight", label: "DND5E.SenseBlindsight", contrast: 0.3, saturation: -1, brightness: 0,
    grey: true }),
  devilsSight: Object.freeze({ id: "dasDevilsSight", label: "DND5ECOMBAT.Vision.DevilsSight", contrast: 0, saturation: 0,
    brightness: 1 })
});

/**
 * A token's field of view from its senses: the one of greatest range, among Darkvision (what dnd5e has already
 * projected onto the token) and Truesight, Blindsight, Devil's Sight — at equal range, in that order. null:
 * nothing to change (none of these three senses, or the Darkvision reaches farther). dnd5e projects Truesight like
 * Darkvision (without color) and does not project Blindsight: the map stayed black for one who nevertheless "sees"
 * up to that range.
 * @param {{darkvision?: number, seeAll?: number, blindsight?: number, devilsSight?: number}} ranges  Grid unit; 0 or
 *   absent: without this sense.
 * @returns {{sense: string, range: number, visionMode: string, contrast: number, saturation: number, brightness: number}|null}
 */
export function fieldOfView({ darkvision=0, seeAll=0, blindsight=0, devilsSight=0 }={}) {
  let best = null;
  for ( const [sense, range] of [["seeAll", seeAll], ["blindsight", blindsight], ["devilsSight", devilsSight]] ) {
    if ( (range > 0) && (range > (best?.range ?? 0)) ) best = { sense, range };
  }
  if ( !best || !(best.range >= (darkvision || 0)) ) return null;
  const { id, contrast, saturation, brightness } = FIELD_MODES[best.sense];
  return { ...best, visionMode: id, contrast, saturation, brightness };
}

/**
 * Issue #42: sets on a token's PREPARED detection modes (plain object, never the source) those that the engine gives in memory —
 * Devil's Sight (range, grid unit; 0 = no summoning: removed) and the hearing of a Blinded creature, set last (the core
 * tries the special modes in order: a real sense comes first). Returns true if something was missing or differed: the preparation
 * of the token's data (`TokenDocument#reset`) had erased them, or an effect `token.detectionModes.devilsSight.range` had left a
 * mode without `enabled` — sight must then be redone.
 * @param {Record<string, {enabled?: boolean, range?: number|null}>} modes
 * `sense`: the actor has a sense declared by content — its mode, with no range of its own (each sense has its own), removed
 * otherwise.
 * @param {{devilsSight?: number, sense?: boolean, hearing?: boolean}} wanted
 */
export function grantInMemoryModes(modes, { devilsSight=0, sense=false, hearing=false }={}) {
  let changed = false;
  const had = modes[DEVILS_SIGHT_MODE];
  if ( devilsSight > 0 ) {
    changed ||= (had?.enabled !== true) || (had.range !== devilsSight);
    modes[DEVILS_SIGHT_MODE] = { enabled: true, range: devilsSight };
  }
  else if ( had ) { changed = true; delete modes[DEVILS_SIGHT_MODE]; }
  if ( sense ) {
    changed ||= modes[SENSE_MODE]?.enabled !== true;
    modes[SENSE_MODE] = { enabled: true, range: Infinity };
  }
  else if ( modes[SENSE_MODE] ) { changed = true; delete modes[SENSE_MODE]; }
  if ( hearing ) {
    const keys = Object.keys(modes);
    changed ||= (modes[HEARING_MODE]?.enabled !== true) || (keys.at(-1) !== HEARING_MODE);
    delete modes[HEARING_MODE];
    modes[HEARING_MODE] = { enabled: true, range: Infinity };
  }
  return changed;
}

/**
 * Issue #42: does Devil's Sight see the target? "You can see normally in Darkness, both magical and nonmagical, to a
 * distance of 120 feet": in range, line of sight (walls, floors — not the edges of darkness), observer not Blinded, target
 * neither Invisible (unless revealed) nor in fog (Devil's Sight pierces darkness, not fog).
 * @param {object} state
 * @param {number} state.distance   Distance observer → target, grid unit.
 * @param {number} state.range      Range of Devil's Sight, same unit; 0: no summoning.
 * @param {boolean} [state.lineOfSight]  Line of sight without the edges of the darkness sources.
 * @param {boolean} [state.invisible]    Target Invisible, not revealed to the observer.
 * @param {boolean} [state.blind]        Observer Blinded.
 * @param {boolean} [state.fog]          Fog cuts the sight between the two.
 */
export function devilsSightSees({ distance, range, lineOfSight=true, invisible=false, blind=false, fog=false }) {
  if ( !(range > 0) || !Number.isFinite(distance) || (distance > range) ) return false;
  return !!lineOfSight && !invisible && !blind && !fog;
}

/** The senses that are not sight: a Blinded observer keeps them (Blindsight, and the core modes without walls). */
/**
 * Setting `unconsciousSenses`: an Unconscious creature is "unaware of its surroundings" (PHB 2024, glossary) — with the
 * setting, it neither sees nor hears anything anymore. Without it (default), its senses stay those of an awake creature.
 * @param {{unconscious: boolean, rule: boolean}} state
 */
export function senseless({ unconscious=false, rule=false }={}) {
  return !!(unconscious && rule);
}

export const WORKS_BLIND = Object.freeze(["blindsight", ...CORE_JUDGED]);

/**
 * Issue #42: does a sense that pierces an area that blocks sight (Blindsight, Truesight) reach the target? Its range and the line
 * of sight (without the edges of darkness); `range` null or absent = unlimited. A Blinded observer (`blind`) no longer sees
 * through a sense that is sight (`sense` outside `WORKS_BLIND`: Truesight) — Blindsight, however, remains.
 */
export function senseReaches({ distance, range=null, lineOfSight=true, sense=null, blind=false }) {
  if ( blind && !WORKS_BLIND.includes(sense) ) return false;
  if ( !lineOfSight || !Number.isFinite(distance) ) return false;
  return (range === null) || (range === Infinity) || (distance <= range);
}

/* -------------------------------------------- */
/*  Duration and fuel of carried sources        */
/* -------------------------------------------- */

const BURN_SECONDS = { second: 1, minute: 60, hour: 3600 };

/**
 * §121: the duration of a carried source (`carriedLight.burn`), in seconds: "a torch burns for 1 hour", "a flask of oil
 * burns for 6 hours in a lamp or a lantern". null: no duration.
 * @param {{value: number, units: "second"|"minute"|"hour"}|undefined} burn
 */
export function burnSeconds(burn) {
  const n = Number(burn?.value);
  return (Number.isFinite(n) && (n > 0) && BURN_SECONDS[burn.units]) ? n * BURN_SECONDS[burn.units] : null;
}

/**
 * §121: what lighting requires. `stored`: the time that remained when it was put out (undefined: never lit — a new
 * torch, a filled lamp); `full`: a whole torch, a whole flask; `fuel`: the source burns a fuel (lamp,
 * lantern); `hasFuel`: the bearer has a flask.
 * @returns {{ok: true, left: number|null, refill: boolean}|{ok: false, reason: "noFuel"}}
 */
export function lightPlan({ stored, full, fuel=false, hasFuel=false }) {
  if ( !Number.isFinite(full) ) return { ok: true, left: null, refill: false };
  if ( (stored === undefined) || (stored === null) ) return { ok: true, left: full, refill: false };
  if ( stored > 0 ) return { ok: true, left: Math.min(stored, full), refill: false };
  if ( !fuel ) return { ok: true, left: full, refill: false };   // a burnt-out torch has given way to the next one
  return hasFuel ? { ok: true, left: full, refill: true } : { ok: false, reason: "noFuel" };
}

/**
 * §121: the source has burnt out. A torch, a candle: the burnt unit disappears (quantity − 1, the item removed at the last one),
 * the next will be new; a lamp, a lantern: it stays, empty (a flask will be needed to relight it).
 * @returns {{consume: boolean, stored: number|undefined}}
 */
export function burnoutPlan({ fuel=false }) {
  return fuel ? { consume: false, stored: 0 } : { consume: true, stored: undefined };
}

/** The remaining time in hours and minutes (rounded up to the minute). */
export function burnParts(seconds) {
  const minutes = Math.max(0, Math.ceil((Number(seconds) || 0) / 60));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * §121: the hands occupied by what the creature holds — an equipped weapon (two if it is "two-handed"), a shield, a
 * lit light source. A creature has two hands.
 * @param {Array<{name: string, hands: number}>} held
 * @returns {{used: number, free: number}}
 */
export function handsOf(held) {
  const used = held.reduce((n, h) => n + Math.max(0, Number(h.hands) || 0), 0);
  return { used, free: Math.max(0, 2 - used) };
}
