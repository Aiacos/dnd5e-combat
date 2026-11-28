/**
 * Who an action can affect (SPEC §16.8), read from Foundry for the core (core/eligibility.mjs): the creature's type
 * (`system.details.type.value`), its condition immunities (`system.traits.ci.value`), the conditions of the action's effects
 * (`getEffect()`, dnd5e 6: an effect can be a compendium reference), and what the content
 * declares (`targets.types`, `targets.unaffectedIf`).
 */

import { MODULE_ID } from "../constants.mjs";
import { typeAllowed, immuneToAll, castTargetRule } from "../core/eligibility.mjs";
import { holds } from "../core/triggers.mjs";
import { contentOf } from "./content.mjs";
import { factsFor, creatureTypeOf, conditionImmunitiesAgainst, originItemOf, enclosureBetween } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { samePlane } from "./plane.mjs";
import { inAntimagic, magicalUse, antimagicSourceName } from "./antimagic.mjs";

/**
 * §161: Globe of Invulnerability — "a spell of level 5 or lower cast from outside cannot affect anything inside the
 * Emanation" (content `globe: { radius, units, maxLevel }`, held by an effect of the globe's caster, Concentration included).
 * Returns the globe that protects the target from this spell, or null. `castLevel`: the level the spell is cast at.
 */
function globeAgainst(activity, token, castLevel) {
  if ( !isSpellCast(activity?.item) || !token?.parent ) return null;
  const caster = activity.actor?.getActiveTokens?.(false, true)?.find(t => t.parent === token.parent) ?? null;
  const factors = readUnitFactors();
  for ( const holder of token.parent.tokens ) {
    for ( const effect of holder.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = item ? contentOf(item).entry?.globe : null;
      if ( !rule || (castLevel > rule.maxLevel) ) continue;
      let radius = lengthIn(rule.radius, rule.units, token.parent.grid.units, factors);
      const inside = t => !!t && (distanceBetween(holder, t).value <= radius + 1e-6);
      // §163: `everywhere` (Antimagic Field) — wherever the spell comes from.
      if ( inside(token) && (rule.everywhere || !inside(caster)) ) return item;
    }
  }
  return null;
}

const effectKey = e => e._id ?? e.uuid;

/** What the content says about this activity's targets (`targets`), or null. */
export function targetRuleOf(activity) {
  if ( !activity?.item ) return null;
  const own = contentOf(activity.item).entry?.targets ?? null;
  // The copy of a spell that a "cast" activity cast (`flags.dnd5e.cachedFor`): what the original item says about its targets.
  const cached = activity.item.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item\.([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  const caster = m ? activity.item.actor?.items?.get(m[1]) : null;
  return caster ? castTargetRule(own, contentOf(caster).entry?.spellTargets, m[2]) : own;
}

/** The allowed types, if the creature is not one of them; otherwise null. */
export function wrongTypeFor(activity, actor) {
  const types = targetRuleOf(activity)?.types;
  return typeAllowed(types, creatureTypeOf(actor)) ? null : types;
}

/**
 * §293: does the content rule (`targets`: required type, `unaffectedIf`) rule out this creature? Synchronous, without plane
 * or immunities: what the "creatures of your choice" list does not offer (Turn Undead: a Humanoid).
 */
export function excludedByRule(activity, token) {
  const actor = token?.actor;
  if ( !actor || !activity ) return false;
  if ( wrongTypeFor(activity, actor) ) return true;
  const rule = targetRuleOf(activity);
  return !!(rule?.unaffectedIf && holds(rule.unaffectedIf, factsFor({ source: activity.actor ?? null, target: actor, activity, targetToken: token })));
}

/**
 * §505 (B25): is the condition the content requires of each target (`targets.requires`: "a creature in the swarm's space")
 * missed for this token? `origin`: the author's token.
 */
export function missesTargetRequirement(activity, token, origin=null) {
  const rule = targetRuleOf(activity)?.requires;
  if ( !rule || !token?.actor || !activity ) return false;
  return !holds(rule, factsFor({ source: activity.actor ?? null, target: token.actor, activity, sourceToken: origin, targetToken: token }));
}

/** "a Humanoid", "a Beast or Humanoid": the types in plain words, through dnd5e's labels. */
export function typesLabel(types) {
  return (types ?? []).map(t => game.i18n.localize(CONFIG.DND5E.creatureTypes?.[t]?.label ?? t).toLowerCase())
    .join(` ${game.i18n.localize("DND5ECOMBAT.Ou")} `);
}

/** The conditions of an effect of the plan (`{ id, activity }`, core/action.mjs). */
async function statusesOfRef(ref) {
  const activity = await fromUuid(ref.activity ?? "");
  const profile = activity?.effects?.find(e => effectKey(e) === ref.id);
  const effect = await profile?.getEffect?.();
  return Array.from(effect?.statuses ?? []);
}

/**
 * Why the action cannot affect the creature of this token, or null: forbidden type, content rule, or
 * immunity to each of its effects when it does nothing else (core/eligibility.mjs, `immuneToAll`).
 * §225: the plane first — a creature in the Ethereal Plane is only affected by what comes from the Ethereal, and conversely.
 * @returns {Promise<{reason: "plane"|"enclosed"|"antimagic"|"globe"|"type"|"content"|"immune", detail?: string}|null>}
 */
export async function unaffectedBy(activity, plan, token, { castLevel=null }={}) {
  const actor = token?.actor;
  if ( !actor || !activity ) return null;
  if ( activity.actor && !samePlane(activity.actor, actor) ) return { reason: "plane" };
  // §232: an Otiluke's sphere between the author and the target — neither from inside to outside, nor from outside to inside.
  const sphere = enclosureBetween(activity.actor, actor);
  if ( sphere ) return { reason: "enclosed", detail: sphere.name };
  // §436: dnd5e 6.1's `antimagic` status — neither spell nor magic item affects whoever stands in the field, from anywhere.
  if ( inAntimagic(actor) && magicalUse(activity) ) return { reason: "antimagic", detail: antimagicSourceName(actor) };
  const globe = globeAgainst(activity, token, castLevel ?? Number(activity.item?.system?.level ?? 0));
  if ( globe ) return { reason: "globe", detail: globe.name };
  // Superior Magic Resistance: "spell attack rolls automatically miss it" (`spellAttacksMiss`) — the target
  // is out of the spell's reach, under the name of the trait that protects it.
  if ( plan.attack && (activity.item?.type === "spell") ) {
    const proof = Array.from(actor.items ?? []).find(i => contentOf(i).entry?.spellAttacksMiss === true);
    if ( proof ) return { reason: "globe", detail: proof.name };
  }
  const rule = targetRuleOf(activity);
  const types = wrongTypeFor(activity, actor);
  if ( types ) return { reason: "type", detail: types.join(",") };
  if ( rule?.unaffectedIf && holds(rule.unaffectedIf, factsFor({ source: activity.actor ?? null, target: actor, activity, targetToken: token })) ) {
    return { reason: "content" };
  }
  const effects = [];
  for ( const ref of plan.effects ?? [] ) effects.push(await statusesOfRef(ref));
  const immune = immuneToAll({ damage: !!plan.damage || !!plan.heal, steps: (plan.steps?.length ?? 0) > 0, effects }, conditionImmunitiesAgainst(actor, activity.actor ?? null));
  return immune ? { reason: "immune", detail: immune } : null;
}

/** An effect the creature cannot receive (immunity to one of its conditions): its blocked conditions, otherwise empty. */
export function blockedFor(effect, actor, source=null) {
  const immune = conditionImmunitiesAgainst(actor, source);
  const blocked = Array.from(effect?.statuses ?? []).filter(s => immune.includes(s));
  if ( blocked.length ) console.log(`${MODULE_ID} | "${effect.name}" not applied to ${actor.name}: immunity (${blocked.join(", ")})`);
  return blocked;
}
