/**
 * §456: `leavesEffects: [ids d'effets]` — when the item leaves the sheet (deleted from the actor), these item effects are placed on
 * the former bearer. Mark of the sacrifice (Ravenloft): "if this Blessing is removed, … Disadvantage on Wisdom saving throws
 * for 24 hours" — the data carries the "(Removed)" effect and asks the GM to place it by hand.
 *
 * Not on a replacement by the diagnostic (delete then recreate the same object, option `{ [MODULE_ID]: { replacing: true } }`).
 * Feedback for the whole table (DAS rule): text above the token and sound for everyone, chat card (seen even with no token on
 * the scene). Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { CORE_SOUNDS } from "../core/action-feedback.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { esc, locEsc, log, notice, say } from "./shared.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

async function onDeleteItem(item, options) {
  const actor = item?.parent;
  if ( (actor?.documentName !== "Actor") || options?.[MODULE_ID]?.replacing ) return;
  const ids = contentOf(item).entry?.leavesEffects;
  if ( !ids?.length ) return;
  const data = ids.map(id => item.effects.get(id)).filter(Boolean).map(effect => {
    const d = effect.toObject();
    delete d._id;
    d.transfer = false;
    d.disabled = false;
    d.origin = item._stats?.compendiumSource ?? item.uuid;
    foundry.utils.setProperty(d, `flags.${MODULE_ID}.leftBy`, { item: item.name, identifier: item.system?.identifier ?? "" });
    return d;
  });
  if ( !data.length ) return;
  const created = await actor.createEmbeddedDocuments("ActiveEffect", data);
  const names = created.map(e => e.name).join(", ");
  notice(tokenOfActor(actor), { key: "Retour.Laisse", data: { item: item.name, effect: names } }, "loss",
    { all: true, sound: CORE_SOUNDS.fade });
  await say({ actor }, [locEsc("Retour.LaisseCarte", { actor: actor.name, item: item.name, effect: names })]);
  log(`${actor.name}: ${esc(item.name)} removed, ${names} applied`);
}

export function registerLeaves() {
  route("deleteItem", onDeleteItem, { executor: true, label: "effect left by a removed item not applied" });
}
