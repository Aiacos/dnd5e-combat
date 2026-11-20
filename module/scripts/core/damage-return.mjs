/**
 * §499 (brique B19) — renvoyer à l'attaquant le montant de dégâts subi : étape `damage { to: "source", same: true | "resisted",
 * damageType? }` au moment `isDamaged` d'un effet porté (`via: "effect"`). Règles pures.
 *
 * Les parts subies se lisent au calcul des dégâts de dnd5e (`dnd5e.calculateDamage`, après immunités, résistances et
 * vulnérabilités) : `{ type, value, multiplier }`. `same: true` renvoie toutes les parts ; `same: "resisted"` seulement celles que la
 * créature a réduites de moitié (multiplicateur entre 0 et 1 : « si elle résiste ainsi à des dégâts, l'attaquant subit le même
 * montant »). `damageType` : un type imposé (sinon le type reçu).
 */

/** Les valeurs de `same`. */
export const SAME_DAMAGE = Object.freeze([true, "resisted"]);

/** Les types qui soignent : jamais renvoyés. */
const HEALING = new Set(["healing", "temphp", "maximum"]);

/**
 * Les parts subies, en données simples, à partir de la liste calculée par dnd5e (entrées `{ type, value, active: { multiplier } }`).
 * @param {object[]} damages
 * @returns {{type: string, value: number, multiplier: number}[]}
 */
export function takenParts(damages) {
  return Array.from(damages ?? []).filter(d => d && (typeof d.type === "string") && !HEALING.has(d.type))
    .map(d => ({ type: d.type, value: Math.max(0, Math.trunc(Number(d.value) || 0)), multiplier: Number(d.active?.multiplier ?? 1) }))
    .filter(p => p.value > 0);
}

/**
 * Les dégâts à renvoyer : un par type, sommés. `same: "resisted"` : seulement les parts résistées. `damageType` : tout sous ce type.
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
