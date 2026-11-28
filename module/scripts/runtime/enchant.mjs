/**
 * Enchant a chosen creature's weapon, on the fly (SPEC §16.41): the interface has the user pick the level and the element
 * (dnd5e window), the creature (targeted), then the weapon (ui/enchant.mjs); the use resumes with the weapon noted, and the
 * active GM applies the enchantment after it (request `dnd5e-combat.enchant`).
 */

import { MODULE_ID } from "../constants.mjs";
import { enchantTargetOf, applyEnchantmentTo, pactRuleOf, conjureWeapon } from "../adapter/enchant.mjs";
import { rewritePactChanges } from "../core/pact.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaActiveGM } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

export const ENCHANT_QUERY = `${MODULE_ID}.enchant`;

/** §16.45: the rewrite waiting for a weapon's enchantment (uuid → options), read at `dnd5e.preApplyEnchantment`. */
const pactRewrites = new Map();

/** §435: the in-progress activation of a profile of an item that enchants itself (item uuid → promise), for whoever must wait for it. */
const selfSwitches = new Map();

/** §435: the promise of the in-place activation of this item's profile (self-enchantment), or null if none is in progress. */
export function selfSwitchOf(item) {
  return selfSwitches.get(item?.uuid) ?? null;
}

async function handleEnchant({ activity: activityUuid, item: itemUuid, profile, message: messageUuid, concentration: concUuid, pactDamage }, { user }={}) {
  const activity = await fromUuid(activityUuid);
  const item = await fromUuid(itemUuid);
  if ( !activity || !item || (user && !activity.actor?.testUserPermission(user, "OWNER")) ) return null;
  const message = messageUuid ? await fromUuid(messageUuid) : null;
  const concentration = concUuid ? await fromUuid(concUuid) : null;
  const pact = pactRuleOf(activity.item);
  if ( pact ) {
    // "Only one pact weapon": the previous link drops.
    for ( const old of Array.from(activity.appliedEnchantments ?? []) ) await old.delete();
    pactRewrites.set(item.uuid, { damageTypes: pact.damageTypes, chosen: pactDamage ?? null, ability: pact.ability ?? null,
      suffix: game.i18n.localize("DND5ECOMBAT.Pacte.Suffixe") });
  }
  let effect;
  try { effect = await applyEnchantmentTo(activity, item, { profile, message, concentration }); }
  finally { pactRewrites.delete(item.uuid); }
  if ( effect ) log(`${item.parent?.name ?? "?"}: ${item.name} enchanted (${effect.name})`);
  return effect ? effect.name : null;
}

/**
 * "Enchant this weapon" intent (weapons window, ui/enchant.mjs) — the suspended use resumes with the weapon noted;
 * dnd5e freezes the card's targets at first use (activity/mixin.mjs:239-242): we let them be re-read.
 */
export function enchantWith(activity, [config, dialog, message], itemUuid, extra={}) {
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  return relaunchUse(activity, { ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), enchantItem: itemUuid, ...extra } }, dialog, messageConfig);
}

/**
 * §16.45: "bind this weapon" intent (pact window, ui/pact.mjs) — a weapon from the inventory, or a weapon summoned from
 * the compendium (created in the inventory); `damageType`: one of the pact's types, or null (the normal type).
 */
export async function pactWith(activity, usage, { itemUuid=null, conjureUuid=null, damageType=null }) {
  let uuid = itemUuid;
  if ( conjureUuid ) uuid = (await conjureWeapon(activity, conjureUuid))?.uuid ?? null;
  if ( !uuid ) return null;
  const [config, dialog, message] = usage;
  return enchantWith(activity, [config, { ...(dialog ?? {}), configure: false }, message], uuid, { pactDamage: damageType });
}

async function onPostUse(activity, usageConfig, results) {
  const itemUuid = usageConfig?.[MODULE_ID]?.enchantItem;
  if ( !itemUuid || !enchantTargetOf(activity) ) return;
  const concentration = results?.effects?.find?.(e => e.statuses?.has?.("concentrating")) ?? concentrationOn(activity.item);
  const payload = { activity: activity.uuid, item: itemUuid, profile: usageConfig.enchantmentProfile,
    message: results?.message?.uuid ?? null, concentration: concentration?.uuid ?? null, pactDamage: usageConfig[MODULE_ID]?.pactDamage ?? null };
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Enchant.SansMJ"));
  const name = await viaActiveGM(ENCHANT_QUERY, handleEnchant, payload);
  const item = await fromUuid(itemUuid);
  const token = tokenOnViewedScene(item?.parent);
  if ( name && token ) notice(token, loc("Enchant.Applique", { item: item.name, effect: name }), "gain");
}

export function registerEnchant() {
  route("dnd5e.postUseActivity", onPostUse, { label: "enchantment: weapon not enchanted" });
  // §16.45: the pact's enchantment, rewritten before its creation (chosen damage type, Charisma, name).
  route("dnd5e.preApplyEnchantment", (item, data) => {
    const rewrite = pactRewrites.get(item.uuid);
    if ( !rewrite ) return;
    data.system.changes = rewritePactChanges(data.system.changes, rewrite);
    log(`${item.name}: pact weapon (${rewrite.chosen ?? "normal type"})`);
  }, { label: "pact weapon: enchantment not rewritten" });
  // O9h (§363): an item that enchants itself with one of its own profiles (Scroll of Protection: the creature type) — the copy
  // that dnd5e creates on the item that already carries the profile does not succeed (seen in play: no effect created, no error).
  // The chosen profile is activated in its place, like an applied enchantment (origin: the activity); the activity's other
  // profiles are switched off.
  route("dnd5e.preApplyEnchantment", (item, data, { activity }={}) => {
    const profile = data?.flags?.dnd5e?.enchantmentProfile;
    if ( !activity || (activity.item !== item) || !profile || !item.effects?.has?.(profile) ) return;
    const profiles = new Set((activity.effects ?? []).map(p => p._id));
    const updates = item.effects.filter(e => profiles.has(e.id) && (e.id !== profile)).map(e => ({ _id: e.id, disabled: true }));
    updates.push({ _id: profile, disabled: false, origin: activity.uuid, "system.origin": data.system?.origin ?? {}, "flags.dnd5e": data.flags.dnd5e });
    // The profile's "riders" (the scroll's "Use" activity, hidden as long as no enchantment declares it): copied as dnd5e does
    // when applying an enchantment (data/active-effect/enchantment.mjs, `collectRiders`).
    const switching = item.updateEmbeddedDocuments("ActiveEffect", updates).then(async () => {
      // §433: dnd5e 6.1 only renders the riders of an APPLIED enchantment (`isApplied`: `transfer` true, enchantment.mjs:285), and
      // an effect cited by an item's activity is never transferred (`isOnActivity`, active-effect-data-model.mjs:57): the
      // profile activated in place cannot answer. The question is put to an in-memory copy, under another identifier and marked
      // applied; what it returns depends on it (`dependentOn`): the profile's identifier is put back there. Nothing is written on
      // the effect.
      const switched = item.effects.get(profile);
      const probeId = foundry.utils.randomID();
      const probe = switched?.clone({ _id: probeId, transfer: true }, { keepId: true });
      const asProfile = data => JSON.parse(JSON.stringify(data).replaceAll(probeId, profile));
      const riders = (await probe?.system?.collectRiders?.({ dnd5e: { enchantmentProfile: profile, activityId: activity.id } }) ?? [])
        .map(op => ({ ...op, ...(op.updates ? { updates: asProfile(op.updates) } : {}), ...(op.data ? { data: asProfile(op.data) } : {}) }));
      if ( riders.length ) await foundry.documents.modifyBatch(riders);
      // The name the profile gives ("Scroll of Protection: Undead"): dnd5e does not apply its changes to an item's profile.
      const named = (item.effects.get(profile)?.system?.changes ?? item.effects.get(profile)?.changes ?? []).find(c => c.key === "name")?.value;
      // §435: a decorating name ("{} (Active)", "Savage Wrath") only holds for the duration of the effect: it is not written on
      // the item (it would stay there, literally "{} (Active)", after the effect ends). Only a full name (the scroll) is.
      if ( named && !named.includes("{}") && (named !== item.name) ) await item.update({ name: named });
      log(`${item.name}: its own profile "${item.effects.get(profile)?.name}" switched on`);
      return item.effects.get(profile) ?? null;
    }).catch(err => { console.error(`${MODULE_ID} | ${item.name}: profile not switched on`, err); return null; })
      .finally(() => { if ( selfSwitches.get(item.uuid) === switching ) selfSwitches.delete(item.uuid); });
    selfSwitches.set(item.uuid, switching);
    return false;
  }, { cancellable: true, label: "self enchantment: profile not switched on" });
  CONFIG.queries[ENCHANT_QUERY] = handleEnchant;
}
