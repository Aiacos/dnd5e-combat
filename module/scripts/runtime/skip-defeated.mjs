/**
 * Skip the turns of defeated NPCs (core/skip-defeated.mjs) — world setting `skipDefeatedNpcs`, on by default. On the
 * active GM, when the turn moves forward onto a defeated NPC, the combat goes on to the next creature that is not one;
 * everyone sees "turn skipped" over the creature (the GM only when its token is hidden). Going back in the tracker never
 * skips: the GM may give a turn back by hand.
 */
import { MODULE_ID } from "../constants.mjs";
import { skipTarget } from "../core/skip-defeated.mjs";
import { isDefeated } from "../core/combat-outcome.mjs";
import { movedForward } from "../core/extra-turns.mjs";
import { isEvent } from "./combat-events.mjs";
import { route } from "./router.mjs";
import { log, notice } from "./shared.mjs";

export const SKIP_DEFEATED = "skipDefeatedNpcs";

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/** A combatant whose turn is skipped: an NPC (not an event) that is defeated. */
function skipped(combatant) {
  const actor = combatant?.actor;
  if ( !actor || isEvent(combatant) || (actor.type === "character") ) return false;
  return isDefeated({ dead: !!actor.statuses?.has?.(DEFEATED()), tracker: !!combatant.defeated,
    hp: actor.system?.attributes?.hp?.value ?? null, character: false });
}

async function onTurnChange(combat, prior, current) {
  if ( !game.settings.get(MODULE_ID, SKIP_DEFEATED) || !combat?.started || !movedForward(prior, current) ) return;
  const turns = combat.turns ?? [];
  const target = skipTarget(turns.map(c => ({ skip: skipped(c) })), current);
  if ( !target ) return;
  const passed = turns[current.turn];
  log(`turn of ${passed?.name ?? "?"} skipped (defeated) — to ${turns[target.turn]?.name ?? "?"}, round ${target.round}`);
  const token = passed?.token ?? null;
  if ( token ) notice(token, { key: "SautVaincu.Passe" }, "gain", { all: true, gmOnly: !!token.hidden, sound: null });
  await combat.update({ round: target.round, turn: target.turn });
}

export function registerSkipDefeated() {
  game.settings.register(MODULE_ID, SKIP_DEFEATED, {
    name: `DND5ECOMBAT.Reglage.${SKIP_DEFEATED}.Nom`, hint: `DND5ECOMBAT.Reglage.${SKIP_DEFEATED}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("combatTurnChange", onTurnChange, { executor: true, label: "defeated NPC: turn not skipped" });
}
