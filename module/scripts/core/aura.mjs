/**
 * Passive auras (the Paladin's Aura of Protection): an effect that creatures receive as long
 * as they stand near another, and lose when moving away. dnd5e 6.0 can only do this
 * for an area placed by an activity; its official Aura of Protection only affects the
 * paladin. Pure functions, no dependency on Foundry.
 */

import { alliedSides } from "./factions.mjs";

/**
 * @typedef {object} AuraSource
 * @property {string} token          UUID of the token bearing the aura.
 * @property {string} key            Identifier of the aura (two auras with the same name do not stack).
 * @property {number} disposition
 * @property {boolean} inactive      Bearer Incapacitated or dead: the aura is off.
 * @property {number} radius         In the same unit as the distances supplied.
 * @property {"ally"|"enemy"|"any"|"summoner"} affects
 * @property {string[]} [summoners]  §403: with `summoner`, the tokens of whoever summoned the bearer.
 * @property {boolean} includeSelf   Does the bearer receive the copy too? (no if it already has the original effect)
 * @property {number} value          Strength of the aura, to tell apart two auras with the same name.
 * @property {string[]} [types]      Only these creature types ("the Undead of its choice").
 */

/**
 * Who receives the aura of a source, among tokens whose distance to that source is known.
 * `lineOfEffect`: false excludes (Total Cover between the two), null or absent does not exclude; `type`: creature type.
 */
export function auraRecipients(source, candidates) {
  if ( source.inactive ) return [];
  return candidates.filter(c => {
    if ( c.token === source.token ) return source.includeSelf;
    if ( c.distance > source.radius + 1e-6 ) return false;
    // An Emanation is stopped by Total Cover (2024 rules): floor, ceiling, solid wall — P2 (§14.2).
    if ( c.lineOfEffect === false ) return false;
    if ( source.types?.length && !source.types.includes(c.type) ) return false;
    if ( source.affects === "summoner" ) return (source.summoners ?? []).includes(c.token);
    if ( source.affects === "ally" ) return alliedSides(c, source);     // §181 : factions, sinon dispositions
    if ( source.affects === "enemy" ) return !alliedSides(c, source);
    return true;
  }).map(c => c.token);
}

/**
 * What each token must bear, all sources combined. Two auras with the same name do not
 * stack: the stronger one wins (2024 rules, "effects with the same name").
 * @param {Array<{source: AuraSource, recipients: string[]}>} auras
 * @returns {Array<{target: string, key: string, source: string, value: number}>}
 */
export function wantedAuraEffects(auras) {
  const best = new Map();
  for ( const { source, recipients } of auras ) for ( const target of recipients ) {
    const slot = `${target}|${source.key}`;
    const current = best.get(slot);
    if ( !current || (source.value > current.value) ) best.set(slot, { target, key: source.key, source: source.token, value: source.value });
  }
  return Array.from(best.values());
}

/**
 * Difference between the aura copies that exist and those we want.
 * @param {Array<{id: string, target: string, key: string, source: string, value: number}>} existing
 * @param {Array<{target: string, key: string, source: string, value: number}>} wanted
 * @returns {{create: object[], update: object[], remove: object[]}}
 */
export function planAuraChanges(existing, wanted) {
  const slot = e => `${e.target}|${e.key}`;
  const wantedBySlot = new Map(wanted.map(w => [slot(w), w]));
  const seen = new Set();
  const update = [];
  const remove = [];
  for ( const e of existing ) {
    const w = wantedBySlot.get(slot(e));
    if ( !w || seen.has(slot(e)) ) { remove.push(e); continue; }   // plus voulue, ou doublon
    seen.add(slot(e));
    if ( (w.source !== e.source) || (w.value !== e.value) ) update.push({ ...w, id: e.id });
  }
  const create = wanted.filter(w => !seen.has(slot(w)));
  return { create, update, remove };
}
