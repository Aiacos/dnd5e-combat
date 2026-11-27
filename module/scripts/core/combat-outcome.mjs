/**
 * §555: what a combat leaves behind (runtime/combat-outcome.mjs). Pure.
 */

/**
 * A creature counts as defeated when it is dead (the `dead` status, Foundry's DEFEATED), marked defeated in the tracker, or, for a
 * creature that is not a player character, at 0 HP. A character at 0 HP is dying, not defeated.
 * @param {{ dead?: boolean, tracker?: boolean, hp?: number|null, character?: boolean }} state
 */
export function isDefeated({ dead=false, tracker=false, hp=null, character=false }={}) {
  if ( dead || tracker ) return true;
  return !character && (hp !== null) && (hp !== undefined) && Number.isFinite(Number(hp)) && (Number(hp) <= 0);
}

/** Was the combat actually played (begun, or past round 0)? A combat deleted before it began ends nothing. */
export function wasPlayed({ started=false, round=0 }={}) {
  return !!started || (Number(round) > 0);
}
