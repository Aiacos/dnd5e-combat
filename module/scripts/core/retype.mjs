/**
 * The damage types a spell can take in place of its own (key `spellDamageTypes`) — Psychic Spells: any Warlock spell
 * can become psychic, at no cost; Transmuted Spell (SRD 5.2): "when you cast a spell that deals a damage type from the
 * list — acid, cold, fire, lightning, poison, thunder —, you can spend 1 Sorcery Point to change that type to one of the
 * others on the list". Pure functions.
 */

/**
 * What the rules offer this spell.
 * @param {Array<{types: string[], from?: string[], cost?: string|null, payable?: boolean}>} rules  those that apply to this spell
 *   (class already judged); `from`: the spell must deal one of these types; `cost`: the activity that pays for the change,
 *   `payable`: whether it has enough left
 * @param {string[]} own   the types the spell already deals
 * @returns {Array<{type: string, cost: string|null}>}  a type at most once, never its own; free ones preferred
 */
export function retypeOffers(rules, own) {
  const mine = new Set(own ?? []);
  const out = new Map();
  for ( const rule of rules ?? [] ) {
    if ( rule.from && !rule.from.some(t => mine.has(t)) ) continue;
    if ( rule.cost && (rule.payable === false) ) continue;
    for ( const type of rule.types ?? [] ) {
      if ( mine.has(type) ) continue;
      const cost = rule.cost ?? null;
      if ( !out.has(type) || ((out.get(type) !== null) && (cost === null)) ) out.set(type, cost);
    }
  }
  return Array.from(out, ([type, cost]) => ({ type, cost }));
}
