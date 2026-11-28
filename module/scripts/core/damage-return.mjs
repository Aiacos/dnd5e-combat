/**
 * §499 (block B19) — return the damage amount taken to the attacker: the `damage { to: "source", same: true | "resisted",
 * damageType? }` step at the `isDamaged` moment of a carried effect (`via: "effect"`). Pure rules.
 *
 * The parts taken are read from dnd5e's damage calculation (`dnd5e.calculateDamage`, after Immunities, Resistances and
 * Vulnerabilities): `{ type, value, multiplier }`. `same: true` returns all the parts; `same: "resisted"` only those that the
 * creature halved (multiplier between 0 and 1: "if it resists damage this way, the attacker takes the same
 * amount"). `damageType`: an imposed type (otherwise the received type).
 */

/** Les valeurs de `same`. */
export const SAME_DAMAGE = Object.freeze([true, "resisted"]);

/** The types that heal: never returned. */
const HEALING = new Set(["healing", "temphp", "maximum"]);

/**
 * The parts taken, as plain data, from the list computed by dnd5e (entries `{ type, value, active: { multiplier } }`).
 * @param {object[]} damages
 * @returns {{type: string, value: number, multiplier: number}[]}
 */
export function takenParts(damages) {
  return Array.from(damages ?? []).filter(d => d && (typeof d.type === "string") && !HEALING.has(d.type))
    .map(d => ({ type: d.type, value: Math.max(0, Math.trunc(Number(d.value) || 0)), multiplier: Number(d.active?.multiplier ?? 1) }))
    .filter(p => p.value > 0);
}

/**
 * The damage to return: one per type, summed. `same: "resisted"`: only the resisted parts. `damageType`: all of it under that type.
 * @param {{type: string, value: number, multiplier?: number}[]} parts
 * @param {{same?: true|"resisted", damageType?: string|null}} [options]
 * @returns {{type: string, value: number}[]}
 */
export function returnedDamage(parts, { same=true, damageType=null }={}) {
  const kept = (parts ?? []).filter(p => (Number(p?.value) > 0) && ((same !== "resisted") || ((p.multiplier > 0) && (p.multiplier < 1))));
  const sums = new Map();
  for ( const p of kept ) {
    const type = damageType || p.type;
    sums.set(type, (sums.get(type) ?? 0) + Number(p.value));
  }
  return [...sums].map(([type, value]) => ({ type, value })).filter(p => p.value > 0);
}
