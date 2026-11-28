/**
 * §16.41: choose the weapon to enchant among those of the targeted creature (Elemental Weapon) — one portrait per weapon,
 * those that the enchantment refuses (already magical…) greyed out with their reason. The interface asks;
 * runtime/enchant.mjs casts.
 */

import { enchantableWeapons } from "../adapter/enchant.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { weaponCard, pickCard } from "./cards.mjs";

/** Rend l'uuid de l'arme choisie, ou null. */
export async function askEnchantWeapon(activity, actor) {
  const weapons = enchantableWeapons(activity, actor);
  const cards = weapons.map(weaponCard).join("");
  return pickCard({ title: `${activity.item.name} — ${actor?.name ?? ""}`, icon: "fa-solid fa-khanda", width: 480,
    content: weapons.length ? `<div class="dnd5e-combat-forms">${cards}</div>` : `<p>${esc(loc("Enchant.Aucune", { name: actor?.name ?? "" }))}</p>`,
    label: loc("Enchant.Choisir") });
}
