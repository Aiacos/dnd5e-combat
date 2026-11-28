/**
 * O9h (§363): a barrier that drops when its bearer comes into contact (`barrier.endsOnContact` — Scroll of Protection: "if you
 * move so that a creature of the chosen type ends up in the area, the effect ends"). Active GM, after each
 * token move: its Emanations that now contain a creature they stop drop (the item's effects on
 * it). The rest of the barrier (entering, affecting the inside): adapter/barriers.mjs.
 */

import { breachedBarriers } from "../adapter/barriers.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

async function onMoved(token, changes) {
  if ( !token?.actor || !(("x" in changes) || ("y" in changes) || ("elevation" in changes)) ) return;
  for ( const zone of breachedBarriers(token) ) {
    const ids = token.actor.effects.filter(e => originItemOf(e)?.uuid === zone.item.uuid).map(e => e.id);
    if ( !ids.length ) continue;
    await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${zone.item.name}: ${token.name} moved up to a creature it wards off, the emanation ends`);
    notice(token, loc("Protection.Fin", { item: zone.item.name }), "refused", { all: true });
  }
}

export function registerProtection() {
  route("updateToken", (token, changes) => enqueue(`protection:${token.uuid}`, () => onMoved(token, changes)),
    { executor: true, label: "protection emanation: not ended on contact" });
}
