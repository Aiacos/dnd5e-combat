/**
 * §222: the chosen mastery properties — how many, which, when to change them (the properties' effects: runtime/mastery.mjs).
 *
 *  - **Limit** (world setting `masteryRules`, on by default): on the client that edits the sheet (`preUpdateActor`), a choice
 *    of properties that exceeds what classes and feats give, takes a weapon the character is not proficient with, puts a ranged
 *    weapon in a Barbarian property, or removes a property outside a Long Rest is stripped from the update (the rest goes
 *    through), with a warning. The GM is never held back: a warning only. dnd5e's level-up (`isAdvancement`) always goes through.
 *  - **Long Rest** (`dnd5e.restCompleted`, on the rest's client): the `masteryRest` flag notes how many properties can change
 *    (Fighter: one; Barbarian, Paladin, Ranger, Rogue, Weapon Master: all of theirs), then `dnd5e-combat.masteryRest` is
 *    published: the interface opens the properties window for the player (ui/mastery.mjs). Each property removed spends one.
 *  - **Entering combat** (`combatStart`, active GM): the flag drops — changes are made on leaving the rest.
 */

import { MODULE_ID } from "../constants.mjs";
import { masteryVerdict, restChanges } from "../core/mastery.mjs";
import { MASTERY_REST_FLAG, chosenMasteries, masterySourcesOf, restAllowanceOf, weaponFacts, baseWeapons } from "../adapter/mastery.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const MASTERY_RULES_SETTING = "masteryRules";
const PATH = "system.traits.weaponProf.mastery.value";

export const masteryRulesOn = () => { try { return game.settings.get(MODULE_ID, MASTERY_RULES_SETTING) !== false; } catch { return true; } };

/** The choice proposed by an update (`changes` expanded or flat), or undefined. */
function proposed(changes) {
  if ( PATH in changes ) return changes[PATH];
  return foundry.utils.getProperty(changes, PATH);
}

function dropProposal(changes) {
  if ( PATH in changes ) delete changes[PATH];
  const mastery = foundry.utils.getProperty(changes, "system.traits.weaponProf.mastery");
  if ( mastery && (typeof mastery === "object") ) delete mastery.value;
}

/**
 * Judges a choice of mastery properties for this actor: the verdict of core/mastery.mjs, with its sources, its weapons and what the
 * Long Rest lets change. Exposed to the interface (the properties window judges before saving).
 */
export function judgeMasteries(actor, after) {
  return masteryVerdict({ before: chosenMasteries(actor), after: Array.from(after ?? []), weapons: weaponFacts(actor),
    sources: masterySourcesOf(actor), allowance: restAllowanceOf(actor) });
}

function onPreUpdateActor(actor, changes, options) {
  if ( options?.isAdvancement || options?.[MODULE_ID]?.masteryChecked || !masteryRulesOn() ) return true;
  const after = proposed(changes);
  if ( after === undefined ) return true;
  const verdict = judgeMasteries(actor, after);
  if ( !verdict.ok ) {
    const text = loc(`Bottes.Refus.${verdict.reason}`, { name: actor.name, slots: verdict.slots, allowance: restAllowanceOf(actor) });
    if ( game.user.isGM ) {
      ui.notifications.warn(loc("Bottes.Refus.MJ", { text }));
      return true;
    }
    ui.notifications.warn(text);
    log(`weapon mastery: ${actor.name}'s choice refused (${verdict.reason})`);
    dropProposal(changes);
    return true;
  }
  // A removed property spends what the Long Rest lets change (the GM too: they act for the player).
  if ( verdict.removed > 0 ) {
    const left = Math.max(0, restAllowanceOf(actor) - verdict.removed);
    foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${MASTERY_REST_FLAG}`, { allowance: left });
  }
  return true;
}

async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "long") || !actor?.isOwner || !masteryRulesOn() ) return;
  const sources = masterySourcesOf(actor);
  if ( !sources.length ) return;
  const allowance = restChanges(sources);
  await actor.setFlag(MODULE_ID, MASTERY_REST_FLAG, { allowance });
  log(`${actor.name}: Long Rest, ${allowance} weapon mastery choice(s) may change`);
  // §222: on each client that owns the actor, after a Long Rest that lets them change weapon mastery properties: `(actor)`.
  // Read-only.
  Hooks.callAll(`${MODULE_ID}.masteryRest`, actor);
}

async function onCombatStart(combat) {
  for ( const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean)) ) {
    if ( actor.getFlag(MODULE_ID, MASTERY_REST_FLAG) ) await actor.unsetFlag(MODULE_ID, MASTERY_REST_FLAG);
  }
}

export function registerMasteryChoices() {
  game.settings.register(MODULE_ID, MASTERY_RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${MASTERY_RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${MASTERY_RULES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  // The index of base weapons, read once: the `preUpdateActor` check is synchronous.
  route("ready", () => baseWeapons().catch(err => console.error(`${MODULE_ID} | weapon index`, err)), { label: "weapon index not read" });
  route("preUpdateActor", onPreUpdateActor, { cancellable: true, label: "weapon mastery choice not checked" });
  // On the client that started the rest (documents/actor/actor.mjs), owner of the actor.
  route("dnd5e.restCompleted", onRestCompleted, { label: "weapon mastery: Long Rest change not offered" });
  route("combatStart", onCombatStart, { executor: true, label: "weapon mastery: Long Rest change not closed" });
}
