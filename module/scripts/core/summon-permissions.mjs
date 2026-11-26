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

/**
 * The data problems that make a summon place nothing without a word (Discord "Summon spells", 2026-11-26): dnd5e skips the creature
 * part silently when the activity has no profile, or none allowed at this cast level (`availableProfiles` empty: `create.summons`
 * false, dnd5e 6.1.1 dnd5e.mjs:41342), and `placeSummons` returns without a message when the chosen profile names no creature
 * (`if ( !summonUuid ) return`, dnd5e 6.0.3 documents/activity/summon.mjs:141-142) or when no scene is viewed (:122).
 */
export const SUMMON_DATA_PROBLEMS = Object.freeze(["noProfile", "noProfileAtLevel", "noScene", "noCreature"]);

/**
 * Why this use of a summon activity placed nothing, when no right is missing (see `summonBlocker`), or null.
 * @param {{ profiles?: number, available?: number, meantToPlace?: boolean, placing?: boolean, crMode?: boolean,
 *   chosenHasCreature?: boolean, scene?: boolean, placed?: number }} facts
 *   `profiles`: profiles on the activity; `available`: those allowed at the cast level; `meantToPlace`: the activity places its
 *   creature on use (`summon.prompt`, or content `placesSummons`); `placing`: dnd5e was told to place it (`create.summons`);
 *   `crMode`: the creature is picked in the compendium browser (`summon.mode` "cr"), not named by the profile;
 *   `chosenHasCreature`: the chosen profile names a creature (`uuid`); `placed`: tokens dnd5e placed.
 * @returns {"noProfile"|"noProfileAtLevel"|"noScene"|"noCreature"|null}
 */
export function summonDataProblem({ profiles=0, available=0, meantToPlace=false, placing=false, crMode=false, chosenHasCreature=true,
  scene=true, placed=0 }={}) {
  if ( placed > 0 ) return null;
  // No creature at all: never anything to summon, the chat card has no Summon button either.
  if ( profiles <= 0 ) return meantToPlace ? "noProfile" : null;
  if ( available <= 0 ) return meantToPlace ? "noProfileAtLevel" : null;
  // The user unticked "Place Summons" in dnd5e's window (or the activity never places): their choice.
  if ( !placing ) return (meantToPlace && !scene) ? "noScene" : null;
  if ( !scene ) return "noScene";
  if ( !crMode && !chosenHasCreature ) return "noCreature";
  return null;
}
