/**
 * At 0 Hit Points (2024 rules, PHB "Dropping to 0 Hit Points"). Pure functions, no dependency on Foundry.
 *
 * What dnd5e 6.0.3 already does, and is NOT taken over here:
 *  - the Unconscious condition at 0 HP (which carries Incapacitated and adds Prone), Dead for an ordinary NPC, depending on the
 *    "Auto-Apply Downed" setting (documents/actor/actor.mjs, `updateDowned`), and their removal when HP rises again —
 *    but **in combat only, and not at all with the "none" setting**: the engine guarantees it everywhere (§17.1,
 *    `downedStatus`);
 *  - the death saving throw itself: successes and failures counted, natural 20 = 1 HP, natural 1 = two
 *    failures, three successes = counters reset to zero (data/actor/templates/attributes.mjs, `applyDeathSaveResult`).
 *
 * What the engine adds (here the rule, the adapter writes it):
 *  - "Damage at 0 Hit Points": one failure, two on a Critical Hit, death if the damage reaches the max HP;
 *  - "Instant Death": dropping to 0 HP with remaining damage at least equal to the max HP;
 *  - the death save at the start of the turn, as long as the creature is neither stabilized nor dead;
 *  - Stable after three successes (the system resets the counters without saying so), Dead after three failures.
 */

/** Failures that kill. */
export const DEATH_FAILURES = 3;

/**
 * Does the creature make death saving throws? PCs, and the NPCs that dnd5e marks "important"
 * (the others die at 0 HP, the system sets that).
 * @param {{type: string, important?: boolean}} actor
 */
export function makesDeathSaves({ type, important=false }) {
  return (type === "character") || ((type === "npc") && important);
}

/**
 * What damage does to a creature from the point of view of death.
 * @param {object} state
 * @param {number} state.hp         HP before the damage (excluding Temporary Hit Points).
 * @param {number} state.max        Maximum HP.
 * @param {number} state.through    Damage that gets past Temporary Hit Points (after Resistances).
 * @param {boolean} [state.critical]
 * @param {number} [state.failures] Failures already suffered.
 * @param {boolean} state.saves     The creature makes death saves (`makesDeathSaves`).
 * @returns {{failures: number|null, added: number, dead: boolean, reason: "massive"|"failures"|null, unstable: boolean}}
 *   `failures`: new total of failures to write (null = unchanged); `unstable`: a stabilized creature no longer is.
 */
export function damageAtZero({ hp, max, through, critical=false, failures=0, saves }) {
  const none = { failures: null, added: 0, dead: false, reason: null, unstable: false };
  if ( !saves || !(through > 0) || !(max > 0) ) return none;
  // Dropping to 0: only remaining damage at least equal to the max HP kills; otherwise the creature falls unconscious (the system).
  if ( hp > 0 ) {
    const remainder = through - hp;
    return (remainder > 0) && (remainder >= max) ? { ...none, dead: true, reason: "massive" } : none;
  }
  // Already at 0: damage at least equal to the max HP kills; otherwise one failure, two on a Critical Hit.
  if ( through >= max ) return { ...none, dead: true, reason: "massive", unstable: true };
  const added = critical ? 2 : 1;
  const total = Math.min(DEATH_FAILURES, failures + added);
  return { failures: total, added, dead: total >= DEATH_FAILURES, reason: total >= DEATH_FAILURES ? "failures" : null, unstable: true };
}

/**
 * The condition that a creature at 0 HP must carry and does not yet (§17.1, user request 2026-09-26: "a
 * creature at 0 HP must necessarily have the Dead condition; a PC, Unconscious, Incapacitated, Prone"). Dead for whoever does not
 * make death saves or has failed three; Unconscious otherwise (dnd5e adds Incapacitated and Prone to it).
 * `regenerates` (§18.13): "the troll dies only if it starts its turn at 0 HP without regenerating" — Unconscious until then.
 * @param {{hp: number, saves: boolean, statuses: string[], failures?: number, regenerates?: boolean}} state
 * @returns {"dead"|"unconscious"|null}
 */
export function downedStatus({ hp, saves, statuses, failures=0, regenerates=false }) {
  if ( !(hp <= 0) || statuses.includes("dead") ) return null;
  if ( (!saves && !regenerates) || (failures >= DEATH_FAILURES) ) return "dead";
  return statuses.includes("unconscious") ? null : "unconscious";
}

/**
 * Is the creature dead? The Dead condition, or 0 HP for a creature that does not make death saves (the condition
 * may be missing for a moment: it is set after the HP write).
 * @param {{hp: number, saves: boolean, statuses: string[]}} state
 */
export function isDead({ hp, saves, statuses }) {
  return statuses.includes("dead") || (!saves && (hp <= 0));
}

/**
 * Is a death save needed at the start of its turn?
 * @param {object} state
 * @param {number} state.hp
 * @param {boolean} state.saves     `makesDeathSaves`.
 * @param {string[]} state.statuses
 * @param {number} [state.failures]
 * @param {number} [state.successes]
 */
export function needsDeathSave({ hp, saves, statuses, failures=0, successes=0 }) {
  if ( !saves || (hp > 0) ) return false;
  if ( statuses.includes("dead") || statuses.includes("stable") ) return false;
  return (failures < DEATH_FAILURES) && (successes < DEATH_FAILURES);
}

/**
 * What the engine sets after a death save, from the outcome that dnd5e gives it
 * (`dnd5e.rollDeathSave`: "stable", "death", "revive" or null).
 * @returns {"stable"|"dead"|null}
 */
export function statusAfterDeathSave(outcome) {
  if ( outcome === "stable" ) return "stable";
  if ( outcome === "death" ) return "dead";
  return null;
}

/**
 * §50: can this creature be stabilized (healer's kit: "stabilize an Unconscious creature at 0 Hit Points")?
 * At 0 HP, neither dead nor already stable.
 * @param {{hp: number, statuses: string[]}} state
 */
export function canStabilize({ hp, statuses }) {
  return (hp <= 0) && !statuses.includes("dead") && !statuses.includes("stable");
}
