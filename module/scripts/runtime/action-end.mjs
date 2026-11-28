/**
 * An action ends an effect (SPEC §43.2, content `actionEnds`).
 *
 *  - The bearer: through "Escape" (basic action, menu of its own token — runtime/grapple.mjs adds them to what one
 *    escapes from). `roll: "check"`: the item's check, like a restraint; `roll: "save"`: the spell's save replayed
 *    (repeated save card: on success, the effect drops); with no roll: the effect drops.
 *  - Another creature: through the bearer's context menu ("Wake", "Free") — it comes into contact, spends its
 *    action there, makes the check if there is one.
 * An effect of another creature is not removed from a player's client, and a repeated save card is played on the GM's side:
 * the active GM makes the gesture (core request), after rereading the rule in the content.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { checkUse, spendUse } from "../core/turn.mjs";
import { actionEndingsOf } from "../adapter/action-end.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { setStatus } from "../adapter/conditions.mjs";
import { combatantFor, readBudget, writeBudget, isOwnTurn } from "../adapter/turn.mjs";
import { joinToken } from "./actions.mjs";
import { saveActivityOf } from "./triggers.mjs";
import { log, loc, locEsc, notice, rolledAndShown, say, viaActiveGM } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";

export const ACTION_END_QUERY = `${MODULE_ID}.actionEnd`;

/** Active GM: the effect drops, or its save is replayed. The rule is reread here — a client cannot make just anything drop. */
async function handleActionEnd({ effect: uuid }, { user=null }={}) {
  const effect = await fromUuid(uuid ?? "");
  const actor = effect?.parent;
  if ( actor?.documentName !== "Actor" ) return false;
  const own = actionEndingsOf(actor, "bearer").find(e => e.effect === effect);
  const ending = own ?? actionEndingsOf(actor, "other").find(e => e.effect === effect);
  if ( !ending ) return false;
  // §472: from a player, the bearer ends their own effect; another must have a creature of theirs on the same scene.
  if ( needsCheck(user) ) {
    const scene = tokenOf(actor)?.parent ?? null;
    const allowed = (own && actsFor(user, actor))
      || (!own && !!scene && scene.tokens.some(t => t.actor && (t.actor !== actor) && actsFor(user, t.actor)));
    if ( !allowed ) { console.warn(`${MODULE_ID} | actionEnd query from ${user.name} refused: ${effect.name} on ${actor.name} is not theirs to end`); return false; }
  }
  const token = tokenOf(actor);
  if ( ending.rule.roll === "save" ) {
    const origin = await fromUuid(effect.system?.origin?.activity ?? "");
    const activity = saveActivityOf(origin ?? ending.item.system.activities?.find?.(a => a.type === "save") ?? null);
    if ( (activity?.type !== "save") || !token ) { log(`${ending.item.name}: saving throw as an action impossible (save activity or token not found)`); return false; }
    log(`${ending.item.name}: ${actor.name} repeats the saving throw (action)`);
    await resaveAgainst(effect, activity, token, "action");
    return true;
  }
  log(`${ending.item.name}: "${effect.name}" ends on ${actor.name} (action)`);
  if ( token ) notice(token, effect.name, "effectOff");
  await effect.delete();
  // §49: "by inflicting the Prone condition on yourself and rolling on the ground" (Alchemist's Fire).
  if ( ending.rule.status ) await setStatus(actor, ending.rule.status, true);
  // §288: "it escapes and the spell ends" (Maze) — the caster's Concentration on the item.
  if ( ending.rule.spell ) {
    const concentration = concentrationOn(ending.item);
    if ( concentration ) await ending.item.actor.endConcentration(concentration);
  }
  return true;
}

function askExecutor(effect) {
  return viaActiveGM(ACTION_END_QUERY, handleActionEnd, { effect: effect.uuid }, { noGm: "Fin.SansMJ", fallback: false });
}

/** The bearer's effects that it ends itself through an action. */
export const ownEndingsOf = actor => actionEndingsOf(actor, "bearer");

/** The effects of `target` (TokenDocument) that another creature ends through an action. */
export const endingsOn = target => actionEndingsOf(target?.actor, "other");

/**
 * The bearer ends their effect — save replayed, or end with no roll. The action is already paid ("Escape" basic action,
 * or budget debited for an NPC: runtime/grapple.mjs). The check of a `roll: "check"` goes through escaping a restraint.
 * @returns {Promise<boolean>}  Was the gesture made (not: did the effect drop — a save remains to be played)?
 */
export async function endOwn(ending) {
  return (await askExecutor(ending.effect)) === true;
}

/** Pays `token`'s action in combat; false (and the reason stated) if it is not available. The GM is never held back. */
export async function payAction(token) {
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return true;
  const request = { cost: "action", weaponAttack: false, usesSpellSlot: false };
  const before = readBudget(combatant);
  const own = isOwnTurn(combatant);
  const issues = checkUse(before, request, { isOwnTurn: own });
  // §412 (issue #44, batch 5): no flat refusal — the legality window; forced, the action is taken anyway (the GM notified).
  if ( issues.length && !game.user.isGM
    && !(await askAnyway(loc("Force.TitreAction", { name: token.name }), issues.map(i => loc(`Souci.${i}`)), { actor: token.actor, token })) ) return false;
  await writeBudget(combatant, spendUse(before, request, { isOwnTurn: own, attacksPerAction: 1 }));
  return true;
}

/**
 * `token` ends an effect of `target`: it comes into contact, spends its action there, makes the check if there is one.
 * @returns {Promise<boolean>}  Did the effect drop?
 */
export async function endFor(token, target, ending) {
  const near = await joinToken(token, target);
  if ( !near.arrived ) { notice(token, loc("Fin.TropLoin", { name: target.name })); return false; }
  if ( !(await payAction(token)) ) return false;
  if ( ending.check ) {
    const { ability, skill, dc } = ending.check;
    const rolls = skill
      ? await token.actor.rollSkill({ skill, ...(ability ? { ability } : {}), target: dc }, { configure: false })
      : await token.actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( !Number.isFinite(total) ) return false;
    log(`${token.name} ${total >= dc ? "frees" : "fails to free"} ${target.name} from ${ending.item.name} (${total} vs DC ${dc})`);
    if ( total < dc ) { ui.notifications.info(loc("Fin.Rate", { name: token.name, target: target.name, source: ending.item.name })); return false; }
  }
  const done = (await askExecutor(ending.effect)) === true;
  if ( done ) log(`${token.name} ends ${ending.item.name} on ${target.name}`);
  return done;
}

/**
 * §288: at the start of its turn, the bearer of a `turnStart` effect (Maze: banished, its hidden token no longer offers itself
 * to a click) is offered the action that ends it — on their player's side, otherwise the GM's. Yes: the action paid, the
 * item's check (`check`), on success, the effect drops (and the spell with it, `spell`). Card and floating text for all. Active GM.
 */
async function offerAtTurnStart(combatant) {
  const actor = combatant?.actor;
  const endings = ownEndingsOf(actor).filter(e => e.rule.turnStart && e.check);
  for ( const ending of endings ) {
    const { ability, skill, dc } = ending.check;
    const what = skill ? (CONFIG.DND5E.skills[skill]?.label ?? skill) : (CONFIG.DND5E.abilities[ability]?.label ?? ability);
    const answer = await askChoice(actor, { actor: actor.uuid, item: ending.item.name,
      prompt: loc("Fin.Etude.Question", { item: ending.item.name, check: what, dc }),
      options: [{ id: "yes", label: loc("Fin.Etude.Oui") }, { id: "no", label: loc("Fin.Etude.Non") }] });
    if ( answer?.id !== "yes" ) continue;
    const budget = readBudget(combatant);
    if ( budget ) await writeBudget(combatant, spendUse(budget, { cost: "action", weaponAttack: false, usesSpellSlot: false }, { isOwnTurn: true, attacksPerAction: 1 }));
    const rolls = await rolledAndShown(() => skill
      ? actor.rollSkill({ skill, ...(ability ? { ability } : {}), target: dc }, { configure: false })
      : actor.rollAbilityCheck({ ability, target: dc }, { configure: false }));
    const total = rolls?.[0]?.total;
    const success = Number.isFinite(total) && (total >= dc);
    log(`${ending.item.name}: ${actor.name} studies (${total} vs DC ${dc}) — ${success ? "escapes" : "stays"}`);
    await say({ actor }, locEsc(success ? "Fin.Etude.Reussie" : "Fin.Etude.Ratee", { name: actor.name, item: ending.item.name, total, dc }),
      { actionEnd: { item: ending.item.name, total, dc, success } });
    if ( success ) await handleActionEnd({ effect: ending.effect.uuid });
    return;
  }
}

export function registerActionEnd() {
  CONFIG.queries[ACTION_END_QUERY] = handleActionEnd;
  route("combatTurnChange", (combat, prior, current) => {
    const started = combat.combatants.get(current?.combatantId);
    if ( started?.actor ) return enqueue(`actionEnd:${started.actor.uuid}`, () => offerAtTurnStart(started));
  }, { executor: true, label: "study to escape: not offered" });
}
