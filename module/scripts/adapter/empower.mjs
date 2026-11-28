/**
 * §19.9: the empowering bite (content `empower`, the Dhampir's Vampiric Bite) seen from dnd5e 6.
 *
 * Verified in dnd5e 6.0.3:
 *  - an item's uses: `system.uses.value` = max - spent (data/shared/uses-field.mjs), spent by writing
 *    `system.uses.spent`;
 *  - an effect change `system.bonuses.mwak.attack` (and rwak, msak, rsak) adds to the attack roll, and
 *    `system.bonuses.abilities.check` to ability checks and skill checks: this is what the effect
 *    "Strengthened Attack or Check" of the Ravenloft module carries, with `@abilities.con.mod` as value —
 *    replaced here by the amount.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { creatureTypeOf } from "./facts.mjs";

/** An item's `empower` rule, or null. */
export function empowerOf(item) {
  return item ? (contentOf(item).entry?.empower ?? null) : null;
}

/** Can the bitten creature be empowered? (neither a Construct nor an Undead) */
export function feedsOn(rule, actor) {
  return !!actor && !(rule.excludeTypes ?? []).includes(creatureTypeOf(actor));
}

export const usesLeft = item => Math.max(0, item?.system?.uses?.value ?? 0);

/** An actor's empowerment effects in progress (those the engine placed). */
export const boostsOf = actor => (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "consumeOn"));

/**
 * The item's empowerment effect, its changes worth `n`: until the next attack roll or ability check,
 * one minute at most. Returns the data to create, or null if the item has no such effect.
 */
export function boostData(item, rule, n) {
  const effect = item.effects.get(rule.effect);
  if ( !effect ) return null;
  const data = effect.toObject();
  delete data._id;
  const changes = (data.system?.changes ?? data.changes ?? []).map(c => ({ ...c, value: String(n) }));
  if ( data.system?.changes ) data.system.changes = changes;
  else data.changes = changes;
  return foundry.utils.mergeObject(data, {
    name: `${effect.name} (+${n})`,
    disabled: false,
    transfer: false,
    origin: item.uuid,
    // The duration is the item effect's (60 seconds); the V14 core dates its start at creation (`start`).
    duration: { value: 60, units: "seconds" },
    [`flags.${MODULE_ID}.consumeOn`]: ["attack", "check"],
    [`flags.${MODULE_ID}.boost`]: { item: item.uuid, amount: n }
  }, { inplace: false });
}
