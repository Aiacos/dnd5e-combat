/**
 * §213: Improvised Weapons (2024 rules) — requested from the GM.
 *  - The basic action "Improvised Weapon" (content/actions.mjs, no cost by itself): the player names the object ("a chair") and
 *    the gesture (strike in melee, or throw).
 *  - The active GM receives the request and decides: refuse; accept as an improvised weapon (1d4, the damage type they judge
 *    logical, throw range 6/18 m); or accept "as" a weapon of the game (`CONFIG.DND5E.weaponIds`: a table leg as a club),
 *    whose damage, properties and mastery the creature takes.
 *  - Accepted: a temporary weapon (`flags.dnd5e-combat.improvised`) is placed on the sheet, and its attack goes off at once (in
 *    aim mode with no target) — a weapon attack like any other (the Attack action, Extra Attack). Improvised weapon: no
 *    proficiency, except the Tavern Brawler feat ("proficiency with improvised weapons"; dnd5e only gives it on the 2014 flag
 *    `tavernBrawlerFeat`, data/item/weapon.mjs:372). The temporary weapon disappears at the end of the creature's turn, with the
 *    combat, or at the next request.
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, say, viaActiveGM } from "./shared.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";

export const IMPROVISED_QUERY = `${MODULE_ID}.improvised`;
const FLAG = "improvised";
/** The time left to the GM to decide. */
const GM_TIMEOUT = 120000;
/** Damage types offered to the GM for an improvised weapon. */
const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "acid", "lightning", "poison"];

/* -------------------------------------------- */
/*  Player side: the request                    */
/* -------------------------------------------- */

/** The player's window: the object and the gesture; null if closed. */
async function askObject(actor) {
  const content = `<p>${loc("Improvise.Intro")}</p>
    <div class="form-group"><label>${loc("Improvise.Objet")}</label><input type="text" name="object" placeholder="${esc(loc("Improvise.Exemple"))}" autofocus></div>
    <div class="form-group"><label>${loc("Improvise.Geste")}</label><select name="mode">
      <option value="melee">${loc("Improvise.Frapper")}</option><option value="thrown">${loc("Improvise.Lancer")}</option></select></div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Improvise.Titre", { name: actor.name }) }, content, rejectClose: false, position: { width: 420 },
    buttons: [
      { action: "ask", label: loc("Improvise.Demander"), icon: "fa-solid fa-paper-plane", default: true,
        callback: (event, button) => ({ object: button.form.elements.object.value.trim(), mode: button.form.elements.mode.value }) },
      { action: "cancel", label: loc("Improvise.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return (answer && (typeof answer === "object") && answer.object) ? answer : null;
}

/* -------------------------------------------- */
/*  GM side: the decision                       */
/* -------------------------------------------- */

/** The game's weapons offered to the GM (`CONFIG.DND5E.weaponIds`), by name. */
function weaponChoices() {
  return Object.entries(CONFIG.DND5E.weaponIds ?? {})
    .map(([id, uuid]) => ({ id, name: fromUuidSync(uuid, { strict: false })?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** Active GM: a player's request — refuse, or accept (improvised weapon, or as a weapon of the game). */
async function handleRequest({ actor: actorUuid, object, mode, user }, { user: sender=null }={}) {
  // §472: the name shown to the GM is the real sender's.
  if ( sender && !sender.isSelf ) user = sender.id;
  const actor = await fromUuid(actorUuid ?? "");
  if ( !actor ) return { accepted: false };
  const opt = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
  const asker = game.users.get(user)?.name ?? "";
  const content = `<p>${loc("Improvise.DemandeMJ", { user: esc(asker), name: esc(actor.name), object: esc(object), mode: esc(loc(mode === "thrown" ? "Improvise.Lancer" : "Improvise.Frapper")) })}</p>
    <div class="form-group"><label>${loc("Improvise.CommeQuoi")}</label><select name="as">
      ${opt("", loc("Improvise.Improvisee"))}${weaponChoices().map(w => opt(w.id, loc("Improvise.Comme", { weapon: w.name }))).join("")}</select></div>
    <div class="form-group"><label>${loc("Improvise.TypeDegats")}</label><select name="type">
      ${DAMAGE_TYPES.map(t => opt(t, game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t))).join("")}</select></div>
    <p class="hint">${loc("Improvise.AideMJ")}</p>`;
  // §381: the table sees the GM deciding (hourglass above the character).
  const answer = await whileAwaiting(actor, "choice", () => foundry.applications.api.DialogV2.wait({
    window: { title: loc("Improvise.TitreMJ") }, content, rejectClose: false, position: { width: 460 },
    buttons: [
      { action: "accept", label: loc("Improvise.Accepter"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => ({ accepted: true, as: button.form.elements.as.value || null, type: button.form.elements.type.value }) },
      { action: "refuse", label: loc("Improvise.Refuser"), icon: "fa-solid fa-ban", callback: () => ({ accepted: false }) }
    ]
  }));
  const verdict = (answer && (typeof answer === "object")) ? answer : { accepted: false };
  log(`improvised weapon asked by ${actor.name} (${object}, ${mode}): ${verdict.accepted ? `accepted${verdict.as ? ` as ${verdict.as}` : ` (1d4 ${verdict.type})`}` : "refused"}`);
  return verdict;
}

/* -------------------------------------------- */
/*  L'arme temporaire                           */
/* -------------------------------------------- */

/** The Tavern Brawler feat (2024) grants proficiency with improvised weapons. */
const tavernBrawler = actor => (actor?.items ?? []).some(i => identifierOf(i).id === "tavern-brawler") || !!actor?.getFlag?.("dnd5e", "tavernBrawlerFeat");

/** The generic improvised weapon's data: 1d4 of the chosen type, range 6/18 m if thrown. */
function improvisedData(actor, { object, mode, type }) {
  const thrown = mode === "thrown";
  const activityId = "dnd5eCombatImprv";
  return {
    name: loc("Improvise.NomArme", { object }),
    type: "weapon",
    img: "icons/svg/hanging-sign.svg",
    system: {
      description: { value: `<p>${loc("Improvise.TexteArme")}</p>` },
      type: { value: "improv", baseItem: "" },
      proficient: tavernBrawler(actor) ? 1 : 0,
      equipped: true,
      quantity: 1,
      properties: thrown ? ["thr"] : [],
      range: thrown ? { value: 20, long: 60, reach: 5, units: "ft" } : { reach: 5, units: "ft" },
      damage: { base: { number: 1, denomination: 4, types: [type || "bludgeoning"] } },
      activities: {
        [activityId]: { _id: activityId, type: "attack", activation: { type: "action", value: 1 },
          target: { affects: { type: "creature", count: "1" }, prompt: false },
          attack: { ability: "", type: { value: "melee", classification: "weapon" } }, damage: { includeBase: true, parts: [] } }
      }
    }
  };
}

/** The data of a game weapon taken "as": its own, renamed after the object. */
async function asWeaponData(weaponId, { object }) {
  const source = await fromUuid(CONFIG.DND5E.weaponIds?.[weaponId] ?? "");
  if ( !source ) return null;
  const data = source.toObject();
  delete data._id;
  data.name = loc("Improvise.NomComme", { object, weapon: source.name });
  data.system.equipped = true;
  data.system.quantity = 1;
  return data;
}

/** Retire les armes temporaires de cet acteur. */
async function dropTemporary(actor) {
  const ids = (actor?.items ?? []).filter(i => i.getFlag(MODULE_ID, FLAG)).map(i => i.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("Item", ids);
}

/** `dnd5e.postUseActivity`, on the client that took the action: the request, the GM's decision, the weapon and the attack. */
async function onImprovisedUsed(activity) {
  if ( basicActionOf(activity?.item) !== "improvised" ) return;
  const actor = activity.actor;
  if ( !actor?.isOwner ) return;
  const request = await askObject(actor);
  if ( !request ) return;
  const token = tokenOf(actor);
  ui.notifications.info(loc("Improvise.Attente"));
  const verdict = await viaActiveGM(IMPROVISED_QUERY, handleRequest, { actor: actor.uuid, ...request, user: game.user.id },
    { timeout: GM_TIMEOUT, noGm: "Improvise.SansMJ", fallback: { accepted: false } });
  if ( !verdict?.accepted ) {
    ui.notifications.warn(loc("Improvise.Refuse", { object: request.object }));
    await say({ actor, token }, loc("Improvise.CarteRefus", { name: esc(actor.name), object: esc(request.object) }));
    return;
  }
  const data = verdict.as ? await asWeaponData(verdict.as, request) : improvisedData(actor, { ...request, type: verdict.type });
  if ( !data ) return;
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [FLAG]: { object: request.object, mode: request.mode } } };
  await dropTemporary(actor);
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  const attack = item?.system.activities?.find(a => a.type === "attack");
  await say({ actor, token }, loc("Improvise.CarteAccord", { name: esc(actor.name), object: esc(request.object), weapon: esc(item?.name ?? "") }));
  log(`${actor.name}: improvised weapon ${item?.name} (${request.mode})`);
  if ( !attack ) return;
  // Throwing: dnd5e's "throw" mode, held by the engine until the roll (§150) — a game weapon without Thrown stays thrown as the
  // GM accepted it.
  const thrown = (request.mode === "thrown") && item.system.properties?.has?.("thr");
  await attack.use({ [MODULE_ID]: thrown ? { attackMode: "thrown" } : {} });
}

/** Active GM: at the end of a creature's turn, its temporary weapons disappear (with the combat too). */
function onTurnEnd(combat, prior) {
  const actor = combat.combatants.get(prior?.combatantId)?.actor;
  if ( actor ) dropTemporary(actor).catch(err => console.error(`${MODULE_ID} | improvised weapon`, err));
}

async function onCombatEnd(combat) {
  for ( const combatant of combat.combatants ) await dropTemporary(combatant.actor).catch(() => {});
}

export function registerImprovised() {
  CONFIG.queries[IMPROVISED_QUERY] = handleRequest;
  route("dnd5e.postUseActivity", activity => { onImprovisedUsed(activity).catch(err => console.error(`${MODULE_ID} | improvised weapon`, err)); },
    { label: "improvised weapon: not requested" });
  route("combatTurnChange", onTurnEnd, { executor: true, label: "improvised weapon: not removed at end of turn" });
  route("deleteCombat", onCombatEnd, { executor: true, label: "improvised weapon: not removed with the combat" });
}
