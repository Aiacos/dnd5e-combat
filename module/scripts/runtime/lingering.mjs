/**
 * §261: the terrain that an instantaneous area leaves behind (`difficultTerrain.lingers`, adapter/zone-effects.mjs) goes away
 * at the end of its caster's next turn — at the turn change that closes a caster's turn of a round later than the placement —, or
 * with the combat. Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

const lingering = region => region.getFlag(MODULE_ID, "lingering") ?? null;

async function removeWhere(test) {
  for ( const scene of game.scenes ) {
    const gone = scene.regions.filter(r => { const l = lingering(r); return l && test(l); }).map(r => r.id);
    const left = gone.filter(id => scene.regions.has(id));
    if ( !left.length ) continue;
    try { await scene.deleteEmbeddedDocuments("Region", left); }
    catch(err) { if ( !/does not exist/.test(err?.message ?? "") ) throw err; }
    log(`${left.length} lingering terrain region(s) removed`);
  }
}

function onTurnChange(combat, prior) {
  const caster = combat.combatants.get(prior?.combatantId)?.actor;
  if ( !caster ) return;
  const round = prior.round ?? combat.round;
  return enqueue("lingering", () => removeWhere(l => (l.caster === caster.uuid) && (l.combat === combat.id) && (round > l.round)));
}

export function registerLingering() {
  route("combatTurnChange", onTurnChange, { executor: true, label: "lingering terrain not removed" });
  route("deleteCombat", combat => enqueue("lingering", () => removeWhere(l => l.combat === combat.id)),
    { executor: true, label: "lingering terrain not removed with the combat" });
}
