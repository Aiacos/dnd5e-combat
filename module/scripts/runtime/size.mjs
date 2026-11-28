/**
 * Change size (SPEC §16.58): when an effect is created on an actor, the size change that its item declares
 * (adapter/size.mjs) is added to its changes — on the client that creates the effect, before the write (no extra write).
 */

import { sizeChangeFor } from "../adapter/size.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

function onPreCreate(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const change = sizeChangeFor(effect, actor);
  if ( !change ) return;
  effect.updateSource({ "system.changes": [...(effect._source.system?.changes ?? []), change] });
  log(`${actor.name}: ${effect.name}, size ${actor.system.traits.size} -> ${change.value}`);
}

export function registerSize() {
  route("preCreateActiveEffect", onPreCreate, { label: "size: change not added" });
}
