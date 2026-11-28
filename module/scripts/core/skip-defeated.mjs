/**
 * Skip the turns of defeated NPCs (2026-11-28, user's request: « the carousel passes defeated NPCs automatically »). Pure.
 *
 * When the turn moves forward onto a creature that is not a player character and is defeated (core/combat-outcome.mjs `isDefeated`:
 * dead, ticked defeated in the tracker, or at 0 HP), the turn goes on to the next creature that is not. Player characters are never
 * skipped (at 0 HP they make death saving throws), nor initiative events. Foundry's own « Skip defeated » combat setting only reads the
 * tracker and the dead status; this one also passes an NPC left at 0 HP.
 */

/**
 * Where the turn should go instead of `current`, or null to stay.
 * @param {{ skip: boolean }[]} turns           The combat's turns in order (`combat.turns`): `skip` true for a defeated NPC.
 * @param {{ round: number, turn: number }} current
 * @returns {{ round: number, turn: number }|null}  null when the current turn is not skipped, or when every turn would be (nobody left
 *   to play: the turn stays, the GM ends the combat).
 */
export function skipTarget(turns, current) {
  const list = Array.isArray(turns) ? turns : [];
  const n = list.length;
  const at = Number(current?.turn);
  const round = Number(current?.round) || 0;
  if ( !n || !Number.isInteger(at) || (at < 0) || (at >= n) || !list[at]?.skip ) return null;
  for ( let step = 1; step < n; step++ ) {
    const index = (at + step) % n;
    if ( list[index]?.skip ) continue;
    return { round: round + Math.floor((at + step) / n), turn: index };
  }
  return null;
}
