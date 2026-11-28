/**
 * Imposed order (SPEC §16.59): the effect that carries the order on the target, and "Drop" — what the creature holds: its
 * equipped weapons and shield. Who puts them on the ground: a neighboring module that offered itself on the
 * `dnd5e-combat.dropItems` hook (§40.3 — the engine knows none): they fall in a pile at its feet and leave its sheet; without a
 * neighbor, they are only unequipped (left in the inventory: "dropped", to be picked up with a Utilize action). The fallback
 * on Item Piles was removed in §44.
 */

import { MODULE_ID } from "../constants.mjs";
import { identifierOf } from "./content.mjs";

/** The order an actor must follow: `{ effect, order, from }` (from: uuid of the caster's token), or null. */
export function orderOn(actor) {
  for ( const effect of actor?.effects ?? [] ) {
    const flag = effect.getFlag?.(MODULE_ID, "order");
    if ( flag?.order && !effect.disabled ) return { effect, order: flag.order, from: flag.from ?? null, done: flag.done === true };
  }
  return null;
}

/** The effect carrying the order, to create on the target. Ends at the end of its next turn (content: `remove` at endOfTurn). */
export function orderEffectData({ item, activity, order, label, fromToken, message }) {
  return {
    name: game.i18n.format("DND5ECOMBAT.LabelValue", { label: item.name, value: label }),
    img: item.img,
    origin: item.uuid,
    system: { origin: { item: item.uuid, activity: activity?.uuid ?? null, message: message?.uuid ?? null } },
    flags: { [MODULE_ID]: { order: { order, from: fromToken ?? null } } }
  };
}

/**
 * What the creature holds: equipped weapons and shield — not natural weapons (Slam, Bite: type "natural"), nor the
 * Unarmed Strike, which a class puts equipped (Command "Drop" does not make it drop its fists).
 */
export function heldItemsOf(actor) {
  return (actor?.items ?? []).filter(i => (i.system?.equipped === true)
    && (((i.type === "weapon") && (i.system.type?.value !== "natural") && (identifierOf(i).id !== "unarmed-strike"))
      || ((i.type === "equipment") && (i.system.type?.value === "shield"))));
}

/**
 * §40.3: a neighboring module puts on the ground what a creature drops (Darsh Loot: a pile in its cell). The engine calls
 * `Hooks.callAll("dnd5e-combat.dropItems", takers, { token, items })` on the active GM's client; a module that handles it pushes
 * into `takers` an `async () => boolean` function — true: the objects left the sheet and are on the ground. The first that
 * answers true wins; an error or a refusal lets the rest (the plain unequipping) go ahead. Also used for the familiar that
 * leaves into its pocket dimension (§107).
 */
export async function droppedByNeighbour(token, items) {
  const takers = [];
  // §40.3: on the active GM's client, when a creature drops what it holds ("Drop" order, familiar that leaves into its pocket):
  // `(takers, { token, items })`. A module that puts the objects on the ground pushes into `takers` an `async () => boolean`
  // (true: it is done); otherwise, plain unequipping.
  Hooks.callAll(`${MODULE_ID}.dropItems`, takers, { token, items });
  for ( const take of takers ) {
    if ( typeof take !== "function" ) continue;
    try { if ( (await take()) === true ) return true; }
    catch(err) { console.warn(`${MODULE_ID} | dropped items: a neighbouring module failed`, err); }
  }
  return false;
}

/**
 * Drops what the creature holds. Returns `{ items: [noms], pile: boolean, kept: [noms] }` — `items`: what is on the ground (with a
 * neighbor) or dropped in the inventory (without); `kept` (§122): with a neighbor, what stayed on the sheet (a creature's
 * attack, which Loot and Trade does not put on the ground), unequipped.
 * @param {TokenDocument} token
 */
export async function dropHeld(token) {
  const actor = token?.actor;
  const held = heldItemsOf(actor);
  if ( !held.length ) return { items: [], pile: false, kept: [] };
  const names = held.map(i => i.name);
  // On the ground, the object carries the name of its "gear" version (dnd5e `gearPresentationData`, physical-item.mjs:413:
  // "Dagger" rather than the "Umbral Dagger" of the Vampire Familiar), as dnd5e's NPC sheet displays it.
  const gearName = i => i.system?.gearPresentationData?.()?.name ?? i.name;
  if ( await droppedByNeighbour(token, held) ) {
    const stayed = held.filter(i => actor.items.has(i.id));
    const stillHeld = stayed.filter(i => actor.items.get(i.id)?.system?.equipped);
    if ( stillHeld.length ) await actor.updateEmbeddedDocuments("Item", stillHeld.map(i => ({ _id: i.id, "system.equipped": false })));
    return { items: held.filter(i => !actor.items.has(i.id)).map(gearName), pile: true, kept: stayed.map(i => i.name) };
  }
  await actor.updateEmbeddedDocuments("Item", held.map(i => ({ _id: i.id, "system.equipped": false })));
  return { items: names, pile: false, kept: [] };
}
