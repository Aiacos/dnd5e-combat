/**
 * M7 (SPEC §18.11): monster auras that act — Fire Aura (damage at the end of the bearer's turn), Stench (save
 * at the start of the turn of a creature inside). What the content does not say is read in the item's original English text:
 * "unless Incapacitated", "other than a Ghast", "immune … for 24 hours". Pure functions, without Foundry.
 */

import { hostileSides } from "./factions.mjs";

/**
 * The moments of an Emanation: the end of its bearer's turn, the start of the turn of a creature inside it, the death of
 * its bearer (§18.14, Death Burst of Mephits, Death Throes of the Balor).
 */
export const EMANATION_MOMENTS = Object.freeze(["ownTurnEnd", "ownTurnStart", "turnStart", "death"]);

const plain = html => String(html ?? "").replace(/\[\[[^\]]*\]\]/g, "…").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

/**
 * What the English text of an Emanation specifies.
 *  - `active`: "unless / while … doesn't have the Incapacitated condition" — off if the bearer is Incapacitated;
 *  - `kin`: "any creature (other than a Ghast)" — those that carry the same Emanation are not subject to it;
 *  - `immunity`: "Success: The target is immune to this …'s Fear Aura for 24 hours" (`all: false`, that bearer only) or
 *    "immune to the Stench of all ghasts for 1 hour" (`all: true`, all Emanations of that name).
 * @param {string} html
 * @returns {{active: boolean, kin: boolean, immunity: {hours: number, all: boolean}|null}}
 */
export function readEmanationText(html) {
  const text = plain(html);
  const active = /\b(unless|while|provided)\b[^.]{0,80}\bIncapacitated\b/i.test(text);
  const kin = /\bother than an?\s/i.test(text);
  let immunity = null;
  const m = text.match(/\bimmune to (the [^.]*? of all|this|th)[^.]*?\bfor (?:the next )?(\d+|one|an?) hours?\b/i);
  if ( m ) {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : 1;
    immunity = { hours: n, all: /\bof all\b/i.test(m[1]) };
  }
  return { active, kin, immunity };
}

/**
 * Whom the Emanation reaches, among creatures whose distance to the bearer is known.
 * @param {{token: string, disposition: number, radius: number, affects: "any"|"enemy", inactive: boolean}} source
 * @param {Array<{token: string, disposition: number, distance: number, lineOfEffect?: boolean|null, kin?: boolean,
 *   immune?: boolean, sees?: boolean|null, out?: boolean}>} candidates
 *   `out`: out of play (dead, hidden, piloted object); `sees`: false excludes (the Emanation requires being seen), null does
 *   not exclude.
 * @returns {string[]}
 */
export function emanationTargets(source, candidates) {
  if ( source.inactive ) return [];
  return candidates.filter(c => {
    if ( (c.token === source.token) || c.out || c.kin || c.immune ) return false;
    if ( !(c.distance <= source.radius + 1e-6) ) return false;
    if ( c.lineOfEffect === false ) return false;   // an Emanation is stopped by Total Cover (§14.2)
    if ( c.sees === false ) return false;
    if ( source.affects === "enemy" ) return hostileSides(source, c);   // "of its choice": opposing sides
    return true;
  }).map(c => c.token);
}

