/**
 * Hearing (§62) read from Foundry: does the observer hear the target? Deafness (Deafened condition), hidden target (the
 * engine's Hide effect, adapter/search.mjs), dead target, and the walls and floors that stop sound (`sound` collision engine
 * and the core's Surfaces, levels). Validated positions (`_source`). The rule is in core/hearing.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { hears, hearingRange, beyondHearing } from "../core/hearing.mjs";
import { tokenCenter, distanceBetween } from "./turn.mjs";
import { hiddenDcOf } from "./search.mjs";
import { isObjectToken } from "./bodies.mjs";
import { trapLike } from "./content.mjs";
import { blockedBetween, isSenseless } from "./vision.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

/**
 * Does a wall or floor that stops sound separate the two tokens? Like the core's sight (detection-mode.mjs:211-259), walls and
 * Surfaces (`defineSurface` regions, scene.mjs:836) are tested separately: walls in each token's level, Surfaces of all levels
 * (a floor attached only to the level above also stops sound that rises). A target in a level that cannot be seen from the
 * observer's own (`Level#visibility.levels`, token.mjs:399-417) is not heard either: otherwise it would be "detected", and the
 * core would fade out for it the image of the level covering it.
 */
function soundBlocked(observer, target) {
  const scene = observer.parent;
  const levels = scene.levels;
  const own = levels?.get?.(observer.level);
  if ( own && (target.level !== observer.level) && !target.includedInLevel?.(own) ) return true;
  const a = tokenCenter(observer);
  const b = tokenCenter(target);
  if ( scene.testSurfaceCollision?.(a, b, { type: "sound", mode: "any" }) === true ) return true;
  const backend = CONFIG.Canvas.polygonBackends?.sound;
  if ( !backend ) return false;
  for ( const id of new Set([observer.level, target.level]) ) {
    const level = levels?.get?.(id);
    if ( backend.testCollision(a, b, { type: "sound", mode: "any", level: level ?? undefined }) === true ) return true;
  }
  return false;
}

/** `hearingRange` setting: each actor's range, in feet, for the current formula (read once, not for each pair). */
let ranges = new WeakMap();

/** The sheet, its effects or its items changed, or the setting: the ranges are re-read. */
export function clearHearingRanges() {
  ranges = new WeakMap();
}

/**
 * `hearingRange` setting: the observer's hearing range, in the unit of their scene; null — no range — when the setting is
 * empty (the official rule). The formula is evaluated with the actor's roll data (`@skills.prc.passive`…), in feet.
 * @param {TokenDocument} observer
 * @returns {number|null}
 */
export function hearingRangeOf(observer) {
  let formula = "";
  try { formula = String(game.settings.get(MODULE_ID, "hearingRange") ?? "").trim(); } catch { formula = ""; }
  const actor = observer?.actor;
  if ( !formula || !actor ) return null;
  let known = ranges.get(actor);
  if ( known?.formula !== formula ) {
    let value = null;
    try { value = Roll.safeEval(Roll.replaceFormulaData(formula, actor.getRollData?.() ?? {}, { missing: "0" })); }
    catch { value = null; }
    known = { formula, feet: hearingRange(value) };
    ranges.set(actor, known);
  }
  if ( known.feet === null ) return null;
  return lengthIn(known.feet, "ft", observer.parent?.grid?.units ?? "ft", readUnitFactors());
}

/**
 * L'observateur entend-il la cible ?
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {boolean}
 */
export function canHear(observer, target) {
  if ( !observer || !target || (observer === target) || target.hidden || (observer.parent !== target.parent) ) return false;
  const statuses = s => target.actor?.statuses?.has(s) ?? false;
  return hears({
    // `unconsciousSenses` setting: Unconscious, it no longer hears anything either.
    deafened: (observer.actor?.statuses?.has("deafened") ?? false) || isSenseless(observer),
    hidden: hiddenDcOf(target.actor) !== null,
    // §255: an object (placed trap, Spiritual Weapon) or a trap actor makes no noise — a trap spotted out of sight would
    // show up as "heard".
    silent: statuses("dead") || isObjectToken(target) || trapLike(target.actor),
    // Issue #42: Silence — "no sound can be created within or pass through the Sphere": the target inside, or the line
    // joining them passing through it (the observer inside is already Deafened by the area, §37.4).
    soundBlocked: soundBlocked(observer, target) || blockedBetween(observer, target).silence,
    outOfRange: outOfHearing(observer, target)
  });
}

/** Is the target beyond the observer's hearing range? With no range, the distance is not read. */
function outOfHearing(observer, target) {
  const range = hearingRangeOf(observer);
  return (range !== null) && beyondHearing(distanceBetween(observer, target).value, range);
}
