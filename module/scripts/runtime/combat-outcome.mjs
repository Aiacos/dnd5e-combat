/**
 * §555: two read-only signals for neighbour modules (XP, loot, statistics): « a combat is over » and « a creature was defeated ».
 * Emitted by the active GM only, once each. Registered at the lowest automation level (Essentials) and kept during Theater of the
 * Mind (`always`): they observe, they decide nothing.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { isEvent } from "./combat-events.mjs";
import { isDefeated, wasPlayed } from "../core/combat-outcome.mjs";

/**
 * §555: on the active GM, when a combat that was played (begun) is deleted: `({ combat, scene, round, combatants, defeated })` —
 * `combatants` `[{ combatant, token, actor, defeated }]` (initiative events left out), `defeated` the TokenDocuments of those
 * defeated (dead, marked defeated in the tracker, or a non-character at 0 HP). Read-only; sides are the listener's call
 * (`api.factions.relation`).
 */
export const COMBAT_ENDED_HOOK = `${MODULE_ID}.combatEnded`;

/**
 * §555: on the active GM, when a creature becomes defeated — the `dead` status (Foundry's DEFEATED) placed on it, or the tracker's
 * « defeated » ticked: `({ token, actor, combat, cause })` — `token` the TokenDocument, `combat` the running combat it takes
 * part in or null, `cause` « dead » or « tracker ». Once per creature until it is back (status removed, tracker unticked).
 * Characters included: the listener filters. Read-only.
 */
export const CREATURE_DEFEATED_HOOK = `${MODULE_ID}.creatureDefeated`;

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/** Token uuids already announced as defeated (cleared when the creature is back). */
const told = new Set();

/** A combatant's line in `combatEnded`. */
function lineOf(combatant) {
  const actor = combatant.actor;
  const defeated = isDefeated({
    dead: !!actor?.statuses?.has?.(DEFEATED()), tracker: !!combatant.defeated,
    hp: actor?.system?.attributes?.hp?.value ?? null, character: actor?.type === "character"
  });
  return { combatant, token: combatant.token ?? null, actor: actor ?? null, defeated };
}

function onCombatDeleted(combat) {
  if ( !wasPlayed({ started: combat?.started, round: combat?.round }) ) return;
  const combatants = Array.from(combat.combatants ?? []).filter(c => !isEvent(c) && c.actor).map(lineOf);
  const defeated = combatants.filter(c => c.defeated && c.token).map(c => c.token);
  const scene = combat.scene ?? game.scenes?.get(combat._source?.scene) ?? null;
  log(`combat over (round ${combat.round}): ${combatants.length} combatant(s), ${defeated.length} defeated`);
  Hooks.callAll(COMBAT_ENDED_HOOK, { combat, scene, round: combat.round ?? 0, combatants, defeated });
}

/** The started combat a token takes part in, or null. */
function combatOf(token) {
  return game.combats?.find(c => c.started && c.combatants.some(cb => (cb.tokenId === token.id) && (cb.sceneId === token.parent?.id)))
    ?? null;
}

function announce(token, cause) {
  if ( !token?.actor || told.has(token.uuid) ) return;
  told.add(token.uuid);
  log(`${token.name}: defeated (${cause})`);
  Hooks.callAll(CREATURE_DEFEATED_HOOK, { token, actor: token.actor, combat: combatOf(token), cause });
}

/** The tokens an actor's status applies to: its own token (unlinked), or every token of the linked actor. */
function tokensOf(actor) {
  if ( actor?.token ) return [actor.token];
  return actor?.getActiveTokens?.(false, true) ?? [];
}

function onEffect(effect, placed) {
  if ( !effect?.statuses?.has?.(DEFEATED()) ) return;
  const actor = effect.parent;
  if ( !(actor instanceof Actor) ) return;
  for ( const token of tokensOf(actor) ) {
    if ( placed ) announce(token, "dead");
    else told.delete(token.uuid);
  }
}

function onCombatantUpdate(combatant, changes) {
  if ( !("defeated" in (changes ?? {})) || !combatant.token ) return;
  if ( changes.defeated === true ) announce(combatant.token, "tracker");
  else if ( !combatant.actor?.statuses?.has?.(DEFEATED()) ) told.delete(combatant.token.uuid);
}

export function registerCombatOutcome() {
  const opts = label => ({ executor: true, always: true, label });
  route("deleteCombat", onCombatDeleted, opts("combatEnded not announced"));
  route("createActiveEffect", effect => onEffect(effect, true), opts("creatureDefeated not announced"));
  route("deleteActiveEffect", effect => onEffect(effect, false), opts("creatureDefeated: return not noted"));
  route("updateCombatant", onCombatantUpdate, opts("creatureDefeated (tracker) not announced"));
  route("deleteToken", token => { told.delete(token.uuid); }, opts("creatureDefeated: removed token not forgotten"));
}
