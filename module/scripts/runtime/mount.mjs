/**
 * Monture et ordre à un compagnon (§490, brique B08). Règles pures : core/mount.mjs ; lectures : adapter/mount.mjs.
 *
 *  - Monter / Descendre : entrées du menu contextuel (cavalier sur sa monture, ou sur lui-même une fois monté). En combat, la moitié
 *    de la Vitesse du cavalier (budget `stood`, comme se relever : Manuel 2024, « Monter et descendre »). Un refus de règle (pas son
 *    cavalier, trop grand, pas au contact, À terre, plus assez de déplacement) se force par la fenêtre de légalité ; « déjà monté »,
 *    « déjà montée » et « pas une monture » restent secs. Les écritures (drapeaux, déplacements, initiative) : MJ actif, par la requête
 *    `MOUNT_QUERY` (l'expéditeur doit posséder le cavalier).
 *  - Déplacement commun (MJ actif) : la monture marche, le cavalier est reposé au centre de son espace ; le cavalier déplacé (son
 *    joueur le prend en main), la monture le suit du même écart puis il est rassis. Pas `displace`, cases prises ignorées.
 *  - Monture contrôlée : son initiative est mise juste après celle de son cavalier (au montage, au lancement du combat, quand celle
 *    du cavalier change) ; sans ordre de ce round, elle ne prend que Foncer, Se désengager, Esquiver (runtime/turn.mjs, souci
 *    `mountNotCommanded`).
 *  - Chute : le cavalier ou la monture À terre, Neutralisé (ou pire) ou à 0 PV — le lien tombe, le cavalier est posé à côté, À terre.
 *  - Ordre (`commands`) : à l'utilisation de l'item, les compagnons désignés à portée sont commandés pour ce round
 *    (`flags.dnd5e-combat.commanded`) ; aucun à portée : la légalité le dit (souci `commandFar`, forçable) et l'ordre forcé vaut
 *    pour tous les compagnons désignés de la scène.
 * Chaque geste : un texte flottant vu de tous et un son (`notice … all`, actions `mount`, `dismount`, `thrown`, `command` du hook
 * `dnd5e-combat.feedback`, que darsh-animations peut animer).
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { isControlled } from "../core/mount.mjs";
import { initiativeAfter, standUpCost, movementAllowance } from "../core/turn.mjs";
import { COMMANDED, MOUNTED_ON, RIDDEN, bondBrokenFor, commandRuleOf, companionsOf, masterTokenOf, mountOf, mountProblemFor,
  mountRuleOf, riderOf, seatOf } from "../adapter/mount.mjs";
import { combatantFor, committedPosition, movementOf, readBudget, writeBudget } from "../adapter/turn.mjs";
import { dragDestination } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { askAnyway } from "./turn.mjs";
import { route } from "./router.mjs";
import { isExecutor, loc, log, notice, viaActiveGM } from "./shared.mjs";

export const MOUNT_QUERY = `${MODULE_ID}.mount`;
/** Les raisons qui ne se forcent pas : il n'y a rien à monter, ou la place est prise. */
const HARD = ["notMount", "riding", "ridden"];
/** Les options d'un déplacement fait par la monture elle-même (pas de boucle entre les deux tokens). */
const SYNC = { [MODULE_ID]: { mountSync: true, cleared: true, dragged: true } };

const tokenDoc = t => t?.document ?? t ?? null;
const scenesTokens = scene => scene?.tokens?.contents ?? [];

/* -------------------------------------------- */
/*  Monter, descendre                           */
/* -------------------------------------------- */

/** Le déplacement qui reste au cavalier ce tour (null hors combat) et ce que coûte monter ou descendre, ou le souci. */
function halfSpeedCost(rider) {
  const combatant = combatantFor(rider.actor);
  if ( !combatant ) return { combatant: null, cost: 0, issue: null };
  const movement = movementOf(combatant, readUnitFactors());
  const remaining = movement ? movementAllowance(readBudget(combatant), movement.speed) - movement.spent : 0;
  const { cost, issue } = standUpCost({ speed: movement?.speed ?? 0, remaining });
  return { combatant, cost, issue: issue ? "mountNoMovement" : null };
}

/** L'entrée de menu « Monter » / « Descendre » pour `token` (en main) sur `target`, ou null. */
export function mountEntry(token, target) {
  const rider = tokenDoc(token), other = tokenDoc(target);
  if ( !rider?.isOwner || !other ) return null;
  if ( (rider === other) || (mountOf(rider) === other) ) {
    const mount = mountOf(rider);
    return mount ? { icon: "fa-solid fa-person-arrow-down-to-line", label: loc("Monture.Descendre", { name: mount.name }), run: () => dismount(rider) } : null;
  }
  if ( !mountRuleOf(other.actor) ) return null;
  const problem = mountProblemFor(rider, other);
  if ( HARD.includes(problem) ) return null;
  return { icon: "fa-solid fa-horse", label: loc("Monture.Monter", { name: other.name }),
    ...(problem ? { refused: loc(`Monture.Souci.${problem}`, { name: other.name }) } : {}), run: () => mountUp(rider, other) };
}

/** Les raisons (clés `Monture.Souci.*`) qui refusent à `rider` de monter `mount` maintenant (vide : rien ne cloche). */
export function mountIssues(riderToken, mountToken) {
  const rider = tokenDoc(riderToken), mount = tokenDoc(mountToken);
  return [mountProblemFor(rider, mount), halfSpeedCost(rider).issue].filter(Boolean);
}

/**
 * Monter `mount` (sur le client de qui possède le cavalier). Rend true si le cavalier est en selle. `force` : passer outre sans fenêtre
 * (l'API de test, qui ne répond pas aux fenêtres).
 */
export async function mountUp(riderToken, mountToken, { force=false }={}) {
  const rider = tokenDoc(riderToken), mount = tokenDoc(mountToken);
  const problem = mountProblemFor(rider, mount);
  if ( HARD.includes(problem) ) { notice(rider, loc(`Monture.Souci.${problem}`, { name: mount?.name ?? "" })); return false; }
  const { combatant, cost, issue } = halfSpeedCost(rider);
  const lines = [problem, issue].filter(Boolean).map(k => loc(`Monture.Souci.${k}`, { name: mount.name }));
  if ( lines.length && !force && !(await askAnyway(loc("Monture.Titre", { name: rider.name }), lines, { actor: rider.actor, token: rider })) ) return false;
  if ( combatant && cost ) { const b = readBudget(combatant); await writeBudget(combatant, { ...b, stood: (Number(b.stood) || 0) + cost }); }
  const done = await viaActiveGM(MOUNT_QUERY, handleMountQuery, { action: "mount", rider: rider.uuid, mount: mount.uuid },
    { noGm: "Monture.SansMJ", fallback: false, label: "mount: request" });
  return done === true;
}

/** Descendre de sa monture (sur le client de qui possède le cavalier). */
export async function dismount(riderToken, { force=false }={}) {
  const rider = tokenDoc(riderToken);
  const mount = mountOf(rider);
  if ( !mount ) return false;
  const { combatant, cost, issue } = halfSpeedCost(rider);
  if ( issue && !force && !(await askAnyway(loc("Monture.Titre", { name: rider.name }), [loc(`Monture.Souci.${issue}`, { name: mount.name })],
    { actor: rider.actor, token: rider })) ) return false;
  if ( combatant && cost ) { const b = readBudget(combatant); await writeBudget(combatant, { ...b, stood: (Number(b.stood) || 0) + cost }); }
  const done = await viaActiveGM(MOUNT_QUERY, handleMountQuery, { action: "dismount", rider: rider.uuid },
    { noGm: "Monture.SansMJ", fallback: false, label: "dismount: request" });
  return done === true;
}

/** MJ actif : la requête d'un joueur (ou du MJ lui-même). L'expéditeur doit posséder le cavalier. */
async function handleMountQuery({ action, rider: riderUuid, mount: mountUuid }={}, { user }={}) {
  const rider = fromUuidSync(riderUuid ?? "", { strict: false });
  if ( !rider || (rider.documentName !== "Token") || !actsFor(user, rider) ) return false;
  if ( action === "dismount" ) return unseat(rider, { reason: "dismount" });
  const mount = fromUuidSync(mountUuid ?? "", { strict: false });
  if ( (action !== "mount") || !mount || (mount.documentName !== "Token") || HARD.includes(mountProblemFor(rider, mount)) ) return false;
  await mount.setFlag(MODULE_ID, RIDDEN, rider.id);
  await rider.setFlag(MODULE_ID, MOUNTED_ON, mount.id);
  await seat(rider, mount);
  await followRider(mount);
  notice(rider, { key: "Monture.EnSelle", data: { name: mount.name } }, "gain", { all: true, action: "mount", outcome: "success" });
  log(`${rider.name} mounts ${mount.name}`);
  return true;
}

/** Assied le cavalier au centre de l'espace de sa monture (MJ actif). */
async function seat(rider, mount) {
  const at = committedPosition(mount);
  const { x, y } = seatOf(rider, mount, at);
  const here = committedPosition(rider);
  if ( (Math.abs(here.x - x) < 0.5) && (Math.abs(here.y - y) < 0.5) && ((here.elevation ?? 0) === (at.elevation ?? 0))
    && ((here.level ?? null) === (at.level ?? null)) ) return;
  await rider.move([{ x, y, elevation: at.elevation ?? 0, ...(at.level ? { level: at.level } : {}), snapped: false, action: "displace" }],
    { constrainOptions: { ignoreTokens: true, ignoreWalls: true }, ...SYNC });
}

/**
 * Défait le lien (MJ actif) et pose le cavalier sur une case libre au contact de la monture. `reason` : « dismount » (descendre),
 * « thrown » (chute : À terre). Rend true.
 */
async function unseat(rider, { reason="dismount", status=null }={}) {
  const mount = mountOf(rider);
  if ( rider.getFlag(MODULE_ID, MOUNTED_ON) ) await rider.unsetFlag(MODULE_ID, MOUNTED_ON);
  if ( mount?.getFlag(MODULE_ID, RIDDEN) ) await mount.unsetFlag(MODULE_ID, RIDDEN);
  if ( mount ) {
    const m = committedPosition(mount);
    const spot = dragDestination(rider, mount, { x: m.x - (rider.width * rider.parent.grid.sizeX), y: m.y });
    if ( spot ) await rider.move([{ x: spot.x, y: spot.y, elevation: m.elevation ?? 0, snapped: true, action: "displace" }], SYNC);
  }
  const thrown = reason === "thrown";
  if ( thrown && rider.actor && !rider.actor.statuses.has("prone") ) await rider.actor.toggleStatusEffect("prone", { active: true });
  const key = thrown ? "Monture.Chute" : "Monture.PiedATerre";
  notice(rider, { key, data: { name: mount?.name ?? "", status: status ? loc(`Monture.Etat.${status}`) : "" } }, thrown ? "refused" : "gain",
    { all: true, action: thrown ? "thrown" : "dismount", outcome: thrown ? "failure" : "success" });
  log(`${rider.name} ${thrown ? `falls from ${mount?.name ?? "?"} (${status})` : `dismounts ${mount?.name ?? "?"}`}`);
  return true;
}

/* -------------------------------------------- */
/*  Initiative de la monture contrôlée          */
/* -------------------------------------------- */

/** MJ actif : la monture contrôlée de ce cavalier passe juste après lui dans l'initiative (si elle y est). */
async function followRider(mount) {
  const rider = riderOf(mount);
  const combat = game.combat;
  if ( !rider || !combat || !isControlled(mountRuleOf(mount.actor)) ) return;
  const mine = combat.combatants.find(c => c.tokenId === rider.id);
  const its = combat.combatants.find(c => c.tokenId === mount.id);
  if ( !Number.isFinite(mine?.initiative) || !its ) return;
  const others = combat.combatants.filter(c => (c !== mine) && (c !== its)).map(c => c.initiative);
  const value = initiativeAfter(mine.initiative, others);
  if ( its.initiative === value ) return;
  await its.update({ initiative: value }, { [MODULE_ID]: { mountSync: true } });
  log(`${mount.name} acts right after ${rider.name} (initiative ${value})`);
}

/** Les montures montées d'un combat. */
const riddenIn = combat => scenesTokens(combat?.scene ?? canvas?.scene).filter(t => riderOf(t));

function onCombatant(combatant, changes, options) {
  if ( !("initiative" in (changes ?? {})) || options?.[MODULE_ID]?.mountSync ) return;
  const token = combatant.token;
  if ( !token ) return;
  const mount = mountOf(token) ?? (riderOf(token) ? token : null);
  if ( mount ) return followRider(mount);
}

/* -------------------------------------------- */
/*  Déplacement commun                          */
/* -------------------------------------------- */

async function onMoveToken(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.mountSync ) return;
  const rider = riderOf(token);
  if ( rider ) return seat(rider, token);
  const mount = mountOf(token);
  if ( !mount ) return;
  // Le cavalier a bougé seul : la monture le suit du même écart, puis il se rassied.
  const from = movement?.origin ?? movement?.passed?.waypoints?.[0];
  if ( !from ) return;
  const to = committedPosition(token);
  const m = committedPosition(mount);
  await mount.move([{ x: m.x + (to.x - from.x), y: m.y + (to.y - from.y), elevation: (m.elevation ?? 0) + ((to.elevation ?? 0) - (from.elevation ?? 0)),
    ...(to.level ? { level: to.level } : {}), snapped: false, action: "displace" }], { constrainOptions: { ignoreTokens: true }, ...SYNC });
  await seat(token, mount);
}

/* -------------------------------------------- */
/*  Chute                                        */
/* -------------------------------------------- */

/** MJ actif : un état ou des PV ont changé chez cet acteur — le lien de ses couples tombe-t-il ? */
async function checkBond(actor) {
  if ( !actor ) return;
  for ( const token of actor.getActiveTokens?.(false, true) ?? [] ) {
    const rider = mountOf(token) ? token : riderOf(token);
    const mount = rider ? mountOf(rider) : null;
    if ( !rider || !mount ) continue;
    const broken = bondBrokenFor(rider, mount);
    if ( broken ) await unseat(rider, { reason: "thrown", status: broken.status });
  }
}

/** MJ actif : un token retiré de la scène — son partenaire est libéré (sans chute). */
async function onDeleteToken(token) {
  for ( const other of scenesTokens(token.parent) ) {
    if ( other.getFlag(MODULE_ID, MOUNTED_ON) === token.id ) await other.unsetFlag(MODULE_ID, MOUNTED_ON);
    if ( other.getFlag(MODULE_ID, RIDDEN) === token.id ) await other.unsetFlag(MODULE_ID, RIDDEN);
  }
}

/* -------------------------------------------- */
/*  Ordre à un compagnon                        */
/* -------------------------------------------- */

/** Les compagnons que l'ordre de cette activité toucherait : à portée, ou tous s'il n'y en a aucun (ordre forcé). */
export function commandTargets(activity) {
  const rule = commandRuleOf(activity?.item);
  const master = rule ? masterTokenOf(activity.actor) : null;
  if ( !master ) return { rule, master, inRange: [], all: [] };
  const all = companionsOf(tokenDoc(master), rule);
  return { rule, master: tokenDoc(master), inRange: all.filter(c => c.inRange).map(c => c.token), all: all.map(c => c.token) };
}

/** Les activités d'ordre (`commands`) de ce maître qui désignent ce compagnon : pour le menu de ce dernier. */
export function commandActivitiesFor(masterToken, companionToken) {
  const master = tokenDoc(masterToken), companion = tokenDoc(companionToken);
  if ( !master?.actor || !companion || (master === companion) ) return [];
  const out = [];
  for ( const item of master.actor.items ) {
    const rule = commandRuleOf(item);
    if ( !rule || !companionsOf(master, rule).some(c => c.token === companion) ) continue;
    const activity = item.system?.activities?.contents?.[0] ?? Array.from(item.system?.activities ?? [])[0];
    if ( activity ) out.push(activity);
  }
  return out;
}

/** Sur le client de l'auteur : l'ordre donné, transmis au MJ actif (qui écrit sur le compagnon). */
async function onPostUse(activity) {
  const { rule, master, inRange, all } = commandTargets(activity);
  if ( !rule || !master ) return;
  const targets = inRange.length ? inRange : all;
  if ( !targets.length ) { notice(master, loc("Monture.Souci.commandNone")); return; }
  await viaActiveGM(MOUNT_QUERY, handleCommandQuery, { action: "command", master: master.uuid, companions: targets.map(t => t.uuid),
    round: game.combat?.round ?? null }, { noGm: "Monture.SansMJ", fallback: false, label: "command: request" });
}

/** MJ actif : marque les compagnons commandés pour ce round. L'expéditeur doit posséder le maître. */
async function handleCommandQuery({ master: masterUuid, companions=[], round=null }={}, { user }={}) {
  const master = fromUuidSync(masterUuid ?? "", { strict: false });
  if ( !master || !actsFor(user, master) ) return false;
  for ( const uuid of companions ) {
    const token = fromUuidSync(uuid, { strict: false });
    if ( !token?.actor || (token.parent !== master.parent) ) continue;
    await token.actor.setFlag(MODULE_ID, COMMANDED, round);
    notice(token, { key: "Monture.Commande", data: { name: master.name } }, "gain", { all: true, action: "command", outcome: "success" });
    log(`${master.name} commands ${token.name} (round ${round})`);
  }
  return true;
}

/** La requête unique : monter, descendre, ordonner. */
function handleQuery(payload, context) {
  return (payload?.action === "command") ? handleCommandQuery(payload, context) : handleMountQuery(payload, context);
}

export function registerMount() {
  CONFIG.queries[MOUNT_QUERY] = handleQuery;
  const executor = { executor: true };
  route("moveToken", onMoveToken, { ...executor, label: "mount: rider and mount don't move together" });
  route("deleteToken", onDeleteToken, { ...executor, label: "mount: bond not cleared" });
  route("updateActor", (actor, changes) => (foundry.utils.hasProperty(changes, "system.attributes.hp") ? checkBond(actor) : null),
    { ...executor, label: "mount: fall at 0 HP not checked" });
  route("createActiveEffect", effect => checkBond(actorOfEffect(effect)), { ...executor, label: "mount: fall on a condition not checked" });
  route("updateCombatant", onCombatant, { ...executor, label: "mount: controlled mount initiative not set" });
  route("combatStart", combat => Promise.all(riddenIn(combat).map(followRider)), { ...executor, label: "mount: controlled mount initiative not set" });
  route("dnd5e.postUseActivity", activity => onPostUse(activity), { label: "command: companion not commanded" });
}

/** Pour l'API de test : l'état du couple de ce token. */
export function mountState(token) {
  const t = tokenDoc(token);
  return { mountedOn: mountOf(t)?.id ?? null, ridden: riderOf(t)?.id ?? null, rule: mountRuleOf(t?.actor) ?? null,
    commanded: t?.actor?.getFlag(MODULE_ID, COMMANDED) ?? null, statuses: Array.from(t?.actor?.statuses ?? []), executor: isExecutor() };
}
