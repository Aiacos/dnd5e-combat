/**
 * §72: the contest (key `contest`) — what touches dnd5e: the item's rule, the skill checks, the applied effect.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { bestSkill } from "../core/contest.mjs";
import { applyEffectsToToken } from "./saves.mjs";

/** The `contest` rule that applies to this activity, or null. */
export function contestOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.contest : null;
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return rule;
}

/** An actor's total skill bonuses, by key (`system.skills.<clé>.total`). */
const skillBonuses = actor => Object.fromEntries(Object.entries(actor?.system?.skills ?? {}).map(([k, s]) => [k, Number(s?.total) || 0]));

/**
 * An actor's skill check, with no dialog (the best among `skills`). Returns `{ skill, total }`, or null.
 * @param {Actor5e} actor
 * @param {string[]} skills
 */
export async function rollContestSkill(actor, skills) {
  const skill = bestSkill(skillBonuses(actor), skills);
  if ( !actor || !skill ) return null;
  const rolls = await actor.rollSkill({ skill }, { configure: false });
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? { skill, total } : null;
}

/** The active player who owns this actor (not a GM), or null. */
export function playerOwnerOf(actor) {
  return game.users.find(u => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? null;
}

/**
 * Applies the won effect to the target; `exclusive`: first removes those that the same item from the same author placed on other
 * actors in the scene ("until it successfully uses this feature against a different target").
 * Returns the number of effects applied.
 */
export async function applyContestWin(usageMessage, activity, targetToken, rule) {
  if ( rule.exclusive ) {
    const scene = targetToken.parent;
    for ( const token of scene?.tokens ?? [] ) {
      if ( token === targetToken ) continue;
      const ids = (token.actor?.effects ?? []).filter(e => fromUuidSync(e.origin ?? "", { strict: false })?.item === activity.item
        || (fromUuidSync(e.origin ?? "", { strict: false }) === activity.item)).map(e => e.id);
      if ( ids.length ) await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  }
  const applied = await applyEffectsToToken(usageMessage, targetToken.uuid, [{ id: rule.effect, activity: activity.uuid }]);
  return applied.length;
}

/** Chat announcement: the two rolls and the outcome. */
export function announceContest({ actor, target, mine, theirs, outcome, item }) {
  const label = k => CONFIG.DND5E.skills?.[k]?.label ?? k;
  const verdict = game.i18n.localize(`DND5ECOMBAT.Opposition.${outcome === "win" ? "Gagne" : (outcome === "tie" ? "Egalite" : "Perdu")}`);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p><strong>${item.name}</strong> — ${game.i18n.format("DND5ECOMBAT.Opposition.Resume", {
      name: actor.name, skill: label(mine.skill), total: mine.total, target: target.name, against: label(theirs.skill), theirs: theirs.total })}</p><p>${verdict}</p>`,
    flags: { [MODULE_ID]: { contest: { item: item.uuid, target: target.uuid, mine: mine.total, theirs: theirs.total, outcome } } }
  });
}
