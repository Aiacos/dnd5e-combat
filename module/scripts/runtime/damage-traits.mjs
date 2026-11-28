/**
 * A trait that responds to a type of damage taken (`onDamageTaken`, core/damage-traits.mjs): Water Elemental's Freeze,
 * Flesh Golem's Fire Aversion. The types actually taken are read at the damage calculation (`dnd5e.calculateDamage`, like
 * Undead Fortitude); the trait's effect is applied to its bearer once the damage is applied (`dnd5e.applyDamage`),
 * by the GM's client that applies it. An effect already carried is replaced: its duration restarts.
 */

import { MODULE_ID } from "../constants.mjs";
import { damageTraitHits, traitEffectData } from "../core/damage-traits.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** The bearer's traits that declare `onDamageTaken`. */
const traitsOf = actor => Array.from(actor?.items ?? []).map(item => ({ item, rule: contentOf(item).entry?.onDamageTaken ?? null }))
  .filter(t => t.rule);

function onCalculateDamage(actor, damages, options) {
  if ( !traitsOf(actor).length ) return;
  (options[MODULE_ID] ??= {}).damageTraitTypes = damages.filter(d => (d.value > 0) && d.type).map(d => d.type);
}

async function onApplyDamage(actor, amount, options) {
  const taken = options?.[MODULE_ID]?.damageTraitTypes;
  if ( !(amount > 0) || !taken?.length || !game.user?.isGM ) return;
  for ( const { item, rule } of traitsOf(actor) ) {
    if ( !damageTraitHits(rule, taken) ) continue;
    const source = item.effects.get(rule.effect);
    if ( !source ) continue;
    const worn = actor.effects.filter(e => (e.origin === item.uuid) && (e.name === source.name)).map(e => e.id);
    if ( worn.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", worn);
    await actor.createEmbeddedDocuments("ActiveEffect", [traitEffectData(source.toObject(), source.uuid, item.uuid)]);
    log(`${item.name}: ${actor.name} took ${taken.join(", ")} damage — "${source.name}" applied`);
  }
}

export function registerDamageTraits() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "trait answering a damage type: types not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "trait answering a damage type: effect not applied" });
}
