/**
 * §282: Heroic Inspiration (PHB 2024) — "if you (a player character) have Heroic Inspiration, you can spend it to reroll any die
 * immediately after rolling it, and you must use the new roll". User request (2026-10-30): at each roll, BEFORE it is confirmed
 * and before Bardic Inspiration, a foreground window offers to reroll a die.
 *
 * Where the question is asked (each time before the other after-roll dice):
 *  - attack roll (runtime/engine-messages.mjs, `inspiredAttack`): a d20 of choice if Advantage / Disadvantage; the new d20 redoes
 *    the Critical Hit and the automatic failure;
 *  - saving throw requested by a resolution (same file, `onSaveMessage`);
 *  - free check (`dnd5e.rollSkill`, `rollAbilityCheck`, `rollToolCheck`): here, then runtime/roll-bonus.mjs waits for the answer
 *    (`heroicAfter`) before its own dice — the registrants of the same hook do not wait for each other (runtime/router.mjs);
 *  - roll requested by the GM (runtime/group-roll.mjs, `decideBonus`);
 *  - initiative (core card, active GM): here, "Hypervigilance" waits (`heroicAfter`);
 *  - damage and healing (runtime/engine-messages.mjs, `onDamageMessage`): the player chooses THE die to reroll (the user's
 *    choice).
 *
 * The client setting `heroicInspiration` filters on the answering side (adapter/heroic.mjs): at each roll, only on a failure (a
 * damage roll: a die at half its maximum or less), never. The original roll is not rewritten: the reroll goes off in the clear on
 * its own card, waits for Dice So Nice to finish, then the result counts. Feedback to the whole table: text above the token and
 * sound.
 *
 * Feedback to the table only when Inspiration is USED (user request, 2026-10-30): golden flash on the token, scrolling text,
 * drum hit — on each client. Neither the window nor the gain makes a sound.
 */

import { MODULE_ID } from "../constants.mjs";
import { rerolledD20, damageDiceLow, keptOf } from "../core/heroic.mjs";
import { HEROIC_QUERY, HEROIC_SETTING, askHeroic, d20Facts, damageDice, hasHeroic, handleHeroicQuery, spendHeroic } from "../adapter/heroic.mjs";
import { route } from "./router.mjs";
import { loc, log, notice, tokenOfActor, waitForDice } from "./shared.mjs";

/** The result of the question asked on a roll (a `Roll` or a message id), for the dice waiting their turn. */
const pending = new WeakMap();
const pendingById = new Map();

/** The after-roll dice wait for Heroic Inspiration to be decided on this roll (`Roll` or message id); null otherwise. */
export function heroicAfter(key) {
  return ((typeof key === "string") ? pendingById.get(key) : pending.get(key)) ?? null;
}

function remember(key, promise) {
  if ( typeof key === "string" ) {
    pendingById.set(key, promise);
    promise.finally(() => setTimeout(() => pendingById.delete(key), 60000));
  }
  else if ( key ) pending.set(key, promise);
  return promise;
}

/** The sound and text of a reroll, for the whole table. */
function announce(actor, data) {
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Heroique.Avis", data }, "heroic", { all: true, action: "heroic", outcome: "success" });
}

/** The "Keep the roll" option. */
const keepOption = () => ({ id: "keep", label: loc("Heroique.Garder"), icon: "fa-solid fa-check", class: "dnd5e-combat-heroic-keep" });

/** Font Awesome's die icons, by faces. */
const DIE_ICONS = { 4: "fa-dice-d4", 6: "fa-dice-d6", 8: "fa-dice-d8", 10: "fa-dice-d10", 12: "fa-dice-d12", 20: "fa-dice-d20" };

/** A die to reroll, as a tile: its value large, a caption below ("kept", "d8 Fire"), the detail in a tooltip. */
function dieOption(index, { value, faces, caption, state, tooltip }) {
  return { id: String(index), label: String(value), icon: `fa-solid ${DIE_ICONS[faces] ?? "fa-dice"}`, caption, tooltip,
    class: ["dnd5e-combat-heroic-die", state].filter(Boolean).join(" ") };
}

/**
 * A d20 roll of the creature, read from its card: the question, then the reroll of the chosen d20. Returns null (no Inspiration,
 * refusal, setting) or `{ total, delta, old, kept, critical, fumble }` — the roll after the reroll.
 * @param {Actor} actor
 * @param {{roll: Roll, what: string, needed?: number|null, failed?: boolean|null, total?: number}} context
 *   `total`: the total in force if it differs from the roll's; `failed`: the outcome when the engine judges it itself (an attack
 *   against several targets); otherwise deduced from `needed` (null: unknown).
 */
export async function offerHeroicD20(actor, { roll, what, needed=null, failed, total }={}) {
  if ( !hasHeroic(actor) ) return null;
  const facts = d20Facts(roll);
  if ( !facts ) return null;
  if ( Number.isFinite(total) ) facts.total = total;
  const outcome = (failed !== undefined) ? failed : (Number.isFinite(needed) ? (facts.total < needed) : null);
  const two = facts.values.length > 1;
  // Advantage / Disadvantage: the d20 that counts is marked "kept", the other "discarded" (only one kept if both are equal).
  const keptIndex = two ? facts.values.indexOf(keptOf(facts.values, facts.mode)) : 0;
  const answer = await askHeroic(actor, {
    actor: actor.uuid, item: loc("Heroique.Nom"), failed: outcome,
    prompt: loc(Number.isFinite(needed) ? "Heroique.QuestionD20DD" : "Heroique.QuestionD20", { what, total: facts.total, needed }),
    // "Keep" first: with no answer within the delay, the window takes the first option. Each d20 is a tile with its value.
    options: [keepOption(),
      ...facts.values.map((value, i) => dieOption(i, { value, faces: 20,
        caption: two ? loc(i === keptIndex ? "Heroique.Garde" : "Heroique.Ecarte") : "d20",
        state: two ? (i === keptIndex ? "kept" : "dropped") : "kept",
        tooltip: loc(two ? "Heroique.RelancerUn" : "Heroique.RelancerD20", { value }) }))]
  });
  const index = Number(answer?.id);
  if ( !answer || !Number.isInteger(index) || !(index in facts.values) ) return null;
  if ( !await spendHeroic(actor) ) return null;
  const reroll = await new Roll("1d20").evaluate();
  const after = rerolledD20(facts, index, reroll.total);
  const message = await reroll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("Heroique.CarteD20", { name: actor.name, what, old: facts.values[index], new: reroll.total, before: facts.total, after: after.total }),
    flags: { [MODULE_ID]: { heroic: { kind: "d20", old: facts.values[index], new: reroll.total, total: after.total } } } });
  if ( message ) await waitForDice(message);
  announce(actor, { old: facts.values[index], new: reroll.total });
  log(`${actor.name}: Heroic Inspiration, d20 ${facts.values[index]} → ${reroll.total} (${what} ${facts.total} → ${after.total})`);
  return after;
}

/**
 * A damage or healing roll of the creature: the player chooses the die to reroll. Returns null, or
 * `{ type, properties, old, now }` — the part of the engine's aggregate that changes, and by how much.
 * @param {Actor} actor
 * @param {Roll[]} rolls  The message's `DamageRoll`s.
 */
export async function offerHeroicDamage(actor, rolls) {
  if ( !hasHeroic(actor) || !rolls?.length ) return null;
  const dice = damageDice(rolls);
  if ( !dice.length ) return null;
  const total = rolls.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const typeLabel = type => CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? "";
  const answer = await askHeroic(actor, {
    actor: actor.uuid, item: loc("Heroique.Nom"), failed: damageDiceLow(dice),
    prompt: loc("Heroique.QuestionDegats", { total }),
    // A die at half its maximum or less comes out (the good candidate for a reroll).
    options: [keepOption(),
      ...dice.map((d, i) => dieOption(i, { value: d.value, faces: d.faces, caption: `d${d.faces} ${typeLabel(d.type)}`.trim(),
        state: (d.value <= d.faces / 2) ? "low" : null,
        tooltip: loc("Heroique.RelancerDe", { faces: d.faces, value: d.value, type: typeLabel(d.type) }) }))]
  });
  const die = dice[Number(answer?.id)];
  if ( !answer || (answer.id === "keep") || !die ) return null;
  if ( !await spendHeroic(actor) ) return null;
  // The modifiers that bound the die (Great Weapon Fighting style: "min3") also apply to the reroll.
  const reroll = await new Roll(`1d${die.faces}${die.modifiers.join("")}`).evaluate();
  const message = await reroll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("Heroique.CarteDegats", { name: actor.name, faces: die.faces, old: die.value, new: reroll.total, before: total, after: total - die.value + reroll.total }),
    flags: { [MODULE_ID]: { heroic: { kind: "damage", faces: die.faces, old: die.value, new: reroll.total } } } });
  if ( message ) await waitForDice(message);
  announce(actor, { old: die.value, new: reroll.total });
  log(`${actor.name}: Heroic Inspiration, d${die.faces} ${die.value} → ${reroll.total}`);
  return { type: die.type, properties: die.properties, old: die.value, now: reroll.total };
}

/* -------------------------------------------- */
/*  Tests libres et initiative                  */
/* -------------------------------------------- */

function checkName({ skill, tool, ability }) {
  if ( skill ) return CONFIG.DND5E.skills?.[skill]?.label ?? skill;
  if ( tool ) return CONFIG.DND5E.tools?.[tool]?.label ?? game.i18n.localize("DND5E.ToolCheck");
  return CONFIG.DND5E.abilities?.[ability]?.label ?? ability ?? "";
}

/** A check rolled by this client: the question, held for runtime/roll-bonus.mjs. A roll requested by the GM has its own circuit. */
function onCheckRolled(rolls, { skill=null, tool=null, ability=null, subject }={}) {
  const roll = rolls?.[0];
  if ( !subject?.isOwner || !roll || roll.options?.[MODULE_ID]?.groupRoll || !hasHeroic(subject) ) return;
  const needed = Number.isFinite(roll.options?.target) ? roll.options.target : null;
  return remember(roll, offerHeroicD20(subject, { roll, what: checkName({ skill, tool, ability }), needed }).catch(err => {
    console.warn(`${MODULE_ID} | Heroic Inspiration on a check`, err);
    return null;
  }));
}

/** The combatant whose initiative card carries the roll (its token, and initiative equal to the total). */
function combatantOfMessage(message) {
  const { token, actor } = message.speaker ?? {};
  const total = message.rolls?.[0]?.total;
  const matches = game.combats.contents.flatMap(combat => combat.combatants.filter(c => (token ? c.tokenId === token : c.actorId === actor)));
  return matches.find(c => Number.isFinite(total) && (Math.abs(c.initiative - total) < 1e-6)) ?? null;
}

/** Initiative (active GM): the reroll corrects the value in force by the difference. */
function onInitiativeMessage(message) {
  if ( !message.getFlag?.("core", "initiativeRoll") ) return;
  const combatant = combatantOfMessage(message);
  const actor = combatant?.actor;
  if ( !hasHeroic(actor) ) return;
  return remember(message.id, (async () => {
    const after = await offerHeroicD20(actor, { roll: message.rolls?.[0], what: game.i18n.localize("DND5E.Initiative"), failed: null });
    if ( !after?.delta ) return after;
    await combatant.update({ initiative: (combatant.initiative ?? after.total - after.delta) + after.delta });
    return after;
  })().catch(err => {
    console.warn(`${MODULE_ID} | Heroic Inspiration on Initiative`, err);
    return null;
  }));
}

/* -------------------------------------------- */
/*  Donner l'Inspiration (MJ)                   */
/* -------------------------------------------- */

/** The GM gives or removes Inspiration (engine menu, `api.heroic.set`); a card tells the table. */
export async function setHeroic(actor, on) {
  if ( (actor?.type !== "character") || (!!actor.system.attributes?.inspiration === !!on) ) return false;
  await actor.update({ "system.attributes.inspiration": !!on });
  await ChatMessage.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${foundry.utils.escapeHTML(loc(on ? "Heroique.CarteDonnee" : "Heroique.CarteRetiree", { name: actor.name }))}</p>`,
    flags: { [MODULE_ID]: { heroic: { kind: on ? "given" : "removed" } } } });
  return true;
}

export function registerHeroic() {
  game.settings.register(MODULE_ID, HEROIC_SETTING, {
    name: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.Aide`,
    scope: "client", config: true, type: String, default: "on",
    choices: { on: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.on`, failure: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.failure`,
      off: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.off` }
  });
  CONFIG.queries[HEROIC_QUERY] = handleHeroicQuery;   // on all clients: the player is the one who answers
  // dnd5e 6.0: documents/actor/actor.mjs — `dnd5e.roll${name}` after a check, on the client that rolled it (`subject` = the actor).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "Heroic Inspiration not offered on a check" });
  }
  route("createChatMessage", onInitiativeMessage, { executor: true, label: "Heroic Inspiration not offered on Initiative" });
}
