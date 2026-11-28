/**
 * What, on the scene, is not a creature (SPEC §16.60): an engine-driven object (Spiritual Weapon, Flaming
 * Sphere: flag `dnd5e-combat.object`, §16.15). Neither target, nor obstacle, nor ally, nor enemy; it gives no cover and takes
 * no area effects. (Until 0.149: also an Item Piles pile of objects on the ground, a token — removed in §44; what a creature
 * drops is placed by a neighboring module, which makes it a region and a tile.)
 */

import { MODULE_ID } from "../constants.mjs";

/**
 * The dnd5e actor types that are never a creature: a group (a neighboring module's loot container, the party
 * of adventurers) and an encounter. §260: placed on a scene, they were caught in areas, which waited forever for their
 * save.
 */
const NON_CREATURE_TYPES = Object.freeze(["group", "encounter"]);

/** §271: a 2024 Dungeon Master's Guide trap — an NPC with the custom creature type "Trap" (or "Piège"), even placed without the mark. */
const TRAP_TYPE = /^(traps?|pièges?)$/i;
const isTrapActor = actor => (actor?.system?.details?.type?.value === "custom") && TRAP_TYPE.test(String(actor.system.details.type.custom ?? "").trim());

/** Not a creature: driven object, actor of a type that is never one, or trap. */
export function isObjectToken(token) {
  return !!token?.flags?.[MODULE_ID]?.object || NON_CREATURE_TYPES.includes(token?.actor?.type) || isTrapActor(token?.actor);
}
