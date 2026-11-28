/**
 * Familiars (SPEC §107): vision on summoning, and the pocket dimension of Find Familiar (PHB 2024) — "by taking the Magic
 * action, you can temporarily dismiss the familiar to a pocket dimension"; "by taking the Magic action while it is
 * temporarily dismissed, you can make it reappear in an unoccupied space within 9 m of you". The familiar's basic actions
 * are set by runtime/basics.mjs.
 *
 *  - Intentions (`dismissFamiliar`, `recallFamiliar`) leave from the client of whoever acts: soft check (§6) of the
 *    master's budget in combat (their action, on their turn), then a request to the active GM — a player neither creates nor
 *    deletes tokens in the table's world.
 *  - On the active GM, the dismissal: what the familiar carries drops to the ground via the `dnd5e-combat.dropItems` hook (a
 *    neighboring module that handles it, §40.3; without a neighbor, the items stay on its sheet, kept with it), its combatants
 *    are removed, its token is noted in the master's pocket (adapter/familiar.mjs) then deleted, the master's action is spent.
 *  - The recall: the pocket is emptied THEN the token recreated at the chosen cell (the delta comes back with it: HP, effects,
 *    items); its creation goes through the ordinary routes of a summon — it joins its master's combat and rolls its own
 *    Initiative there (§16.13, `initiative: "own"`), its end time (Wild Companion) stays that of the summon
 *    (adapter/summons.mjs `noteSummonExpiry`).
 *  - Recasting the spell while the familiar is in the pocket summons a new one (dnd5e): "only one familiar" — the
 *    pocket is emptied when the new token is created.
 */

import { MODULE_ID } from "../constants.mjs";
import { POCKET_COST, carriedItemIds, recalledTokenData } from "../core/familiar.mjs";
import { isFamiliarItem, isFamiliarToken, masterOf, pocketOf, storeInPocket, emptyPocket, recallSpot } from "../adapter/familiar.mjs";
import { droppedByNeighbour } from "../adapter/orders.mjs";
import { budgetIssues, spendBudget } from "./neighbours.mjs";
import { askAnyway } from "./turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaActiveGM, say, locEsc } from "./shared.mjs";

export const POCKET_QUERY = `${MODULE_ID}.familiarPocket`;
export const RECALL_QUERY = `${MODULE_ID}.familiarRecall`;

/** Can this client dismiss this familiar: it owns its master (the GM, always). */
export function canPocket(tokenDoc) {
  return !!tokenDoc && isFamiliarToken(tokenDoc) && (masterOf(tokenDoc)?.isOwner === true);
}

/** Can this client recall this master's familiar: it owns it, and the pocket is not empty. */
export function canRecall(masterToken) {
  return !!masterToken?.actor?.isOwner && !!pocketOf(masterToken.actor);
}

/** The familiar kept in the pocket of this token's master: `{ name, img }`, or null. */
export function pocketedFamiliar(masterToken) {
  const pocket = pocketOf(masterToken?.actor);
  return pocket ? { name: pocket.name ?? pocket.token.name, img: pocket.img ?? null } : null;
}

/** What refuses the cell under this point for the recall (short text), or null. */
export function recallRefusal(masterToken, point) {
  const spot = recallSpot(masterToken, point);
  if ( !spot ) return loc("Familier.PocheVide");
  if ( spot.problem === "far" ) return loc("Retour.HorsDePortee");
  if ( spot.problem === "occupied" ) return loc("Familier.CaseOccupee");
  return null;
}

/** Soft mode (§6): in combat, the master's action — we say what is wrong, they decide. Returns true to continue. */
async function legalForMaster(master, title) {
  const issues = budgetIssues(master, POCKET_COST);
  if ( !issues.length ) return true;
  return askAnyway(`${title} — ${master.name}`, issues.map(issue => loc(`Souci.${issue}`)), { actor: master, item: title });
}

function askGM(query, payload, here) {
  return viaActiveGM(query, p => here(p, { user: game.user }), payload,
    { timeout: 15000, noGm: "Familier.SansMJ", fallback: false, label: "familiar" });
}

/**
 * Intention: dismiss this familiar into its pocket dimension. Returns true if done.
 * @param {TokenDocument} tokenDoc
 */
export async function dismissFamiliar(tokenDoc) {
  if ( !canPocket(tokenDoc) ) return false;
  const master = masterOf(tokenDoc);
  if ( !(await legalForMaster(master, loc("Familier.Renvoyer", { name: tokenDoc.name }))) ) return false;
  return (await askGM(POCKET_QUERY, { token: tokenDoc.uuid }, handlePocket)) === true;
}

/**
 * Intention: recall the familiar of this token's master, under this point. Returns true if done; false if the cell is
 * refused (targeting can continue) or if it was given up.
 * @param {TokenDocument} masterToken
 * @param {{x: number, y: number}} point
 */
export async function recallFamiliar(masterToken, point) {
  if ( !canRecall(masterToken) ) return false;
  const refusal = recallRefusal(masterToken, point);
  if ( refusal ) { notice(masterToken, refusal, "refused"); return false; }
  const name = pocketedFamiliar(masterToken)?.name ?? "";
  if ( !(await legalForMaster(masterToken.actor, loc("Familier.Rappeler", { name }))) ) return false;
  return (await askGM(RECALL_QUERY, { token: masterToken.uuid, point: { x: point.x, y: point.y } }, handleRecall)) === true;
}

async function tell(actor, key, data, flag) {
  await say({ actor }, locEsc(key, data), { familiar: flag });
}

/** Active GM side: the familiar goes into its master's pocket. */
export async function handlePocket({ token: tokenUuid }, { user }={}) {
  const token = await fromUuid(tokenUuid);
  const master = token ? masterOf(token) : null;
  if ( !master || (user && !master.testUserPermission(user, "OWNER")) ) return false;
  // "It leaves in its space everything it was carrying": up to a neighboring module to put it on the ground.
  const carried = carriedItemIds(token.actor?.items.contents.map(i => i.toObject()), MODULE_ID)
    .map(id => token.actor.items.get(id)).filter(Boolean);
  const dropped = carried.length ? await droppedByNeighbour(token, carried) : false;
  if ( carried.length ) log(`${token.name}: ${carried.map(i => i.name).join(", ")} ${dropped ? "dropped on the ground" : "kept with it (no module drops items on the ground)"}`);
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.sceneId === token.parent.id) && (c.tokenId === token.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  await storeInPocket(master, token);
  await token.delete();
  await spendBudget(master, POCKET_COST);
  await tell(master, "Familier.Renvoye", { name: master.name, familiar: token.name }, { pocket: token.name });
  log(`${token.name}: in ${master.name}'s pocket dimension`);
  return true;
}

/** Active GM side: the familiar returns to the chosen cell (refused again here if it no longer fits). */
export async function handleRecall({ token: tokenUuid, point }, { user }={}) {
  const masterToken = await fromUuid(tokenUuid);
  const master = masterToken?.actor;
  const pocket = pocketOf(master);
  if ( !pocket || (user && !master.testUserPermission(user, "OWNER")) ) return false;
  const spot = recallSpot(masterToken, point);
  if ( !spot || spot.problem ) return false;
  if ( !game.actors.get(pocket.token.actorId) ) {
    ui.notifications.warn(loc("Familier.ActeurPerdu", { name: pocket.name }));
    return false;
  }
  const data = recalledTokenData(pocket.token, spot, MODULE_ID);
  await emptyPocket(master);
  let created = null;
  try { [created] = await masterToken.parent.createEmbeddedDocuments("Token", [data]); }
  catch(err) {
    console.error(`${MODULE_ID} | familiar not recalled`, err);
    await master.setFlag(MODULE_ID, "pocket", pocket);   // rien n'est perdu
    return false;
  }
  if ( !created ) { await master.setFlag(MODULE_ID, "pocket", pocket); return false; }
  await spendBudget(master, POCKET_COST);
  await tell(master, "Familier.Rappele", { name: master.name, familiar: created.name }, { recall: created.name });
  log(`${created.name}: back from ${master.name}'s pocket dimension`);
  return true;
}

/**
 * Vision: the familiar's token sees (`sight.enabled`) — its player sees through its eyes. dnd5e (setting `senseVisionSync`)
 * then sets range and mode from its senses, without touching `enabled` (documents/token.mjs:77-80, 123-134). The
 * `dnd5e.summonToken` hook passes the token data before their creation, on the client that summons
 * (documents/activity/summon.mjs:192, created at :204).
 */
function onSummonToken(activity, profile, tokenData) {
  if ( !isFamiliarItem(activity?.item) ) return;
  if ( tokenData.sight?.enabled === true ) return;
  tokenData.sight = { ...(tokenData.sight ?? {}), enabled: true };
  log(`${tokenData.name}: familiar, vision enabled`);
}

/** Active GM: familiars already placed without vision (summoned before this version) get it. */
async function sightForPlaced() {
  for ( const scene of game.scenes ) {
    const updates = scene.tokens.filter(t => !t._source.sight?.enabled && isFamiliarToken(t)).map(t => ({ _id: t.id, "sight.enabled": true }));
    if ( !updates.length ) continue;
    await scene.updateEmbeddedDocuments("Token", updates);
    log(`${scene.name}: vision enabled for ${updates.length} familiar(s)`);
  }
}

export function registerFamiliars() {
  CONFIG.queries[POCKET_QUERY] = handlePocket;
  CONFIG.queries[RECALL_QUERY] = handleRecall;
  route("dnd5e.summonToken", onSummonToken, { label: "familiar: vision not enabled" });
  route("ready", sightForPlaced, { executor: true, label: "familiar: vision not enabled" });
  // "Only one familiar": a newly summoned familiar empties the pocket (the recall empties it BEFORE recreating its own).
  route("createToken", async tokenDoc => {
    const master = isFamiliarToken(tokenDoc) ? masterOf(tokenDoc) : null;
    if ( !pocketOf(master) ) return;
    await emptyPocket(master);
    log(`${master.name}: new familiar (${tokenDoc.name}), the old one leaves the pocket dimension`);
  }, { executor: true, label: "familiar: pocket not emptied" });
}
