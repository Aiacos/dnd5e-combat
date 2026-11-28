/**
 * §274: a weapon's ammunition, read and retained where dnd5e keeps it (issue #23).
 *  - possible ammunition: `item.system.ammunitionOptions` (data/item/weapon.mjs:145, "ammo" consumables of the weapon subtype);
 *  - the retained choice: `flags.dnd5e.last.<activité>.ammunition`, read by `rollAttack` (activity/attack.mjs:94) and
 *    written by it after the roll (attack.mjs:205) — writing there brings the dnd5e window, the dialog-less roll
 *    and the chance to hit into line.
 */
import { MODULE_ID } from "../constants.mjs";
import { ammoChoice } from "../core/ammo.mjs";

/** Does the weapon fire ammunition? */
export function usesAmmo(item) {
  return (item?.type === "weapon") && (item.system.properties?.has?.("amm") === true) && !!item.actor;
}

/** A weapon's attack activities (usually only one). */
function attackActivities(item) {
  return Array.from(item?.system.activities?.values?.() ?? []).filter(a => a.type === "attack");
}

/**
 * The ammunition a weapon can fire and the one its next roll would fire.
 * @param {Item5e} item
 * @param {Activity} [activity]   The attack activity (the weapon's first by default).
 * @param {object} [options]
 * @param {string|null} [options.explicit]  An imposed ammunition.
 * @returns {{options: Array<{id, name, img, quantity}>, current: string|null, ask: boolean}|null}  null: the weapon fires nothing.
 */
export function ammoState(item, activity=null, { explicit=null }={}) {
  if ( !usesAmmo(item) ) return null;
  activity ??= attackActivities(item)[0] ?? null;
  const options = (item.system.ammunitionOptions ?? []).map(o => ({
    id: o.value, name: o.item?.name ?? o.label, img: o.item?.img ?? null, quantity: Number(o.item?.system.quantity ?? 0)
  }));
  const remembered = activity ? (item.getFlag("dnd5e", `last.${activity.id}.ammunition`) ?? null) : null;
  const choice = ammoChoice({ options, remembered, explicit });
  return { options, current: choice.use, ask: choice.ask };
}

/**
 * Retains an ammunition for the weapon's next attacks (all its attack activities), and announces it
 * (hook `dnd5e-combat.ammunition`, `(item, ammoId)`, on every client through the item update).
 * @param {Item5e} item
 * @param {string} ammoId   The id of one of the creature's ammunition consumables.
 * @returns {Promise<boolean>}  false: the weapon does not fire this ammunition, or the item is not editable.
 */
export async function setAmmo(item, ammoId) {
  if ( !usesAmmo(item) || !item.isOwner ) return false;
  if ( !(item.system.ammunitionOptions ?? []).some(o => o.value === ammoId) ) return false;
  const update = {};
  for ( const a of attackActivities(item) ) update[`flags.dnd5e.last.${a.id}.ammunition`] = ammoId;
  if ( foundry.utils.isEmpty(update) ) return false;
  await item.update(update, { [MODULE_ID]: { ammunition: ammoId } });
  return true;
}

/** `updateItem`: a change of retained ammunition, wherever it comes from (DAS, dnd5e window after the roll) → public hook. */
export function announceAmmoChange(item, changes) {
  const last = changes?.flags?.dnd5e?.last;
  if ( !last || !usesAmmo(item) ) return;
  const changed = Object.values(last).some(v => v && (typeof v === "object") && ("ammunition" in v));
  if ( !changed ) return;
  // §274: on every client, when a weapon's retained ammunition changes (DAS, or the dnd5e window after the roll):
  // `(item, ammoId)`, the id of the ammunition the next roll will fire, or null. Read-only.
  Hooks.callAll(`${MODULE_ID}.ammunition`, item, ammoState(item)?.current ?? null);
}
