/**
 * Sorcerer Metamagic (SPEC §32). Each option of the 2024 Player's Handbook is an item whose activity spends Sorcery
 * Points (dnd5e does that); nothing in the system then modifies the spell. The engine remembers the chosen option on
 * the actor (`flags["dnd5e-combat"].metamagic`), carries it over to the next spell's card (`flags["dnd5e-combat"].metamagic`,
 * list of kinds), then forgets it.
 *
 * Kinds held by the engine: "quickened" (a one-action spell is cast with a Bonus Action), "careful" (allies
 * automatically succeed on their saving throw, taking no damage if they would have taken half), "heightened"
 * (one target has Disadvantage on its saving throw), "distant" (range doubled; touch → 9 m), "subtle" (no components:
 * no Counterspell possible), "extended" (duration doubled, Advantage on Concentration saving throws).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { carriesEffectFrom } from "./facts.mjs";

/** The Metamagic kind of this activity (content `metamagic: { activity, kind }`), or null. */
export function metamagicKindOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.metamagic : null;
  return (rule && (rule.activity === activity.id)) ? rule.kind : null;
}

/** The options retained for the actor's next spell (one minute at most). */
export function pendingMetamagic(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, "metamagic");
  if ( !flag?.kinds?.length ) return [];
  const now = game.time?.worldTime ?? 0;
  return (Number.isFinite(flag.at) && ((now - flag.at) > 60)) ? [] : flag.kinds;
}

export async function addMetamagic(actor, kind) {
  const kinds = [...new Set([...pendingMetamagic(actor), kind])];
  await actor.setFlag(MODULE_ID, "metamagic", { kinds, at: game.time?.worldTime ?? 0 });
  return kinds;
}

export async function clearMetamagic(actor) {
  if ( actor?.getFlag?.(MODULE_ID, "metamagic") ) await actor.unsetFlag(MODULE_ID, "metamagic");
}

/**
 * The `metamagicRules` of the caster's items (Sorcery Incarnate, Arcane Apotheosis), and whether the effect they require is on
 * them (Innate Sorcery active).
 */
export function metamagicRulesOf(actor) {
  return Array.from(actor?.items ?? []).map(item => contentOf(item).entry?.metamagicRules).filter(Boolean)
    .map(rule => ({ ...rule, active: carriesEffectFrom(actor, rule.whileEffect) }));
}

/** The options carried by a spell's card. */
export const usageMetamagic = message => message?.getFlag?.(MODULE_ID, "metamagic") ?? [];

/** Distant Spell: a spell's range, doubled; "touch" (or under 1.50 m) becomes 9 m. */
export function distantRange(range) {
  if ( !range ) return range;
  if ( (range.units === "touch") || !(Number(range.value) > 0) ) return { ...range, value: 30, units: "ft" };
  return { ...range, value: Number(range.value) * 2, long: range.long ? Number(range.long) * 2 : range.long };
}
