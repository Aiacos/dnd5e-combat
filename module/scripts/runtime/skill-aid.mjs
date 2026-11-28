/**
 * §113: help requested for a skill or tool check (BG3 style) — the request goes to the helper's player
 * (core `user.query` request; otherwise the active GM), who accepts or refuses:
 *  - Guidance: the helper REALLY casts the spell on the tester (their Concentration, the skill effect chosen in advance,
 *    without the 18-effects question); the native effect adds the 1d4, to this check and the following ones as long as the
 *    spell lasts;
 *  - Bardic Inspiration: the bard really uses their Inspiration on the tester (one use, the "Inspired" effect); the
 *    die is rolled after the check, if it is missed (runtime/roll-bonus.mjs);
 *  - Help: nothing is cast, the check has Advantage (the interface sets it in the roll window) and a card says so.
 * The one who asks and already owns the helper (the same player, or the GM with no player connected) is not asked.
 */

import { MODULE_ID } from "../constants.mjs";
import { replacesConcentration } from "../core/concentration.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { timedWait, combatWindowSeconds, windowsUnlimited } from "../adapter/dialogs.mjs";
import { queryPlayer, waitLabel } from "../adapter/player-wait.mjs";
import { guidanceSpellOf, guidanceEffectFor } from "../adapter/skill-aid.mjs";
import { inspirationSourceOf, usesLeftFor } from "../adapter/inspiration.mjs";
import { castOnTargets } from "./actions.mjs";
import { log, loc, say, locEsc } from "./shared.mjs";

export const SKILL_AID_QUERY = `${MODULE_ID}.skillAid`;

/** A free check is not a combat: the helper is given time to read. */
const answerSeconds = () => Math.max(20, combatWindowSeconds());

/** The name of the check: the skill or the tool. */
export function testLabel({ skill=null, tool=null }) {
  if ( skill ) return game.i18n.localize(CONFIG.DND5E.skills?.[skill]?.label ?? skill);
  return globalThis.dnd5e?.documents?.Trait?.keyLabel?.(tool, { trait: "tool" }) ?? tool ?? "";
}

/** The help, on the client that owns the helper. Returns true if it is given. */
async function perform({ kind, helper, tester, skill, tool }) {
  const actor = await fromUuid(helper);
  const target = await fromUuid(tester);
  if ( !actor || !target?.actor ) return false;
  const what = testLabel({ skill, tool });
  if ( kind === "help" ) {
    await say({ actor }, locEsc("AideTest.CarteSoutien", { helper: actor.name, name: target.name, test: what }));
    log(`help: ${actor.name} helps ${target.name} with their ${what} check (Advantage)`);
    return true;
  }
  if ( kind === "inspiration" ) {
    const source = inspirationSourceOf(actor);
    if ( !source ) {
      ui.notifications.warn(loc("AideTest.SansInspiration", { name: actor.name }));
      return false;
    }
    await castOnTargets(source.activity, [{ [MODULE_ID]: { confirmed: true } }, { configure: false }, {}], [target.uuid]);
    log(`Bardic Inspiration: ${actor.name} inspires ${target.name} (${what})`);
    return true;
  }
  const spell = guidanceSpellOf(actor);
  const found = guidanceEffectFor(spell, skill);
  if ( !found ) {
    ui.notifications.warn(loc("AideTest.SansSort", { name: actor.name }));
    return false;
  }
  await castOnTargets(found.activity, [{ [MODULE_ID]: { choice: found.effectId, confirmed: true } }, { configure: false }, {}], [target.uuid]);
  log(`guidance: ${actor.name} casts ${spell.name} on ${target.name} (${what})`);
  return true;
}

/**
 * Helper side: the question, then the help. "No" at the end of the delay.
 * @param {{kind: "guidance"|"inspiration"|"help", helper: string, tester: string, skill: string|null, tool: string|null}} payload
 *   `helper`: uuid of the actor who helps; `tester`: uuid of the token making the check.
 */
export async function handleSkillAidQuery(payload) {
  const actor = await fromUuid(payload.helper);
  const target = await fromUuid(payload.tester);
  if ( !actor || !target ) return false;
  const what = testLabel(payload);
  // Casting Guidance ends the Concentration in progress (dnd5e replaces it without a window): we say so. §494: only if the
  // creature already holds as many as its limit (several Concentrations at once: nothing drops below it).
  const held = Array.from(actor.concentration?.effects ?? []);
  const current = ((payload.kind === "guidance") && replacesConcentration(held.length, actor.system?.attributes?.concentration?.limit)) ? held[0] : null;
  const source = payload.kind === "inspiration" ? inspirationSourceOf(actor) : null;
  const ask = { guidance: "DemandeAssistance", inspiration: "DemandeInspiration", help: "DemandeSoutien" }[payload.kind];
  const lines = [loc(`AideTest.${ask}`, { name: target.name, test: what, formula: source?.formula ?? "",
    left: source ? usesLeftFor(source.activity) : 0 })];
  if ( current ) lines.push(loc("AideTest.FinConcentration", { effect: current.name }));
  const answer = await timedWait({
    window: { title: loc(`AideTest.${{ guidance: "TitreAssistance", inspiration: "TitreInspiration", help: "TitreSoutien" }[payload.kind]}`, { name: actor.name }) },
    content: lines.map(l => `<p>${l}</p>`).join(""),
    buttons: [
      { action: "yes", label: loc("AideTest.Accepter"), icon: "fa-solid fa-hand-holding-heart", default: true },
      { action: "no", label: loc("AideTest.Refuser"), icon: "fa-solid fa-xmark" }
    ]
  }, { fallback: "no", seconds: windowsUnlimited() ? null : answerSeconds(), awaiting: { actor, kind: "choice" } });   // §290: no delay, the GM forces
  if ( answer !== "yes" ) return false;
  return perform(payload);
}

/**
 * On the tester's client: asks for help from whoever plays the helper. Returns true if it is given (Guidance is then
 * cast; its effect arrives a little later, through the active GM's resolution).
 * @param {{kind: "guidance"|"inspiration"|"help", helper: Actor, tester: TokenDocument,
 *   skill?: string|null, tool?: string|null}} request
 */
export async function requestSkillAid({ kind, helper, tester, skill=null, tool=null }) {
  const payload = { kind, helper: helper.uuid, tester: tester.uuid, skill, tool };
  const userId = rollerFor(helper);
  if ( (userId === game.user.id) || (!userId && helper.isOwner) ) return perform(payload);
  const user = userId ? game.users.get(userId) : game.users.activeGM;
  if ( !user ) {
    ui.notifications.warn(loc("AideTest.Personne", { name: helper.name }));
    return false;
  }
  try {
    return (await queryPlayer(user, SKILL_AID_QUERY, payload, { timeout: (answerSeconds() + 15) * 1000, actor: helper,
      label: waitLabel("Aide") })) === true;
  }
  catch(err) {
    console.warn(`${MODULE_ID} | check aid: no answer for ${helper.name}`, err);
    return false;
  }
}

export function registerSkillAid() {
  CONFIG.queries[SKILL_AID_QUERY] = handleSkillAidQuery;   // on every client: the helper's player is the one who answers
}
