/**
 * §184–§185: being hidden, read in Foundry. A single condition (user's decision, 2026-10-14): the Stealth effect (Hide
 * action, `flags.dnd5e-combat.hidden = { dc }`, adapter/hide.mjs), in both rules of the `stealthRules` setting:
 *  - `2024`: placed by a successful DC 15 Stealth check; the DC to find it is the total;
 *  - `bg3`  : placed without a roll when no enemy sees it; each enemy must **spot** it (runtime/stealth.mjs);
 *  - `off`  : the engine does not manage Stealth (issue #65, narrative table) — Hide takes its action and the GM judges; no token
 *    is hidden for the engine, even if it still carries a Stealth effect placed before.
 * A hidden token is **invisible to its enemies** (`hiddenFrom`, wired into `canSee`) — not to its allies: the effect no
 * longer carries the core's Invisible condition, which also hid it from the party. In BG3, those who spotted it see it: token flag
 * `stealth.spottedBy` (token ids), readable by all clients.
 */

import { MODULE_ID } from "../constants.mjs";
import { areEnemies } from "./factions.mjs";
import { settingOr } from "./settings.mjs";
import { knownTo } from "./facts.mjs";

export const RULES_SETTING = "stealthRules";

/** The world's Stealth rules: `"2024"`, `"bg3"` or `"off"` (not managed by the engine). */
export function stealthRules() {
  const value = settingOr(RULES_SETTING, "2024");
  return ["bg3", "off"].includes(value) ? value : "2024";
}

const doc = t => t?.document ?? t ?? null;

/** Is the token (or actor) hidden? */
export function isHidden(token) {
  if ( stealthRules() === "off" ) return false;
  const actor = doc(token)?.actor ?? token?.actor ?? (token?.documentName === "Actor" ? token : null);
  return !!actor?.effects?.some?.(e => !e.disabled && e.getFlag?.(MODULE_ID, "hidden"));
}

/** The tokens that have spotted this hidden token (ids, BG3 rules). */
export function spottedBy(token) {
  return doc(token)?.getFlag?.(MODULE_ID, "stealth")?.spottedBy ?? [];
}

/**
 * Does being hidden hide `target` from `observer`? An enemy that has not spotted it. An ally, or itself, always sees it.
 */
export function hiddenFrom(observer, target) {
  const o = doc(observer), t = doc(target);
  if ( !o || !t || (o === t) || !isHidden(t) || !areEnemies(o, t) ) return false;
  if ( knownTo(t.actor, o.actor) ) return false;   // §284: Mind Sliver — it cannot Hide from its caster
  return !spottedBy(t).includes(o.id);
}
