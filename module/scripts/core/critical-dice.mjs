/**
 * Issue #269 (journal §545): the extra dice of a Critical Hit, rolled apart from the normal damage.
 *
 * When one attack roll hits several targets and only some of them are Critical Hits (a Paralyzed target within 5 ft, a
 * lowered critical margin, a target's own `noCrit`, a reaction that turns a critical into a normal hit), SRD 5.2 decides the
 * critical target by target. The damage is then rolled once, normally, for every target hit, and the extra critical dice
 * are rolled beside it and added only to the critical targets.
 *
 * This file mirrors dnd5e's `DamageRoll#configureDamage` (module/dice/damage-roll.mjs, `#applyCriticalTerm`) on a plain
 * description of the roll's terms, and returns the formula of what a Critical Hit adds to the normal roll:
 *  - a plain die (`2d6`): `number × (multiplier − 1)` more dice, plus `bonusDice` on the roll's first term;
 *  - a die with modifiers (`1d8min3`) or any other random term: `(multiplier − 1) + bonusDice` more copies of the term;
 *  - a flat number: `number × (multiplier − 1)`, only with the « multiply modifiers » setting;
 *  - « maximize the extra dice » (`powerfulCritical`): the term's maximum, `max(1, multiplier − 1) + bonusDice` times;
 *  - `bonusDamage`: added once.
 * Pure: no Foundry global.
 */

/**
 * @typedef {object} TermInfo
 * @property {string} [operator]       An operator term: "+", "-", "*", "/", "%".
 * @property {number} [number]         Dice count (dice term) or value (flat term).
 * @property {number} [faces]          A die's faces. Present = dice term.
 * @property {string[]} [modifiers]    A die's modifiers ("min3", "r<3", "kh"…).
 * @property {string} [flavor]         The term's flavor (`[fire]`).
 * @property {string} [formula]        Any other term, written as is (parenthetical, pool, function).
 * @property {boolean} [deterministic] That other term has no dice.
 * @property {number} [max]            The term's maximum (needed for `powerfulCritical` on a random term).
 */

const BINDING = new Set(["*", "/", "%"]);

const withFlavor = (formula, flavor) => (flavor ? `${formula}[${flavor}]` : formula);

/** The formula of one term, as written in a roll. */
function termFormula(term) {
  if ( term.faces ) return withFlavor(`${term.number}d${term.faces}${(term.modifiers ?? []).join("")}`, term.flavor);
  if ( Number.isFinite(term.number) ) return withFlavor(String(term.number), term.flavor);
  return term.formula ?? "";
}

/**
 * The extra part one term adds on a Critical Hit, or null.
 * @param {TermInfo} term
 * @param {object} critical
 * @param {boolean} first  The roll's first term (where `bonusDice` goes).
 */
function extraOf(term, critical, first) {
  const cm = Number(critical.multiplier ?? 2);
  const cb = (first && (Number(critical.bonusDice) > 0)) ? Number(critical.bonusDice) : 0;
  const flat = !term.faces && Number.isFinite(term.number);
  if ( flat ) {
    const value = critical.multiplyNumeric ? term.number * (cm - 1) : 0;
    return value ? withFlavor(String(value), term.flavor) : null;
  }
  if ( !term.faces && term.deterministic ) return null;
  if ( critical.powerfulCritical ) {
    const max = term.faces ? (term.number * term.faces) : Number(term.max);
    const value = (Number.isFinite(max) ? max : 0) * (Math.max(1, cm - 1) + cb);
    return value > 0 ? withFlavor(String(value), term.flavor) : null;
  }
  if ( term.faces && !(term.modifiers ?? []).length ) {
    const count = (term.number * (cm - 1)) + cb;
    return count > 0 ? withFlavor(`${count}d${term.faces}`, term.flavor) : null;
  }
  const copies = (cm - 1) + cb;
  if ( copies <= 0 ) return null;
  return Array.from({ length: copies }, () => termFormula(term)).join(" + ");
}

/**
 * The formula of what a Critical Hit adds to this roll, or "" when it adds nothing.
 * @param {TermInfo[]} terms  The roll's terms, in order (the normal roll, not configured as critical).
 * @param {object} [critical]  dnd5e's critical configuration of the roll (`roll.options.critical`).
 * @param {number} [critical.multiplier=2]
 * @param {number} [critical.bonusDice=0]
 * @param {boolean} [critical.multiplyNumeric=false]
 * @param {boolean} [critical.powerfulCritical=false]
 * @param {string} [critical.bonusDamage]
 * @returns {string}
 */
export function criticalExtraFormula(terms, critical={}) {
  const parts = [];
  for ( const [i, term] of (terms ?? []).entries() ) {
    if ( term.operator ) continue;
    const prev = terms[i - 1]?.operator;
    const next = terms[i + 1]?.operator;
    // A flat factor (`× 2`) is not damage of its own: its dice term carries it.
    if ( !term.faces && Number.isFinite(term.number) && (BINDING.has(prev) || BINDING.has(next)) ) continue;
    let extra = extraOf(term, critical, i === 0);
    if ( !extra ) continue;
    // A term bound by `*`, `/` or `%` keeps its factor: `2d6 * 2` adds `(2d6) * 2`, `2 * 1d6` adds `2 * (1d6)`.
    if ( BINDING.has(next) ) {
      const factor = terms[i + 2];
      if ( !factor || factor.operator ) continue;
      extra = `(${extra}) ${next} ${termFormula(factor)}`;
    }
    if ( BINDING.has(prev) ) {
      const factor = terms[i - 2];
      if ( !factor || factor.operator || BINDING.has(terms[i - 3]?.operator) ) continue;
      extra = `${termFormula(factor)} ${prev} (${extra})`;
    }
    // The sign of an additive term: the operator before it, or before its factor.
    const sign = BINDING.has(prev) ? terms[i - 3]?.operator : prev;
    parts.push({ sign: sign === "-" ? "-" : "+", extra });
  }
  if ( critical.bonusDamage ) parts.push({ sign: "+", extra: String(critical.bonusDamage) });
  return parts.map((p, i) => (i === 0 ? (p.sign === "-" ? `-${p.extra}` : p.extra) : `${p.sign} ${p.extra}`)).join(" ");
}

/**
 * Of one attack's targets, how the Critical Hit splits them: "none" (no hit target is critical), "all" (every hit target is),
 * or "mixed" — then the damage is rolled normally and the critical dice apart (`criticalExtraFormula`).
 * @param {Array<{hit?: boolean, critical?: boolean}>} targets
 * @returns {"none"|"all"|"mixed"}
 */
export function criticalSplit(targets) {
  const hit = (targets ?? []).filter(t => t.hit);
  const critical = hit.filter(t => t.critical).length;
  if ( !critical ) return "none";
  return (critical === hit.length) ? "all" : "mixed";
}
