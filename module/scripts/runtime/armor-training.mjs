/**
 * §214: Armor Training — what dnd5e does not do (adapter/armor-training.mjs).
 *  - Armor without training: Disadvantage on ability checks (skills, Initiative included) and on Strength and
 *    Dexterity saving throws (`dnd5e.preRollAbilityCheckV2`, `dnd5e.preRollSavingThrowV2`, on the client that rolls); on
 *    Strength or Dexterity attacks, it is an engine Disadvantage reason (core/conditions.mjs, "Armor without training");
 *    casting a spell is a legality matter (runtime/turn.mjs).
 *  - Shield without training: no AC bonus — the active GM puts a marked effect on the character that removes the shield's bonus
 *    (`system.attributes.ac.bonus`), and removes it as soon as the training or the shield changes.
 */

import { MODULE_ID } from "../constants.mjs";
import { armorHampers, untrainedShield } from "../adapter/armor-training.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const SHIELD_FLAG = "untrainedShield";

/** On the client that rolls: Disadvantage on the Strength or Dexterity check or save in armor without training. */
function onPreRoll(config) {
  const actor = config?.subject;
  const roll = config?.rolls?.[0];
  const armor = (actor?.documentName === "Actor") ? armorHampers(actor, config.ability) : null;
  if ( !armor || !roll ) return true;
  roll.options ??= {};
  roll.options.disadvantage = true;
  log(`${actor.name}: ${config.ability} roll with Disadvantage (${armor.name} worn without armor training)`);
  return true;
}

/** Active GM: the "shield without training" effect follows the shield worn and the character's training. */
async function syncShield(actor) {
  if ( actor?.type !== "character" ) return;
  const shield = untrainedShield(actor);
  const value = Number(shield?.system?.armor?.value) || 0;
  const current = actor.effects.find(e => e.getFlag(MODULE_ID, SHIELD_FLAG));
  if ( !shield || !value ) {
    if ( current ) { await current.delete(); log(`${actor.name}: shield penalty removed`); }
    return;
  }
  const changes = [{ key: "system.attributes.ac.bonus", type: "add", value: `-${value}` }];
  if ( current ) {
    if ( current.changes?.[0]?.value === `-${value}` ) return;
    await current.update({ changes, name: loc("Armure.Bouclier", { item: shield.name }) });
    return;
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: loc("Armure.Bouclier", { item: shield.name }), img: shield.img, transfer: false, disabled: false,
    description: `<p>${loc("Armure.BouclierTexte")}</p>`, changes, flags: { [MODULE_ID]: { [SHIELD_FLAG]: true } }
  }]);
  log(`${actor.name}: ${shield.name} carried without armor training, no AC bonus (-${value})`);
}

const queued = new Set();
/** A single update at a time per actor (several hooks may fall together). */
function resync(actor) {
  if ( !actor || queued.has(actor.uuid) ) return;
  queued.add(actor.uuid);
  setTimeout(() => {
    queued.delete(actor.uuid);
    syncShield(actor).catch(err => console.error(`${MODULE_ID} | armor training`, err));
  }, 200);
}

const itemChanged = item => { if ( item?.type === "equipment" ) resync(item.parent); };

export function registerArmorTraining() {
  route("dnd5e.preRollAbilityCheckV2", onPreRoll, { label: "armor training: ability check Disadvantage" });
  route("dnd5e.preRollSavingThrowV2", onPreRoll, { label: "armor training: saving throw Disadvantage" });
  const executor = { executor: true, label: "armor training: shield AC not updated" };
  route("createItem", itemChanged, executor);
  route("updateItem", itemChanged, executor);
  route("deleteItem", itemChanged, executor);
  route("updateActor", (actor, changes) => { if ( foundry.utils.hasProperty(changes, "system.traits.armorProf") ) resync(actor); }, executor);
  route("ready", () => { for ( const actor of game.actors ) if ( actor.type === "character" ) resync(actor); }, executor);
}
