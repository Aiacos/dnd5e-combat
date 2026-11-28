/**
 * §492: who attacked whom, during the current combat turn — pure rule. The registry lives on the Combat
 * (adapter/attacked-this-turn.mjs); it keeps only one turn: the first attack of another turn starts from an empty registry.
 *
 * Registry: `{ turn: "<combat>.<round>.<turn>", attacks: [{ source, target, kinds: ["melee"?, "ranged"?] }] }` (actor uuids: an
 * unlinked token has its own). A list, not an object per pair: `setFlag` merges objects, a list is replaced whole.
 * The fact `source.attackedSelfThisTurn` reads it: "when a hostile creature ends its turn after attacking it in melee".
 */

export const ATTACK_KINDS = Object.freeze(["melee", "ranged"]);

/**
 * The kind of an attack: "melee" for a melee-type activity attack that is neither thrown nor fired (same rule as dnd5e,
 * data/activity/attack-data.mjs, `getRollData`: `roll.attack.type`, and as the fact `activity.isMelee`), "ranged" otherwise;
 * null outside an attack.
 */
export function attackKindOf({ activityType=null, attackType=null, attackMode=null }={}) {
  if ( activityType !== "attack" ) return null;
  const thrownOrRanged = !!attackMode && (String(attackMode).includes("thrown") || (attackMode === "ranged"));
  return ((attackType === "melee") && !thrownOrRanged) ? "melee" : "ranged";
}

/**
 * The registry after an attack. Another turn erases the previous one; a pair keeps each kind once.
 * @returns {object|null}  The new registry, or null if there is nothing to note (unknown turn, source, target or kind).
 */
export function recordAttack(log, { turn, source, targets=[], kind }) {
  if ( !turn || !source || !ATTACK_KINDS.includes(kind) ) return null;
  const list = [targets].flat().filter(t => t && (t !== source));
  if ( !list.length ) return null;
  const attacks = (log?.turn === turn) ? (log.attacks ?? []).map(a => ({ ...a, kinds: [...(a.kinds ?? [])] })) : [];
  for ( const target of list ) {
    let entry = attacks.find(a => (a.source === source) && (a.target === target));
    if ( !entry ) attacks.push(entry = { source, target, kinds: [] });
    const kinds = new Set([...entry.kinds, kind]);
    entry.kinds = ATTACK_KINDS.filter(k => kinds.has(k));
  }
  return { turn, attacks };
}

/** The attack kinds of `source` against `target` during this turn (`[]`: none, or the registry of another turn). */
export function attacksDuring(log, { turn, source, target }) {
  if ( !turn || !source || !target || (log?.turn !== turn) ) return [];
  return [...((log.attacks ?? []).find(a => (a.source === source) && (a.target === target))?.kinds ?? [])];
}

/**
 * The condition: `true` (an attack, whatever its kind), `false` (none), `"melee"` / `"ranged"` or a list of kinds (at least one
 * of them).
 */
export function attackedMatches(kinds, want) {
  if ( !validAttackedArg(want) ) return false;
  if ( (want === true) || (want === false) ) return (kinds.length > 0) === want;
  const wanted = [want].flat();
  return kinds.some(k => wanted.includes(k));
}

/** Is the value of the condition valid? (Content validation.) */
export function validAttackedArg(want) {
  if ( typeof want === "boolean" ) return true;
  const list = [want].flat();
  return list.length > 0 && list.every(k => ATTACK_KINDS.includes(k));
}
