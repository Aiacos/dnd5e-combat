/**
 * §68: use without a window (world setting "autoUsage", enabled by default). The dnd5e use window
 * (applications/activity/activity-usage-dialog.mjs) serves only to uncheck what dnd5e has already planned
 * (activity/mixin.mjs:445-510, `_prepareUsageConfig`): consuming (action, resources, slot), starting Concentration
 * (and ending the previous one if the limit is reached), placing the area. Without it, the three apply as they are
 * (`dialogConfig.configure = false`).
 *
 *  - Spell slot: the one dnd5e proposes if any remain, otherwise the lowest available of at least the spell's level
 *    (core/usage.mjs), and the casting level follows (`scaling`).
 *  - §106: a spell that can be cast higher (a slot of a higher level remains) keeps the dnd5e window, where the
 *    level is chosen — from the sheet in particular. Whoever has already chosen the slot skips it themselves
 *    (`configure: false`: drawer of the darsh-dnd-ui bar), like the engine's uses.
 *  - No more resources (no slot, activity or item uses exhausted): §77, the GM can always cast — a
 *    warning window lets them cast without consuming anything, or give up (whether or not the dnd5e window was passed); a
 *    player cannot — dnd5e refuses the use with its own warning.
 *  - §77: an activity that spends its own uses without having any, when the item carries some (data of the 2024 Monster Manual,
 *    Dretch's Fetid Cloud), spends the item's (fixed on the copy of the item that dnd5e uses, not on the sheet).
 *  - A real choice remains for the window: summon, transformation or enchantment profile when there are several,
 *    size or creature type of a summon (§383), bastion command. A call that skips the window itself (action
 *    bar) gets the engine's "Choose the form" window (ui/summon-form.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { pickSpellSlot, misplacedSelfUses, canCastHigher, forcedSpellSlot, followUpScaling } from "../core/usage.mjs";
import { contentOf } from "../adapter/content.mjs";
import { formChangeOf } from "../adapter/coven.mjs";
import { movableZoneOf } from "./zones.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { summonChoicesOf, applySummonCount, applyPreferredActors, concentrationOn } from "../adapter/summons.mjs";

export const AUTO_USAGE_SETTING = "autoUsage";

/** A choice that only the dnd5e window offers. */
function needsChoice(activity) {
  if ( activity.type === "order" ) return true;
  // §122: an adjustable expenditure outside spells — how many points to take from the pool (Lay On Hands: "restore a
  // number of Hit Points equal to…", up to what remains), the slider of the dnd5e window (`consumption.scaling`).
  // Without it, dnd5e took 1 point. A spell's level is judged further down (§106).
  if ( activity.consumption?.scaling?.allowed && !activity.requiresSpellSlot ) return true;
  // §383: a summon keeps the window as soon as there is a form, size or type to choose (Find Familiar: a single
  // profile, three creature types — the first was taken by default).
  if ( activity.type === "summon" ) return summonChoicesOf(activity).any;
  if ( ["transform", "enchant"].includes(activity.type) ) {
    const profiles = (activity.type === "enchant") ? activity.availableEnchantments : activity.availableProfiles;
    return (profiles?.length ?? 0) > 1;
  }
  return false;
}

/** A use (of the activity or of an item) that the consumption asks for and that is missing. */
function lacksUses(activity, usageConfig) {
  const indexes = usageConfig.consume?.resources;
  if ( !Array.isArray(indexes) ) return false;
  const targets = Array.from(activity.consumption?.targets ?? []);
  return indexes.some(i => {
    const target = targets[i];
    const cost = Number(target?.value);
    if ( !(cost > 0) ) return false;   // a formula or a zero cost: dnd5e will judge
    if ( target.type === "activityUses" ) {
      const owner = target.target ? activity.item.system.activities?.get(target.target) : activity;
      return !!owner?.uses?.max && ((Number(owner.uses.value) || 0) < cost);
    }
    if ( target.type === "itemUses" ) {
      const item = target.target ? activity.actor?.items.get(target.target) : activity.item;
      return !!item?.system.uses?.max && ((Number(item.system.uses.value) || 0) < cost);
    }
    return false;
  });
}

/**
 * §77: the own uses of an activity that has none, carried by the item: rewritten as item uses on the COPY
 * of the item that dnd5e uses (`Activity#use` clones the item; `updateSource` survives scaling). Returns the updated activity.
 */
function repairSelfUses(activity) {
  const targets = Array.from(activity.consumption?.targets ?? []);
  const wrong = misplacedSelfUses(targets, !!activity.uses?.max, !!activity.item.system.uses?.max);
  if ( !wrong.length ) return activity;
  const source = activity.toObject().consumption.targets.map((t, i) => (wrong.includes(i) ? { ...t, type: "itemUses" } : t));
  // As dnd5e does for scaling (activity/mixin.mjs:541-544): the copy is prepared with its sheet, then its final attributes.
  const item = activity.item;
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.consumption.targets`]: source });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  log(`${activity.item.name}: the activity's uses are the item's (${activity.item.system.uses.value}/${activity.item.system.uses.max})`);
  return activity.item.system.activities.get(activity.id) ?? activity;
}

/**
 * §109: a spell that always summons, whose "place" checkbox starts unchecked (`summon.prompt: false`) — checked here, as it
 * would have been in the window; `create.summons` is already prepared for this hook (documents/activity/summon.mjs:65-70).
 * §116: a caller that places the summons itself says so (`{ "dnd5e-combat": { placeSummons: false } }`) — at this hook, its
 * explicit `create.summons: false` cannot be told apart from the one dnd5e prepares (`??=`, summon.mjs:67).
 * §389: also at the "Cast anyway" relaunch (§77), which used to exit earlier — Animate Dead, Conjure Animals, Phantom
 * Steed… placed nothing (summons sweep).
 */
function placeAlways(activity, usageConfig) {
  if ( (activity.type === "summon") && (usageConfig[MODULE_ID]?.placeSummons !== false)
    && (usageConfig.create?.summons === false || !usageConfig.create?.summons)
    && contentOf(activity.item).entry?.placesSummons && activity.canSummon && canvas.scene && activity.availableProfiles?.length ) {
    usageConfig.create = { ...(usageConfig.create ?? {}), summons: true };
  }
}

function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  if ( !activity?.item ) return;
  // §111: a movable area already placed — the use moves it (ui/pointer.mjs, §16.14), nothing is cast: no slot
  // to choose or fix, no "out of charges" for the GM. A caller that confirms outright really casts (same rule).
  if ( !usageConfig[MODULE_ID]?.confirmed && movableZoneOf(activity) ) return;
  activity = repairSelfUses(activity);
  // §498: a declared form change (`changesForm`) — the engine does the swap after the use. Without it, a dnd5e "transform"
  // activity in `cr` mode (the default, data/activity/transform-data.mjs:41) opens the compendium at the end of the use to choose
  // the creature (`_finalizeUsage` → `queryActor`, documents/activity/transform.mjs:114-117) and waits for it: a profile
  // it does not know prevents that (like Wild Shape, runtime/wildshape.mjs `takeForm`).
  if ( (activity.type === "transform") && formChangeOf(activity) ) usageConfig.transform = { ...(usageConfig.transform ?? {}), profile: MODULE_ID };
  // §386: a 2014 SRD creature summoned by the 2024 Monster Manual one when it is there.
  if ( activity.type === "summon" ) activity = applyPreferredActors(activity);
  // §385: "up to N" creatures — the number chosen in the "Choose the form" window, on the copy of the item.
  const count = Number(usageConfig[MODULE_ID]?.summonCount) || 0;
  if ( (activity.type === "summon") && (count >= 1) && usageConfig.summons?.profile ) {
    activity = applySummonCount(activity, usageConfig.summons.profile, count);
    log(`${activity.item.name}: ${count} creature(s) summoned`);
  }
  // §405: an activity of a spell that does not spend a slot (Flame Blade attack, Witch Bolt damage) is played at the
  // casting level, which dnd5e noted on the spell's Concentration effect.
  const followUp = activity.isSpell ? followUpScaling({ spellLevel: activity.item.system.level,
    consumesSlot: activity.consumption?.spellSlot !== false, scaling: usageConfig.scaling,
    concentrationScaling: concentrationOn(activity.item)?.getFlag?.("dnd5e", "scaling") }) : null;
  if ( followUp ) {
    usageConfig.scaling = followUp.scaling;
    usageConfig.spell = { ...(usageConfig.spell ?? {}), slot: followUp.slot };
    log(`${activity.item.name}: played at its cast level (+${followUp.scaling}, from its concentration)`);
  }
  // §77: relaunched by the GM without a charge — nothing is consumed, no window.
  if ( usageConfig[MODULE_ID]?.forced ) {
    usageConfig.consume = { ...(usageConfig.consume ?? {}), resources: false, spellSlot: false };
    dialogConfig.configure = false;
    // §384: at the spell's level, not that of the proposed slot (level 3 pact slot for a level 6 spell).
    if ( activity.requiresSpellSlot ) {
      const level = Number(activity.item.system.level) || 0;
      const slot = forcedSpellSlot(activity.actor?.system.spells, usageConfig.spell?.slot, level);
      if ( slot && (slot !== usageConfig.spell?.slot) ) {
        log(`${activity.item.name}: cast anyway at its own level ${level} (not the ${usageConfig.spell?.slot} slot)`);
        usageConfig.spell = { ...(usageConfig.spell ?? {}), slot };
        if ( (usageConfig.scaling !== false) && !(usageConfig.scaling > 0) ) usageConfig.scaling = 0;
      }
    }
    placeAlways(activity, usageConfig);
    return;
  }
  let auto = !!dialogConfig?.configure && game.settings.get(MODULE_ID, AUTO_USAGE_SETTING) && !needsChoice(activity);
  let lacking = false;
  const slots = activity.actor?.system.spells;
  const proposed = usageConfig.spell?.slot;
  if ( activity.requiresSpellSlot && usageConfig.consume?.spellSlot && proposed && slots ) {
    const level = Number(activity.item.system.level) || 0;
    const slot = pickSpellSlot(slots, proposed, level);
    if ( !slot ) lacking = true;
    else if ( auto && (slot !== proposed) ) {
      usageConfig.spell.slot = slot;
      if ( usageConfig.scaling !== false ) usageConfig.scaling = Math.max(0, (Number(slots[slot]?.level) || level) - level);
      log(`${activity.item.name}: no ${proposed} slot left, cast with ${slot}`);
    }
  }
  // §106: the level is a real choice — the dnd5e window stays (with the slot corrected above, if it was).
  if ( auto && !lacking && activity.requiresSpellSlot && usageConfig.consume?.spellSlot && (usageConfig.scaling !== false)
    && canCastHigher(slots, Number(activity.item.system.level) || 0) ) auto = false;
  const slotLacking = lacking;
  if ( !lacking ) lacking = lacksUses(activity, usageConfig);
  // §77, §410 (issue #44, batch 3): no more resources — no more flat refusal or GM-only window: what is missing is noted for
  // the legality window (runtime/turn.mjs, registered later), which tells everyone, GM and players; forced, the use restarts with
  // `forced` (above: nothing is consumed, the spell at its level).
  if ( lacking ) usageConfig[MODULE_ID] = { ...(usageConfig[MODULE_ID] ?? {}), lacking: slotLacking ? "noSlot" : "noUses" };
  if ( auto ) dialogConfig.configure = false;
  placeAlways(activity, usageConfig);
}

export function registerUsage() {
  game.settings.register(MODULE_ID, AUTO_USAGE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "use without dialog" });
}
