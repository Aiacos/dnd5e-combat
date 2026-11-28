/**
 * §66: Counterspell in the 2014 manner (SRD 5.1, "Counterspell") — the reaction does not ask the caster for a save: a spell
 * of the counterspell's level or lower fails without a roll; above that, the one countering makes an ability check with their
 * spellcasting ability against a DC of 10 + the spell's level; if it succeeds, the spell fails. Declared on the countering item
 * (`counter: { level? }`, core/content.mjs), played by the `castsSpell` gate (runtime/gates.mjs). The 2024 Counterspell
 * (Constitution save of the caster) does not change.
 *
 * Pure functions, no dependency on Foundry.
 */

const level = value => (Number.isFinite(Number(value)) && (value !== null) && (value !== "")) ? Math.max(0, Math.trunc(Number(value))) : null;

/**
 * The level at which a spell is cast, as known before it is cast: the highest of its level, its scaled level
 * (`scaling`), the chosen slot (`slotLevel`) and the level given to it by the feature that casts it
 * (`linkedLevel`: a spell cast by a "cast" activity, a monster's "Fireball (level 4)").
 * @param {{level?: number, scaling?: number, slotLevel?: number|null, linkedLevel?: number|null}} data
 * @returns {number}
 */
export function castLevelOf({ level: base=0, scaling=0, slotLevel=null, linkedLevel=null }={}) {
  const own = level(base) ?? 0;
  const candidates = [own, own + (level(scaling) ?? 0), level(slotLevel), level(linkedLevel)].filter(v => v !== null);
  return Math.max(...candidates);
}

/**
 * §481: the casting level of a spell, as the conditions of the declarations read it (`spell.castLevel`,
 * `spell.castLevelAtMost`, `spell.castLevelAtLeast`). `castLevel` when the moment knows it (`castsSpell` gate: from the
 * use configuration, chosen slot included); otherwise the one the item carries (spell scaled by dnd5e, spell
 * cast by a "cast" activity, scroll). null outside a spell: a level condition then never holds.
 * @param {{castLevel?: number|null, isSpell?: boolean, level?: number|null, scaling?: number, linkedLevel?: number|null}} data
 * @returns {number|null}
 */
export function knownCastLevel({ castLevel=null, isSpell=false, level: base=null, scaling=0, linkedLevel=null }={}) {
  const given = level(castLevel);
  if ( given !== null ) return given;
  if ( !isSpell || ((level(base) === null) && (level(linkedLevel) === null)) ) return null;
  return castLevelOf({ level: base ?? 0, scaling, linkedLevel });
}

/** §481: is the spell cast at level `n` or lower ("a spell of level 3 or lower")? False when the level is unknown. */
export function castLevelAtMost(castLevel, n) {
  const cast = level(castLevel), max = level(n);
  return (cast !== null) && (max !== null) && (cast <= max);
}

/** §481: is the spell cast at level `n` or higher? False when the level is unknown. */
export function castLevelAtLeast(castLevel, n) {
  const cast = level(castLevel), min = level(n);
  return (cast !== null) && (min !== null) && (cast >= min);
}

/**
 * What happens to the countered spell: `auto` (it fails without a roll) or a check against `dc`.
 * @param {number} castLevel     Casting level of the countered spell.
 * @param {number} counterLevel  Level of the counterspell.
 * @returns {{castLevel: number, level: number, auto: boolean, dc: number|null}}
 */
export function counterPlan(castLevel, counterLevel) {
  const cast = level(castLevel) ?? 0;
  const lvl = level(counterLevel) ?? 0;
  return (cast <= lvl) ? { castLevel: cast, level: lvl, auto: true, dc: null } : { castLevel: cast, level: lvl, auto: false, dc: 10 + cast };
}

/**
 * Is the spell dispelled? Automatically if the plan says so; otherwise if the check took place and reaches the DC.
 * @param {{auto: boolean, dc: number|null}} plan
 * @param {number|null} total  Total of the ability check (null: no check).
 */
export function counterSucceeds(plan, total) {
  if ( plan?.auto ) return true;
  return Number.isFinite(total) && Number.isFinite(plan?.dc) && (total >= plan.dc);
}

/**
 * §344 (batch O8): absorbing a spell that targets only the bearer (Rod of Absorption, Staff of the Magi) — "a spell that
 * targets only you and does not produce an area of effect". A spell of at least level 1 (the stored energy, or the charges
 * gained, equal its level), a single target, no area; an item that pays per level (`costs`: the Rod) must have enough uses.
 * The item's activity is played at the spell's level: `scaling` = level − 1 (dnd5e "amount" consumption: one per level).
 * @param {{castLevel: number, targets: number, area: boolean, costs?: boolean, usesLeft?: number|null}} data
 * @returns {{scaling: number}|null}
 */
export function absorbPlan({ castLevel, targets, area, costs=false, usesLeft=null }={}) {
  const cast = level(castLevel) ?? 0;
  if ( (cast < 1) || (targets !== 1) || area ) return null;
  if ( costs && (usesLeft !== null) && (usesLeft < cast) ) return null;
  return { scaling: cast - 1 };
}
