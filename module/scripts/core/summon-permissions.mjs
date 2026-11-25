/**
 * §542 (issue #43): can the players summon? dnd5e only places a summoned creature when the user may create tokens and, for a
 * player, when the world setting "Allow Summoning" is on (`SummonActivity#canSummon`, dnd5e 6.1.1 dnd5e.mjs:41329). The first
 * summon of a creature that lives in a compendium also imports it into the world, which needs "Create New Actors"
 * (`Actor5e.fetchExisting`, dnd5e.mjs:43886). Without them the creature window never opens and nobody is told.
 *
 * Pure rules: the facts are read by adapter/summon-permissions.mjs.
 */

/** The gaps, most blocking first. `tokenCreate` and `allowSummoning` block every summon; `actorCreate` the first one of a creature. */
export const SUMMON_GAPS = Object.freeze(["allowSummoning", "tokenCreate", "actorCreate"]);

/**
 * What stops the players of this world from summoning.
 * @param {{ allowSummoning: boolean, players: { name: string, tokenCreate: boolean, actorCreate: boolean }[] }} facts
 *   `players`: the non-GM users (a GM is never blocked).
 * @returns {{ key: string, players?: string[] }[]} one entry per gap, in `SUMMON_GAPS` order; empty without players.
 */
export function summonGaps({ allowSummoning=false, players=[] }={}) {
  if ( !players.length ) return [];
  const gaps = [];
  if ( !allowSummoning ) gaps.push({ key: "allowSummoning" });
  const lacking = right => players.filter(p => !p[right]).map(p => p.name);
  const noToken = lacking("tokenCreate");
  if ( noToken.length ) gaps.push({ key: "tokenCreate", players: noToken });
  const noActor = lacking("actorCreate");
  if ( noActor.length ) gaps.push({ key: "actorCreate", players: noActor });
  return gaps;
}

/**
 * The signature of a set of gaps, kept when the GM chooses "don't show again": the alert comes back only when a new kind of gap
 * appears (not when one more player lacks a right already reported).
 */
export const gapSignature = gaps => [...new Set(gaps.map(g => g.key))].sort().join(",");

/** True when these gaps contain a kind the dismissed signature did not have. */
export function hasNewGap(gaps, dismissed="") {
  const seen = new Set(String(dismissed ?? "").split(",").filter(Boolean));
  return gaps.some(g => !seen.has(g.key));
}

/**
 * Why this user cannot place the creature of this summon, or null.
 * @param {{ isGM: boolean, tokenCreate: boolean, actorCreate: boolean, allowSummoning: boolean, needsImport?: boolean }} user
 *   `needsImport`: the chosen creature lives in a compendium and has no world copy yet (dnd5e will import it).
 * @returns {"tokenCreate"|"allowSummoning"|"actorCreate"|null}
 */
export function summonBlocker({ isGM=false, tokenCreate=false, actorCreate=false, allowSummoning=false, needsImport=false }={}) {
  if ( !tokenCreate ) return "tokenCreate";
  if ( !isGM && !allowSummoning ) return "allowSummoning";
  if ( needsImport && !actorCreate ) return "actorCreate";
  return null;
}
