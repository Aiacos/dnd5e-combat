/**
 * §207: two Critical Hit options, both disabled by default (GitHub issue #5) — house rules, not those of 2024.
 *  - `critMargin`: a hit that beats the target's AC by at least this margin is critical (0: no; "AC + 10"). Judged in the
 *    verdict (core/action.mjs, `beatsAcBy`); the margin is read at the attack roll (runtime/engine-messages.mjs).
 *  - `criticalMode`: on a Critical Hit, "standard" (dnd5e's doubled dice, as without the option), "choice" (the attacker
 *    chooses, on their screen, between the standard critical and the table) or "table" (always the table).
 *    The table (`criticalTable`: uuid or name of a world table) is rolled in the chat, and the damage is then that of a normal
 *    hit; the GM applies what it says. `criticalNpc`: the option applies to NPCs too (otherwise, their criticals stay standard).
 * The hook `dnd5e-combat.criticalHit` (`Hooks.callAll`, before the question) receives `{ actor, activity, target, mode }`:
 * a neighboring module can change `mode` ("standard", "table", or "plain": normal damage, the critical's effect being left to it).
 */
import { MODULE_ID } from "../constants.mjs";
import { timedWait } from "./dialogs.mjs";

export const CRIT_MARGIN_SETTING = "critMargin";
export const CRITICAL_MODE_SETTING = "criticalMode";
export const CRITICAL_TABLE_SETTING = "criticalTable";
export const CRITICAL_NPC_SETTING = "criticalNpc";
export const CRITICAL_MODES = Object.freeze(["standard", "choice", "table"]);
export const CRITICAL_TABLE_QUERY = `${MODULE_ID}.criticalTable`;

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
};
const t = (key, data) => (data ? game.i18n.format(`DND5ECOMBAT.CritOption.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.CritOption.${key}`));

/** The `critMargin` setting's margin (0: disabled). */
export function critMargin() {
  const n = Number(read(CRIT_MARGIN_SETTING, 0));
  return (Number.isFinite(n) && (n > 0)) ? Math.floor(n) : 0;
}

/** The setting's critical table: by uuid, otherwise by name among the world's tables. null if none. */
export async function criticalTable() {
  const ref = String(read(CRITICAL_TABLE_SETTING, "") ?? "").trim();
  if ( !ref ) return null;
  const byUuid = ref.includes(".") ? await fromUuid(ref).catch(() => null) : null;
  const table = byUuid ?? game.tables.getName(ref) ?? null;
  return (table?.documentName === "RollTable") ? table : null;
}

/**
 * Handling of a Critical Hit, on the attacker's client, before the damage roll: "standard" (doubled dice), "table"
 * (table rolled, normal damage) or "plain" (normal damage, a neighbor handles it). Without a critical: "standard".
 * @param {Activity} activity
 * @param {TokenDocument|null} target
 * @returns {Promise<"standard"|"table"|"plain">}
 */
export async function criticalChoice(activity, target) {
  const actor = activity?.actor ?? null;
  let mode = read(CRITICAL_MODE_SETTING, "standard");
  if ( !CRITICAL_MODES.includes(mode) ) mode = "standard";
  if ( (actor?.type !== "character") && !read(CRITICAL_NPC_SETTING, false) ) mode = "standard";
  const decision = { actor, activity, target, mode };
  // §207: on the attacker's client, on a Critical Hit, before the damage: `(decision)`, `{ actor, activity, target, mode }`. A
  // listener can change `decision.mode`: "standard" (doubled dice), "choice", "table" or "plain"
  // (normal damage, the effect left to it).
  Hooks.callAll(`${MODULE_ID}.criticalHit`, decision);
  mode = decision.mode;
  if ( mode === "plain" ) return "plain";
  if ( (mode === "table") || (mode === "choice") ) {
    if ( !(await criticalTable()) ) {
      if ( game.user.isGM ) ui.notifications.warn(t("SansTable"));
      return "standard";
    }
  }
  if ( mode === "choice" ) {
    const picked = await timedWait({
      window: { title: t("Titre", { name: actor?.name ?? "" }) },
      content: `<p>${t("Question", { name: target?.name ?? "" })}</p>`,
      buttons: [
        { action: "standard", label: t("Standard"), icon: "fa-solid fa-dice", default: true },
        { action: "table", label: t("Table"), icon: "fa-solid fa-table-list" }
      ]
    }, { fallback: "standard", awaiting: { actor, kind: "choice" } });
    return (picked === "table") ? "table" : "standard";
  }
  return (mode === "table") ? "table" : "standard";
}

/**
 * Rolls the critical table. A compendium table is rolled here; a world table by a GM (the active GM otherwise):
 * without replacement, the core marks the drawn result (`RollTable#draw`, documents/roll-table.mjs:109),
 * which a player cannot write. Returns the result's text, or null.
 */
export async function drawCriticalTable({ speaker=null }={}) {
  const table = await criticalTable();
  if ( !table ) return null;
  if ( table.pack || game.user.isGM ) return drawHere(table, speaker);
  const gm = game.users.activeGM;
  if ( !gm ) return null;
  return gm.query(CRITICAL_TABLE_QUERY, { speaker }, { timeout: 15000 }).catch(() => null);
}

/** The roll, in the chat, in the attacker's name. */
export async function drawHere(table=null, speaker=null) {
  table ??= await criticalTable();
  if ( !table ) return null;
  const draw = await table.draw({ displayChat: false });
  const results = draw?.results ?? [];
  if ( draw?.roll ) {
    await table.toMessage(results, { roll: draw.roll, messageData: { speaker: speaker ?? ChatMessage.implementation.getSpeaker(),
      flavor: t("Tirage", { table: table.name }), flags: { [MODULE_ID]: { criticalTable: true } } } });
  }
  return results.map(r => r.name || r.description || r.text || "").filter(Boolean).join(" ; ") || null;
}
