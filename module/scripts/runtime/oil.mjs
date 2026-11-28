/**
 * §54: Oil — the target that fails its Dexterity saving throw is oiled; if it takes fire damage within the minute, before the
 * oil dries, the oil ignites and deals 5 more fire damage to it.
 * The "oiled" mark is placed on the failed saving throw (outcome step `mark`, content/gear.mjs). Here: the fire damage.
 *
 * Damage types are only known at calculation (`dnd5e.calculateDamage`, actor.mjs:967, after Resistances) — hook also
 * called for the previews of the damage tray: there we only HOLD. We act on the real application (`dnd5e.applyDamage`,
 * actor.mjs:841), on the client that applies (it has the right to write the actor): the mark falls first (no loop), then
 * the 5 fire damage.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log, say, locEsc } from "./shared.mjs";

const OILED = "oiled";
const lastFire = new WeakMap();   // actor → fire damage was just computed for it

function onCalculate(actor, damages) {
  const fire = Array.from(damages ?? []).some(d => (d.type === "fire") && (Number(d.value) > 0));
  lastFire.set(actor, fire);
}

async function onApplied(actor, amount) {
  const fire = lastFire.get(actor);
  lastFire.delete(actor);
  if ( !fire || !(amount > 0) ) return;
  const marks = actor.effects.filter(e => e.getFlag(MODULE_ID, "mark") === OILED);
  if ( !marks.length || !actor.isOwner ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(e => e.id));
  log(`${actor.name}: the oil ignites (5 Fire damage)`);
  await say({ actor }, locEsc("Huile.Enflammee", { name: actor.name }), { oilBurns: { actor: actor.uuid } });
  await actor.applyDamage([{ value: 5, type: "fire" }]);
}

export function registerOil() {
  route("dnd5e.calculateDamage", onCalculate, { label: "oil: fire damage not noted" });
  route("dnd5e.applyDamage", (actor, amount) => { onApplied(actor, amount).catch(err => console.error(`${MODULE_ID} | oil`, err)); },
    { label: "oil: not ignited" });
}
