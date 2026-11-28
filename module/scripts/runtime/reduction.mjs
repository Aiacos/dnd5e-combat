/**
 * Damage reduction and absorption (SPEC §16.11, B14): the pool (Arcane Ward) on `dnd5e.preApplyDamage`,
 * BEFORE 0 HP (runtime/death.mjs: what is absorbed does not reach the creature) — the order of the `register…()` calls in
 * dnd5e-combat.mjs ensures it. Uncanny Dodge (half the damage of an attack) is a Reaction (core/action.mjs,
 * `halved`); Warding Bond, a share on `isDamaged` (runtime/triggers.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { absorbDamage, spendPools, rechargePools } from "../adapter/absorb.mjs";
import { disarmForeignEnhancers } from "../adapter/interop.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export function registerReduction() {
  route("dnd5e.preApplyDamage", absorbDamage, { label: "pool: damage not absorbed" });
  route("dnd5e.applyDamage", async (actor, amount, options) => {
    const pools = await spendPools(actor, options);
    for ( const p of pools ) log(`${p.name}: absorbs ${p.take} damage for ${actor.name}`);
  }, { label: "pool: spending not written" });
  route("createChatMessage", async message => {
    if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
    for ( const r of await rechargePools(message) ) log(`${r.name}: +${r.gained}`);
  }, { executor: true, label: "pool: recharge not written" });
  // §474: DDB Importer's aegis absorbed a second time what got past the engine's — its automations cut off, the GM warned.
  route("ready", async () => {
    const keys = await disarmForeignEnhancers();
    if ( !keys.length ) return;
    log(`DDB Importer: ${keys.join(", ")} turned off (the engine automates Arcane Ward and Warding Bond)`);
    ui.notifications.warn(loc("Interop.DdbEgide"), { permanent: true });
  }, { executor: true, label: "DDB Importer: Arcane Ward automation not turned off" });
}
