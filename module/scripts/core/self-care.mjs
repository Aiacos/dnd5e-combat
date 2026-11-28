/**
 * §278: what a creature gives itself at a moment of the turn — ending one of its conditions, removing a level of Exhaustion,
 * regaining item uses on the Initiative roll. Rule shapes and decisions, without Foundry (runtime/feats.mjs,
 * runtime/roll-bonus.mjs).
 */

/**
 * `endsOwnConditions`: the list of conditions (§236, Self-Restoration: at the end of the turn), or
 * `{ statuses?, at?, exhaustion?, uses? }` — `at`: "turnStart" | "turnEnd" (default); `exhaustion`: failing a condition, a level
 * of Exhaustion removed; `uses`: each time costs a use of the item (nothing without a remaining use).
 * @returns {{statuses: string[], at: "turnStart"|"turnEnd", exhaustion: boolean, uses: boolean}}
 */
export function ownConditionsRule(value) {
  if ( Array.isArray(value) ) return { statuses: value, at: "turnEnd", exhaustion: false, uses: false };
  return { statuses: value?.statuses ?? [], at: value?.at ?? "turnEnd", exhaustion: !!value?.exhaustion, uses: !!value?.uses };
}

/**
 * What the rule removes now: the first condition of the list that the creature has, otherwise a level of Exhaustion (if allowed).
 * @param {{statuses: Set<string>|string[], exhaustion: number, usesLeft?: number|null}} state  `usesLeft`: null = not counted
 * @returns {{status: string}|{exhaustion: true}|null}
 */
export function pickOwnCondition(rule, { statuses, exhaustion=0, usesLeft=null }) {
  if ( rule.uses && !(usesLeft > 0) ) return null;
  const has = new Set(statuses ?? []);
  const status = rule.statuses.find(s => has.has(s));
  if ( status ) return { status };
  if ( rule.exhaustion && (exhaustion > 0) ) return { exhaustion: true };
  return null;
}

/**
 * `regainOnInitiative`: `{ item, upTo }` (§236, Superior Inspiration: the item's uses go back up to at least `upTo`), or
 * `{ items?, exhaustion?, uses? }` — `items`: identifiers of items whose uses all come back; `exhaustion`: levels
 * of Exhaustion removed; `uses`: costs a use of the item that carries the rule, and only happens if there is something to gain.
 * Or `{ items, activity }` (Supernatural Metabolism): nothing is written here — the named activity of the item that carries the
 * rule does the work (its consumptions, its healing), offered to the player when one of the `items` has spent uses and the
 * rule's item has one left.
 * @param {object} rule
 * @param {{items: Record<string, {max: number, spent: number}>, exhaustion: number, usesLeft?: number|null}} state
 *   `items`: by identifier
 * @returns {{spent: Record<string, number>, exhaustion: number|null, pay: boolean, use?: string, back?: number}|null}  the
 *   new values of `uses.spent` by identifier, the new Exhaustion level (null: unchanged), and whether to pay; with `use`,
 *   the activity to offer (`back`: what it would give back); null: nothing to do
 */
export function initiativeRegain(rule, { items={}, exhaustion=0, usesLeft=null }) {
  if ( rule.activity ) {
    const back = (rule.items ?? []).reduce((n, id) => n + (items[id]?.max ? (items[id].spent || 0) : 0), 0);
    if ( !back || ((usesLeft !== null) && !(usesLeft > 0)) ) return null;
    return { spent: {}, exhaustion: null, pay: false, use: rule.activity, back };
  }
  const spent = {};
  if ( rule.item ) {
    const s = items[rule.item];
    if ( s?.max ) {
      const want = Math.min(rule.upTo, s.max);
      if ( (s.max - (s.spent || 0)) < want ) spent[rule.item] = s.max - want;
    }
  }
  for ( const id of rule.items ?? [] ) if ( items[id]?.max && (items[id].spent > 0) ) spent[id] = 0;
  const level = (rule.exhaustion > 0) && (exhaustion > 0) ? Math.max(0, exhaustion - rule.exhaustion) : null;
  if ( !Object.keys(spent).length && (level === null) ) return null;
  if ( rule.uses && !(usesLeft > 0) ) return null;
  return { spent, exhaustion: level, pay: !!rule.uses };
}

/**
 * `turnStartHeal` (Survivor, Heroic Surge: "at the start of each of your turns, you regain Hit Points if you are
 * Bloodied and have at least 1 Hit Point"): is the healing activity played at this start of turn? Bloodied: half the
 * Hit Points or fewer. Without `bloodied`, as soon as Hit Points are missing.
 * @param {{bloodied?: true}} rule
 * @param {{hp: number, max: number}} state
 */
export function turnStartHealDue(rule, { hp, max }) {
  if ( !rule || !(hp >= 1) || !(max > 0) || (hp >= max) ) return false;
  return rule.bloodied ? (hp <= Math.floor(max / 2)) : true;
}

/**
 * `deathSaveCritical` (Survivor, Defy Death: "an 18 to 20 on a death saving throw counts as a 20"): the threshold that applies
 * to the creature — the lowest of those its items declare, or null.
 * @param {Array<number|undefined|null>} declared
 * @returns {number|null}
 */
export function deathSaveCriticalOf(declared) {
  const valid = (declared ?? []).filter(n => Number.isInteger(n) && (n >= 2) && (n <= 19));
  return valid.length ? Math.min(...valid) : null;
}
