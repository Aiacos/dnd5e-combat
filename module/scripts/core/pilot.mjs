/**
 * Piloted summon (SPEC §16.15, B19): a summoned object that the caster commands during THEIR turn — Spiritual Weapon,
 * Flaming Sphere, Bigby's Hand. "As a Bonus Action on your later turns, you can move [the object] X m
 * and [act]": a COMMAND costs the declared activation (the Bonus Action) to the caster, and opens a bounded move plus
 * one use of an activity of the object, which closes it. On the turn of casting, `onCast` gives a free
 * command: `use` (Spiritual Weapon attacks "immediately", without moving) or `command` (Bigby's Hand moves and acts).
 *
 * A command's state is kept per object and per caster turn (`turn` = turn key); a state from another turn does not
 * count. The three spells say "move … then act": the use closes the command's move (Flaming Sphere
 * "stops for the turn" on hitting a creature). Pure functions.
 */

/**
 * @typedef {object} CommandState
 * @property {string} turn     Key of the caster's turn where the command was paid.
 * @property {boolean} paid    A command is open this turn (paid, or offered at casting).
 * @property {boolean} move    It allows moving the object.
 * @property {number} used     Activity uses made in this command (one at most).
 */

/** The state valid for this turn, or null. */
export function currentCommand(state, turnKey) {
  return (state && (state.turn === turnKey)) ? state : null;
}

/**
 * What a gesture of the piloted object costs, and the resulting state. A gesture that the open command no longer covers
 * (second attack, move after a free casting attack) opens a new one, at the price of `cost`: the
 * caster's budget will then say whether enough remains to pay.
 * @param {CommandState|null} state  The turn's state (`currentCommand`).
 * @param {"move"|"use"} gesture
 * @param {string} cost              Activation of a command ("bonus").
 * @param {string} turnKey
 * @returns {{pay: string|null, next: CommandState}}
 */
export function planCommand(state, gesture, cost, turnKey) {
  const open = currentCommand(state, turnKey);
  if ( gesture === "use" ) {
    if ( open?.paid && ((open.used ?? 0) < 1) ) return { pay: null, next: { ...open, move: false, used: 1 } };
    return { pay: cost, next: { turn: turnKey, paid: true, move: false, used: 1 } };
  }
  if ( open?.paid && open.move ) return { pay: null, next: open };
  return { pay: cost, next: { turn: turnKey, paid: true, move: true, used: 0 } };
}

/** The command offered on the turn of casting (`onCast`), or null. */
export function castCommand(onCast, turnKey) {
  if ( !onCast ) return null;
  return { turn: turnKey, paid: true, move: onCast === "command", used: 0 };
}

/**
 * §38.2: Trickster's Transposition (Trickery 6) — the Bonus Action that creates or moves the illusion of Invoke Duplicity also lets
 * the cleric swap places with it by teleportation. Out of combat: always. In combat: during the caster's
 * turn, once per turn, if the illusion was created this turn (`createdTurn`) or moved by a command paid this turn.
 * @param {{inCombat: boolean, ownTurn: boolean, turnKey: string|null, command: CommandState|null, createdTurn: string|null,
 *   usedTurn: string|null}} state
 * @returns {boolean}
 */
export function canTranspose({ inCombat, ownTurn, turnKey, command, createdTurn=null, usedTurn=null }) {
  if ( !inCombat ) return true;
  if ( !ownTurn || !turnKey || (usedTurn === turnKey) ) return false;
  const moved = !!command && (command.turn === turnKey) && command.paid && command.move;
  return moved || (createdTurn === turnKey);
}
/**
 * Index of the next turn to play when some combatants do not play (piloted objects: they act during the turn
 * of their caster). `direction`: 1 going forward, -1 going back. Returns -1 or `skip.length` if one leaves the round.
 * @param {boolean[]} skip   For each turn, in combat order: is this combatant skipped?
 * @param {number} from      Turn targeted by the core.
 * @param {1|-1} direction
 */
export function nextPlayableTurn(skip, from, direction=1) {
  let turn = from;
  while ( (turn >= 0) && (turn < skip.length) && skip[turn] ) turn += direction;
  return turn;
}
