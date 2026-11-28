/**
 * Mount and command to a companion (§490, building block B08), read and written in Foundry. Pure rules: core/mount.mjs.
 *
 * The link lives in two token flags, written by the active GM (runtime/mount.mjs):
 *  - on the rider: `flags["dnd5e-combat"].mountedOn` = id of the mount's token;
 *  - on the mount: `flags["dnd5e-combat"].ridden` = id of the rider's token.
 * The order given to a companion: `flags["dnd5e-combat"].commanded` = round of the order, on its actor (like the Primal Companion,
 * runtime/turn.mjs C12-c).
 */

import { MODULE_ID } from "../constants.mjs";
import { bondBroken, mountProblem, needsCommand, riderSeat } from "../core/mount.mjs";
import { basicActionOfActivity } from "./basics.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { areEnemies } from "./factions.mjs";
import { committedPosition, distanceBetween } from "./turn.mjs";
import { areAdjacent } from "./conditions.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";

export const MOUNTED_ON = "mountedOn";
export const RIDDEN = "ridden";
export const COMMANDED = "commanded";

/** The `mount` rule carried by one of this actor's items, or null. */
export function mountRuleOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.mount;
    if ( rule ) return rule;
  }
  return null;
}

/** The `commands` rule of an item, or null. */
export const commandRuleOf = item => (item ? (contentOf(item).entry?.commands ?? null) : null);

/** The ids that designate a token's actor: the synthetic actor, the world actor. */
export function actorIdsOf(token) {
  return [token?.actor?.id, token?.actorId, token?.baseActor?.id].filter(Boolean);
}

/** The token of this rider's mount, on its scene, or null. */
export function mountOf(token) {
  const id = token?.getFlag?.(MODULE_ID, MOUNTED_ON);
  return id ? (token.parent?.tokens.get(id) ?? null) : null;
}

/** The token of this mount's rider, on its scene, or null. */
export function riderOf(token) {
  const id = token?.getFlag?.(MODULE_ID, RIDDEN);
  return id ? (token.parent?.tokens.get(id) ?? null) : null;
}

const statusesOf = token => Array.from(token?.actor?.statuses ?? []);
const hpOf = token => token?.actor?.system?.attributes?.hp?.value ?? null;

/** Why `rider` cannot mount `mount` (key of core/mount.mjs `mountProblem`), or null. */
export function mountProblemFor(rider, mount) {
  if ( !rider || !mount || (rider === mount) || (rider.parent !== mount.parent) ) return "notMount";
  return mountProblem({ rule: mountRuleOf(mount.actor), riderActorIds: actorIdsOf(rider),
    riderSize: rider.actor?.system?.traits?.size, mountSize: mount.actor?.system?.traits?.size,
    enemies: areEnemies(rider, mount), adjacent: areAdjacent(rider, mount, readUnitFactors()),
    alreadyRidden: !!riderOf(mount), riding: !!mountOf(rider), riderStatuses: statusesOf(rider), mountStatuses: statusesOf(mount) });
}

/** Le lien de ce couple tombe-t-il (core/mount.mjs `bondBroken`) ? */
export function bondBrokenFor(rider, mount) {
  return bondBroken({ rider: { statuses: statusesOf(rider), hp: hpOf(rider) }, mount: { statuses: statusesOf(mount), hp: hpOf(mount) } });
}

/** The top-left corner where to seat the rider on their mount (validated position of the mount). */
export function seatOf(rider, mount, at=committedPosition(mount)) {
  return riderSeat(at, { w: mount.width, h: mount.height }, { w: rider.width, h: rider.height }, mount.parent.grid);
}

/**
 * The companions that this `commands` rule designates, on the master's scene: `{ token, inRange }`. An actor by its id, or any
 * actor that carries an item of this identifier; the master themself excluded.
 */
export function companionsOf(masterToken, rule) {
  if ( !masterToken?.parent || !rule ) return [];
  const factors = readUnitFactors();
  const reach = lengthIn(rule.distance, rule.units, masterToken.parent.grid.units, factors);
  const out = [];
  for ( const token of masterToken.parent.tokens ) {
    if ( (token === masterToken) || !token.actor ) continue;
    const named = rule.actor ? actorIdsOf(token).includes(rule.actor)
      : token.actor.items.some(i => identifierOf(i) === rule.identifier);
    if ( !named ) continue;
    const gap = distanceBetween(masterToken, token).value;
    out.push({ token, inRange: Number.isFinite(gap) && (gap <= reach + 1e-6) });
  }
  return out;
}

/** The token of the master who uses this activity (the displayed scene's first). */
export function masterTokenOf(actor) {
  const tokens = actor?.getActiveTokens?.(false, true) ?? [];
  return tokens.find(t => t.parent === canvas?.scene) ?? tokens[0] ?? null;
}

/**
 * §490: does an activity of this controlled, mounted mount need this round's command (core/mount.mjs `needsCommand`)?
 * @param {Activity} activity
 * @param {boolean} inCombat
 */
export function controlledMountUncommanded(activity, inCombat) {
  const actor = activity?.actor;
  const rule = mountRuleOf(actor);
  if ( !rule ) return false;
  const ridden = (actor.getActiveTokens?.(false, true) ?? []).some(t => !!riderOf(t?.document ?? t));
  return needsCommand({ rule, ridden, inCombat, activation: activity.activation?.type ?? null, basicAction: basicActionOfActivity(activity),
    commandedRound: actor.getFlag?.(MODULE_ID, COMMANDED) ?? null, round: game.combat?.round ?? null });
}

/**
 * §490: a command (`commands`) with no designated companion in range — `{ distance, units }` for the warning, or null
 * (no command, or at least one companion in range, or no companion on the scene: nothing to judge).
 */
export function commandOutOfRange(activity) {
  const rule = commandRuleOf(activity?.item);
  if ( !rule ) return null;
  const master = masterTokenOf(activity.actor);
  const all = master ? companionsOf(master.document ?? master, rule) : [];
  if ( !all.length || all.some(c => c.inRange) ) return null;
  return { distance: rule.distance, units: rule.units };
}
