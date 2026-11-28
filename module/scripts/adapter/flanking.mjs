/**
 * §369 (GitHub issue #27): flanking on the scene — three world settings, flanking disabled by default.
 *  - `flanking`: "off" (default) or "advantage";
 *  - `flankingSide`: who benefits — "all" (PCs and NPCs, default), "pc" (PCs only), "npc" (NPCs only);
 *  - `flankingConga`: no chain flanking — a creature that is itself flanked does not flank and does not help to.
 * Nothing is placed on the tokens: flanking is judged at each attack (and at each hover over the chance to hit), from the
 * validated positions (`_source`), so an ally who moves away or falls no longer grants it.
 *
 * Conditions (DMG 2014, optional rule): melee attack, attacker and ally in contact with the target (1.50 m, in 3D),
 * on opposite sides (core/flanking.mjs), on the same plane as it; the ally is an ally of the attacker (factions), neither dead nor
 * Incapacitated nor hidden, and sees the target; the attacker must see it too. Square grid only.
 */
import { MODULE_ID } from "../constants.mjs";
import { flanks, flankingApplies } from "../core/flanking.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { rangeIssue } from "../core/range.mjs";
import { committedPosition, distanceBetween } from "./turn.mjs";
import { areAllies, areEnemies } from "./factions.mjs";
import { canSee, isVisionAvailable } from "./vision.mjs";
import { samePlane } from "./plane.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";

export const FLANKING_SETTING = "flanking";
export const FLANKING_SIDE_SETTING = "flankingSide";
export const FLANKING_CONGA_SETTING = "flankingConga";

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
};

/** Is flanking in effect in this world? */
export const flankingOn = () => read(FLANKING_SETTING, "off") === "advantage";

/** A token's space in cells (at `pos` if given: a hypothetical attacker position at the end of an approach). */
function spaceOf(token, pos=null) {
  const grid = token.parent.grid;
  const p = pos ? { ...committedPosition(token), ...pos } : committedPosition(token);
  return { x: p.x / grid.sizeX, y: p.y / grid.sizeY, w: p.width ?? 1, h: p.height ?? 1 };
}

const touching = (a, b, factors, positions) => rangeIssue(distanceBetween(a, b, positions), { value: 5, units: "ft" }, factors) === null;
const sees = (observer, target) => !isVisionAvailable() || canSee(observer, target);
const able = token => token?.actor && !token.hidden && !isObjectToken(token) && !isDeadActor(token.actor)
  && !INCAPACITATING.some(s => token.actor.statuses?.has?.(s));

/** The creatures that can flank `target` on `side`'s side: in contact, valid, seeing it. */
function flankersOf(target, side, factors, exclude=null) {
  return target.parent.tokens.filter(t => (t !== target) && (t !== exclude) && able(t) && areAllies(side, t) && areEnemies(t, target)
    && samePlane(t, target) && touching(t, target, factors) && sees(t, target));
}

/** Is this creature itself flanked (by two of its enemies)? Serves the "no chain flanking" rule. */
function isFlanked(token, factors, pos=null) {
  const box = spaceOf(token, pos);
  const enemies = token.parent.tokens.filter(t => (t !== token) && able(t) && areEnemies(t, token) && samePlane(t, token)
    && touching(t, token, factors, pos ? { posB: pos } : {}) && sees(t, token));
  return enemies.some((a, i) => enemies.slice(i + 1).some(b => areAllies(a, b) && flanks(box, spaceOf(a), spaceOf(b))));
}

/**
 * The name of the ally with whom the attacker flanks the target, or null.
 * @param {TokenDocument} origin
 * @param {TokenDocument} target
 * @param {{ranged: boolean, factors: object, posA?: object}} options
 * @returns {string|null}
 */
export function flankingAlly(origin, target, { ranged, factors, posA }={}) {
  if ( ranged || !origin?.actor || !target?.actor || (origin === target) ) return null;
  const grid = origin.parent?.grid;
  if ( !grid || grid.isGridless || !grid.isSquare || (origin.parent !== target.parent) ) return null;
  if ( !flankingApplies({ mode: read(FLANKING_SETTING, "off"), side: read(FLANKING_SIDE_SETTING, "all"), attackerIsPc: origin.actor.type === "character" }) ) return null;
  if ( !areEnemies(origin, target) || !samePlane(origin, target) || !touching(origin, target, factors, { posA }) || !sees(origin, target) ) return null;
  const conga = read(FLANKING_CONGA_SETTING, false) === true;
  if ( conga && isFlanked(origin, factors, posA) ) return null;
  const box = spaceOf(target), mine = spaceOf(origin, posA);
  const ally = flankersOf(target, origin, factors, origin)
    .find(t => flanks(box, mine, spaceOf(t)) && !(conga && isFlanked(t, factors)));
  return ally?.name ?? null;
}
