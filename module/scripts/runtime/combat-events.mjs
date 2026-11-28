/**
 * §250: events in the Initiative — a temporary combat entry that is not a creature (a trap, a lair action, the end of a spell,
 * reinforcements): a combatant with no token or actor, at a fixed Initiative, marked `flags.dnd5e-combat.event`. The engine never
 * takes it for a creature (no rule reads its actor: it has none). When its turn comes, the active GM emits
 * `dnd5e-combat.eventTurn` (`{ combat, combatant, key, data }`): the neighbour that placed it acts, then passes the turn. It leaves
 * the combat on its own after its last round (`rounds`), at the end of its turn.
 *
 * Public API (`api.combat`): `addEvent({ combat, name, img, initiative, rounds, key, data, hidden })` → the combatant;
 * `removeEvent(keyOrCombatant, combat)`; `events(combat)`; `isEvent(combatant)`. GM only to write.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { eventRounds, eventEnded } from "../core/combat-events.mjs";

/**
 * §250: on the active GM, when the turn of an Initiative event comes (`api.combat.addEvent`): `({ combat, combatant, key, data
 * })` — for the module that placed it to act, then pass the turn. Once per turn.
 */
export const EVENT_TURN_HOOK = `${MODULE_ID}.eventTurn`;

/** An event of the combat (not a creature)? */
export const isEvent = combatant => !!combatant?.getFlag?.(MODULE_ID, "event");

/** The events of a combat. */
export const events = (combat=game.combat) => (combat?.combatants ?? []).filter(isEvent);

/**
 * Add an event to the combat. `rounds`: how many rounds it plays from the current round (1 by default: this round only;
 * null: until removed). An event with the same `key` already there is replaced.
 * @returns {Promise<Combatant|null>}
 */
export async function addEvent({ combat=game.combat, name, img=null, initiative=20, rounds=1, key=null, data={}, hidden=false }={}) {
  if ( !game.user.isGM || !combat ) return null;
  if ( key ) await removeEvent(key, combat);
  const { from, until } = eventRounds(combat.round, rounds);
  const [created] = await combat.createEmbeddedDocuments("Combatant", [{
    name: name || game.i18n.localize("DND5ECOMBAT.Evenement.Nom"),
    img: img || "icons/svg/clockwork.svg",
    initiative: Number.isFinite(Number(initiative)) ? Number(initiative) : 20,
    hidden: hidden === true,
    flags: { [MODULE_ID]: { event: { key, from, until, data } } }
  }]);
  log(`initiative event "${created?.name}" added (initiative ${created?.initiative}, rounds ${from}–${until ?? "∞"})`);
  return created ?? null;
}

/** Remove an event (by its key or the combatant). */
export async function removeEvent(target, combat=game.combat) {
  if ( !game.user.isGM || !combat ) return 0;
  const ids = events(combat).filter(c => (c === target) || (c.id === target) || (c.getFlag(MODULE_ID, "event")?.key === target)).map(c => c.id);
  if ( ids.length ) await combat.deleteEmbeddedDocuments("Combatant", ids);
  return ids.length;
}

/** On the active GM, at each turn change: the event whose turn it is is announced; the one that just finished its last round leaves. */
async function onTurnChange(combat, prior, current) {
  const previous = combat.combatants.get(prior?.combatantId);
  if ( isEvent(previous) && eventEnded(previous.getFlag(MODULE_ID, "event"), prior?.round) ) {
    await removeEvent(previous, combat);
  }
  // A skipped round (the GM advances two rounds): what finished long ago leaves too.
  const stale = events(combat).filter(c => (c !== combat.combatant) && eventEnded(c.getFlag(MODULE_ID, "event"), (combat.round ?? 1) - 1));
  for ( const c of stale ) await removeEvent(c, combat);
  announce(combat);
}

/** At the start of combat: the first turn may be an event's. */
function onCombatStart(combat) {
  announce(combat);
}

const announced = new Set();

function announce(combat) {
  const combatant = combat?.combatant;
  if ( !isEvent(combatant) ) return;
  const key = `${combat.id}:${combat.round}:${combat.turn}:${combatant.id}`;
  if ( announced.has(key) ) return;
  announced.add(key);
  const event = combatant.getFlag(MODULE_ID, "event");
  if ( Number.isFinite(event?.from) && ((combat.round ?? 1) < event.from) ) return;
  log(`initiative event "${combatant.name}": its turn (round ${combat.round})`);
  Hooks.callAll(EVENT_TURN_HOOK, { combat, combatant, key: event?.key ?? null, data: event?.data ?? {} });
}

export const combatApi = Object.freeze({ addEvent, removeEvent, events, isEvent });

export function registerCombatEvents() {
  route("combatTurnChange", onTurnChange, { executor: true, label: "initiative event not announced" });
  route("combatStart", onCombatStart, { executor: true, label: "initiative event not announced" });
  route("deleteCombat", combat => { for ( const k of [...announced] ) if ( k.startsWith(`${combat.id}:`) ) announced.delete(k); });
  // §256: dnd5e recovers each combatant's uses at the start, at each turn and at the end of combat (`recoverCombatUses`) by
  // writing on its actor — an event has none: without this refusal, an error every time ("performBulkUpdate" of null).
  route("dnd5e.preCombatRecovery", combatant => (isEvent(combatant) ? false : undefined),
    { cancellable: true, always: true, label: "initiative event: no combat recovery" });
}
