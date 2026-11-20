/**
 * Monture et ordre à un compagnon (§490, brique B08) — règles pures, aucune dépendance à Foundry.
 *
 * Deux clés de contenu :
 *  - `mount: { rider?, controlled? }` sur un item de la MONTURE : la créature peut être montée. `rider` (id d'acteur, 16 caractères) :
 *    seul cet acteur la monte ; absent : toute créature alliée plus petite d'au moins une taille (Manuel 2024, « Combat monté »).
 *    `controlled` (défaut vrai) : monture contrôlée — elle agit au tour de son cavalier (son initiative est mise juste après lui) et
 *    ne prend que les actions Foncer, Se désengager et Esquiver, sauf si son cavalier la commande à ce round (`commands`).
 *    `controlled: false` : monture indépendante, qui garde son initiative et ses actions ; seul le déplacement est commun.
 *  - `commands: { actor | identifier, distance, units, cost? }` sur l'item du MAÎTRE qui donne l'ordre : à son utilisation, les
 *    compagnons désignés à portée sont commandés pour ce round. `actor` : id d'acteur du compagnon ; `identifier` : identifiant d'un
 *    item qu'il porte. `cost` (défaut « bonus ») : le coût de l'ordre, quand l'activité de la fiche n'en dit pas.
 * Le lien monture–cavalier tombe quand l'un d'eux est À terre, Neutralisé (ou pire) ou à 0 PV : le cavalier tombe À terre à côté.
 */

import { isId, isObject } from "./content/shared.mjs";
import { SIZES } from "./content/enums.mjs";
import { INCAPACITATING } from "./conditions.mjs";

/** Les actions de base qu'une monture contrôlée peut prendre sans ordre (Manuel 2024, « Contrôler une monture »). */
export const MOUNT_FREE_ACTIONS = Object.freeze(["dash", "disengage", "dodge"]);
/** Les coûts d'un ordre. */
export const COMMAND_COSTS = Object.freeze(["action", "bonus", "free"]);

/** Les erreurs de la clé `mount` (vide = valide). */
export function validateMount(mount, at="mount") {
  if ( !isObject(mount) ) return [`${at}: { rider?: actor id, controlled?: boolean }`];
  const errors = [];
  for ( const key of Object.keys(mount) ) if ( !["rider", "controlled"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  if ( ("rider" in mount) && !isId(mount.rider) ) errors.push(`${at}.rider: an actor id (16 characters)`);
  if ( ("controlled" in mount) && (typeof mount.controlled !== "boolean") ) errors.push(`${at}.controlled: true or false`);
  return errors;
}

/** Les erreurs de la clé `commands` (vide = valide). */
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

/** La monture est-elle contrôlée par son cavalier (défaut : oui) ? */
export const isControlled = rule => !!rule && (rule.controlled !== false);

/**
 * Pourquoi ce cavalier ne peut pas monter cette créature, ou null.
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

/** L'état qui fait tomber le cavalier (ou interdit de monter) : À terre, Neutralisé ou pire. Rend l'état, ou null. */
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
 * Une activité de la monture est-elle refusée faute d'ordre ? Contrôlée, en combat, une action qui n'est ni Foncer, ni Se désengager,
 * ni Esquiver, sans ordre de ce round.
 * @param {{rule: object|null, ridden: boolean, inCombat: boolean, activation: string|null, basicAction: string|null,
 *   commandedRound: number|null, round: number|null}} p
 */
export function needsCommand({ rule, ridden, inCombat, activation, basicAction, commandedRound, round }) {
  if ( !isControlled(rule) || !ridden || !inCombat || (activation !== "action") ) return false;
  if ( MOUNT_FREE_ACTIONS.includes(basicAction) ) return false;
  return commandedRound !== round;
}

/**
 * Le coin haut-gauche (pixels) où poser le cavalier au centre de l'espace de sa monture.
 * @param {{x: number, y: number}} mountAt  coin haut-gauche de la monture
 * @param {{w: number, h: number}} mountSize  taille en cases de la monture
 * @param {{w: number, h: number}} riderSize  taille en cases du cavalier
 * @param {{sizeX: number, sizeY: number}} grid
 */
export function riderSeat(mountAt, mountSize, riderSize, grid) {
  return { x: mountAt.x + (((mountSize.w - riderSize.w) / 2) * grid.sizeX), y: mountAt.y + (((mountSize.h - riderSize.h) / 2) * grid.sizeY) };
}
