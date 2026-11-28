/**
 * §52: the tinderbox (`kindles`) — "using it to light a Candle, a Lamp, a Lantern or a Torch […] takes a Bonus
 * Action". After the use, the source to light (or to put out): automatically if there is only one, otherwise by choice.
 * The interface asks; runtime/lights.mjs lights it.
 *
 * §121: the right-click menu of a source in dnd5e's inventory (`dnd5e.getItemContextOptions`,
 * applications/components/inventory.mjs:636) — "Light" / "Extinguish", with the time remaining. The Player's Handbook Torch
 * has only an attack activity: that is how it is lit (or with the tinderbox, or the HUD). No action cost.
 */

import { contentOf } from "../adapter/content.mjs";
import { carriedLightsOf, carriedLightEffect, carriedLightOf, burnLeftOf, hoodedDown } from "../adapter/lights.mjs";
import { toggleCarriedLight, toggleHood, burnLabel } from "../runtime/lights.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "../runtime/router.mjs";
import { log, loc, notice } from "../runtime/shared.mjs";

async function onPostUse(activity) {
  const actor = activity?.actor;
  if ( !contentOf(activity?.item).entry?.kindles || !actor?.isOwner ) return;
  // §346: a light that follows an enchantment (Flame Tongue) is not lit with a tinderbox.
  const sources = carriedLightsOf(actor).filter(i => !carriedLightOf(i).whileEnchanted);
  const token = tokenOf(actor);
  if ( !sources.length ) return notice(token, loc("Amadou.Rien"));
  const label = item => loc(carriedLightEffect(item) ? "Amadou.Eteindre" : "Amadou.Allumer", { item: item.name });
  let chosen = sources[0];
  if ( sources.length > 1 ) {
    const id = await foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name, icon: "fa-solid fa-fire" },
      content: `<p>${loc("Amadou.Choisir")}</p>`,
      buttons: sources.map((item, i) => ({ action: item.id, label: label(item), default: i === 0 })),
      rejectClose: false
    }).catch(() => null);
    chosen = sources.find(i => i.id === id) ?? null;
  }
  if ( !chosen ) return;
  const result = await toggleCarriedLight(chosen);
  if ( result.changed ) log(`${actor.name}: ${chosen.name} ${result.lit ? "lit" : "put out"} (${activity.item.name})`);
}

/** §121: "Light" / "Extinguish" in the menu of a carried source in the inventory. */
function onItemContext(item, options) {
  const rule = carriedLightOf(item);
  if ( !rule || rule.whileEnchanted || !item.actor?.isOwner || !Array.isArray(options) ) return;
  const lit = !!carriedLightEffect(item);
  // §346: the hood of a lit source (Hooded Lantern).
  if ( lit && rule.hooded ) {
    const down = hoodedDown(item);
    options.push({ label: loc(down ? "Lumiere.MenuLeverCapuchon" : "Lumiere.MenuBaisserCapuchon"), icon: down ? "fa-solid fa-sun" : "fa-solid fa-moon",
      group: "action", onClick: () => toggleHood(item) });
  }
  const left = burnLabel(burnLeftOf(item));
  options.push({
    label: loc(lit ? "Lumiere.MenuEteindre" : "Lumiere.MenuAllumer", { left }),
    icon: lit ? "fa-solid fa-fire-flame-simple" : "fa-solid fa-fire",
    group: "action",
    onClick: () => toggleCarriedLight(item)
  });
}

export function registerKindleUi() {
  route("dnd5e.postUseActivity", onPostUse, { label: "tinderbox: nothing lit" });
  route("dnd5e.getItemContextOptions", onItemContext, { label: "light source: no menu entry" });
}
