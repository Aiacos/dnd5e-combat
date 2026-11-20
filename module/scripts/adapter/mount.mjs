/**
 * Monture et ordre à un compagnon (§490, brique B08), lus et écrits dans Foundry. Règles pures : core/mount.mjs.
 *
 * Le lien vit dans deux drapeaux de token, écrits par le MJ actif (runtime/mount.mjs) :
 *  - sur le cavalier : `flags["dnd5e-combat"].mountedOn` = id du token de la monture ;
 *  - sur la monture : `flags["dnd5e-combat"].ridden` = id du token du cavalier.
 * L'ordre donné à un compagnon : `flags["dnd5e-combat"].commanded` = round de l'ordre, sur son acteur (comme le Compagnon primitif,
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

/** La règle `mount` que porte un des items de cet acteur, ou null. */
export function mountRuleOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.mount;
    if ( rule ) return rule;
  }
  return null;
}

/** La règle `commands` d'un item, ou null. */
export const commandRuleOf = item => (item ? (contentOf(item).entry?.commands ?? null) : null);

/** Les ids qui désignent l'acteur d'un token : l'acteur synthétique, l'acteur du monde. */
export function actorIdsOf(token) {
  return [token?.actor?.id, token?.actorId, token?.baseActor?.id].filter(Boolean);
}

/** Le token de la monture de ce cavalier, sur sa scène, ou null. */
export function mountOf(token) {
  const id = token?.getFlag?.(MODULE_ID, MOUNTED_ON);
  return id ? (token.parent?.tokens.get(id) ?? null) : null;
}

/** Le token du cavalier de cette monture, sur sa scène, ou null. */
export function riderOf(token) {
  const id = token?.getFlag?.(MODULE_ID, RIDDEN);
  return id ? (token.parent?.tokens.get(id) ?? null) : null;
}

const statusesOf = token => Array.from(token?.actor?.statuses ?? []);
const hpOf = token => token?.actor?.system?.attributes?.hp?.value ?? null;

/** Pourquoi `rider` ne peut pas monter `mount` (clé de core/mount.mjs `mountProblem`), ou null. */
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

/** Le coin haut-gauche où asseoir le cavalier sur sa monture (position validée de la monture). */
export function seatOf(rider, mount, at=committedPosition(mount)) {
  return riderSeat(at, { w: mount.width, h: mount.height }, { w: rider.width, h: rider.height }, mount.parent.grid);
}

/**
 * Les compagnons que cette règle `commands` désigne, sur la scène du maître : `{ token, inRange }`. Un acteur par son id, ou tout
 * acteur qui porte un item de cet identifiant ; le maître lui-même exclu.
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

/** Le token du maître qui utilise cette activité (celui de la scène affichée d'abord). */
export function masterTokenOf(actor) {
  const tokens = actor?.getActiveTokens?.(false, true) ?? [];
  return tokens.find(t => t.parent === canvas?.scene) ?? tokens[0] ?? null;
}

/**
 * §490 : une activité de cette monture contrôlée, montée, demande-t-elle l'ordre de ce round (core/mount.mjs `needsCommand`) ?
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
 * §490 : un ordre (`commands`) sans aucun compagnon désigné à portée — `{ distance, units }` pour le souci, ou null (pas d'ordre, ou au
 * moins un compagnon à portée, ou aucun compagnon sur la scène : rien à juger).
 */
export function commandOutOfRange(activity) {
  const rule = commandRuleOf(activity?.item);
  if ( !rule ) return null;
  const master = masterTokenOf(activity.actor);
  const all = master ? companionsOf(master.document ?? master, rule) : [];
  if ( !all.length || all.some(c => c.inRange) ) return null;
  return { distance: rule.distance, units: rule.units };
}
