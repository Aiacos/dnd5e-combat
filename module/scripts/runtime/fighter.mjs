/**
 * The Fighter (SPEC §21): what goes through neither the turn budget (Action Surge, Tactical Shift: runtime/turn.mjs) nor
 * the marks (Studied Attacks: runtime/mastery.mjs).
 *
 *  - Heroic Warrior: at the start of their turn, in combat, the Champion gets Heroic Inspiration if they do not have it
 *    (dnd5e's `system.attributes.inspiration`). Active GM.
 *  - Great Weapon Fighting style: on the author's client, at the damage roll of a melee attack with a two-handed
 *    weapon (Two-Handed property, or Versatile wielded with two hands): each die of the weapon's part becomes "min3"
 *    (a 1 or a 2 counts as 3).
 *  - Thrown Weapon Fighting style: +2 to the weapon's part of a thrown attack that hits.
 */

import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key]);
const ruleValue = (actor, key) => Array.from(actor?.items ?? []).map(i => contentOf(i).entry?.[key]).find(v => v !== undefined) ?? null;

function onTurnStart(combat, prior, current) {
  const actor = combat.combatants.get(current?.combatantId)?.actor;
  if ( !actor || !hasRule(actor, "heroicWarrior") || actor.system.attributes?.inspiration ) return;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return;
  return enqueue(`heroic:${actor.uuid}`, async () => {
    await actor.update({ "system.attributes.inspiration": true });
    log(`${actor.name}: Heroic Inspiration (Heroic Warrior)`);
  });
}

/** A weapon part: its dice become "min3" (not those that already have a modifier of this kind). */
const minThree = part => String(part).replace(/(\d*d\d+)(?![\dmrxk])/g, "$1min3");

function onPreRollDamage(config) {
  const activity = config.subject;
  const actor = activity?.actor;
  const weapon = activity?.item;
  if ( !actor || (activity.type !== "attack") || (weapon?.type !== "weapon") || !config.rolls?.length ) return true;
  const mode = config.attackMode ?? "";
  const base = config.rolls.find(r => r.base) ?? config.rolls[0];
  const props = weapon.system.properties;
  const melee = (activity.attack?.type?.value === "melee") && !mode.startsWith("thrown");
  if ( melee && hasRule(actor, "greatWeaponFighting") && (props?.has("two") || (props?.has("ver") && (mode === "twoHanded"))) ) {
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? minThree(p) : p));
    log(`Great Weapon Fighting: ${base.parts[0]}`);
  }
  const thrown = ruleValue(actor, "thrownDamage");
  if ( thrown && mode.startsWith("thrown") && props?.has("thr") ) {
    base.parts = [...(base.parts ?? []), String(thrown)];
    log(`Thrown Weapon Fighting: +${thrown}`);
  }
  return true;
}

export function registerFighter() {
  route("combatTurnChange", onTurnStart, { executor: true, label: "Heroic Warrior: inspiration not given" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Fighter fighting styles" });
}
