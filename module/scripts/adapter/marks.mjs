/**
 * Marks local to the client that plays a reaction (SPEC §19.6): what the chosen reaction promises to the roll that follows
 * it, for the duration of that roll. For example a riposte: an attack against that enemy, with Advantage. The reaction's
 * activity is used right after (adapter/reactions.mjs, `handleReactionQuery`) and its attack roll follows on that same
 * client; the Advantage is declared there (adapter/triggers.mjs, `declaredAttackModifiers`). The mark drops at the roll, or by
 * itself.
 */

/** A mark's lifetime without a roll (reaction cancelled, window closed). */
const LIFETIME_MS = 30000;

/**
 * §438 continued: places a mark and its timer. A new mark on the same activity replaces the old one AND its timer —
 * without which the timer of a missed Riposte erased the mark of a following Riposte (the superiority die lost, seen on the
 * test bench).
 */
const timers = new WeakMap();
function put(map, key, value, ms) {
  clearTimeout(timers.get(map)?.get(key));
  map.set(key, value);
  if ( !timers.has(map) ) timers.set(map, new Map());
  timers.get(map).set(key, setTimeout(() => { map.delete(key); timers.get(map)?.delete(key); }, ms));
}
function take(map, key) {
  const value = map.get(key) ?? null;
  map.delete(key);
  clearTimeout(timers.get(map)?.get(key));
  timers.get(map)?.delete(key);
  return value;
}

const advantaged = new Map();

/** The activity `uuid`, used as a reaction, attacks with Advantage (in the name of `name`). */
export function markReactionAdvantage(uuid, name) {
  put(advantaged, uuid, name, LIFETIME_MS);
}

/** The name of the reaction that gives Advantage to this roll of the activity `uuid`, or null; the mark is consumed. */
export function takeReactionAdvantage(uuid) {
  return take(advantaged, uuid);
}

/** Without consuming it: does the activity have an Advantage mark? */
export const hasReactionAdvantage = uuid => advantaged.has(uuid);

/** §134: the counterpart — a reaction played with Disadvantage (Opportunity Attack against a "Swift" bearer). */
const hampered = new Map();
export function markReactionDisadvantage(uuid, name) {
  put(hampered, uuid, name, LIFETIME_MS);
}
export const hasReactionDisadvantage = uuid => hampered.has(uuid);
export function takeReactionDisadvantage(uuid) {
  return take(hampered, uuid);
}

/* -------------------------------------------- */

/**
 * §88: Battle Master's Riposte — "if you hit, add the superiority die to the attack's damage": the formula (already
 * rolled with the actor's data, "1d8") promised to the damage roll of the activity `uuid`, on this client; consumed at the roll.
 */
const damaged = new Map();

export function markReactionDamage(uuid, formula, name) {
  put(damaged, uuid, { formula, name, attacked: false }, LIFETIME_MS * 2);
}

/**
 * §438 continued: the promised die applies only to the reaction's own attack. At the first attack roll of the marked weapon, the
 * mark waits for the damage of THAT attack; a second attack roll of the same weapon before any damage roll means that the
 * Riposte did not land (missed), the mark drops. Otherwise a missed Riposte left its die to the next hit of the same weapon
 * within the minute. A miss does NOT make it drop at its roll: Lucky, Heroic or Bardic Inspiration, success at a cost can still
 * turn it into a hit after that roll (they reroll or add without a new attack roll), and its damage must keep the die.
 * Returns true if the mark dropped.
 */
export function noteReactionAttack(uuid) {
  const mark = damaged.get(uuid);
  if ( !mark ) return false;
  if ( mark.attacked ) { take(damaged, uuid); return true; }
  mark.attacked = true;
  return false;
}

/** The formula promised to the damage roll of the activity `uuid`, or null; the mark is consumed. */
export function takeReactionDamage(uuid) {
  const mark = take(damaged, uuid);
  return mark ? { formula: mark.formula, name: mark.name } : null;
}
