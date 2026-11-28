/**
 * §265: the real Banishment (`banishes`, CAT / CPR audit) — "the target is transported to a harmless demiplane"
 * (Banishment, Banishing Smite). The data only sets the Incapacitated condition: the target stayed on the map, targetable.
 * When the declared effect is placed, the token and its combatant are hidden (nothing targets it, sees it, hears it); when it
 * falls (spell ended, Concentration broken), it reappears in the space it left, or, if occupied, in the nearest free space
 * ("the target reappears in the space it left or, if that is occupied, in the nearest unoccupied space"). The permanent
 * banishment of a creature from another plane after a minute is left to the GM. Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { nearestFreeCell } from "../core/plane.mjs";
import { contentOf } from "../adapter/content.mjs";
import { comesFromItemEffect, originItemOf } from "../adapter/facts.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { occupiedAt } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, notice } from "./shared.mjs";

const FLAG = "banished";

/** Does the effect come from an item that banishes, through one of its declared effects? */
function banishing(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  const ids = contentOf(originItemOf(effect)).entry?.banishes ?? [];
  return ids.some(id => comesFromItemEffect(effect, id));
}

const tokensOf = actor => actor.isToken ? [actor.token].filter(Boolean) : (actor.getActiveTokens?.(false, true) ?? []);

async function hideCombatant(token, hidden) {
  for ( const combat of game.combats ) {
    const c = combat.combatants.find(x => (x.sceneId === token.parent?.id) && (x.tokenId === token.id));
    if ( c && (c.hidden !== hidden) ) await c.update({ hidden });
  }
}

async function onCreateEffect(effect) {
  if ( !banishing(effect) ) return;
  for ( const token of tokensOf(effect.parent) ) {
    if ( token.getFlag(MODULE_ID, FLAG) ) continue;
    notice(token, { key: "Retour.Banni" }, "ended", { all: true, action: "spellEnds", outcome: "success" });
    await token.update({ hidden: true, [`flags.${MODULE_ID}.${FLAG}`]: { wasHidden: token.hidden === true } });
    await hideCombatant(token, true);
    log(`${token.name}: banished to a harmless demiplane`);
  }
}

async function onDeleteEffect(effect) {
  if ( !banishing(effect) ) return;
  const actor = effect.parent;
  // Another banishment still holds: it stays over there.
  if ( actor.effects.some(e => (e.id !== effect.id) && banishing(e)) ) return;
  for ( const token of tokensOf(actor) ) {
    const state = token.getFlag(MODULE_ID, FLAG);
    if ( !state ) continue;
    await token.update({ hidden: state.wasHidden === true, [`flags.${MODULE_ID}.-=${FLAG}`]: null });
    await hideCombatant(token, state.wasHidden === true);
    if ( occupiedAt(token, token._source) ) {
      const grid = token.parent.grid;
      const cell = nearestFreeCell(cellOf(token), c => !occupiedAt(token, grid.getTopLeftPoint(c)), 12);
      if ( cell ) {
        const to = grid.getTopLeftPoint(cell);
        await token.move([{ x: to.x, y: to.y, elevation: token._source.elevation, level: token._source.level, snapped: true, action: "displace" }],
          { [MODULE_ID]: { cleared: true } });
      }
    }
    notice(token, { key: "Retour.Revenu" }, "gain", { all: true });
    log(`${token.name}: back from the demiplane`);
  }
}

/**
 * §402: a send-back with no return by the engine (outcome step `banish`: Divine Word — "sent back to its plane of origin",
 * 24 hours, out of the game): the token and its combatant are hidden like a banishment, with no effect that brings it back;
 * the GM makes it visible if it returns.
 */
export async function banishToken(token) {
  if ( !token || token.getFlag(MODULE_ID, FLAG) ) return false;
  notice(token, { key: "Retour.Banni" }, "ended", { all: true, action: "spellEnds", outcome: "success" });
  await token.update({ hidden: true, [`flags.${MODULE_ID}.${FLAG}`]: { wasHidden: token.hidden === true, permanent: true } });
  await hideCombatant(token, true);
  log(`${token.name}: sent back to its plane of origin`);
  return true;
}

export function registerBanish() {
  route("createActiveEffect", effect => enqueue(`banish:${effect.parent?.uuid}`, () => onCreateEffect(effect)),
    { executor: true, label: "banishment: target not removed from the scene" });
  route("deleteActiveEffect", effect => enqueue(`banish:${effect.parent?.uuid}`, () => onDeleteEffect(effect)),
    { executor: true, label: "banishment: target not returned" });
}
