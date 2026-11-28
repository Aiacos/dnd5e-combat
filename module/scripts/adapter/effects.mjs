/**
 * The effects an item places, completed at creation according to its content (SPEC §16.38). `effectsExpire`: the effect ends
 * on the bearer's rest — dnd5e's native expiration (`duration.expiry` = "longRest" / "shortRest", removed on rest by
 * documents/actor/actor.mjs:2378-2395), which the PHB does not set on "Prayer of Healing".
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { englishDescription } from "./multiattack.mjs";
import { expiryFromText, namesStatus } from "../core/durations.mjs";

/** On the creation of an effect (`preCreateActiveEffect`, on the client that writes it). Returns the expiration set, or null. */
export function setRestExpiry(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return null;
  const item = originItemOf(effect);
  const rest = item ? contentOf(item).entry?.effectsExpire : null;
  if ( !rest || effect.duration?.expiry ) return null;
  effect.updateSource({ "duration.expiry": rest });
  return rest;
}

/**
 * M4 (SPEC §18.7): an effect placed without a duration takes the one its text writes ("until the end of its next turn"), as
 * dnd5e 6 native expiration (`targetEnd`…, core/durations.mjs). Read from the effect's description, otherwise from that
 * of the origin item (original English text under Babele, otherwise the description as is). Returns the expiration set.
 * §77: the core's generic "1 turn" duration (`units: "turns"`, expiration `turnStart` / `turnEnd`) does not say whose: it counts
 * the combat turns of ANY combatant (Dretch's Fetid Cloud, Monster Manual 2024: the Poisoned condition ended on the next
 * combatant's turn). When the text says whose, it takes precedence.
 */
export function setTextExpiry(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return null;
  // The source, not `effect.duration`: prepared by the V14 core, an empty duration is `value: Infinity` there
  // (client/documents/active-effect.mjs:292, `updateDuration`).
  const d = effect._source?.duration ?? {};
  const generic = (d.units === "turns") && ["turnStart", "turnEnd"].includes(d.expiry) && ((Number(d.value) || 0) <= 1);
  if ( !generic && (d.expiry || (Number.isFinite(d.value) && (d.value > 0))) ) return null;
  const item = originItemOf(effect);
  if ( !item || effect.transfer ) return null;   // a passive effect of an actor's item is not "placed"
  const statuses = Array.from(effect.statuses ?? []);
  // The description of the effect that names its condition is authoritative, even without a duration; otherwise the item.
  let expiry = namesStatus(effect.description, statuses)
    ? expiryFromText(effect.description, statuses, { alone: true })
    : (expiryFromText(effect.description, statuses, { alone: true })
      ?? expiryFromText(englishDescription(item), statuses)
      ?? expiryFromText(item.system?.description?.value, statuses));
  // §79: the generic duration is already wrong — the item's text, if it only writes a duration, is worth more than it.
  if ( !expiry && generic && !namesStatus(effect.description, statuses) ) {
    expiry = expiryFromText(englishDescription(item), statuses, { fallback: true });
  }
  if ( !expiry ) return null;
  effect.updateSource({ "duration.expiry": expiry, ...(generic ? { "duration.value": null, "duration.units": "" } : {}) });
  return expiry;
}

/**
 * §42.2: places an item's effect on an actor, outside the dnd5e card (an effect a smite places on a hit, lethargy that
 * follows Haste) — in the form the system's effects panel would have given it (applications/components/
 * effect-application.mjs:232-289): origin, casting level, `_stats.duplicateSource` (what `comesFromItemEffect` reads).
 * An already-carried effect coming from the same item effect is replaced. Active GM.
 * @returns {Promise<ActiveEffect|null>}
 */
/**
 * §438: a compendium effect (dnd5e 6.1 "remote effect": an activity that points to `Compendium.<pack>.ActiveEffect.<id>` instead
 * of carrying the effect — Player's Handbook 3.0.0, "AC +N" effects of "Evasive Footwork") placed on the actor in the item's
 * name, as `placeItemEffect` places an item effect: previous copy removed, origin = the item,
 * `compendiumSource` = the compendium effect.
 */
export async function placeRemoteEffect(item, uuid, actor) {
  const source = uuid ? await fromUuid(uuid) : null;
  if ( !source || !actor || (source.documentName !== "ActiveEffect") ) return null;
  const old = actor.effects.filter(e => (e._stats?.compendiumSource === uuid) && (e.origin === item.uuid)).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const data = foundry.utils.mergeObject(source.toObject(), {
    disabled: false, transfer: false, origin: item.uuid, system: { origin: { item: item.uuid } },
    _stats: { compendiumSource: uuid, duplicateSource: null }
  }, { inplace: false });
  delete data._id;
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created ?? null;
}

export async function placeItemEffect(item, effectId, actor, { scaling=0, dependentOn=null }={}) {
  const source = item?.effects?.get(effectId);
  if ( !source || !actor ) return null;
  const old = actor.effects.filter(e => (e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid)).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const sourceKey = source.inCompendium ? "compendiumSource" : "duplicateSource";
  const data = foundry.utils.mergeObject(source.toObject(), {
    disabled: false,
    transfer: false,
    origin: item.uuid,
    // §402: `dependentOn` — the effect falls with the caster's Concentration (dnd5e documents/mixins/dependent.mjs).
    flags: { dnd5e: { scaling, spellLevel: (Number(item.system?.level) || 0) + scaling, ...(dependentOn ? { dependentOn } : {}) } },
    system: { origin: { item: item.uuid } },
    _stats: { [sourceKey]: source.uuid }
  }, { inplace: false });
  delete data._id;
  const forApplication = ActiveEffect.implementation.forApplication;
  if ( forApplication && data.system?.changes ) data.system.changes = await forApplication.call(ActiveEffect.implementation, data.system.changes, item, actor);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created ?? null;
}
