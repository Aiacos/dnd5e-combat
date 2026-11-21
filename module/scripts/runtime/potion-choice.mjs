/**
 * Issue #31 (Henrique) : règle maison des potions de soins, réglage de monde `potionHealing`, désactivé par défaut.
 *
 * - Action Bonus : on boit ou l'on fait boire, le soin est lancé (règle 2024, rien ne change).
 * - Action : le soin est maximal (Potion de guérison 2d4 + 2 → 10 PV) — les dés deviennent leur maximum AVANT le jet, comme Guérison
 *   suprême (§233) : la carte montre la valeur rendue, Dice So Nice n'a aucun dé à animer.
 *
 * Le choix : passé par l'appelant (`usageConfig["dnd5e-combat"].potionMode`, la Combat UI et le menu « Faire boire »), sinon demandé ici
 * quand l'action et l'action Bonus sont libres toutes les deux (core/potion-choice.mjs) ; hors combat, soin maximal sans question.
 * Le coût passe par la clé `cost` que la légalité et le budget lisent déjà (le Sort accéléré fait l'inverse) : inscrit avant
 * registerTurn. Seules les potions dont le soin coûte une action Bonus (donnée 2024) sont concernées (`offersPotionChoice`).
 *
 * Faire boire à un autre : les règles de visée ne changent pas (§101) ; celui qui administre choisit et paie, le patient reçoit le soin.
 */

import { MODULE_ID } from "../constants.mjs";
import { relaunchUse } from "./relaunch.mjs";
import { potionChoice, chosenPotionMode, costForPotionMode } from "../core/potion-choice.mjs";
import { maximizeDice } from "../core/max-dice.mjs";
import { offersPotionChoice, healingFormulaOf } from "../adapter/potions.mjs";
import { combatantFor, readBudget, usageTokenOf } from "../adapter/turn.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { route } from "./router.mjs";
import { log, loc, locEsc, notice } from "./shared.mjs";

export const POTION_HEALING_SETTING = "potionHealing";

/** La règle maison est-elle active dans ce monde ? */
export function potionHealingOn() {
  try { return game.settings.get(MODULE_ID, POTION_HEALING_SETTING) === true; } catch { return false; }
}

/**
 * Ce qu'une interface peut proposer pour cette activité (la Combat UI : son tiroir), ou null si la règle ne s'applique pas.
 * `bonus` : la formule lancée ; `action` : le soin maximal ; `available` : ce que le budget du tour permet ; `ask` : faut-il un choix
 * (sinon `mode` est celui que le moteur prendra d'office).
 * @param {Activity} activity
 * @returns {{ ask: boolean, mode: string|null, available: {bonus: boolean, action: boolean}, formula: string|null, max: number|null }|null}
 */
export function potionOptions(activity) {
  if ( !potionHealingOn() || !offersPotionChoice(activity) || !activity.actor ) return null;
  const combatant = combatantFor(activity.actor);
  const choice = potionChoice({ inCombat: !!combatant, budget: combatant ? readBudget(combatant) : null });
  const heal = healingFormulaOf(activity, maximizeDice);
  return { ...choice, formula: heal?.formula ?? null, max: heal?.max ?? null };
}

/* -------------------------------------------- */

/** Le soin maximal promis, par « idActeur.idItem » : la potion bue peut être détruite avant le jet (dernière de sa pile). */
const promised = new Map();
const PROMISE_MS = 10 * 60 * 1000;
const promiseKey = activity => `${activity?.actor?.id}.${activity?.item?.id}`;

/** La question, quand l'action et l'action Bonus sont libres. Rend « bonus », « action » ou null (fermée). */
function askMode(activity) {
  const heal = healingFormulaOf(activity, maximizeDice);
  const formula = heal?.formula ?? "?";
  return timedWait({
    window: { title: activity.item.name, icon: "fa-solid fa-flask" },
    content: `<p>${locEsc("Potion.Question", { item: activity.item.name })}</p>`,
    buttons: [
      { action: "bonus", icon: "fa-solid fa-dice", label: loc("Potion.Bonus", { formula }), default: true },
      { action: "action", icon: "fa-solid fa-heart-circle-plus", label: loc("Potion.Action", { max: heal?.max ?? "?" }) }
    ]
  }, { fallback: "bonus", awaiting: { actor: activity.actor, kind: "choice" } });
}

/** `dnd5e.preUseActivity` : le choix (passé, d'office ou demandé) et son coût. */
function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  if ( !potionHealingOn() || !offersPotionChoice(activity) ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  let mode = chosenPotionMode(ours.potionMode);
  if ( !mode ) {
    const combatant = combatantFor(activity.actor);
    const choice = potionChoice({ inCombat: !!combatant, budget: combatant ? readBudget(combatant) : null });
    if ( choice.ask ) {
      // Les cibles de l'utilisation suspendue repartent avec la relance (faire boire à un autre).
      const targets = Array.from(game.user.targets);
      askMode(activity).then(picked => {
        if ( !chosenPotionMode(picked) ) return;
        if ( !game.user.targets.size ) for ( const t of targets ) t.setTarget(true, { releaseOthers: false });
        relaunchUse(activity, { ...usageConfig, [MODULE_ID]: { ...ours, potionMode: picked } }, dialogConfig, messageConfig);
      }).catch(err => console.error(`${MODULE_ID} | healing potion choice`, err));
      return false;
    }
    mode = choice.mode;
  }
  ours.potionMode = mode;
  const cost = costForPotionMode(mode);
  if ( cost && !ours.cost ) ours.cost = cost;
  if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.potionMode`, mode);
  log(`${activity.item.name}: healing potion as ${mode === "action" ? "an action (maximum healing)" : "a Bonus Action (rolled)"}`);
  return true;
}

/** `dnd5e.postUseActivity` : l'utilisation a eu lieu — le soin maximal est promis au jet qui suit. */
function onPostUse(activity, usageConfig, results) {
  if ( usageConfig?.[MODULE_ID]?.potionMode !== "action" || !offersPotionChoice(activity) ) return;
  promised.set(promiseKey(activity), { at: Date.now(), message: results?.message?.id ?? null });
}

/** Le jet de soin de cette potion doit-il être maximal ? Par la carte d'utilisation, sinon par la promesse en mémoire. */
function promisedMax(activity, message) {
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin");
  if ( origin && (game.messages.get(origin)?.getFlag(MODULE_ID, "potionMode") === "action") ) return true;
  const p = promised.get(promiseKey(activity));
  if ( !p ) return false;
  if ( (Date.now() - p.at) > PROMISE_MS ) { promised.delete(promiseKey(activity)); return false; }
  return true;
}

/** `dnd5e.preRollDamageV2` (client de celui qui boit ou fait boire) : les dés au maximum, et le retour visible de la table. */
function onPreRollHealing(config, dialog, message) {
  const activity = config?.subject;
  if ( !offersPotionChoice(activity) || !config.rolls?.length || !promisedMax(activity, message) ) return true;
  promised.delete(promiseKey(activity));
  for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(part => maximizeDice(part));
  const patients = (foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [])
    .map(t => fromUuidSync(t.token, { strict: false })).filter(Boolean);
  const tokens = patients.length ? patients : [usageTokenOf(activity)].filter(Boolean);
  for ( const token of tokens ) notice(token, { key: "Potion.SoinMax" }, "gain", { all: true, action: "potionMax", outcome: "success" });
  log(`${activity.item.name}: healing dice at their maximum (potion drunk as an action)`);
  return true;
}

export function registerPotionChoice() {
  game.settings.register(MODULE_ID, POTION_HEALING_SETTING, {
    name: `DND5ECOMBAT.Reglage.${POTION_HEALING_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${POTION_HEALING_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false
  });
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "healing potion: Bonus Action or action not chosen" });
  route("dnd5e.postUseActivity", onPostUse, { label: "healing potion: maximum healing not noted" });
  route("dnd5e.preRollDamageV2", onPreRollHealing, { cancellable: true, label: "healing potion: dice not at their maximum" });
}

/**
 * Issue #31 : « Faire boire une potion de soins » (menu contextuel d'une créature au contact, MJ et joueurs) — la créature est désignée,
 * puis la potion utilisée comme d'un clic : la question action Bonus / action vient ensuite si la règle maison est active. `administer`
 * fait aller le soin d'une potion « personnelle » (Guide du maître) à la créature désignée (adapter/usage.mjs).
 * @param {TokenDocument} target
 * @param {Activity} activity  L'activité de soin de la potion (adapter/potions.mjs, `healingPotionActivity`).
 * @param {{event?: Event, potionMode?: string}} [options]
 */
export function administerPotion(target, activity, { event=null, potionMode=null }={}) {
  const placeable = target?.object;
  if ( !placeable || !activity ) return null;
  placeable.setTarget(true, { releaseOthers: true });
  const ours = { administer: true, ...(chosenPotionMode(potionMode) ? { potionMode } : {}) };
  return activity.use({ event, [MODULE_ID]: ours });
}
