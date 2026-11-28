/**
 * Weapon Mastery (Player's Handbook 2024; SPEC §21). dnd5e 6 notes the mastery used on the attack message
 * (`system.mastery`) without doing anything with it; the engine draws the consequences. Pure functions.
 *
 *  - Cleave: after a melee hit, a second melee attack with the same weapon, against another creature within reach and within 5 feet
 *    of the first; its damage adds the ability modifier only if it is
 *    negative. Once per turn.
 *  - Graze: a missed attack still deals, of the weapon's type, as much damage as the attack's ability
 *    modifier.
 *  - Nick: held by the turn budget (core/turn.mjs).
 *  - Push: on a hit, a target of Large size or smaller can be pushed up to 10 feet away in a straight line.
 *  - Sap: on a hit, Disadvantage on the target's next attack, until the start of the attacker's next turn.
 *  - Slow: on a hit that deals damage, -10 feet of Speed until the start of the attacker's next turn, no stacking
 *    beyond 10 feet.
 *  - Topple: on a hit, Constitution saving throw (DC 8 + attack modifier + Proficiency Bonus);
 *    on a failure, the target falls Prone.
 *  - Vex: on a hit that deals damage, Advantage on the next attack against this target, until the end of the
 *    attacker's next turn.
 */

export const MASTERIES = Object.freeze(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]);

/** dnd5e size ranks, for "Large or smaller". */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/**
 * What the mastery does after this attack, for a target.
 * @param {string|null} mastery
 * @param {object} outcome
 * @param {boolean} outcome.hit          The target was hit.
 * @param {boolean} outcome.damaged      It lost HP (or Temporary Hit Points).
 * @param {boolean} outcome.melee        Melee attack (not thrown).
 * @param {string|null} outcome.size     Its size (dnd5e key).
 * @param {boolean} outcome.down         It is at 0 HP.
 * @param {boolean} [outcome.cleaveSpent] Cleave already used this turn.
 * @returns {"cleave"|"graze"|"push"|"sap"|"slow"|"topple"|"vex"|null}
 */
export function masteryEffect(mastery, { hit, damaged, melee, size, down, cleaveSpent=false }) {
  if ( !MASTERIES.includes(mastery) || (mastery === "nick") ) return null;
  if ( mastery === "graze" ) return hit ? null : "graze";
  if ( !hit ) return null;
  if ( mastery === "cleave" ) return (melee && !cleaveSpent) ? "cleave" : null;
  if ( down ) return null;   // a creature at 0 HP: no push, no mark, no saving throw
  if ( mastery === "push" ) return ((SIZE_RANK[size] ?? 2) <= SIZE_RANK.lg) ? "push" : null;
  if ( ["slow", "vex"].includes(mastery) ) return damaged ? mastery : null;
  return mastery;
}

/** Graze: the damage, equal to the modifier (nothing if it is zero or negative). */
export const grazeDamage = mod => Math.max(0, Number(mod) || 0);

/** Renversement : le DD de la sauvegarde de Constitution. */
export const toppleDC = (mod, prof) => 8 + (Number(mod) || 0) + (Number(prof) || 0);

/**
 * Cleave: the second attack's damage is rolled without the ability modifier, "unless that modifier is negative".
 * @param {number} mod
 */
export const cleaveModifier = mod => Math.min(0, Number(mod) || 0);

/**
 * When a mastery mark falls, on the turn of whoever placed it (`source`). Sap and Slow: at the start of their next
 * turn. Vex (and the Fighter's Studied Attacks, "studied"): at the end of their next turn — not at the end of the very
 * turn in which it was placed.
 * Barbarian's Recklessness ("reckless", §22): at the start of their next turn, like Sap.
 * @param {"sap"|"slow"|"vex"|"studied"|"reckless"} kind
 * @param {{moment: "turnStart"|"turnEnd", sourceTurn: boolean, turnKey: string|null, placedOn: string|null}} event
 */
export function markExpires(kind, { moment, sourceTurn, turnKey, placedOn }) {
  if ( !sourceTurn ) return false;
  if ( (kind === "vex") || (kind === "studied") ) return (moment === "turnEnd") && (turnKey !== placedOn);
  return moment === "turnStart";
}

/* -------------------------------------------- */
/*  Les bottes choisies (§222)                  */
/* -------------------------------------------- */

/**
 * Classes whose feature lets only one mastery be changed after a Long Rest (Fighter: "change one of those weapon choices");
 * the others (Barbarian, Paladin, Ranger, Rogue, Weapon Master feat) change all of theirs.
 */
const ONE_CHANGE = Object.freeze(["fighter"]);
/** Classes whose masteries go only to melee weapons (Barbarian: "Simple or Martial Melee weapons"). */
const MELEE_ONLY = Object.freeze(["barbarian"]);

/**
 * An actor's mastery sources, one per item: the "Trait" advancements in "mastery" mode of its classes and subclasses
 * (up to its class level) and of its feats (always). The number of an advancement: its choices and its automatic grants.
 * @param {Array<{item: string, label: string, identifier: string, kind: string, classLevel: number|null,
 *   advancements: Array<{level: number, count: number}>}>} items
 * @returns {Array<{item: string, label: string, identifier: string, count: number, melee: boolean, changes: number}>}
 */
export function masterySources(items) {
  const out = [];
  for ( const it of items ?? [] ) {
    const counted = ["class", "subclass"].includes(it.kind) && Number.isFinite(it.classLevel);
    const count = (it.advancements ?? []).filter(a => !counted || ((Number(a.level) || 0) <= it.classLevel))
      .reduce((n, a) => n + Math.max(0, Number(a.count) || 0), 0);
    if ( count <= 0 ) continue;
    out.push({ item: it.item, label: it.label, identifier: it.identifier ?? "", count,
      melee: MELEE_ONLY.includes(it.identifier), changes: ONE_CHANGE.includes(it.identifier) ? 1 : count });
  }
  return out;
}

/** Le nombre de bottes que l'acteur peut choisir. */
export const masterySlots = sources => (sources ?? []).reduce((n, s) => n + s.count, 0);

/** Le nombre de bottes qu'un Repos long laisse changer. */
export const restChanges = sources => (sources ?? []).reduce((n, s) => n + s.changes, 0);

/** How many of the earlier masteries are no longer chosen. */
export const removedCount = (before, after) => (before ?? []).filter(k => !(after ?? []).includes(k)).length;

/**
 * §510 (Discord, Fanarie): what the Long Rest still lets one change once the current choice is counted — the flag (`allowance`,
 * already reduced by the recorded changes) minus the masteries that the selection removes. Never negative.
 */
export const allowanceLeft = (allowance, before, after) => Math.max(0, (Math.max(0, Number(allowance) || 0)) - removedCount(before, after));

/**
 * Does the choice `after` respect the rules? Reasons, in order:
 *  - `notProficient`: a weapon that the actor is not proficient with ("with which you have proficiency");
 *  - `tooMany`: more masteries than its sources give;
 *  - `melee`: too many ranged weapons for the places that accept them (Barbarian: melee only);
 *  - `changes`: more masteries removed than the Long Rest allows (`allowance`; outside a rest, 0).
 * A mastery already chosen is not re-judged for `notProficient` (proficiency since lost); a weapon absent from `weapons` (index not
 * yet read, weapon of another module) is judged only on the number.
 * @param {{before: string[], after: string[], weapons: Record<string, {melee: boolean, proficient: boolean}>,
 *   sources: object[], allowance: number}} input
 * @returns {{ok: boolean, reason: string|null, slots: number, removed: number}}
 */
export function masteryVerdict({ before=[], after=[], weapons={}, sources=[], allowance=0 }) {
  const slots = masterySlots(sources);
  const removed = removedCount(before, after);
  const verdict = reason => ({ ok: !reason, reason, slots, removed });
  if ( after.some(k => !before.includes(k) && weapons[k] && !weapons[k].proficient) ) return verdict("notProficient");
  if ( after.length > slots ) return verdict("tooMany");
  const anywhere = sources.filter(s => !s.melee).reduce((n, s) => n + s.count, 0);
  if ( after.filter(k => weapons[k] && !weapons[k].melee).length > anywhere ) return verdict("melee");
  if ( removed > Math.max(0, Number(allowance) || 0) ) return verdict("changes");
  return verdict(null);
}

/* -------------------------------------------- */
/*  Standing mastery per weapon (§537, #160)    */
/* -------------------------------------------- */

/**
 * Tactical Master (Fighter 9, PHB 2024) and any other source of bonus masteries (dnd5e `weaponProf.mastery.bonus`): when the
 * weapon offers more than one mastery, the player picks one once per weapon and the engine uses it at every attack, until they change
 * it (user's choice on issue #160, option 3: no question at each attack).
 *
 * The mastery an attack with this weapon uses: the stored choice when the weapon still offers it, otherwise the weapon's own (the
 * first option, as dnd5e orders them). Null when there is nothing to choose (no option, or only the weapon's own): dnd5e keeps its
 * default.
 * @param {string[]|null} options   The weapon's mastery options, its own first (dnd5e `masteryOptions` values).
 * @param {string|null} chosen      The stored choice.
 * @returns {string|null}
 */
export function standingMastery(options, chosen) {
  if ( !Array.isArray(options) || (options.length < 2) ) return null;
  return options.includes(chosen) ? chosen : options[0];
}

/**
 * The value to store for a new choice: null when it is the weapon's own mastery (nothing to remember), the choice otherwise. An
 * option the weapon does not offer is refused (`undefined`).
 * @param {string[]|null} options
 * @param {string|null} choice
 * @returns {string|null|undefined}
 */
export function standingChoiceToStore(options, choice) {
  if ( !Array.isArray(options) || !options.includes(choice) ) return undefined;
  return (choice === options[0]) ? null : choice;
}
