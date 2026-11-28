/**
 * §293: "each creature of your choice within a radius of…" (Turn Undead) — what the content declares (`pickTargets`) and
 * the creatures the list offers: within the caster's range (the engine's 3D distance, unit converted), on their plane, alive, not
 * objects, and that the activity's rule can affect (`targets`: Undead only — legality asks nothing again).
 * The activity that can replace it (`upgrade`: Sear Undead), if the caster has the item.
 */

import { contentOf, identifierOf } from "./content.mjs";
import { distanceBetween, usageTokenOf } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isDefeated } from "./movement.mjs";
import { samePlane } from "./plane.mjs";
import { areEnemies } from "./factions.mjs";
import { excludedByRule } from "./eligibility.mjs";
import { levelHidden } from "./level-gate.mjs";
import { originItemOf } from "./facts.mjs";
import { picksFor, withinCenters } from "../core/pick-after.mjs";

/** Bloodied: at half its maximum HP or less (and not at 0: "Survival" raises no one). */
const isBloodied = actor => { const hp = actor?.system?.attributes?.hp ?? {}; const max = hp.effectiveMax ?? hp.max ?? 0;
  return (max > 0) && (hp.value > 0) && (hp.value <= max / 2); };

/**
 * The targets of a use message, as dnd5e writes them (`TargetsField.getDescriptors`,
 * data/chat-message/fields/targets-field.mjs:32). The message of a suspended use (the choice window) already took them,
 * empty: the rerun sets them itself.
 */
export function targetDescriptorsOf(tokens) {
  const own = globalThis.dnd5e?.dataModels?.chatMessage?.fields?.TargetsField?.getDescriptors;
  if ( typeof own === "function" ) return own.call(dnd5e.dataModels.chatMessage.fields.TargetsField, tokens);
  return tokens.filter(t => t.actor).map(t => ({ actor: t.actor.uuid, ac: t.actor.statuses?.has("coverTotal") ? null : (t.actor.system.attributes?.ac?.value ?? null),
    img: t.texture?.src, name: t.name, token: t.uuid }));
}

/** §438: does the effect come from this item (its origin, by uuid: the item, or one of its activities)? */
function carriesFrom(effect, item) {
  if ( originItemOf(effect)?.uuid === item.uuid ) return true;
  const o = effect.system?.origin ?? {};
  return [o.activity, o.item, effect.origin, effect._source?.origin].some(u => (typeof u === "string") && ((u === item.uuid) || u.startsWith(`${item.uuid}.`)));
}

/** The activity's rule, or null. */
export function pickTargetsOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.pickTargets : null;
  // §438: not for a utility manifestation followed by a list (`after`) — it places the Emanation, the list comes after.
  return (rule && picksFor(rule, activity.id, activity.type)) ? rule : null;
}

/**
 * The activity that can replace this one (`upgrade`), on an item of the same actor, or null. §431: a list is read in order
 * (the Sear Undead of the Handbook and of dnd5e 6.0's SRD, then that of the 6.1 SRD, carried by Channel Divinity); `requires`,
 * an item the caster must have in addition; never the activity itself (6.1 "Sear Undead" used directly). §438: never an
 * activity hidden at this level by the data (the Handbook 3.0.0 "Sear Undead", visible at Cleric level 5: dnd5e would
 * refuse to use it).
 */
export function upgradeOf(activity, rule=pickTargetsOf(activity)) {
  if ( !rule?.upgrade || !activity?.actor ) return null;
  const items = Array.from(activity.actor.items);
  const has = id => items.some(i => identifierOf(i).id === id);
  for ( const wanted of [rule.upgrade].flat() ) {
    if ( wanted.requires && !has(wanted.requires) ) continue;
    const found = items.find(i => (identifierOf(i).id === wanted.item) && i.system?.activities?.get?.(wanted.activity))
      ?.system.activities.get(wanted.activity);
    if ( found && (found !== activity) && (found.id !== activity.id) && !levelHidden(found) ) return found;
  }
  return null;
}

/**
 * The creatures the list offers, nearest first.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {(token: TokenDocument) => boolean} [options.seen]  What the user sees (the interface passes it); by default, everything.
 * @param {TokenDocument[]|null} [options.centers]  §438: the creatures around which the Emanation is manifested (`after`
 *   chain); by default the caster, and (`bearers`) any creature that carries an effect of the item.
 * @returns {{caster: TokenDocument|null, radius: number, units: string,
 *   creatures: Array<{token: TokenDocument, distance: number, enemy: boolean}>}}
 */
export function pickCandidates(activity, { seen=() => true, centers=null, rule: given=null }={}) {
  const rule = given ?? pickTargetsOf(activity);
  const caster = usageTokenOf(activity);
  if ( !rule || !caster?.parent ) return { caster: caster ?? null, radius: 0, units: "", creatures: [] };
  const units = caster.parent.grid.units;
  // §300: a radius as a formula (class scaling) is read in the activity's roll data.
  const raw = (typeof rule.radius === "string")
    ? (Number(globalThis.dnd5e?.utils?.simplifyBonus?.(rule.radius, activity.getRollData?.() ?? {})) || 0) : rule.radius;
  const radius = lengthIn(raw, rule.units, units);
  // §438: the centers and their radius — the caster at the rule's radius; another creature at the `bearers` radius
  // (Wrath of the Sea manifested on an ally: 3 m), otherwise at the rule's radius.
  const otherRadius = rule.bearers ? lengthIn(rule.bearers.radius, rule.bearers.units, units) : radius;
  const item = activity.item;
  const bearers = (!centers && rule.bearers && item) ? caster.parent.tokens.filter(t => (t !== caster) && t.actor
    && Array.from(t.actor.effects ?? []).some(e => !e.disabled && carriesFrom(e, item))) : [];
  const around = (centers ?? [caster, ...bearers]).map(t => ({ token: t, radius: (t === caster) ? radius : otherRadius }));
  const creatures = [];
  for ( const token of caster.parent.tokens ) {
    // §296: `self` — the caster too (Beacon of Hope, "Survival": "including you").
    if ( ((token === caster) && !rule.self) || !token.actor || token.hidden || isObjectToken(token) || isDefeated(token) ) continue;
    // §438: "ANOTHER creature in the Emanation" — not the one around whom it is manifested.
    if ( around.some(c => (c.token === token) && (c.token !== caster)) ) continue;
    if ( !samePlane(caster, token) || !seen(token) || excludedByRule(activity, token) ) continue;
    // §296: `filter: "bloodied"` — only Bloodied creatures, at half their HP or less ("Survival").
    if ( (rule.filter === "bloodied") && !isBloodied(token.actor) ) continue;
    const distance = (token === caster) ? 0
      : withinCenters(around.map(c => ({ radius: c.radius, distance: (c.token === token) ? 0 : distanceBetween(c.token, token).value })));
    if ( distance === null ) continue;
    const enemy = (token !== caster) && areEnemies(caster, token);
    creatures.push({ token, distance, enemy, checked: (rule.check === "allies") ? !enemy : enemy });
  }
  creatures.sort((a, b) => (a.distance - b.distance) || a.token.name.localeCompare(b.token.name));
  // §296: `max` — "one creature of your choice", "up to six": no more ticked in advance than allowed.
  let left = Number.isInteger(rule.max) ? rule.max : Infinity;
  for ( const c of creatures ) if ( c.checked ) { if ( left > 0 ) left--; else c.checked = false; }
  return { caster, radius, units, creatures, max: Number.isInteger(rule.max) ? rule.max : null, centers: around.map(c => c.token) };
}
