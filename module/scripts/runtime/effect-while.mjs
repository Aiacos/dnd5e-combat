/**
 * §130: the feat effects that the Player's Handbook applies without their condition (Defense, Dueling, Heavy and Medium Armor
 * Master, "Fog of War" of the stealthy Ranger). Key `effectWhile: { <id d'effet de l'item>: { if, changes? } }`: on the active GM,
 * the bearer's item effect is enabled when the condition holds, disabled otherwise (`disabled`, visible on the sheet) — on every
 * change of equipment, of ability scores, at the start and end of a combat, and on load. `changes`: the changes the effect must
 * carry, written if they differ (Medium Armor Master: its data key is broken). No patch: dnd5e applies or not
 * the effect as for any effect disabled by hand.
 * Limit: Heavy Armor Master also reduces B/P/S damage that does not come from an attack (rule: "hit by an attack").
 */

import { MODULE_ID } from "../constants.mjs";
import { effectHolds, sameChanges } from "../core/feats.mjs";
import { effectFacts } from "../adapter/effect-while.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

/** The effects to maintain on an actor: `[{ item, effect, rule }]`. */
function watched(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rules = contentOf(item).entry?.effectWhile;
    if ( !rules ) continue;
    for ( const [id, rule] of Object.entries(rules) ) {
      const effect = item.effects.get(id);
      if ( effect ) out.push({ item, effect, rule });
    }
  }
  return out;
}

async function sync(actor) {
  const list = watched(actor);
  if ( !list.length ) return;
  const facts = effectFacts(actor);
  for ( const { item, effect, rule } of list ) {
    const update = {};
    // §295: without `if`, the effect keeps the state the player gives it (Aspect of the Beasts choice); only its changes are
    // rewritten.
    const disabled = rule.if ? !effectHolds(rule.if, facts) : effect.disabled;
    if ( effect.disabled !== disabled ) update.disabled = disabled;
    if ( rule.changes && !sameChanges(effect.system?.changes ?? effect.changes ?? [], rule.changes) ) update["system.changes"] = rule.changes;
    if ( !Object.keys(update).length ) continue;
    await item.updateEmbeddedDocuments("ActiveEffect", [{ _id: effect.id, ...update }], { [MODULE_ID]: { effectWhile: true } });
    log(`${actor.name}: "${effect.name}" (${item.name}) ${disabled ? "inactive" : "active"}${update["system.changes"] ? ", changes rewritten" : ""}`);
  }
}

const later = actor => (actor ? enqueue(`effectWhile:${actor.uuid}`, () => sync(actor)) : null);

/** What changes the facts: equipment (weapons, armor, shield), an ability score. Not our own writes. */
const RELEVANT = ["system.equipped", "system.type", "system.properties", "system.armor"];

export function registerEffectWhile() {
  const opts = { executor: true, label: "feat effect not synced" };
  route("ready", () => Promise.all([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].map(later)), opts);
  route("updateItem", (item, changes, options) => {
    if ( options?.[MODULE_ID]?.effectWhile ) return;
    if ( item.parent?.documentName !== "Actor" ) return;
    if ( !RELEVANT.some(k => foundry.utils.hasProperty(changes, k)) ) return;
    return later(item.parent);
  }, opts);
  route("createItem", item => (item.parent?.documentName === "Actor" ? later(item.parent) : null), opts);
  route("deleteItem", item => (item.parent?.documentName === "Actor" ? later(item.parent) : null), opts);
  route("updateActor", (actor, changes) => (foundry.utils.hasProperty(changes, "system.abilities") ? later(actor) : null), opts);
  // Combat starts when its round goes to 1: `combatStart` fires BEFORE this write (the combat is not yet `started`).
  route("updateCombat", (combat, changes) => (("round" in (changes ?? {})) ? Promise.all(combat.combatants.map(c => later(c.actor))) : null), opts);
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => later(c.actor))), opts);
  route("createCombatant", combatant => later(combatant.actor), opts);
  // C12-c: an effect that depends on another effect (Starry Form) or on Wild Shape — recomputed when the actor's effects change
  // (not our own writes, made on the items' effects).
  const byEffects = effect => {
    const actor = (effect.parent?.documentName === "Actor") ? effect.parent : effect.parent?.parent;
    if ( (actor?.documentName !== "Actor") || !watched(actor).some(w => w.rule.if?.hasEffect || w.rule.if?.wildShaped) ) return null;
    return later(actor);
  };
  for ( const hook of ["createActiveEffect", "deleteActiveEffect"] ) route(hook, byEffects, opts);
  route("updateActiveEffect", (effect, changes, options) => (options?.[MODULE_ID]?.effectWhile ? null : byEffects(effect)), opts);
  route("createToken", token => (token.actor?.isPolymorphed ? later(token.actor) : null), opts);
  // §135: an effect that depends on light (Boon of the Night Spirit) — recomputed when the token moves.
  route("updateToken", (token, changes) => ((["x", "y", "elevation"].some(k => k in (changes ?? {})) && watched(token.actor).some(w => w.rule.if?.light))
    ? later(token.actor) : null), opts);
}
