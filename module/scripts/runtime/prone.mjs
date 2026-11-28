/**
 * Prone (SPEC §17.2): PHB 2024, "your only movement options are to crawl or to spend an amount of movement equal to
 * half your Speed to right yourself".
 *  - Crawling: dnd5e 6 has the `crawl` movement action (cost + distance, documents/token.mjs:233) and reduces to 0 every
 *    speed other than walking for a Prone creature (`CONFIG.DND5E.conditionEffects.crawl`, data/actor/templates/
 *    attributes.mjs:534), but never puts the token in crawl mode: it walks at normal cost. The engine puts the tokens
 *    of a creature that gains the `crawl` effect in `crawl` mode (`movementAction`, token field, read by default by each
 *    waypoint: client/documents/token.mjs:1100) and restores the previous mode when the effect ends. Difficult Terrain on
 *    top: 3 for 1, as the rule says (the terrain and the action stack in the core).
 *  - Standing up: entry in its token's menu (ui/pointer.mjs); in combat, half the speed is taken from the
 *    turn's movement (`stood` budget), refused if not enough is left or if the speed is zero (Unconscious…).
 */

import { MODULE_ID } from "../constants.mjs";
import { standUpCost, movementAllowance } from "../core/turn.mjs";
import { placementOf } from "../core/altitude.mjs";
import { combatantFor, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { convertLength } from "../core/units.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";

const crawls = actor => actor?.hasConditionEffect?.("crawl") ?? actor?.statuses?.has("prone") ?? false;

function tokensOf(actor) {
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  // `concreteOnly` (V14 core, client/documents/actor.mjs:595): not the deleted tokens the actor keeps as dependents —
  // a linked token placed then removed (scenario) stayed in the list, with no id, and its update failed (2026-09-27).
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

/** Puts the actor's tokens in crawl mode, or restores their previous mode. Active GM. */
async function syncCrawl(actor) {
  if ( !actor ) return;
  const on = crawls(actor);
  for ( const token of tokensOf(actor) ) {
    const saved = token.getFlag(MODULE_ID, "crawl");
    if ( on && (token.movementAction !== "crawl") ) {
      // `forced`: not a mode choice (§17.4) — a Prone creature in the air falls (dnd5e), it does not land.
      await token.update({ movementAction: "crawl", [`flags.${MODULE_ID}.crawl`]: { from: token._source.movementAction ?? null } }, { [MODULE_ID]: { forced: true } });
      log(`${token.name}: Prone -> crawl`);
    }
    else if ( !on && saved ) {
      // A flier made Prone has fallen (dnd5e): it stands up on the ground, walking (§17.4).
      const from = ["air", "under"].includes(placementOf(saved.from)) ? "walk" : (saved.from ?? null);
      await token.update({ movementAction: (token.movementAction === "crawl") ? from : token._source.movementAction, [`flags.${MODULE_ID}.crawl`]: null }, { [MODULE_ID]: { forced: true } });
      log(`${token.name}: standing -> ${from ?? "default mode"}`);
    }
  }
}

/** The effects that make a creature Prone and that it can leave by standing up (not Unconscious, which imposes it). */
function proneEffectsOf(actor) {
  return actor.effects.filter(e => e.statuses.has("prone") && !e.statuses.has("unconscious") && !holdsProne(e));
}

/** §285: an effect that holds the creature Prone (Tasha's Hideous Laughter: "it can't end the Prone condition"). */
const holdsProne = effect => !effect.disabled && (contentOf(originItemOf(effect)).entry?.keepsProne === true);
export const heldProne = actor => Array.from(actor?.effects ?? []).find(e => e.statuses?.has?.("prone") && holdsProne(e)) ?? null;

export const canStandUp = token => (token?.actor?.statuses?.has("prone") === true) && !heldProne(token.actor);

/** Standing up: half the speed in combat, then the Prone effects removed. On the client of the one who stands up. */
export async function standUp(token) {
  const actor = token?.actor;
  const held = heldProne(actor);
  if ( held ) { notice(token, loc("Relever.Tenu", { item: originItemOf(held)?.name ?? held.name })); return false; }
  if ( !canStandUp(token) ) return false;
  const combatant = combatantFor(actor);
  if ( combatant ) {
    const movement = movementOf(combatant, readUnitFactors());
    const budget0 = readBudget(combatant);
    const remaining = movement ? movementAllowance(budget0, movement.speed) - movement.spent : 0;
    // §134: Athlete — standing up for a fixed movement (`quickStand`), converted to the speed's unit.
    const rule = Array.from(actor.items ?? []).map(i => contentOf(i).entry?.quickStand).find(Boolean);
    let fixed = null;
    if ( rule && movement?.units ) { try { fixed = convertLength(rule.value, rule.units, movement.units, readUnitFactors()); } catch { fixed = null; } }
    const { cost, issue } = standUpCost({ speed: movement?.speed ?? 0, remaining, fixed });
    if ( issue ) { notice(token, loc(`Relever.${issue}`)); return false; }
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, stood: (Number(budget.stood) || 0) + cost });
  }
  else if ( !((actor.system?.attributes?.movement?.walk ?? 1) > 0) ) { notice(token, loc("Relever.noSpeed")); return false; }
  const ids = proneEffectsOf(actor).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if ( actor.statuses.has("prone") ) { notice(token, loc("Relever.noSpeed")); return false; }   // Prone imposed (Unconscious)
  notice(token, loc("Relever.Fait"), "gain");
  log(`${actor.name} stands up`);
  return true;
}

export function registerProne() {
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => syncCrawl(actorOfEffect(effect)), { executor: true, label: "Prone: crawl mode not set or not removed" });
  }
}
