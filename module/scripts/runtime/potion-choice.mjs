/**
 * Issue #31 (Henrique): house rule for healing potions, world setting `potionHealing`, disabled by default.
 *
 * - Bonus Action: one drinks or has someone drink, the healing is rolled (2024 rule, nothing changes).
 * - Action: the healing is maximal (Potion of Healing 2d4 + 2 → 10 HP) — the dice become their maximum BEFORE the roll, like
 *   Supreme Healing (§233): the card shows the returned value, Dice So Nice has no die to animate.
 *
 * The choice: passed by the caller (`usageConfig["dnd5e-combat"].potionMode`, the Combat UI and the "Give a drink" menu), otherwise
 * asked here when the action and the Bonus Action are both free (core/potion-choice.mjs); out of combat, maximal healing with no
 * question. The cost goes through the `cost` key that legality and the budget already read (Quickened Spell does the opposite):
 * registered before registerTurn. Only potions whose healing costs a Bonus Action (2024 data) are concerned
 * (`offersPotionChoice`).
 *
 * Having another drink: targeting rules do not change (§101); whoever administers chooses and pays, the patient receives
 * the healing.
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

/** Is the house rule active in this world? */
export function potionHealingOn() {
  try { return game.settings.get(MODULE_ID, POTION_HEALING_SETTING) === true; } catch { return false; }
}

/**
 * What an interface can offer for this activity (the Combat UI: its drawer), or null if the rule does not apply.
 * `bonus`: the formula rolled; `action`: the maximal healing; `available`: what the turn's budget allows; `ask`: is a choice needed
 * (otherwise `mode` is the one the engine will take by default).
 * @param {Activity} activity
 * @returns {{ ask: boolean, mode: string|null, available: {bonus: boolean, action: boolean},
 *   formula: string|null, max: number|null }|null}
 */
export function potionOptions(activity) {
  if ( !potionHealingOn() || !offersPotionChoice(activity) || !activity.actor ) return null;
  const combatant = combatantFor(activity.actor);
  const choice = potionChoice({ inCombat: !!combatant, budget: combatant ? readBudget(combatant) : null });
  const heal = healingFormulaOf(activity, maximizeDice);
  return { ...choice, formula: heal?.formula ?? null, max: heal?.max ?? null };
}

/* -------------------------------------------- */

/** The promised maximal healing, by "actorId.itemId": the drunk potion may be destroyed before the roll (last of its stack). */
const promised = new Map();
const PROMISE_MS = 10 * 60 * 1000;
const promiseKey = activity => `${activity?.actor?.id}.${activity?.item?.id}`;

/** The question, when the action and the Bonus Action are free. Returns "bonus", "action" or null (closed). */
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

/** `dnd5e.preUseActivity`: the choice (passed, by default or asked) and its cost. */
function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  if ( !potionHealingOn() || !offersPotionChoice(activity) ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  let mode = chosenPotionMode(ours.potionMode);
  if ( !mode ) {
    const combatant = combatantFor(activity.actor);
    const choice = potionChoice({ inCombat: !!combatant, budget: combatant ? readBudget(combatant) : null });
    if ( choice.ask ) {
      // The suspended use's targets restart with the relaunch (having another drink).
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

/** `dnd5e.postUseActivity`: the use took place — the maximal healing is promised to the roll that follows. */
function onPostUse(activity, usageConfig, results) {
  if ( usageConfig?.[MODULE_ID]?.potionMode !== "action" || !offersPotionChoice(activity) ) return;
  promised.set(promiseKey(activity), { at: Date.now(), message: results?.message?.id ?? null });
}

/** Must this potion's healing roll be maximal? By the use card, otherwise by the promise in memory. */
function promisedMax(activity, message) {
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin");
  if ( origin && (game.messages.get(origin)?.getFlag(MODULE_ID, "potionMode") === "action") ) return true;
  const p = promised.get(promiseKey(activity));
  if ( !p ) return false;
  if ( (Date.now() - p.at) > PROMISE_MS ) { promised.delete(promiseKey(activity)); return false; }
  return true;
}

/** `dnd5e.preRollDamageV2` (client of whoever drinks or gives a drink): dice at their maximum, and visible feedback. */
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
 * Issue #31: "Have a creature drink a healing potion" (context menu of a creature in contact, GM and players) — the
 * creature is chosen, then the potion is used as if clicked: the Bonus Action / action question follows if the house rule is
 * active. `administer` makes the healing of a "personal" potion (Dungeon Master's Guide) go to the chosen creature
 * (adapter/usage.mjs).
 * @param {TokenDocument} target
 * @param {Activity} activity  The potion's healing activity (adapter/potions.mjs, `healingPotionActivity`).
 * @param {{event?: Event, potionMode?: string}} [options]
 */
export function administerPotion(target, activity, { event=null, potionMode=null }={}) {
  const placeable = target?.object;
  if ( !placeable || !activity ) return null;
  placeable.setTarget(true, { releaseOthers: true });
  const ours = { administer: true, ...(chosenPotionMode(potionMode) ? { potionMode } : {}) };
  return activity.use({ event, [MODULE_ID]: ours });
}
