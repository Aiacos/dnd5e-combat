/**
 * Passive auras: what an item declares (content/auras.mjs, world overlay or the item's flag
 * `flags["dnd5e-combat"].aura`), and the effect copies placed on those standing
 * in the aura.
 *
 * Verified in dnd5e 6.0.3 (packs/_source/classes24/paladin/class-features/aura-of-protection.yml):
 * the official Aura of Protection carries a "Protected" effect transferred to the paladin alone
 * (`system.bonuses.abilities.save` = `@abilities.cha.mod`), and a utility activity whose
 * template gives the radius (`@scale.paladin.aura`) and the targeted side (`ally`). The engine reuses this
 * data: it copies that effect onto allies in range. The bonus is FROZEN at the bearer's value
 * at the time of the copy — left as a formula, `@abilities.cha.mod` would read the ally's Charisma.
 */

import { MODULE_ID } from "../constants.mjs";
import { AURA_AFFECTS } from "../core/content.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** An effect of this item (not an aura copy) on the actor. `concentration`: the spell's concentration counts. */
function ownEffectsFrom(actor, item, { concentration=true }={}) {
  return (actor?.effects ?? []).filter(e => !e.disabled && !e.getFlag(MODULE_ID, "aura")
    && (concentration || !e.statuses?.has("concentrating")) && (originItemOf(e)?.uuid === item.uuid));
}

/**
 * §16.47: does this creature already carry the spell's original effect (target of the casting)? A `whileActive` aura does not
 * place a further copy on it (the two would add up).
 */
export function carriesOriginal(actor, aura) {
  return !!aura.whileActive && (ownEffectsFrom(actor, aura.item, { concentration: false }).length > 0);
}

/** The part of an aura that the world overlay declares for this item (it takes precedence over the shipped content). */
function worldAura(item) {
  return game.modules.get(MODULE_ID).api?.content?.world?.()[contentOf(item).identifier]?.aura ?? {};
}

/** Radius and side read from the item's template activity, when it has one. */
function fromActivity(item) {
  for ( const activity of item.system.activities ?? [] ) {
    const template = activity.target?.template;
    if ( !template?.type ) continue;
    const size = Number(template.size);
    return {
      radius: Number.isFinite(size) && (size > 0) ? size : null,
      units: template.units ?? "ft",
      // "creature" (the Monster Manual, for "of its choice") does not state the side: the content decides.
      affects: AURA_AFFECTS.includes(activity.target?.affects?.type) ? activity.target.affects.type : null
    };
  }
  return {};
}

/** §438: does the item have an activity whose dnd5e 6.1 behavior places an effect through a region (`applyActiveEffect`)? */
function systemAura(item) {
  for ( const activity of item?.system?.activities ?? [] ) {
    for ( const behavior of activity?.behaviors ?? [] ) if ( behavior?.type === "applyActiveEffect" ) return true;
  }
  return false;
}

/** The auras carried by an actor. */
export function aurasOf(actor) {
  const auras = [];
  for ( const item of actor?.items ?? [] ) {
    // Combined layers (adapter/content.mjs): module content, world overlay, item flag.
    const declared = contentOf(item).entry?.aura;
    if ( !declared ) continue;
    // §16.47: a spell aura exists only while the caster carries an effect of it (concentration included).
    if ( declared.whileActive && !ownEffectsFrom(actor, item).length ) continue;
    const known = { ...declared };
    const merged = { includeSelf: false, affects: "ally", units: "ft", ...known };
    // Order of trust: what the world or the item state explicitly, then the template of
    // the activity, then the class scale, then the default value of the shipped content.
    const fromItem = fromActivity(item);
    const flagged = { ...(contentOf(item).layers.world ? worldAura(item) : {}), ...(item.getFlag(MODULE_ID, "aura") ?? {}) };
    if ( !("radius" in flagged) ) {
      const scaled = known.radiusFormula ? Number(dnd5e.utils.simplifyBonus(known.radiusFormula, actor.getRollData())) : NaN;
      if ( Number.isFinite(fromItem.radius) ) Object.assign(merged, { radius: fromItem.radius, units: fromItem.units });
      else if ( Number.isFinite(scaled) && (scaled > 0) ) merged.radius = scaled;
    }
    if ( !("affects" in flagged) && fromItem.affects ) merged.affects = fromItem.affects;
    // §18.12: declared changes replace the item's effect (absent, empty or wrong in the Monster Manual).
    const effect = merged.changes ? null
      : ((merged.effect ? item.effects.get(merged.effect) : null) ?? item.effects.find(e => e.transfer) ?? item.effects.contents[0]);
    // §438 (user decision, 2026-11-14): a Player's Handbook 3.0.0 spell that no longer has its own effect but an activity with
    // `applyActiveEffect` behavior (Crusader's Mantle, Aura of Life, Aura of Purity, Circle of Power: Handbook compendium effect
    // placed by dnd5e 6.1's region, dnd5e.mjs:14159-14205) — dnd5e holds the aura itself: the engine does not make a second one.
    if ( !effect && !merged.changes && systemAura(item) ) continue;
    if ( (!effect && !merged.changes) || !Number.isFinite(merged.radius) ) {
      console.warn(`${MODULE_ID} | aura "${item.name}" of ${actor.name} ignored: ${(effect || merged.changes) ? "unknown radius" : "no effect to copy"}`);
      continue;
    }
    // §159: `effect` (the content id, in `merged`) must not replace the effect found.
    auras.push({ item, key: item.system.identifier ?? item.id, ...merged, effect });
  }
  return auras;
}

const changesOf = data => data.system?.changes ?? data.changes ?? [];

/** An effect's changes, with their values frozen for the aura's bearer. */
function frozenChanges(effectData, sourceActor) {
  const rollData = sourceActor.getRollData();
  return changesOf(effectData).map(change => {
    const text = String(change.value ?? "");
    if ( !text.includes("@") ) return change;
    return { ...change, value: String(dnd5e.utils.simplifyBonus(text, rollData)) };
  });
}

/**
 * The effect data to copy: the item's, or (§18.12) an effect named after the item made of the declared changes,
 * without a condition — the Monster Manual's Aura of Courage carries Charmed and Frightened in addition to the immunity to those
 * conditions.
 */
function baseEffectData(aura) {
  if ( !aura.changes ) return aura.effect.toObject();
  const base = aura.effect?.toObject() ?? { name: aura.item.name, img: aura.item.img };
  return { ...base, statuses: [], system: { ...(base.system ?? {}), changes: foundry.utils.deepClone(aura.changes) }, changes: undefined };
}

/** Strength of an aura: the sum of its numeric values once frozen (tells apart two auras of the same name). */
export function auraValue(aura, sourceActor) {
  return frozenChanges(baseEffectData(aura), sourceActor)
    .reduce((sum, c) => sum + (Number.isFinite(Number(c.value)) ? Number(c.value) : 0), 0);
}

/** The aura copies present on an actor. */
export function auraCopiesOn(token) {
  const copies = [];
  for ( const effect of token.actor?.effects ?? [] ) {
    const flag = effect.getFlag(MODULE_ID, "aura");
    if ( !flag ) continue;
    copies.push({
      id: effect.id, target: token.uuid, key: flag.key, source: flag.source, value: flag.value,
      iconShown: effect.showIcon === CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS
    });
  }
  return copies;
}

/** Data of the effect copy to place (or update) on a target. */
function copyData(aura, sourceToken, value) {
  const data = baseEffectData(aura);
  delete data._id;
  if ( data.changes === undefined ) delete data.changes;
  const changes = frozenChanges(data, sourceToken.actor);
  if ( data.system?.changes ) data.system.changes = changes;
  else data.changes = changes;
  return foundry.utils.mergeObject(data, {
    name: `${aura.item.name} (${sourceToken.name})`,
    img: aura.item.img,
    transfer: false,
    disabled: false,
    // An effect without duration is "passive": by default the core shows its icon on the token only
    // if it is temporary (CONST.ACTIVE_EFFECT_SHOW_ICON.CONDITIONAL). An aura must be visible.
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    origin: aura.item.uuid,
    flags: { [MODULE_ID]: { aura: { key: aura.key, source: sourceToken.uuid, value } } }
  });
}

export async function createAuraCopy(targetToken, aura, sourceToken, value) {
  await targetToken.actor.createEmbeddedDocuments("ActiveEffect", [copyData(aura, sourceToken, value)]);
}

/**
 * An aura copy can disappear between the read and the write of the recomputation: summon removed, spell ended, scenario
 * reset (the server answers "ActiveEffect … does not exist!", seen on 2026-10-16 in `releve-sorts-4`). A copy
 * already gone needs nothing more: the recomputation continues. Any other error bubbles up.
 */
async function unlessGone(targetToken, effectId, write) {
  if ( !targetToken?.actor?.effects.has(effectId) ) return;
  try { await write(); }
  catch(err) {
    if ( targetToken.actor?.effects.has(effectId) && !/does not exist/i.test(err?.message ?? "") ) throw err;
  }
}

export async function updateAuraCopy(targetToken, effectId, aura, sourceToken, value) {
  await unlessGone(targetToken, effectId,
    () => targetToken.actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effectId, ...copyData(aura, sourceToken, value) }]));
}

/** Restores the icon on a copy placed before the engine started displaying it. */
export async function showAuraIcon(targetToken, effectId) {
  await unlessGone(targetToken, effectId,
    () => targetToken.actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effectId, showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS }]));
}

export async function removeAuraCopy(targetToken, effectId) {
  await unlessGone(targetToken, effectId, () => targetToken.actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]));
}
