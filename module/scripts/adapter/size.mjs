/**
 * Changing size (SPEC §16.58). The effect that an item declares (`resize`, by the id of the item's effect) receives, when it is
 * created on the target, a `system.traits.size` change in the "initial" phase: the target's category shifted by
 * its steps (core/size.mjs). The rest is up to dnd5e 6: with the "Autosize" setting (`tokenSizeSync`), the actor's computed size
 * becomes the token's (`applyActiveEffects`, dnd5e.mjs:42855-42867), which the active GM writes on the token
 * (`_onOverrideSize`, :93403) — and when the effect ends, the token goes back to its size. The engine reads the token's source:
 * it sees the new size once written.
 */

import { shiftSize } from "../core/size.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** The id of the item's effect of which `effect` is the applied copy (`_stats.duplicateSource` or `compendiumSource`, dnd5e). */
function sourceEffectId(effect) {
  const uuid = effect?._stats?.duplicateSource ?? effect?._stats?.compendiumSource ?? "";
  return uuid.match(/ActiveEffect\.([A-Za-z0-9]{16})$/)?.[1] ?? null;
}

/**
 * The size change to add to an effect being created on an actor, or null.
 * @param {ActiveEffect} effect  the effect being created (its applied copy)
 * @param {Actor} actor          the one receiving it
 */
export function sizeChangeFor(effect, actor) {
  const id = sourceEffectId(effect);
  const steps = id ? contentOf(originItemOf(effect)).entry?.resize?.[id] : null;
  if ( !steps || !actor?.system?.traits ) return null;
  const size = shiftSize(actor.system.traits.size ?? "med", steps, CONFIG.DND5E.actorSizes.orderedKeys ?? Object.keys(CONFIG.DND5E.actorSizes));
  if ( !size || (size === actor.system.traits.size) ) return null;
  return { key: "system.traits.size", type: "override", value: size, phase: "initial", priority: 50 };
}
