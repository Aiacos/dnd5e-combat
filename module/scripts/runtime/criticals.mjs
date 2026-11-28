/**
 * §207: the Critical Hit options (adapter/criticals.mjs) — their world settings, all disabled by default, and the request
 * that has the active GM roll a world critical table when a player scored the hit.
 */
import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { CRIT_MARGIN_SETTING, CRITICAL_MODE_SETTING, CRITICAL_TABLE_SETTING, CRITICAL_NPC_SETTING, CRITICAL_MODES, CRITICAL_TABLE_QUERY, drawHere }
  from "../adapter/criticals.mjs";
import { criticalExtraRolls } from "../adapter/messages.mjs";
import { loc, log } from "./shared.mjs";

import { route } from "./router.mjs";

const key = (setting, part) => `DND5ECOMBAT.Reglage.${setting}.${part}`;

/** A Critical Hit handled differently (table, neighbor): noted on the damage card — it stays a Critical Hit (death saves). */
function onPreRollDamage(config, dialog, message) {
  const kind = config?.[MODULE_ID]?.criticalHit;
  if ( kind ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.criticalHit`, kind);
  return true;
}

/**
 * #269 (§545): one attack, several hit targets, only some of them Critical Hits (`rollDamageForAttack` set `criticalExtra`). The
 * damage rolls are normal; the extra critical dice join them here, after dnd5e configured the rolls (bonus dice, Piercer…) and
 * before they are evaluated: one message, one Dice So Nice animation. Marked apart, they are added to the critical targets only
 * (`readDamageMessage` → `damageRoll.critical` → `damageFor`).
 */
function onPostDamageConfiguration(rolls, config, dialog, message) {
  const extra = config?.[MODULE_ID]?.criticalExtra;
  if ( !extra?.tokens?.length || !Array.isArray(rolls) ) return true;
  const label = loc("CoupCritique.PartCritique", { names: (extra.names ?? []).join(", ") });
  const added = criticalExtraRolls(rolls, label);
  rolls.push(...added);
  if ( message ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.criticalFor`, extra.tokens);
  log(`critical dice apart for ${(extra.names ?? []).join(", ")}: ${added.map(r => r.formula).join(" + ") || "none"}`);
  return true;
}

/**
 * Active GM: the roll requested by a player. §472: from a player, on behalf of their own actor only (the speaker is rebuilt from
 * their sheet, not taken from the data).
 */
async function handleCriticalTable({ speaker=null }={}, { user=null }={}) {
  if ( !game.user.isGM ) return null;
  if ( needsCheck(user) ) {
    const actor = game.actors.get(speaker?.actor ?? "");
    const scene = game.scenes.get(speaker?.scene ?? "");
    const token = scene?.tokens.get(speaker?.token ?? "") ?? null;
    const who = token?.actor ?? actor;
    if ( !who || !actsFor(user, who) ) { console.warn(`${MODULE_ID} | criticalTable query from ${user.name} refused: the speaker is not theirs`); return null; }
    speaker = ChatMessage.implementation.getSpeaker(token ? { token } : { actor: who });
  }
  return drawHere(null, speaker);
}

export function registerCriticals() {
  game.settings.register(MODULE_ID, CRIT_MARGIN_SETTING, {
    name: key(CRIT_MARGIN_SETTING, "Nom"), hint: key(CRIT_MARGIN_SETTING, "Aide"), scope: "world", config: true,
    type: Number, range: { min: 0, max: 20, step: 1 }, default: 0
  });
  game.settings.register(MODULE_ID, CRITICAL_MODE_SETTING, {
    name: key(CRITICAL_MODE_SETTING, "Nom"), hint: key(CRITICAL_MODE_SETTING, "Aide"), scope: "world", config: true, type: String,
    choices: Object.fromEntries(CRITICAL_MODES.map(m => [m, key(CRITICAL_MODE_SETTING, m)])), default: "standard"
  });
  game.settings.register(MODULE_ID, CRITICAL_TABLE_SETTING, {
    name: key(CRITICAL_TABLE_SETTING, "Nom"), hint: key(CRITICAL_TABLE_SETTING, "Aide"), scope: "world", config: true, type: String, default: ""
  });
  game.settings.register(MODULE_ID, CRITICAL_NPC_SETTING, {
    name: key(CRITICAL_NPC_SETTING, "Nom"), hint: key(CRITICAL_NPC_SETTING, "Aide"), scope: "world", config: true, type: Boolean, default: false
  });
  // A player cannot mark a world table's result as rolled: the active GM rolls in their place, on behalf of the attacker.
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "critical hit: noted on the damage card" });
  route("dnd5e.postDamageRollConfiguration", onPostDamageConfiguration,
    { cancellable: true, label: "critical hit: extra dice apart for the critical targets (#269)" });
  CONFIG.queries[CRITICAL_TABLE_QUERY] = handleCriticalTable;
}
