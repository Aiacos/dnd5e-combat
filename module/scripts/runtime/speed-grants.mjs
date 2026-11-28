/**
 * §195: the speeds that an item grants without an effect in its data (`grantsSpeeds`, content/ — Athlete: "a climbing
 * speed equal to your Speed"). The active GM holds on the actor one effect per item (flag `flags.dnd5e-combat.speedGrant` =
 * the item's id, origin = the item), of the same shape as the dnd5e features that grant a speed
 * (`system.attributes.movement.<vitesse>`, `upgrade`, phase `initial`: Draconic Wings, adapter/altitude.mjs): created when
 * the item arrives, rewritten when the base Speed changes, removed with the item. Equipment grants it only when worn (and
 * attuned if it requires: Spider Climb Slippers, Cloak of Arachnida). The climbing speed thus becomes a real speed for
 * dnd5e (cost ×1, `walkFallback`) and for the engine (`climbingOf(token).native`). Nothing is written on the item.
 * §236: likewise the Resistances that an item grants without an effect (`grantsResistances`, Avatar of Battle), in the same
 * effect.
 * §494 (B14): likewise the Concentration limit of a trait (`concentration: { limit }`, "three spells at once"):
 * `system.attributes.concentration.limit`, "upgrade", which dnd5e reads to replace a Concentration or open one more.
 * Limit: "equal to your Speed" is read from the base Speed (sheet, otherwise species), not the Speed of the moment
 * (Haste, Longstrider do not carry over).
 */

import { MODULE_ID } from "../constants.mjs";
import { grantedSpeedChanges, sameSpeedChanges } from "../core/climb.mjs";
import { concentrationLimitChanges } from "../core/concentration.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { loc, log } from "./shared.mjs";

export const SPEED_GRANT_FLAG = "speedGrant";

/** The actor's base Speed: that of their sheet, otherwise that of their species, otherwise the prepared Speed. */
export function baseWalkOf(actor) {
  const movement = actor?.system?.attributes?.movement ?? {};
  const source = actor?._source?.system?.attributes?.movement ?? {};
  return Number(source.speeds?.walk ?? source.walk) || Number(movement.fromSpecies?.walk) || Number(movement.speeds?.walk ?? movement.walk) || 0;
}

/** Equipment grants its speed when worn, and attuned if it requires; a known spell, never (its effect alone counts); a feature, always. */
function worn(item) {
  if ( item.type === "spell" ) return false;
  if ( !["equipment", "weapon"].includes(item.type) ) return true;
  return !!item.system?.equipped && ((item.system?.attunement !== "required") || !!item.system?.attuned);
}

/** The actor's items that grant a speed, with the wanted changes. */
function wantedOf(actor) {
  const walk = baseWalkOf(actor);
  const out = new Map();
  for ( const item of actor?.items ?? [] ) {
    const entry = contentOf(item).entry;
    if ( !(entry?.grantsSpeeds || entry?.grantsResistances || entry?.grantsConditionImmunities || entry?.concentration) || !worn(item) ) continue;
    // §236: the Resistances granted (Avatar of Battle) — the shape of dnd5e's data (Rage: `system.traits.dr.value`, "add").
    const changes = [...grantedSpeedChanges(entry.grantsSpeeds ?? {}, walk),
      ...(entry.grantsResistances ?? []).map(type => ({ key: "system.traits.dr.value", type: "add", value: type })),
      // §295: condition Immunities ("Protégé de dame Nature": Poisoned).
      ...(entry.grantsConditionImmunities ?? []).map(status => ({ key: "system.traits.ci.value", type: "add", value: status })),
      // §494 (B14): the limit of simultaneous Concentrations.
      ...concentrationLimitChanges(entry.concentration)];
    if ( changes.length ) out.set(item.id, { item, changes, speed: !!entry.grantsSpeeds });
  }
  return out;
}

/** The effects that the engine has placed for these items. */
export const speedGrantEffects = actor => (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, SPEED_GRANT_FLAG));

async function sync(actor) {
  if ( !actor || (actor.system?.isCreature === false) ) return;
  const wanted = wantedOf(actor);
  const have = speedGrantEffects(actor);
  const remove = have.filter(e => !wanted.has(e.getFlag(MODULE_ID, SPEED_GRANT_FLAG))).map(e => e.id);
  if ( remove.length ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", remove, { [MODULE_ID]: { speedGrant: true } });
    log(`${actor.name}: ${remove.length} granted speed effect(s) removed`);
  }
  for ( const [itemId, { item, changes, speed }] of wanted ) {
    const withPhase = changes.map(c => ({ ...c, phase: "initial" }));
    const effect = have.find(e => e.getFlag(MODULE_ID, SPEED_GRANT_FLAG) === itemId);
    if ( effect ) {
      if ( sameSpeedChanges(effect.system?.changes ?? effect.changes ?? [], changes) ) continue;
      await actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effect.id, "system.changes": withPhase }], { [MODULE_ID]: { speedGrant: true } });
      log(`${actor.name}: ${item.name} speed rewritten (${changes.map(c => `${c.key.split(".").at(-1)} ${c.value}`).join(", ")})`);
      continue;
    }
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: speed ? loc("Escalade.VitesseAccordee", { item: item.name }) : item.name, img: item.img, origin: item.uuid, transfer: false, disabled: false,
      system: { changes: withPhase },
      flags: { [MODULE_ID]: { [SPEED_GRANT_FLAG]: itemId } }
    }], { [MODULE_ID]: { speedGrant: true } });
    log(`${actor.name}: ${item.name} grants ${changes.map(c => `${c.key.split(".").at(-1)} ${c.value}`).join(", ")}`);
  }
}

const later = actor => (actor ? enqueue(`speedGrant:${actor.uuid}`, () => sync(actor)).catch(err => console.error(`${MODULE_ID} | speed grant`, err)) : null);

export function registerSpeedGrants() {
  const opts = { executor: true, label: "granted speed not synced" };
  route("ready", () => Promise.all([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].map(later)), opts);
  route("canvasReady", () => Promise.all((canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => later(t.actor))), opts);
  for ( const hook of ["createItem", "deleteItem"] ) {
    route(hook, item => { if ( item.parent?.documentName === "Actor" ) return later(item.parent); }, opts);
  }
  route("updateItem", (item, changes) => {
    if ( (item.parent?.documentName === "Actor") && ["system.equipped", "system.attuned"].some(k => foundry.utils.hasProperty(changes, k)) ) return later(item.parent);
  }, opts);
  route("updateActor", (actor, changes) => {
    if ( foundry.utils.hasProperty(changes, "system.attributes.movement") ) return later(actor);
  }, opts);
}
