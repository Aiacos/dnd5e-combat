/**
 * §242 (issue #18): what the rolls requested by the GM read from dnd5e — the check title, the dnd5e roll arguments, the breakdown
 * of bonuses (for an interface that shows them as tiles, BG3 style), and the state of the request card.
 *
 * The card is dnd5e's (`type: "request"`, data/chat-message/request-message-data.mjs): one row per character, its total,
 * success or failure. Each roll carries our flags `groupRollResult` / `groupRollActor`; the active GM links it to its row
 * (runtime/group-roll.mjs). The card button's handler is ours (`CONFIG.DND5E.requests`, config.mjs:4778), so that the
 * player who clicks lands on the same window as if they had received the request.
 */

import { MODULE_ID } from "../constants.mjs";
import { tally } from "../core/group-roll.mjs";
import { inspirationOf } from "./inspiration.mjs";

export const GROUP_FLAG = "groupRoll";
/** The handler's key in `CONFIG.DND5E.requests` (the card's `handler` field). */
export const GROUP_HANDLER = `${MODULE_ID}.groupRoll`;

const abilityLabel = key => game.i18n.localize(CONFIG.DND5E.abilities?.[key]?.label ?? key ?? "");
const skillLabel = key => game.i18n.localize(CONFIG.DND5E.skills?.[key]?.label ?? key ?? "");
export const toolLabel = key => globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait: "tool" }) ?? key ?? "";

/** The check's ability: the requested one, otherwise that of the skill or tool (on the sheet, failing that in the config). */
export function abilityOf(request, actor=null) {
  if ( (request.type === "check") || (request.type === "save") ) return request.key;
  // §397: Initiative is rolled with the sheet's ability (Dexterity by default).
  if ( request.type === "initiative" ) return actor?.system?.attributes?.init?.ability || CONFIG.DND5E.defaultAbilities?.initiative || "dex";
  if ( request.ability ) return request.ability;
  if ( request.type === "skill" ) return actor?.system?.skills?.[request.key]?.ability ?? CONFIG.DND5E.skills?.[request.key]?.ability ?? "";
  return actor?.system?.tools?.[request.key]?.ability ?? CONFIG.DND5E.tools?.[request.key]?.ability ?? "int";
}

/** The check title, in dnd5e's words: "Wisdom (Insight) Check", "Strength Saving Throw"… */
export function testTitle(request) {
  const ability = abilityLabel(abilityOf(request));
  switch ( request.type ) {
    case "check": return game.i18n.format("DND5E.AbilityPromptTitle", { ability });
    case "save": return game.i18n.format("DND5E.SavePromptTitle", { ability });
    case "skill": return game.i18n.format("DND5E.SkillPromptTitle", { skill: skillLabel(request.key), ability });
    case "initiative": return game.i18n.localize("DND5E.InitiativeRoll");
    default: return game.i18n.format("DND5E.ToolPromptTitle", { tool: toolLabel(request.key) });
  }
}

/** The short name of what is rolled: the skill, the tool or the ability. */
export function keyLabel(request) {
  if ( request.type === "skill" ) return skillLabel(request.key);
  if ( request.type === "tool" ) return toolLabel(request.key);
  if ( request.type === "initiative" ) return game.i18n.localize("DND5E.Initiative");
  return abilityLabel(request.key);
}

/** Can the actor make this roll? (a vehicle has no skills, a group has none) */
export function canRoll(actor, request) {
  if ( !actor?.system?.abilities ) return false;
  return (request.type !== "skill") || !!actor.system.skills;
}

/**
 * The three dnd5e roll arguments (`config`, `dialog`, `message`) for an actor.
 * @param {object} request          The normalized request.
 * @param {object} options
 * @param {string} options.requestId  The id of the request card.
 * @param {Actor} options.actor
 * @param {boolean} [options.showDc]  The DC goes into the roll (dnd5e displays it); no when it is hidden from the roller.
 * @param {{advantage?: boolean, disadvantage?: boolean, mode?: "advantage"|"disadvantage"|null}} [options.extra]  What the UI
 *   adds (Help: Advantage); `mode` forces Advantage or Disadvantage, whatever the request and the sheet say.
 * @param {object} [options.flags]  Flags from other modules to put on the roll message (never those of the engine).
 */
export function rollArguments(request, { requestId, actor, showDc=true, extra={}, flags={} }) {
  const config = {};
  if ( (request.type === "check") || (request.type === "save") ) config.ability = request.key;
  else if ( request.type !== "initiative" ) config[request.type] = request.key;
  if ( request.ability && ((request.type === "skill") || (request.type === "tool")) ) config.ability = request.ability;
  if ( (extra.mode === "advantage") || (extra.mode === "disadvantage") ) {
    // Forced: both written, to override the sheet (dnd5e merges `config` on top, actor.mjs:1394).
    config.advantage = extra.mode === "advantage";
    config.disadvantage = extra.mode === "disadvantage";
  }
  else {
    let advantage = !!(request.advantage || extra.advantage);
    let disadvantage = !!(request.disadvantage || extra.disadvantage);
    if ( advantage && disadvantage ) advantage = disadvantage = false;
    // Nothing written when it is no: dnd5e merges `config` on top of the Advantage the sheet gives (actor.mjs:1394).
    if ( advantage ) config.advantage = true;
    if ( disadvantage ) config.disadvantage = true;
  }
  if ( showDc && (request.dc !== null) ) config.target = request.dc;
  // A roll's parts are added to those of the sheet (`config.parts = [...config.parts, ...parts]`, actor.mjs:1499). The roll options
  // mark it as a requested roll: "after seeing the roll" dice (Bardic Inspiration…) then go through the request, which counts them
  // (runtime/group-roll.mjs), not through runtime/roll-bonus.mjs.
  config.rolls = [{ ...(request.bonus ? { parts: [String(request.bonus)] } : {}), options: { [MODULE_ID]: { groupRoll: requestId } } }];
  const flavor = request.label ? `${request.label} — ${testTitle(request)}` : testTitle(request);
  const message = { data: {
    flavor,
    // `flags`: what an interface adds to the roll message (Combat UI: `dice-so-nice.skip`, its dice replace those of Dice So Nice).
    // `groupRollPending`: the check is not concluded until the after-the-roll dice (Bardic Inspiration…) are settled
    // (runtime/group-roll.mjs `bonusAfterRoll` lifts it) — the card, the group verdict and the GM tracking wait.
    flags: { ...flags, [MODULE_ID]: { groupRollResult: requestId, groupRollActor: actor.uuid, groupRollAids: extra.aids ?? [],
      groupRollForced: extra.mode ?? null, groupRollPending: true } }
  } };
  return [config, message];
}

/**
 * What dnd5e combines for this roll: the sheet paths, the rules category (`check` / `save`) and the roll data (`roll` filled in
 * as dnd5e does: actor.mjs:1376-1385 skill/tool, :1600-1605 check/save).
 */
function rollContext(actor, request) {
  const ability = abilityOf(request, actor);
  const rollData = actor.getRollData({ roll: true });
  // §397: the paths of dnd5e's Initiative roll (actor.mjs:1858).
  if ( request.type === "initiative" ) {
    rollData.roll = { ...(rollData.roll ?? {}), ability, type: "initiative" };
    return { category: "check", rollData, paths: [`abilities.${ability}.check.roll`, "attributes.init.roll", "rolls.ability.check"] };
  }
  if ( (request.type === "check") || (request.type === "save") ) {
    rollData.roll = { ...(rollData.roll ?? {}), ability, type: "ability" };
    return { category: request.type, rollData, paths: [`abilities.${ability}.${request.type}.roll`, `rolls.ability.${request.type}`] };
  }
  rollData.roll = { ...(rollData.roll ?? {}), ability, [request.type]: request.key, type: request.type };
  return { category: "check", rollData,
    paths: [`abilities.${ability}.check.roll`, "rolls.ability.check", `rolls.ability.${request.type}`, `${request.type}s.${request.key}.roll`] };
}

/**
 * The Advantage and Disadvantage that dnd5e will apply by itself to this roll (sheet, effects, conditions, applied rules) —
 * the same combination as dnd5e at roll time (`D20RollModificationField.combineFields`,
 * data/shared/d20-roll-modification-field.mjs:59; paths and rules as documents/actor/actor.mjs:1386 for a skill or a tool,
 * and :1606 for a check or a save). What a `dnd5e.preRoll…` listener decides at roll time (an engine rule) is not in it.
 * @returns {{advantage: boolean, disadvantage: boolean}}
 */
export function systemModeOf(actor, request) {
  const Field = globalThis.dnd5e?.dataModels?.shared?.D20RollModificationField;
  const none = { advantage: false, disadvantage: false };
  if ( !Field || !actor?.system?.abilities ) return none;
  const { paths, category, rollData } = rollContext(actor, request);
  try {
    const { advantage, disadvantage } = Field.combineFields(actor.system, paths, { rules: { category, actor, rollData } });
    return { advantage: !!advantage, disadvantage: !!disadvantage };
  } catch(err) {
    console.warn(`${MODULE_ID} | group roll: system Advantage not read`, err);
    return none;
  }
}

/** dnd5e's roll method for this type. */
export function rollMethodOf(actor, type) {
  if ( type === "initiative" ) return actor?.getInitiativeRollConfig ? (config, dialog, message) => rollInitiativeOf(actor, config, dialog, message) : null;
  const name = { check: "rollAbilityCheck", save: "rollSavingThrow", skill: "rollSkill", tool: "rollToolCheck" }[type];
  return actor?.[name]?.bind(actor) ?? null;
}

/**
 * §397: an actor's Initiative roll for a request — dnd5e's configuration (`Actor5e#getInitiativeRollConfig`, actor.mjs:1846:
 * ability, proficiency, bonus, Surprised, Disadvantage from a hidden enemy…), the request's Advantage / Disadvantage, its bonus,
 * then the roll built by dnd5e (`D20Roll.build`, its window if `configure`) and its message, carrying the request's flags. The
 * result becomes the combatant's Initiative with the active GM (runtime/group-roll.mjs `link`).
 */
async function rollInitiativeOf(actor, config, dialog, message) {
  const rollConfig = actor.getInitiativeRollConfig({
    ...(config.advantage ? { advantage: true } : {}), ...(config.disadvantage ? { disadvantage: true } : {}),
    ...(config.advantage === false ? { advantage: false } : {}), ...(config.disadvantage === false ? { disadvantage: false } : {})
  });
  const extra = config.rolls?.[0] ?? {};
  rollConfig.parts = [...(rollConfig.parts ?? []), ...(extra.parts ?? [])];
  rollConfig.options = { ...(rollConfig.options ?? {}), ...(extra.options ?? {}) };
  if ( rollConfig.options.fixed !== undefined ) delete rollConfig.options.fixed;
  return CONFIG.Dice.D20Roll.build(
    { evaluate: true, hookNames: ["initiativeDialog", "abilityCheck", "d20Test"], rolls: [rollConfig], subject: actor },
    { configure: !!dialog?.configure, options: { title: game.i18n.localize("DND5E.InitiativeRoll") } },
    { create: true, rollMode: CONFIG.Dice.BasicRoll.getMessageMode?.(),
      data: { ...(message?.data ?? {}), speaker: ChatMessage.implementation.getSpeaker({ actor }) } }
  );
}

/* -------------------------------------------- */
/*  Bonus breakdown                             */
/* -------------------------------------------- */

const DICE = /[+-]?\s*\d*d\d+(?:[a-z]+\d*)*/gi;
const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const changesOf = effect => effect.system?.changes ?? effect.changes ?? [];

/** The bonus paths (dnd5e 6 strings, dice possible) that count for this roll. */
function bonusPaths(request, ability) {
  const check = [`abilities.${ability}.check.roll.bonus`, "rolls.ability.check.bonus"];
  switch ( request.type ) {
    case "save": return [`abilities.${ability}.save.roll.bonus`, "rolls.ability.save.bonus"];
    case "skill": return [`skills.${request.key}.roll.bonus`, ...check, "rolls.ability.skill.bonus"];
    case "tool": return [`tools.${request.key}.roll.bonus`, ...check, "rolls.ability.tool.bonus"];
    case "initiative": return ["attributes.init.roll.bonus", ...check];
    default: return check;
  }
}

/**
 * The pre-dnd5e 6 keys that an effect still writes (the PHB's Guidance: `system.skills.slt.bonuses.check`, seen in play on
 * 2026-10-24) and that dnd5e converts when applying the effect (common.mjs:96 and following).
 */
function legacyPath(path) {
  let m;
  if ( (m = path.match(/^(skills|tools)\.(\w+)\.roll\.bonus$/)) ) return `${m[1]}.${m[2]}.bonuses.check`;
  if ( (m = path.match(/^abilities\.(\w+)\.(check|save)\.roll\.bonus$/)) ) return `abilities.${m[1]}.bonuses.${m[2]}`;
  if ( (m = path.match(/^rolls\.ability\.(\w+)\.bonus$/)) ) return `bonuses.abilities.${m[1]}`;
  return null;
}

/** The Active Effect that writes this path, or null. */
function effectWriting(actor, path) {
  const keys = [`system.${path}`, legacyPath(path) && `system.${legacyPath(path)}`].filter(Boolean);
  for ( const effect of actor.appliedEffects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( changesOf(effect).some(c => keys.includes(String(c.key ?? ""))) ) return effect;
  }
  return null;
}

/** An effect's image for a tile: that of its source item (the Guidance spell), otherwise its own. */
function effectImage(effect) {
  let origin = null;
  try { origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null; } catch { origin = null; }
  const item = (origin instanceof Item) ? origin : origin?.item ?? origin?.parent;
  return ((item instanceof Item) && item.img) || effect.img || null;
}

/**
 * The breakdown of what is added to the d20, read from the prepared sheet (effects included) — for an interface that shows one
 * tile per source, BG3 style. Indicative: the dnd5e roll is authoritative (a rule applied at roll time does not show in it).
 * @returns {Array<{kind: "ability"|"proficiency"|"bonus"|"dice"|"exhaustion"|"request"|"inspiration", label: string, value: string,
 *   img?: string, key?: string, reserve?: boolean}>}  `key`: the ability (`ability` tile); `reserve`: a die that is added only
 *   after a failure, if the player wants it (Bardic Inspiration already received) — outside the total bonus.
 */
export function breakdownOf(actor, request) {
  const system = actor?.system;
  if ( !system?.abilities ) return [];
  const ability = abilityOf(request, actor);
  const tiles = [];
  const mod = Number(system.abilities[ability]?.mod ?? 0);
  tiles.push({ kind: "ability", key: ability, label: abilityLabel(ability), value: signed(mod) });

  let source = null;
  if ( request.type === "check" ) source = system.abilities[ability]?.check;
  else if ( request.type === "save" ) source = system.abilities[ability]?.save;
  else if ( request.type === "skill" ) source = system.skills?.[request.key];
  else if ( request.type === "initiative" ) source = system.attributes?.init;
  else source = system.tools?.[request.key];
  const prof = source?.prof;
  if ( prof && (Number(prof.multiplier) > 0) && (Number(prof.flat) !== 0) ) {
    tiles.push({ kind: "proficiency", label: keyLabel(request), value: signed(Number(prof.flat)), multiplier: Number(prof.multiplier) });
  }
  // §397: Initiative keeps its bonus under `roll.bonus` (dnd5e 6: `attributes.init.bonus` is obsolete); dice are read from it
  // further down.
  const numeric = Number((request.type === "initiative") ? (source?.roll?.bonus || 0) : (source?.bonus ?? 0)) || 0;
  if ( numeric ) tiles.push({ kind: "bonus", label: game.i18n.localize("DND5E.Bonus"), value: signed(numeric) });

  for ( const path of bonusPaths(request, ability) ) {
    const raw = String(foundry.utils.getProperty(system, path) ?? "");
    const dice = raw.match(DICE);
    if ( !dice ) continue;
    const effect = effectWriting(actor, path);
    for ( const term of dice ) {
      const value = term.replace(/\s+/g, "");
      tiles.push({ kind: "dice", label: effect?.name ?? game.i18n.localize("DND5E.Bonus"), value: /^[+-]/.test(value) ? value : `+${value}`,
        img: effect ? effectImage(effect) : null });
    }
  }
  // dnd5e 6: the bonuses carried by effects' "applied rules" (`check:bonus`, `save:bonus`, and `d20:bonus` for any d20 Test —
  // documents/applied-rules.mjs:57-62), filtered by their conditions as at the roll (`filterWith`). Their flat parts are
  // already in the sheet's bonus (`ruleBonus`, creature.mjs:300); their dice are not — that is how a Guidance placed by a rule
  // escaped the tiles (seen by the user on 2026-10-24).
  const Rules = globalThis.dnd5e?.documents?.AppliedRules;
  if ( Rules ) {
    const { category, rollData } = rollContext(actor, request);
    try {
      for ( const rule of Rules.collect(`${category}:bonus`, actor).filterWith(rollData) ) {
        const dice = String(rule.value ?? "").match(DICE);
        for ( const term of dice ?? [] ) {
          const value = term.replace(/\s+/g, "");
          tiles.push({ kind: "dice", label: rule.effect?.name ?? game.i18n.localize("DND5E.Bonus"),
            value: /^[+-]/.test(value) ? value : `+${value}`, img: rule.effect ? effectImage(rule.effect) : null });
        }
      }
    } catch(err) { console.warn(`${MODULE_ID} | group roll: applied rules not read`, err); }
  }
  const reduction = Number(actor.conditionRollReduction ?? 0);
  if ( reduction ) tiles.push({ kind: "exhaustion", label: game.i18n.localize(CONFIG.DND5E.conditionTypes?.exhaustion?.name ?? "Exhaustion"),
    value: signed(reduction) });
  if ( request.bonus ) tiles.push({ kind: "request", label: "", value: signed(request.bonus) });
  // A Bardic Inspiration already received: it is added only after a failure (PHB 2024), at the player's choice.
  const inspiration = inspirationOf(actor);
  if ( inspiration ) tiles.push({ kind: "inspiration", label: inspiration.bard, value: `+${inspiration.formula}`, reserve: true,
    img: inspiration.source?.img ?? null });
  return tiles;
}

/* -------------------------------------------- */
/*  La carte                                    */
/* -------------------------------------------- */

/** The request carried by a card, or null. */
export function requestOf(message) {
  return message?.getFlag?.(MODULE_ID, GROUP_FLAG) ?? null;
}

/**
 * The state of a request card: each character (actor, player, total) and the tally (core/group-roll.mjs `tally`).
 * @param {ChatMessage} message
 * @returns {object|null}  `{ id, request, entries: [{actor, uuid, name, img, user, total, status, success, message}], …tally }`.
 */
export function viewOf(message) {
  const request = requestOf(message);
  if ( !request || (message.type !== "request") ) return null;
  const entries = (message.system?.targets ?? []).map(t => {
    const actor = fromUuidSync(t.actor);
    const result = t.result ?? null;
    const roll = result?.rolls?.[0] ?? null;
    // The die added after the roll (Bardic Inspiration…) counts toward the total (runtime/group-roll.mjs `bonusAfterRoll`).
    const bonus = result?.getFlag?.(MODULE_ID, "groupRollBonus") ?? null;
    // Pending a decision (Bardic Inspiration die offered, not yet settled): no total yet, the check waits.
    const deciding = result?.getFlag?.(MODULE_ID, "groupRollPending") === true;
    const total = (Number.isFinite(roll?.total) && !deciding) ? roll.total + (Number(bonus?.total) || 0) : null;
    // What the roll had: Advantage / Disadvantage (D20Roll#hasAdvantage, dice/d20-roll.mjs), aids granted, forced mode.
    return { uuid: t.actor, actor, name: actor?.name ?? "?", img: actor?.img ?? null, user: t.user?.id ?? null, total,
      d20: roll?.d20?.total ?? null, message: result?.id ?? null,
      advantage: !!roll?.hasAdvantage, disadvantage: !!roll?.hasDisadvantage,
      aids: [...(result?.getFlag?.(MODULE_ID, "groupRollAids") ?? []), ...(bonus?.parts ?? []).filter(p => p.helper)],
      forced: result?.getFlag?.(MODULE_ID, "groupRollForced") ?? null, bonus: Number(bonus?.total) || 0, deciding,
      rolled: Number.isFinite(roll?.total) ? roll.total : null,
      // Issue #32: accepted as a success at a cost (the GM offered it, the player said yes) — `{ cost }`.
      atCost: result?.getFlag?.(MODULE_ID, "atCost") ?? null,
      by: result?.author?.id ?? null };
  });
  return { id: message.id, request, ...tally(request, entries) };
}
