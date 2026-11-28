/**
 * §409 (issue #44, batch 2): what the creature holds in hand to cast, and the "no free hand" refusal of a spell with a
 * somatic component (pure rule: core/hands.mjs).
 *
 * In hand: what is **equipped** (darsh-dnd-ui equips the weapon set in hand) — weapons (except natural weapons and unarmed
 * strikes), shields, lit light sources, held foci. A focus is a weapon with the "Focus" property (`foc`, dnd5e config.mjs:
 * the Staff) or an item recognized by dnd5e as a focus (`CONFIG.DND5E.focusTypes`, by its compendium document id: crystal,
 * orb, wand, sprig of mistletoe…). The amulet and the emblem are worn: they take no hand.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { carriedLightOf, carriedLightEffect } from "./carried-lights.mjs";
import { pendingMetamagic } from "./metamagic.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { somaticBlocked, handsCheckedFor } from "../core/hands.mjs";

/** World setting: who the hand check applies to — "pc" (default), "all", "off". */
export const SOMATIC_HANDS_SETTING = "somaticHands";

/** Foci that are worn, not held (holy symbol as an amulet or an emblem). */
const WORN_FOCUS = new Set(["amulet", "emblem"]);

/** Document ids of the held foci that dnd5e knows (`CONFIG.DND5E.focusTypes.<type>.itemIds`). */
function heldFocusIds() {
  const ids = new Set();
  for ( const type of Object.values(CONFIG.DND5E?.focusTypes ?? {}) ) {
    for ( const [key, uuid] of Object.entries(type.itemIds ?? {}) ) {
      if ( !WORN_FOCUS.has(key) ) ids.add(String(uuid).split(".").pop());
    }
  }
  return ids;
}

/** The compendium document id the item comes from ("phbafcCrystal000"), or null. */
function sourceId(item) {
  const source = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
  return source ? String(source).split(".").pop() : null;
}

/**
 * Ce que l'acteur tient en main, pour incanter (core/hands.mjs `Held`).
 * @param {Actor5e} actor
 */
export function castingHands(actor) {
  const foci = heldFocusIds();
  const held = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !item.system?.equipped ) continue;
    if ( item.type === "weapon" ) {
      if ( (item.system.type?.value === "natural") || (identifierOf(item).id === "unarmed-strike") ) continue;
      const props = item.system.properties;
      held.push({ name: item.name, hands: props?.has?.("two") ? 2 : 1, twoHanded: !!props?.has?.("two"), focus: !!props?.has?.("foc"), armament: true });
    }
    else if ( (item.type === "equipment") && (item.system.type?.value === "shield") ) held.push({ name: item.name, hands: 1, armament: true });
    else if ( carriedLightOf(item) && carriedLightEffect(item) ) held.push({ name: item.name, hands: 1 });
    else if ( foci.has(sourceId(item)) ) held.push({ name: item.name, hands: 1, focus: true });
  }
  return held;
}

function settingOf() {
  try { return game.settings.get(MODULE_ID, SOMATIC_HANDS_SETTING) ?? "pc"; } catch { return "pc"; }
}

/**
 * The "no free hand" refusal for this use, or null. Casting a spell through an item that waives it: dnd5e's "cast" copy
 * keeps only the remaining components (`spell.properties`, dnd5e.mjs:21874, :22118) — it no longer has `somatic`.
 * @param {Activity} activity
 * @returns {{items: string[]}|null}
 */
export function somaticBlockOf(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !actor || !isSpellCast(item) ) return null;
  if ( !handsCheckedFor(settingOf(), actor.type === "character") ) return null;
  const props = item.system?.properties;
  return somaticBlocked({
    spell: true,
    somatic: !!props?.has?.("somatic"),
    material: !!props?.has?.("material"),
    held: castingHands(actor),
    freeSomatic: (actor.items ?? []).some(i => contentOf(i).entry?.freeSomatic === true),
    // Subtle spell: "without verbal, somatic or material components" (Metamagic, held on the sorcerer until the next spell).
    waived: (item.type === "spell") && pendingMetamagic(actor).includes("subtle")
  });
}

export function registerSomaticHandsSetting() {
  game.settings.register(MODULE_ID, SOMATIC_HANDS_SETTING, { scope: "world", config: true, type: String, default: "pc",
    choices: { pc: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Pj`, all: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Tous`,
      off: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Non` },
    name: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Aide` });
}
