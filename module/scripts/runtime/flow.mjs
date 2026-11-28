/**
 * §418: the "Flow" frame settings that have no other home (the refusal: runtime/forced.mjs, §417). Declared at all
 * automation levels: the settings window always shows them, and what reads them (adapter/reactions.mjs) only runs from
 * the level that judges the rule.
 */
import { MODULE_ID } from "../constants.mjs";
import { REACTION_MODES, DAMAGE_MODES, damageSteps } from "../core/flow.mjs";

/** World setting "Reactions": ask everyone, players only, or never. Read by `askReaction` (adapter/reactions.mjs). */
export const REACTION_SETTING = "reactionPrompts";

/** §419: world setting "Damage" — rolled automatically or on the author's click, applied automatically or validated by the GM. */
export const DAMAGE_SETTING = "damageFlow";

/**
 * §419: what the "Damage" setting asks (core/flow.mjs, `damageSteps`). §524: `playerAuthor` — the action's author is a
 * player; read on the author's client, it is this client's user when not a GM.
 * @param {{playerAuthor?: boolean}} [who]
 */
export function damageFlow({ playerAuthor=false }={}) {
  let mode = "level";
  try { mode = game.settings.get(MODULE_ID, DAMAGE_SETTING); } catch { /* setting not yet declared */ }
  return damageSteps(mode, { playerAuthor });
}

export function registerFlow() {
  game.settings.register(MODULE_ID, DAMAGE_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.Aide`,
    choices: Object.fromEntries(DAMAGE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.${m}`])) });
  game.settings.register(MODULE_ID, REACTION_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Aide`,
    choices: Object.fromEntries(REACTION_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${REACTION_SETTING}.${m}`])) });
}
