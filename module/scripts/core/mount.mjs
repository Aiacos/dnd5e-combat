/**
 * Mount and command to a companion (§490, block B08) — pure rules, no dependency on Foundry.
 *
 * Two content keys:
 *  - `mount: { rider?, controlled? }` on an item of the MOUNT: the creature can be mounted. `rider` (actor id, 16 characters):
 *    only that actor mounts it; absent: any allied creature at least one size smaller (Player's Handbook 2024, "Mounted Combat").
 *    `controlled` (default true): controlled mount — it acts on its rider's turn (its Initiative is set right after theirs) and
 *    takes only the Dash, Disengage and Dodge actions, unless its rider commands it this round (`commands`).
 *    `controlled: false`: independent mount, which keeps its Initiative and its actions; only movement is shared.
 *  - `commands: { actor | identifier, distance, units, cost? }` on the MASTER's item that gives the order: on its use, the
 *    designated companions in range are commanded for this round. `actor`: the companion's actor id; `identifier`: identifier of an
 *    item it carries. `cost` (default "bonus"): the cost of the order, when the sheet's activity does not say.
 * The mount–rider link breaks when either is Prone, Incapacitated (or worse) or at 0 HP: the rider falls Prone beside it.
 */

import { isId, isObject } from "./content/shared.mjs";
import { SIZES } from "./content/enums.mjs";
import { INCAPACITATING } from "./conditions.mjs";

/** The basic actions a controlled mount can take without an order (Player's Handbook 2024, "Controlling a Mount"). */
export const MOUNT_FREE_ACTIONS = Object.freeze(["dash", "disengage", "dodge"]);
/** The costs of an order. */
export const COMMAND_COSTS = Object.freeze(["action", "bonus", "free"]);

/** The errors of the `mount` key (empty = valid). */
export function validateMount(mount, at="mount") {
  if ( !isObject(mount) ) return [`${at}: { rider?: actor id, controlled?: boolean }`];
  const errors = [];
  for ( const key of Object.keys(mount) ) if ( !["rider", "controlled"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  if ( ("rider" in mount) && !isId(mount.rider) ) errors.push(`${at}.rider: an actor id (16 characters)`);
  if ( ("controlled" in mount) && (typeof mount.controlled !== "boolean") ) errors.push(`${at}.controlled: true or false`);
  return errors;
}

/** The errors of the `commands` key (empty = valid). */
export function validateCommands(commands, at="commands") {
  if ( !isObject(commands) ) return [`${at}: { actor | identifier, distance, units, cost? }`];
  const errors = [];
  for ( const key of Object.keys(commands) ) {
    if ( !["actor", "identifier", "distance", "units", "cost"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  }
  const byActor = "actor" in commands, byIdentifier = "identifier" in commands;
  if ( byActor === byIdentifier ) errors.push(`${at}: exactly one of actor (actor id) or identifier (item identifier)`);
  if ( byActor && !isId(commands.actor) ) errors.push(`${at}.actor: an actor id (16 characters)`);
  if ( byIdentifier && !((typeof commands.identifier === "string") && commands.identifier.trim()) ) errors.push(`${at}.identifier: a non-empty string`);
  if ( !(Number.isFinite(commands.distance) && (commands.distance > 0)) ) errors.push(`${at}.distance: a positive number`);
  if ( !((typeof commands.units === "string") && commands.units.trim()) ) errors.push(`${at}.units: "ft", "m"…`);
  if ( ("cost" in commands) && !COMMAND_COSTS.includes(commands.cost) ) errors.push(`${at}.cost: ${COMMAND_COSTS.join(", ")}`);
  return errors;
}

/** Is the mount controlled by its rider (default: yes)? */
export const isControlled = rule => !!rule && (rule.controlled !== false);

/**
 * Why this rider cannot mount this creature, or null.
 * @param {{rule: object|null, riderActorIds: string[], riderSize: string, mountSize: string, enemies: boolean, adjacent: boolean,
 *   alreadyRidden: boolean, riding: boolean, riderStatuses?: string[], mountStatuses?: string[]}} p
 * @returns {"notMount"|"notRider"|"tooBig"|"enemy"|"far"|"ridden"|"riding"|"cannot"|null}
 */
export function mountProblem({ rule, riderActorIds=[], riderSize, mountSize, enemies=false, adjacent=true, alreadyRidden=false,
  riding=false, riderStatuses=[], mountStatuses=[] }) {
  if ( !rule ) return "notMount";
  if ( riding ) return "riding";
  if ( alreadyRidden ) return "ridden";
  if ( rule.rider ) { if ( !riderActorIds.includes(rule.rider) ) return "notRider"; }
  else {
    if ( enemies ) return "enemy";
    if ( sizeIndex(mountSize) <= sizeIndex(riderSize) ) return "tooBig";
  }
  if ( bondBreaker(riderStatuses) || bondBreaker(mountStatuses) ) return "cannot";
  if ( !adjacent ) return "far";
  return null;
}

const sizeIndex = size => SIZES.indexOf(SIZES.includes(size) ? size : "med");

/** The condition that makes the rider fall (or forbids mounting): Prone, Incapacitated or worse. Returns it, or null. */
export function bondBreaker(statuses=[]) {
  return ["prone", ...INCAPACITATING].find(s => statuses.includes(s)) ?? null;
}

/**
 * Le lien tombe-t-il ? Rend `{ who: "rider"|"mount", status }` (ou `status: "zeroHp"`), ou null.
 * @param {{rider: {statuses: string[], hp: number|null}, mount: {statuses: string[], hp: number|null}}} p
 */
export function bondBroken({ rider, mount }) {
  for ( const [who, c] of [["mount", mount], ["rider", rider]] ) {
    const status = bondBreaker(c?.statuses ?? []);
    if ( status ) return { who, status };
    if ( Number.isFinite(c?.hp) && (c.hp <= 0) ) return { who, status: "zeroHp" };
  }
  return null;
}

/**
 * Is a mount activity refused for lack of an order? Controlled, in combat, an action that is neither Dash, nor Disengage,
 * nor Dodge, with no order this round.
 * @param {{rule: object|null, ridden: boolean, inCombat: boolean, activation: string|null, basicAction: string|null,
 *   commandedRound: number|null, round: number|null}} p
 */
export function needsCommand({ rule, ridden, inCombat, activation, basicAction, commandedRound, round }) {
  if ( !isControlled(rule) || !ridden || !inCombat || (activation !== "action") ) return false;
  if ( MOUNT_FREE_ACTIONS.includes(basicAction) ) return false;
  return commandedRound !== round;
}

/**
 * The top-left corner (pixels) where to place the rider at the center of its mount's space.
 * @param {{x: number, y: number}} mountAt  top-left corner of the mount
 * @param {{w: number, h: number}} mountSize  size of the mount in cells
 * @param {{w: number, h: number}} riderSize  size of the rider in cells
 * @param {{sizeX: number, sizeY: number}} grid
 */
export function riderSeat(mountAt, mountSize, riderSize, grid) {
  return { x: mountAt.x + (((mountSize.w - riderSize.w) / 2) * grid.sizeX), y: mountAt.y + (((mountSize.h - riderSize.h) / 2) * grid.sizeY) };
}
