/**
 * Light level (SPEC §16.48): Bright, Dim or Darkness, at a point, then as an observer perceives it according to their senses.
 * 2024 rules (PHB glossary): Dim Light makes an area "Lightly Obscured" — Disadvantage on Wisdom (Perception) checks to see
 * anything in it; Darkness makes it "Heavily Obscured" — the Blinded condition for whoever tries to see in it. Here: the
 * computation, without Foundry; adapter/illumination.mjs reads the canvas sources.
 *
 * Source arbitration, like the V14 core: a light loses against a darkness source of higher OR EQUAL priority that
 * covers the point (client/canvas/sources/point-light-source.mjs:32 and :85, "light loses to darkness at the same priority");
 * global light has priority -Infinity (sources/global-light-source.mjs:22), so any darkness source puts it out.
 */

export const LIGHT = Object.freeze({ DARK: 0, DIM: 1, BRIGHT: 2 });

/** Names of the levels, for messages and tests. */
export const LIGHT_NAMES = Object.freeze(["dark", "dim", "bright"]);

/**
 * The light level at a point.
 * @param {object} input
 * @param {number|null} [input.global]   Level given by global light (already tested: active, darkness within its range), or null.
 * @param {Array<{priority: number, bright: boolean}>} [input.lights]  The lights that cover the point; `bright`: within their
 *                                                                     Bright Light radius.
 * @param {Array<{priority: number}>} [input.darkness]                 The darkness sources that cover the point.
 * @returns {{level: number, darkened: boolean}}  `darkened`: the point is within a darkness source that puts out at least
 *                                                one light there — magical Darkness, which Darkvision does not pierce.
 */
export function lightLevel({ global=null, lights=[], darkness=[] }={}) {
  const strongest = darkness.reduce((max, d) => Math.max(max, d.priority ?? 0), -Infinity);
  const survives = priority => (darkness.length === 0) || (priority > strongest);
  let level = LIGHT.DARK;
  let darkened = darkness.length > 0;
  if ( Number.isFinite(global) && survives(-Infinity) ) level = Math.max(level, global);
  for ( const light of lights ) {
    if ( !survives(light.priority ?? 0) ) continue;
    level = Math.max(level, light.bright ? LIGHT.BRIGHT : LIGHT.DIM);
  }
  // A magical light stronger than the Darkness restores lighting: the point is no longer in Darkness that counts.
  if ( level > LIGHT.DARK ) darkened = false;
  return { level, darkened };
}

/**
 * The light level as the observer perceives it at this point.
 * - Darkvision (in range): "see in Dim Light as if it were Bright Light, and in Darkness as if it were Dim Light";
 *   not through magical Darkness (Darkness: "Darkvision can't see through it").
 * - Devil's Sight (in range): "you can see normally in Dim Light and Darkness, both magical and nonmagical" → bright.
 * - Truesight (in range): "you see in normal and magical Darkness" → bright; its text says nothing about
 *   Dim Light, which stays dim.
 * @param {{level: number, darkened?: boolean}} light   Result of `lightLevel`.
 * @param {{darkvision?: boolean, truesight?: boolean, devilsSight?: boolean}} senses  Each sense: is the point in range?
 * @returns {number}
 */
export function perceivedLight({ level, darkened=false }, { darkvision=false, truesight=false, devilsSight=false }={}) {
  if ( level === LIGHT.DARK ) {
    if ( truesight || devilsSight ) return LIGHT.BRIGHT;
    if ( darkvision && !darkened ) return LIGHT.DIM;
    return LIGHT.DARK;
  }
  if ( (level === LIGHT.DIM) && (darkvision || devilsSight) ) return LIGHT.BRIGHT;
  return level;
}

/**
 * What this perceived level imposes on whoever tries to see at this point.
 * @param {number} perceived
 * @returns {{obscured: "none"|"light"|"heavy", perceptionDisadvantage: boolean, blinded: boolean}}
 */
export function obscurement(perceived) {
  if ( perceived === LIGHT.BRIGHT ) return { obscured: "none", perceptionDisadvantage: false, blinded: false };
  if ( perceived === LIGHT.DIM ) return { obscured: "light", perceptionDisadvantage: true, blinded: false };
  return { obscured: "heavy", perceptionDisadvantage: false, blinded: true };
}

/**
 * A token's light indicator (SPEC §16.50): the light where it stands, as OTHERS see it with no special sense
 * — it is what says whether it is visible or can hide —, and what it itself perceives there.
 * @param {{level: number, darkened?: boolean}} light   Result of `lightLevel` at its position.
 * @param {number} own                                   The level it perceives itself at its position (`perceivedLight`).
 * @returns {{key: "bright"|"dim"|"dark"|"magical", own: "bright"|"dim"|"dark"|null}}  `own`: null if it perceives the real level.
 */
export function lightIndicator({ level, darkened=false }, own) {
  const key = (level === LIGHT.DARK) ? (darkened ? "magical" : "dark") : LIGHT_NAMES[level];
  return { key, own: (Number.isFinite(own) && (own !== level)) ? LIGHT_NAMES[own] : null };
}

/**
 * The level global light gives at a point (SPEC §16.52). Like the core: active, and darkness at the point within its range
 * `darkness` (`testInsideLight`, groups/effects.mjs:331-337), bright if `bright` (groups/environment.mjs:320-331). In addition:
 * **twilight** — a bright global light counts as dim as soon as darkness reaches `twilight` (world setting;
 * 1 = never). The rules put dawn and dusk in Dim Light; Foundry has only one level per global light, and
 * a time module (Simple Timekeeping) varies only the darkness.
 * @param {{active: boolean, bright: number, darkness?: {min?: number, max?: number}}} global
 * @param {number} darkness   Darkness at the point (0–1).
 * @param {number} [twilight=1]
 * @returns {number|null}  `LIGHT.BRIGHT`, `LIGHT.DIM`, or null (global light does not light this point).
 */
export function globalLightLevel({ active, bright, darkness: range = {} }, darkness, twilight = 1) {
  const { min = 0, max = 1 } = range;
  if ( !active || !(darkness >= min) || !(darkness <= max) ) return null;
  if ( !(bright > 0) ) return LIGHT.DIM;
  return (darkness >= twilight) ? LIGHT.DIM : LIGHT.BRIGHT;
}
