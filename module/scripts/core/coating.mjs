/**
 * O9h (§363): weapon coatings (Basic Poison: "a weapon or up to three pieces of ammunition"). Pure: no dependency on Foundry.
 */

/**
 * The items that can receive the coating: weapons (except natural weapons) with a damage type that delivers it, and ammunition.
 * @param {Array<{id, name, type, kind, damageTypes: string[], equipped: boolean, quantity: number}>} items
 * @param {{ damageTypes: string[], ammunition?: number }} rule
 * @returns {Array<{id, name, ammunition: boolean}>}  Equipped weapons first.
 */
export function coatingCandidates(items, rule) {
  const delivers = i => (i.damageTypes ?? []).some(t => rule.damageTypes.includes(t));
  const weapons = items.filter(i => (i.type === "weapon") && (i.kind !== "natural") && delivers(i))
    .sort((a, b) => Number(b.equipped) - Number(a.equipped));
  const ammo = rule.ammunition ? items.filter(i => (i.type === "consumable") && (i.kind === "ammo") && ((i.quantity ?? 0) > 0)) : [];
  return [...weapons.map(i => ({ id: i.id, name: i.name, ammunition: false })), ...ammo.map(i => ({ id: i.id, name: i.name, ammunition: true }))];
}

/**
 * Does the coating apply to this damage roll? "dry" (dried or spent: to remove), "applies", or "no" (the roll has the wrong type).
 * @param {{ until: number, deliveredBy: string[], charges?: number }} coating
 * @param {{ now: number, types: string[] }} roll
 */
export function coatingApplies(coating, { now, types }) {
  if ( !coating || !(Number(coating.charges ?? 1) > 0) || !(now <= coating.until) ) return "dry";
  return (types ?? []).some(t => (coating.deliveredBy ?? []).includes(t)) ? "applies" : "no";
}
