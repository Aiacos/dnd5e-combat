/**
 * Mount and command to a companion (§490, brick B08). Pure rules: core/mount.mjs; reads: adapter/mount.mjs.
 *
 *  - Mount / Dismount: context menu entries (rider on their mount, or on themselves once mounted). In combat, half of the
 *    rider's Speed (`stood` budget, like standing up: Player's Handbook 2024, "Mounting and Dismounting"). A rule refusal (not
 *    their rider, too big, not in contact, Prone, not enough movement left) can be forced through the legality window;
 *    "already mounted", "already ridden" and "not a mount" stay dry. Writes (flags, movements, Initiative): active GM, via
 *    the query `MOUNT_QUERY` (the sender must own the rider).
 *  - Joint movement (active GM): the mount walks, the rider is set back at the center of its space; the rider moved (their
 *    player takes it in hand), the mount follows by the same offset then they are reseated. Not `displace`, taken cells ignored.
 *  - Controlled mount: its Initiative is set right after its rider's (on mounting, at combat start, when the rider's
 *    changes); with no command this round, it only takes Dash, Disengage, Dodge (runtime/turn.mjs, issue
 *    `mountNotCommanded`).
 *  - Fall: the rider or the mount Prone, Incapacitated (or worse) or at 0 HP — the link drops, the rider is placed beside, Prone.
 *  - Command (`commands`): on use of the item, the designated companions in range are commanded for this round
 *    (`flags.dnd5e-combat.commanded`); none in range: legality says so (issue `commandFar`, forceable) and the forced command
 *    applies to all designated companions of the scene.
 * Each gesture: floating text seen by all and a sound (`notice … all`, actions `mount`, `dismount`, `thrown`, `command` of the hook
 * `dnd5e-combat.feedback`, which darsh-animations can animate).
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
/** The reasons that cannot be forced: there is nothing to mount, or the place is taken. */
const HARD = ["notMount", "riding", "ridden"];
/** The options of a movement made by the mount itself (no loop between the two tokens). */
const SYNC = { [MODULE_ID]: { mountSync: true, cleared: true, dragged: true } };

const tokenDoc = t => t?.document ?? t ?? null;
const scenesTokens = scene => scene?.tokens?.contents ?? [];

/* -------------------------------------------- */
/*  Monter, descendre                           */
/* -------------------------------------------- */

/** The movement the rider has left this turn (null out of combat) and what mounting or dismounting costs, or the issue. */
function halfSpeedCost(rider) {
  const combatant = combatantFor(rider.actor);
  if ( !combatant ) return { combatant: null, cost: 0, issue: null };
  const movement = movementOf(combatant, readUnitFactors());
  const remaining = movement ? movementAllowance(readBudget(combatant), movement.speed) - movement.spent : 0;
  const { cost, issue } = standUpCost({ speed: movement?.speed ?? 0, remaining });
  return { combatant, cost, issue: issue ? "mountNoMovement" : null };
}

/** The menu entry "Mount" / "Dismount" for `token` (in hand) on `target`, or null. */
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

/** The reasons (keys `Monture.Souci.*`) that refuse `rider` to mount `mount` now (empty: nothing wrong). */
export function mountIssues(riderToken, mountToken) {
  const rider = tokenDoc(riderToken), mount = tokenDoc(mountToken);
  return [mountProblemFor(rider, mount), halfSpeedCost(rider).issue].filter(Boolean);
}

/**
 * Mount `mount` (on the client of whoever owns the rider). Returns true if the rider is in the saddle. `force`: override with no
 * window (the test API, which does not answer windows).
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

/** Dismount (on the client of whoever owns the rider). */
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

/** Active GM: the query of a player (or of the GM itself). The sender must own the rider. */
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
 * Undoes the link (active GM) and places the rider on a free cell in contact with the mount. `reason`: "dismount" (dismounting),
 * "thrown" (fall: Prone). Returns true.
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
/*  Initiative of the controlled mount          */
/* -------------------------------------------- */

/** Active GM: this rider's controlled mount goes right after them in the Initiative (if it is in it). */
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

/** The mounted mounts of a combat. */
const riddenIn = combat => scenesTokens(combat?.scene ?? canvas?.scene).filter(t => riderOf(t));

function onCombatant(combatant, changes, options) {
  if ( !("initiative" in (changes ?? {})) || options?.[MODULE_ID]?.mountSync ) return;
  const token = combatant.token;
  if ( !token ) return;
  const mount = mountOf(token) ?? (riderOf(token) ? token : null);
  if ( mount ) return followRider(mount);
}

/* -------------------------------------------- */
/*  Joint movement                              */
/* -------------------------------------------- */

async function onMoveToken(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.mountSync ) return;
  const rider = riderOf(token);
  if ( rider ) return seat(rider, token);
  const mount = mountOf(token);
  if ( !mount ) return;
  // The rider moved alone: the mount follows by the same offset, then they sit back down.
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

/** Active GM: a condition or HP changed on this actor — does the link of its pairs drop? */
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

/** Active GM: a token removed from the scene — its partner is freed (no fall). */
async function onDeleteToken(token) {
  for ( const other of scenesTokens(token.parent) ) {
    if ( other.getFlag(MODULE_ID, MOUNTED_ON) === token.id ) await other.unsetFlag(MODULE_ID, MOUNTED_ON);
    if ( other.getFlag(MODULE_ID, RIDDEN) === token.id ) await other.unsetFlag(MODULE_ID, RIDDEN);
  }
}

/* -------------------------------------------- */
/*  Command to a companion                      */
/* -------------------------------------------- */

/** The companions this activity's command would affect: in range, or all if there are none (forced command). */
export function commandTargets(activity) {
  const rule = commandRuleOf(activity?.item);
  const master = rule ? masterTokenOf(activity.actor) : null;
  if ( !master ) return { rule, master, inRange: [], all: [] };
  const all = companionsOf(tokenDoc(master), rule);
  return { rule, master: tokenDoc(master), inRange: all.filter(c => c.inRange).map(c => c.token), all: all.map(c => c.token) };
}

/** This master's command activities (`commands`) that designate this companion: for the latter's menu. */
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

/** On the author's client: the command given, passed on to the active GM (who writes on the companion). */
async function onPostUse(activity) {
  const { rule, master, inRange, all } = commandTargets(activity);
  if ( !rule || !master ) return;
  const targets = inRange.length ? inRange : all;
  if ( !targets.length ) { notice(master, loc("Monture.Souci.commandNone")); return; }
  await viaActiveGM(MOUNT_QUERY, handleCommandQuery, { action: "command", master: master.uuid, companions: targets.map(t => t.uuid),
    round: game.combat?.round ?? null }, { noGm: "Monture.SansMJ", fallback: false, label: "command: request" });
}

/** Active GM: marks the companions commanded for this round. The sender must own the master. */
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

/** The single query: mount, dismount, command. */
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

/** For the test API: the state of this token's pair. */
export function mountState(token) {
  const t = tokenDoc(token);
  return { mountedOn: mountOf(t)?.id ?? null, ridden: riderOf(t)?.id ?? null, rule: mountRuleOf(t?.actor) ?? null,
    commanded: t?.actor?.getFlag(MODULE_ID, COMMANDED) ?? null, statuses: Array.from(t?.actor?.statuses ?? []), executor: isExecutor() };
}
