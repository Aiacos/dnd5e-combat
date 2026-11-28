/**
 * Active links (SPEC §16.43, "Enchanted Bolt"): note the creature tied to the attack, break the link — and the spell — when it
 * leaves range or goes behind Total Cover, forget it when Concentration drops. On the active GM.
 */

import { tetherOfActivity, recordTether, clearTether, tetherItems, tetherBroken } from "../adapter/tether.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const link = tetherOfActivity(activity);
  if ( link?.role !== "attack" ) return;
  const target = message.system?.targets?.[0]?.token ?? null;
  if ( !target ) return;
  await recordTether(activity.item, target);
  log(`${activity.item.name}: ${activity.actor.name} tethered to ${message.system.targets[0].name ?? "?"}`);
}

/** A token moved: are the links that concern it broken? */
async function onMove(tokenDoc) {
  // The possible casters: world actors (linked PCs) and those of the scene's unlinked tokens.
  const actors = new Set([...game.actors, ...(tokenDoc.parent?.tokens ?? []).filter(t => !t.actorLink && t.actor).map(t => t.actor)]);
  for ( const actor of actors ) {
    for ( const item of tetherItems(actor) ) {
      const why = tetherBroken(item);
      if ( !why ) continue;
      log(`${item.name}: tether broken (${why === "range" ? "out of range" : "Total Cover"}), the spell ends`);
      await clearTether(item);
      const concentration = concentrationOn(item);
      if ( concentration ) await concentration.delete();
    }
  }
}

export function registerTether() {
  route("createChatMessage", onUsage, { executor: true, label: "tether: not recorded" });
  route("moveToken", onMove, { executor: true, label: "tether: break not judged" });
  // End of the spell (Concentration removed, whatever the cause): the link is forgotten.
  route("deleteActiveEffect", async effect => {
    const actor = effect.parent;
    if ( (actor?.documentName !== "Actor") || !effect.statuses?.has?.("concentrating") ) return;
    for ( const item of tetherItems(actor) ) if ( !concentrationOn(item) ) await clearTether(item);
  }, { executor: true, label: "tether: not forgotten" });
}
