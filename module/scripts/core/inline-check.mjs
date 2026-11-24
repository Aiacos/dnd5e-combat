/**
 * §536: an inline check clicked in a journal (`[[/check wis prc 11]]`, `[[/skill ste]]`, `[[/save dex 15]]`, `[[/tool thief]]`) opens
 * the engine's requested-roll flow instead of dnd5e's roll dialog (world setting, off by default). Here, the pure rule: which
 * pre-roll hook belongs to which request type, and the request read from dnd5e's roll configuration, the link's skill, ability and DC
 * taken as they are.
 *
 * Pure: no dependency on Foundry.
 */

import { normalizeRequest } from "./group-roll.mjs";

/** The world setting (off by default). */
export const INLINE_CHECK_SETTING = "inlineChecksEngine";

/**
 * dnd5e's pre-roll hooks (`BasicRoll.buildConfigure` calls `dnd5e.preRoll<Name>V2` for each of `config.hookNames`, the most precise
 * first: a skill fires `skill`, then `abilityCheck`), by request type.
 */
export const INLINE_HOOKS = Object.freeze({
  "dnd5e.preRollSkillV2": "skill",
  "dnd5e.preRollToolCheckV2": "tool",
  "dnd5e.preRollAbilityCheckV2": "check",
  "dnd5e.preRollSavingThrowV2": "save"
});

/** The `data-type` of dnd5e's roll links that the engine takes (not attack, damage, item, concentration). */
export const INLINE_LINK_TYPES = Object.freeze(["check", "skill", "tool", "save"]);

/** Rolls that go through these hooks without being the link's own test (a concentration save, the initiative check). */
const FOREIGN_HOOK_NAMES = Object.freeze(["concentration", "initiativeDialog", "deathSave"]);

/**
 * The request an inline link's roll becomes, or null when the engine leaves it to dnd5e.
 * @param {string} kind            The request type of the hook that fired (`INLINE_HOOKS`).
 * @param {object} config          dnd5e's roll configuration (`skill`, `tool`, `ability`, `target`, `advantage`, `disadvantage`,
 *   `hookNames`).
 * @param {{type: string}|null} link  The dnd5e roll link that was clicked (its `data-type`), null when the roll comes from elsewhere.
 * @returns {object|null}          A normalized request (core/group-roll.mjs `normalizeRequest`).
 */
export function inlineRequestOf(kind, config, link) {
  if ( !link || !INLINE_LINK_TYPES.includes(link.type) || !config ) return null;
  const hookNames = Array.isArray(config.hookNames) ? config.hookNames : [];
  if ( hookNames.some(name => FOREIGN_HOOK_NAMES.includes(name)) ) return null;
  // A skill or tool check also fires `abilityCheck` after its own hook: only its own hook counts.
  if ( (kind === "check") && (hookNames.includes("skill") || hookNames.includes("tool")) ) return null;
  let key;
  let ability = null;
  if ( kind === "skill" ) { key = config.skill; ability = config.ability || null; }
  else if ( kind === "tool" ) { key = config.tool; ability = config.ability || null; }
  else if ( (kind === "check") || (kind === "save") ) key = config.ability;
  else return null;
  if ( !key ) return null;
  const { request } = normalizeRequest({
    type: kind, key, ability, dc: config.target ?? null, advantage: !!config.advantage, disadvantage: !!config.disadvantage
  });
  return request;
}

/**
 * The fields of the GM's request window (ui/group-roll.mjs `openGroupRoll`) for this request.
 * @param {object} request  A normalized request.
 * @returns {object}
 */
export function windowValuesOf(request) {
  const mode = request.advantage ? "advantage" : (request.disadvantage ? "disadvantage" : "normal");
  return { type: request.type, key: request.key, ability: request.ability ?? null, dc: request.dc ?? "", mode };
}
