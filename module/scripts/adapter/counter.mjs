/**
 * §66: 2014-style Counterspell — what touches dnd5e: the level at which a spell is about to be cast (read from its use
 * configuration, before casting), and the countering creature's check. The rule itself is pure (core/counter.mjs).
 *
 * Verified in dnd5e 6.0: at `dnd5e.preUseActivity`, `usageConfig` is already prepared (activity/mixin.mjs:232 then :257) —
 * `spell.slot` (slot key, by default that of the spell's level or the linked spell's) and `scaling`; a spell cast by a
 * "cast" activity (`flags.dnd5e.cachedFor`) takes that activity's level (`spell.level`, data/item/spell.mjs:285 and
 * :312, `scalingIncrease`). The level chosen afterwards in the use dialog is not known to the gate (it runs before).
 */

import { castLevelOf, counterPlan, counterSucceeds } from "../core/counter.mjs";
import { contentOf } from "./content.mjs";
import { castingAbilityOf, castingCheck } from "./dispel.mjs";

/** The casting level of a spell, from its use configuration (`dnd5e.preUseActivity`). */
export function castLevelFor(activity, usageConfig={}) {
  const item = activity?.item;
  const slot = usageConfig?.spell?.slot;
  const spells = item?.actor?.system?.spells ?? {};
  const slotLevel = slot ? (spells[slot]?.level ?? Number(String(slot).replace(/\D/g, ""))) : null;
  return castLevelOf({
    level: item?.system?.level ?? 0,
    scaling: Number(usageConfig?.scaling) || 0,
    slotLevel,
    linkedLevel: item?.system?.linkedActivity?.spell?.level ?? null
  });
}

/**
 * The Counterspell that the item declares (`counter`), or null: the 2024 Reaction (a save by the caster) declares none.
 * @returns {{level: number}|null}
 */
export function counterOf(item) {
  const counter = contentOf(item)?.entry?.counter;
  if ( !counter ) return null;
  return { level: Number.isInteger(counter.level) ? counter.level : (Number(item?.system?.level) || 0) };
}

/**
 * On the countering creature's side (their dice): does the spell cast at level `castLevel` fail? Check of the spellcasting
 * ability of the item (or actor) against DC 10 + level, above the Counterspell's level.
 * @returns {Promise<{castLevel, level, auto, dc, total, ability, dissipated}|null>}
 */
export async function resolveCounter(actor, item, castLevel) {
  const counter = counterOf(item);
  if ( !counter ) return null;
  const plan = counterPlan(castLevel, counter.level);
  const ability = castingAbilityOf(item, actor);
  const total = plan.auto ? null : await castingCheck(actor, ability, plan.dc);
  return { ...plan, ability, total, dissipated: counterSucceeds(plan, total) };
}
