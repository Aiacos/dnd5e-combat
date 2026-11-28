/**
 * §403: Freedom of Movement — "the target's Speed cannot be reduced by magic". The changes of an effect that
 * would reduce a Speed: negative add, multiplication by less than 1, forced value ("override", "downgrade": Irresistible Dance,
 * Slow…) on `system.attributes.movement.*`. Pure.
 */

// §438: dnd5e 6.1 (Player's Handbook 3.0.0) adds `movement.multiplier` (Slow: ×0.5) and `movement.bonus`, and the "subtract" type.
const MOVEMENT = /^system\.attributes\.movement\.(walk|fly|swim|climb|burrow|speed|all|bonus|multiplier)$/;

/** Does this change reduce a Speed? */
export function reducesSpeed(change) {
  if ( !MOVEMENT.test(change?.key ?? "") ) return false;
  const value = Number(change.value);
  switch ( change.type ?? change.mode ) {
    case "add": case 2: return Number.isFinite(value) && (value < 0);
    case "subtract": return Number.isFinite(value) && (value > 0);
    case "multiply": case 1: return Number.isFinite(value) && (value < 1);
    case "override": case 5: case "downgrade": case 3: return true;
    default: return false;
  }
}

/** The changes without those that reduce a Speed. */
export function withoutSpeedReductions(changes) {
  return (changes ?? []).filter(c => !reducesSpeed(c));
}
