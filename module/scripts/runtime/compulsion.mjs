/**
 * §403: Compulsion (PHB 2024) — "while the spell lasts, you can take a Bonus Action to designate a horizontal
 * direction. Each charmed target must use as much movement as possible to go in that direction on its next
 * turn… After moving this way, it repeats the Wisdom saving throw". Active GM, in combat.
 *  - At the start of the turn of the caster concentrating on the spell, if they still have their Bonus Action and at least
 *    one creature bears the spell's effect: the question "which direction?" (none, or one of the eight on the grid;
 *    adapter/choices.mjs, `askChoice`: their player, then the GM; without an answer, none). A direction spends the Bonus Action and
 *    is noted on each
 *    target's effect (`flags.dnd5e-combat.compelled.dir`). Simplification: the question comes at the start of the turn, not at
 *    any moment.
 *  - At the start of the turn of a target so designated: it walks as far as its movement allows in that direction, through
 *    the engine's A* (walls bypassed, Opportunity Attacks, scene edge), then the effect notes `moved`.
 *  - The end-of-turn save (`resave` with `ifCompelled`, runtime/triggers.mjs) is only replayed after this walk.
 * What is left to the GM: "it can take its action before moving", a move that would put it in obvious danger.
 */

import { MODULE_ID } from "../constants.mjs";
import { DIRECTIONS, directionTarget } from "../core/orders.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { readBudget, writeBudget } from "../adapter/turn.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { approach, movementCap } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep } from "./shared.mjs";

/** The effects of spell `item` borne by the scene's creatures — not the caster's Concentration, nor anything on the caster. */
function compelledEffects(item, scene) {
  const out = [];
  for ( const token of scene?.tokens ?? [] ) {
    if ( token.actor === item.actor ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.statuses?.has?.("concentrating") ) continue;
      if ( originItemOf(effect) === item ) out.push({ token, effect });
    }
  }
  return out;
}

/** At the start of the caster's turn: designate a direction (Bonus Action). */
async function direct(combatant) {
  const actor = combatant?.actor;
  const scene = combatant?.token?.parent;
  if ( !actor || !scene ) return;
  for ( const item of actor.items ) {
    if ( !contentOf(item).entry?.compels || !concentrationOn(item) ) continue;
    const held = compelledEffects(item, scene);
    if ( !held.length ) continue;
    // The budget refresh happens on the same turn change (runtime/turn.mjs): we let it arrive.
    await sleep(600);
    const budget = readBudget(combatant);
    if ( !((budget?.bonus ?? 0) >= 1) ) { log(`${item.name}: ${actor.name} has no Bonus Action left to direct its targets`); return; }
    const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Injonction.Direction"),
      options: [{ id: "none", label: loc("Injonction.Aucune") }, ...Object.keys(DIRECTIONS).map(d => ({ id: d, label: loc(`Injonction.Dir.${d}`) }))] });
    const dir = DIRECTIONS[answer?.id] ? answer.id : null;
    if ( !dir ) { log(`${item.name}: no direction this turn`); return; }
    await writeBudget(combatant, { ...readBudget(combatant), bonus: Math.max(0, (readBudget(combatant).bonus ?? 1) - 1) });
    for ( const { token, effect } of held ) {
      await effect.setFlag(MODULE_ID, "compelled", { dir });
      notice(token, loc(`Injonction.Dir.${dir}`), "reaction");
    }
    log(`${item.name}: ${actor.name} directs ${held.map(h => h.token.name).join(", ")} — ${dir}`);
    return;
  }
}

/** At the start of a designated target's turn: as much movement as possible in the direction. */
async function obey(combatant) {
  const token = combatant?.token;
  const effect = (token?.actor?.effects ?? []).find(e => e.getFlag?.(MODULE_ID, "compelled")?.dir && !e.disabled);
  if ( !effect ) return;
  const { dir } = effect.getFlag(MODULE_ID, "compelled");
  await sleep(600);
  const scene = token.parent;
  const { sceneX, sceneY, sceneWidth, sceneHeight, size } = scene.dimensions;
  const origin = scene.grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const here = cellOf(token);
  const cells = Math.floor(movementCap(token) / (scene.grid.distance || 5));
  const rel = directionTarget({ i: here.i - origin.i, j: here.j - origin.j }, dir, cells,
    { rows: Math.floor(sceneHeight / size), columns: Math.floor(sceneWidth / size) });
  let result = { arrived: false, reason: "noRoom" };
  if ( rel ) result = await approach(token, { cells: [{ i: rel.i + origin.i, j: rel.j + origin.j }] });
  await effect.setFlag(MODULE_ID, "compelled", { moved: true });
  const after = cellOf(token);
  log(`${effect.name}: ${token.name} moves ${dir} (${here.i},${here.j} → ${after.i},${after.j}, ${result.arrived ? "all the way" : result.reason})`);
  notice(token, loc(`Injonction.Dir.${dir}`), "reaction");
}

export function registerCompulsion() {
  route("combatTurnChange", (combat, prior, current) => {
    const combatant = combat.combatants.get(current?.combatantId);
    if ( !combatant?.token ) return;
    return enqueue(`compulsion:${combatant.token.uuid}`, async () => { await obey(combatant); await direct(combatant); });
  }, { executor: true, label: "Compulsion: direction not played" });
}
