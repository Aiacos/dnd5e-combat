/**
 * §289: "Second Skin" (Ravenloft), Involuntary Change — "after experiencing the catalyst, at the start of your next turn, make a
 * Charisma saving throw (DC 13 + proficiency bonus). Failure: you immediately use Alternate Form to cast Alter Self
 * without a slot. If you have already spent this benefit, you have the Stunned condition until the start of your next turn."
 * The catalyst is judged at the table: the GM declares it through the token menu (`armCatalyst`); at the start of the
 * bearer's next turn (right away out of combat), the active GM rolls the save (`requestSave`), then the free casting or the
 * item's "Stunned" effect (`effectEnds` makes it fall at the start of its following turn). Card and floating text for everyone.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { contentOf } from "../adapter/content.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { requestSave } from "./neighbours.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, viaActiveGM } from "./shared.mjs";

const FLAG = "catalyst";
export const CATALYST_QUERY = `${MODULE_ID}.catalyst`;

/** The bearer's item that declares a catalyst, and its rule — `{ item, rule }`, or null. */
export function catalystOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.catalyst;
    if ( rule ) return { item, rule };
  }
  return null;
}

/** Is the catalyst already declared, waiting for the start of the turn? */
export const catalystArmed = actor => !!actor?.getFlag(MODULE_ID, FLAG);

/** Active GM: the save and what follows. */
async function resolveCatalyst(actor) {
  const found = catalystOf(actor);
  if ( actor.getFlag(MODULE_ID, FLAG) ) await actor.unsetFlag(MODULE_ID, FLAG);
  if ( !found ) return null;
  const { item, rule } = found;
  const save = item.system.activities?.get(rule.save);
  const ability = Array.from(save?.save?.ability ?? [])[0] ?? "cha";
  const dc = Number(save?.save?.dc?.value) || null;
  const token = tokenOf(actor);
  const result = await requestSave(actor, { ability, dc, flavor: loc("Catalyseur.Sauvegarde", { item: item.name, name: actor.name }) });
  if ( !result ) return null;
  if ( result.success ) {
    if ( token ) notice(token, { key: "Catalyseur.Resiste" }, "gain", { all: true });
    await say({ actor }, locEsc("Catalyseur.Reussie", { name: actor.name, item: item.name, total: result.total, dc: dc ?? "?" }), { catalyst: { item: item.name, success: true } });
    log(`${item.name}: ${actor.name} resists the change (${result.total} vs DC ${dc})`);
    return { success: true };
  }
  // The free casting, if any remains: the Alternate Form activity. §295: its use ("once per Long Rest") is counted
  // on the activity in the Ravenloft data, the item has none — the item only as a fallback.
  const cast = item.system.activities?.get(rule.cast);
  const uses = Number(cast?.uses?.max) ? cast.uses : item.system.uses;
  const left = Number(uses?.max) ? (Number(uses.value) || 0) : 0;
  let outcome = "stunned";
  if ( cast && (left > 0) ) {
    const used = await cast.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }).catch(err => { console.error(`${MODULE_ID} | ${item.name}`, err); return null; });
    if ( used ) outcome = "changes";
  }
  if ( outcome === "stunned" ) await placeItemEffect(item, rule.effect, actor);
  if ( token ) notice(token, { key: outcome === "changes" ? "Catalyseur.Change" : "Catalyseur.Etourdi" }, "refused", { all: true });
  await say({ actor }, locEsc(outcome === "changes" ? "Catalyseur.Transforme" : "Catalyseur.Assomme", { name: actor.name, item: item.name, total: result.total, dc: dc ?? "?" }),
    { catalyst: { item: item.name, success: false, outcome } });
  log(`${item.name}: ${actor.name} fails (${result.total} vs DC ${dc}) — ${outcome}`);
  return { success: false, outcome };
}

/** Active GM: the catalyst noted; out of combat, the save right away. */
async function handleCatalyst({ actor: uuid }, { user=null }={}) {
  // §472: only the GM sends this request in play; from a player, it is dropped (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | catalyst query from ${user.name} refused: only a GM sends it`); return null; }
  const actor = await fromUuid(uuid ?? "");
  if ( !actor || !catalystOf(actor) ) return null;
  if ( combatantFor(actor)?.parent?.started ) {
    await actor.setFlag(MODULE_ID, FLAG, true);
    const token = tokenOf(actor);
    if ( token ) notice(token, { key: "Catalyseur.Note" }, "refused", { all: true });
    log(`${actor.name}: change catalyst noted, saving throw at the start of their next turn`);
    return { armed: true };
  }
  return resolveCatalyst(actor);
}

/** The GM declares the catalyst experienced (token menu). */
export function armCatalyst(actor) {
  return viaActiveGM(CATALYST_QUERY, handleCatalyst, { actor: actor.uuid }, { fallback: null });
}

export function registerCatalyst() {
  CONFIG.queries[CATALYST_QUERY] = handleCatalyst;
  route("combatTurnChange", (combat, prior, current) => {
    const actor = combat.combatants.get(current?.combatantId)?.actor;
    if ( catalystArmed(actor) ) return enqueue(`catalyst:${actor.uuid}`, () => resolveCatalyst(actor));
  }, { executor: true, label: "involuntary change: not played" });
}
