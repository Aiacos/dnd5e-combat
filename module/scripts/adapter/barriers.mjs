/**
 * §163: emanations that protect or forbid, held by an effect of their caster (concentration included) and centered on it —
 * they follow it:
 *  - `globe: { radius, units, maxLevel, everywhere? }` (adapter/eligibility.mjs, §161); `everywhere` — Antimagic Field: no spell
 *    affects anyone there, wherever it is cast from, and no spell is cast there;
 *  - `barrier: { radius, units, exceptTypes? }` — Antilife Shell: a creature (outside `exceptTypes`) cannot enter, nor strike
 *    in melee through without a reach weapon; O9h (§363): `onlyTypes`, `shields` (nothing it does reaches the inside),
 *    `endsOnContact` (Scroll of Protection).
 * Read only: legality (runtime/turn.mjs, runtime/actions.mjs) and eligibility decide.
 */

import { contentOf } from "./content.mjs";
import { originItemOf, creatureTypeOf } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { inAntimagic, antimagicSourceName } from "./antimagic.mjs";

/** The `key` emanations of the scene: `{ holder, item, rule }`, one per caster and per item. */
export function zonesOf(scene, key) {
  const out = [];
  for ( const holder of scene?.tokens ?? [] ) {
    const seen = new Set();
    for ( const effect of holder.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = item ? contentOf(item).entry?.[key] : null;
      if ( !rule || seen.has(item.uuid) ) continue;
      seen.add(item.uuid);
      out.push({ holder, item, rule });
    }
  }
  return out;
}

/** An emanation's radius, in the grid's unit. */
function radiusOf(scene, rule) {
  return lengthIn(rule.radius, rule.units, scene.grid.units);
}

/** Is the token (at its position, or at `pos`) inside the emanation of `holder`? */
export function insideZone(holder, token, rule, pos=undefined) {
  if ( !holder || !token || (holder.parent !== token.parent) ) return false;
  return distanceBetween(holder, token, pos ? { posB: pos } : {}).value <= radiusOf(token.parent, rule) + 1e-6;
}

/**
 * The antimagic field this token stands in, or null: `{ name, status, item? }`. §436: first the `antimagic` status of dnd5e
 * 6.1 (placed by a `dnd5e.antimagic` region — the SRD's Field, the Handbook's by the engine, runtime/antimagic.mjs —, or by hand);
 * otherwise (dnd5e 6.0, region absent) the `everywhere` globe of §163, read on the field caster's effect.
 */
export function antimagicAround(token) {
  if ( inAntimagic(token?.actor) ) return { name: antimagicSourceName(token.actor), status: true, item: null };
  const zone = zonesOf(token?.parent, "globe").find(z => z.rule.everywhere && insideZone(z.holder, token, z.rule)) ?? null;
  return zone ? { ...zone, name: zone.item.name, status: false } : null;
}

/** §436: would the token be in an `everywhere` globe (§163) at `pos`? The globe, or null. */
export function antimagicGlobeAt(token, pos) {
  return zonesOf(token?.parent, "globe").find(z => z.rule.everywhere && insideZone(z.holder, token, z.rule, pos)) ?? null;
}

/**
 * Does the creature pass the barrier (exempt types, the caster itself)? O9h (§363): `onlyTypes` — only these creatures are
 * stopped (Scroll of Protection).
 */
const crosses = (zone, token) => {
  if ( zone.holder === token ) return true;
  const type = creatureTypeOf(token.actor);
  if ( zone.rule.onlyTypes ) return !zone.rule.onlyTypes.includes(type);
  return (zone.rule.exceptTypes ?? []).includes(type);
};

/**
 * §163: Antilife Shell — the barrier this movement would cross from outside to inside, or null. `positions`: the successive
 * positions of the movement (waypoints), the first excluded.
 */
export function barrierCrossed(token, positions) {
  for ( const zone of zonesOf(token?.parent, "barrier") ) {
    if ( crosses(zone, token) || insideZone(zone.holder, token, zone.rule) ) continue;
    if ( positions.some(pos => insideZone(zone.holder, token, zone.rule, pos)) ) return zone;
  }
  return null;
}

/**
 * §163: Antilife Shell — "prevents creatures … from reaching through": a melee attack without reach, from outside
 * toward a target inside. Returns the barrier, or null.
 */
export function barrierBetween(attacker, target, activity) {
  const melee = (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !activity.item?.system?.properties?.has?.("rch");
  for ( const zone of zonesOf(attacker?.parent, "barrier") ) {
    // O9h (§363): `shields` — the stopped creature affects nothing in the area, whatever the action (Scroll of Protection).
    if ( !melee && !zone.rule.shields ) continue;
    if ( crosses(zone, attacker) || insideZone(zone.holder, attacker, zone.rule) ) continue;
    if ( insideZone(zone.holder, target, zone.rule) ) return zone;
  }
  return null;
}

/**
 * O9h (§363): `endsOnContact` — this bearer's barriers that now contain a creature they stop (it moved
 * up to it: the emanation falls). Returns `{ item, rule }` for each.
 */
export function breachedBarriers(holder) {
  return zonesOf(holder?.parent, "barrier").filter(zone => (zone.holder === holder) && zone.rule.endsOnContact
    && (holder.parent?.tokens ?? []).some(t => t.actor && !crosses(zone, t) && ((t.actor.system?.attributes?.hp?.value ?? 1) > 0)
      && insideZone(zone.holder, t, zone.rule)));
}
