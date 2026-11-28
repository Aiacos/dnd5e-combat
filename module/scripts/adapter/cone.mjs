/**
 * §182: an observer's vision cone, read from Foundry (`core/cone.mjs`). Applies to a **GM** creature (neither PC nor
 * owned by a player), **outside a started combat** in which it appears, when the world setting `visionCones` is on.
 * Angle: token flag `flags.dnd5e-combat.coneAngle` > per-type `coneAngles` setting > default; a narrower token `sight.angle`
 * wins. Blindsight, Tremorsense and Truesight: 360° within their range.
 */

import { MODULE_ID } from "../constants.mjs";
import { parseConeAngles, coneAngleFor, inCone, formatConeAngles } from "../core/cone.mjs";
import { committedPosition, tokenCenter } from "./turn.mjs";
import { settingOr } from "./settings.mjs";

export const CONES_SETTING = "visionCones";
export const ANGLES_SETTING = "coneAngles";
export const DEFAULT_ANGLES_TEXT = formatConeAngles();

/** Senses that perceive all around (ids of the core's and dnd5e's detection modes). */
const ALL_AROUND = ["blindsight", "feelTremor", "seeAll"];

let cachedText = null;
let cachedTable = null;
function angles() {
  let text;
  try { text = game.settings.get(MODULE_ID, ANGLES_SETTING); } catch { text = DEFAULT_ANGLES_TEXT; }
  if ( text !== cachedText ) { cachedText = text; cachedTable = parseConeAngles(text); }
  return cachedTable;
}

function enabled() {
  return settingOr(CONES_SETTING, false) === true;
}

/** A PC, or a creature that a player owns: never a cone (the player sees what they see). */
const playerSide = actor => !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);

/** Does it appear in a started combat? */
function fighting(doc) {
  return !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc.id));
}

/**
 * An observer's cone, or null if it sees in 360° (setting off, PC, in combat, angle ≥ 360).
 * @param {TokenDocument} doc
 * @returns {{angle: number, rotation: number}|null}
 */
export function coneOf(doc) {
  if ( !doc?.actor || !enabled() || playerSide(doc.actor) || fighting(doc) ) return null;
  const details = doc.actor.system?.details ?? {};
  const own = Number(doc.getFlag?.(MODULE_ID, "coneAngle"));
  let angle = Number.isFinite(own) && (own > 0) ? own : coneAngleFor(angles(), {
    type: details.type?.value ?? null, subtype: details.type?.subtype ?? null, identifier: doc.actor.system?.identifier ?? null
  });
  const sight = Number(doc.sight?.angle);
  if ( Number.isFinite(sight) && (sight > 0) && (sight < angle) ) angle = sight;
  if ( !(angle < 360) ) return null;
  return { angle, rotation: Number(doc.rotation) || 0 };
}

/** The range (grid units) of a sense that perceives all around, the largest; 0 if none. */
function allAroundRange(doc) {
  let best = 0;
  for ( const id of ALL_AROUND ) {
    const mode = doc.detectionModes?.[id];
    if ( !mode || (mode.enabled === false) ) continue;
    const range = (mode.range === null || mode.range === undefined) ? Infinity : Number(mode.range);
    if ( range > best ) best = range;
  }
  return best;
}

/**
 * Is the target **outside** the observer's cone (and outside the range of its 360° senses)? false when it has no cone.
 * The points tested: the center and the four corners of the target.
 */
export function outsideCone(observer, target) {
  const cone = coneOf(observer);
  if ( !cone || !target?.parent ) return false;
  const eye = tokenCenter(observer);
  const pos = committedPosition(target);
  const grid = target.parent.grid;
  // The size of the committed document, like the position (`_source`): not the animated one of a resize in progress.
  const size = target._source ?? target;
  const w = (size.width ?? 1) * grid.sizeX, h = (size.height ?? 1) * grid.sizeY;
  const points = [{ x: pos.x + w / 2, y: pos.y + h / 2 }, { x: pos.x, y: pos.y }, { x: pos.x + w, y: pos.y },
    { x: pos.x, y: pos.y + h }, { x: pos.x + w, y: pos.y + h }];
  if ( inCone(eye, cone.rotation, cone.angle, points) ) return false;
  const range = allAroundRange(observer);
  if ( range > 0 ) {
    const distance = grid.measurePath([eye, points[0]]).distance;
    if ( distance <= range ) return false;
  }
  return true;
}
