/**
 * Undead Fortitude (Monster Manual 2024, §61): Zombie, Ogre Zombie, Beholder Zombie. Damage that drops the creature to 0 HP —
 * unless radiant or a Critical Hit — makes it roll a Constitution saving throw with DC 5 + the damage taken; on a success, it
 * stays at 1 HP. The rule is in core/fortitude.mjs; the save due is recorded with the HP
 * (adapter/death.mjs, `planDamageAtZero`), then played here by the active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { fortitudeOf, pendingFortitude, clearFortitude } from "../adapter/fortitude.mjs";
import { ensureDowned, AFTER_ZERO_HP_MS } from "../adapter/death.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, sleep } from "./shared.mjs";

/** On the client that applies the damage: the types actually taken, to exclude radiant damage. */
function onCalculateDamage(actor, damages, options) {
  if ( !fortitudeOf(actor) ) return;
  const types = damages.filter(d => (d.value > 0) && d.type).map(d => d.type);
  (options[MODULE_ID] ??= {}).takenTypes = types;
}

/** The creature dropped to 0 HP with a pending save: the active GM plays it. */
function onZero(actor) {
  if ( !actor || !pendingFortitude(actor) ) return;
  return enqueue(`fortitude:${actor.uuid}`, async () => {
    await sleep(AFTER_ZERO_HP_MS);
    const pending = pendingFortitude(actor);
    if ( !pending ) return;
    if ( (actor.system.attributes?.hp?.value ?? 1) > 0 ) return clearFortitude(actor);
    const { dc, item } = pending;
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
      { data: { flavor: loc("Robustesse.Carte", { item, dc }), flags: { [MODULE_ID]: { fortitude: { actor: actor.uuid, dc } } } } });
    const total = rolls?.[0]?.total;
    await clearFortitude(actor);
    if ( Number.isFinite(total) && (total >= dc) ) {
      // HP > 0: `clearDeathMarks` (adapter/death.mjs) removes the engine's marks and Stable; the condition that dnd5e sets
      // automatically at 0 HP (flag `autoDowned`) is removed here.
      await actor.update({ "system.attributes.hp.value": 1 });
      const downed = actor.effects.filter(e => e.getFlag("dnd5e", "autoDowned")).map(e => e.id);
      if ( downed.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", downed).catch(() => {});
      const token = tokenOf(actor);
      if ( token ) notice(token, loc("Robustesse.Reussite", { item }), "gain");
      log(`${item}: ${actor.name} succeeds (${total} vs DC ${dc}) and stays at 1 HP`);
      return;
    }
    log(`${item}: ${actor.name} fails (${total} vs DC ${dc})`);
    await ensureDowned(actor);
  });
}

export function registerFortitude() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "Undead Fortitude: damage types not read" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, `flags.${MODULE_ID}.fortitude`) ) return onZero(actor);
  }, { executor: true, label: "Undead Fortitude: saving throw not rolled" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, `delta.flags.${MODULE_ID}.fortitude`) ) return onZero(token.actor);
  }, { executor: true, label: "Undead Fortitude: saving throw not rolled (unlinked token)" });
}
