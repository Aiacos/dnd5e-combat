/**
 * The automation badge and the table's reports (SPEC §9.2).
 *
 * The badge reads what the engine knows about an item through the same paths it does: `contentOf` (module < world < flag),
 * the identifiers it recognizes as hard-coded (Multiattack, Unarmed Strike, Two-Weapon Fighting, its basic
 * actions), the attack variants read from the text (§18.8). The rest is classified from the item's activities
 * (core/automation.mjs).
 *
 * Reports live in a world setting, never on the item: the GM ticks as the session goes what caused trouble,
 * and at the end of the session reads the summary (and Claude too, via `api.reports`).
 */

import { MODULE_ID } from "../constants.mjs";
import { automationOf } from "../core/automation.mjs";
import { contentOf } from "./content.mjs";
import { variantPlanOf } from "./variants.mjs";
import { escapeCheckOf, restrainsWith } from "./escape.mjs";

export const REPORTS_SETTING = "itemReports";
const REPORTS_VERSION = 1;

/** Identifiers the engine handles as hard-coded, outside the declared content. */
const KNOWN = new Set(["multiattack", "unarmed-strike", "two-weapon-fighting"]);

/** Gear item types: with no activity or effect, they have nothing to play (not "manual"). */
const GEAR = new Set(["equipment", "loot", "container", "consumable", "tool", "weapon"]);

/** Ce que le moteur fait de cet item. */
export function automationOfItem(item) {
  const { identifier, entry, layers } = contentOf(item);
  const rules = entry ? Object.keys(entry) : [];
  const own = identifier ?? "";
  if ( KNOWN.has(own) || own.startsWith(`${MODULE_ID}-`) ) rules.push(own);
  if ( (item?.actor?.type === "npc") && variantPlanOf(item) ) rules.push("variants");
  if ( restrainsWith(item) && escapeCheckOf(item) ) rules.push("escape");   // §16.54: escape via the text's check
  const activities = Array.from(item?.system?.activities?.values?.() ?? []).map(a => ({
    type: a.type, roll: !!a.roll?.formula, effects: a.effects?.length ?? 0
  }));
  // AC of armor or a shield, dnd5e computes it on its own (CONFIG.DND5E.armorTypes: light, medium, heavy, shield).
  const armor = (item?.type === "equipment") && ((item.system.type?.value ?? "") in (CONFIG.DND5E?.armorTypes ?? {}));
  const passiveEffects = (item?.effects ?? []).filter(e => e.transfer && !e.disabled).length + (armor ? 1 : 0);
  const gear = GEAR.has(item?.type);
  return { ...automationOf({ rules, activities, passiveEffects, gear }), identifier, layers };
}

/** The world's reports: `{ uuid de l'item: { actor, actorUuid, item, identifier, note, at } }`. */
export function reports() {
  const stored = game.settings.get(MODULE_ID, REPORTS_SETTING);
  if ( !stored || (stored.v !== REPORTS_VERSION) ) return {};
  return stored.entries ?? {};
}

export const reportOf = item => (item?.uuid ? reports()[item.uuid] ?? null : null);

/** Places (or replaces) an item's report. GM only (world setting). */
export async function setReport(item, note="") {
  const entries = { ...reports() };
  entries[item.uuid] = { actor: item.actor?.name ?? "", actorUuid: item.actor?.uuid ?? null, item: item.name,
    identifier: contentOf(item).identifier, note: String(note ?? "").trim(), at: Date.now() };
  await game.settings.set(MODULE_ID, REPORTS_SETTING, { v: REPORTS_VERSION, entries });
  return entries[item.uuid];
}

/** Removes a report (by item uuid), or all with `null`. */
export async function clearReport(uuid) {
  const entries = (uuid === null) ? {} : { ...reports() };
  if ( uuid !== null ) delete entries[uuid];
  await game.settings.set(MODULE_ID, REPORTS_SETTING, { v: REPORTS_VERSION, entries });
}
