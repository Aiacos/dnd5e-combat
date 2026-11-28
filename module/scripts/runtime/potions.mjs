/**
 * §53: potions — the spell a potion casts does not require Concentration ("no Concentration required", Dungeon Master's
 * Guide: Clairvoyance, Reduce, Gaseous Form, Enlarge, Detect Thoughts, Haste; the data for Reduce,
 * Clairvoyance… do not all remove the property). The rest: adapter/usage.mjs (for the drinker), adapter/scrolls.mjs
 * (not a cast spell), ui/pointer.mjs (nothing to aim).
 */

import { potionOfCast, notePotionCast, stampCachedSpell, completeEffectChanges, completeEffectStatuses, foldEffectRiders } from "../adapter/potions.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** `dnd5e.preUseActivity` (after the use is prepared, mixin.mjs:500): no Concentration to begin. */
function onPreUse(activity, usageConfig) {
  const potion = potionOfCast(activity?.item);
  if ( !potion || !usageConfig?.concentration?.begin ) return;
  usageConfig.concentration.begin = false;
  log(`${activity.item.name} (${potion.name}): no concentration`);
}

export function registerPotions() {
  // The "cast" activity does not go through `dnd5e.preUseActivity` but through `dnd5e.preUseLinkedSpell` (activity/cast.mjs:71-90):
  // the potion still exists, the spell copy is not created.
  route("dnd5e.preUseLinkedSpell", activity => { notePotionCast(activity); }, { label: "potion: casting not noted" });
  route("dnd5e.preUseActivity", onPreUse, { label: "potion: concentration not removed" });
  route("preCreateActiveEffect", effect => {
    const n = completeEffectChanges(effect);
    if ( n ) log(`${effect.parent?.name ?? "?"}: ${effect.name} completed (${n} change(s))`);
    const s = completeEffectStatuses(effect);   // §96
    if ( s ) log(`${effect.parent?.name ?? "?"}: ${effect.name} completed (${s} status(es))`);
    const folded = foldEffectRiders(effect);   // §526 (#255)
    if ( folded.length ) log(`${effect.parent?.name ?? "?"}: ${effect.name} carries ${folded.join(", ")} itself (rider ends with it)`);
  }, { label: "potion: effect not completed" });
  route("preCreateItem", (item, data) => { if ( stampCachedSpell(item, data) ) log(`${item.name}: cast from a potion`); },
    { label: "potion: cast spell not marked" });
}
