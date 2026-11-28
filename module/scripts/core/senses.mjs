/**
 * Senses declared by content (key `sense`) and what protects against them (key `wardsDetection`). Pure rule.
 *
 * A sense that is not sight gives a creature's position without letting it be seen: the target stays unseen for the attack and
 * for whatever requires seeing it. A sense of kind `sight` counts as sight. Some only give presence
 * (`reveals: "presence"`), without the position.
 *
 * The adapter (adapter/senses.mjs) reads the scene: distance, wall between the two, facts about the target, protections it carries.
 */

import { holds } from "./triggers.mjs";

/** The verdicts of a sense, from weakest to strongest. */
export const SENSE_VERDICTS = Object.freeze(["aura", "presence", "locate", "sight"]);

/**
 * What a sense can reveal instead of the position (`reveals`): `presence` — the presence is known, not the position;
 * `aura` — nothing more than what is already seen: the visible creature that carries what the sense detects is marked
 * (Detect Magic).
 */
export const SENSE_REVEALS = Object.freeze(["presence", "aura"]);

/** The kinds of sense: `locate` — position known, not sight; `sight` — counts as sight. */
export const SENSE_KINDS = Object.freeze(["locate", "sight"]);

/** The senses a content entry carries: `sense` is a sense or a list. */
export function sensesIn(entry) {
  const declared = entry?.sense;
  if ( !declared ) return [];
  return Array.isArray(declared) ? declared : [declared];
}

/**
 * Is the target protected against this sense? `wards`: what its protections stop — a school of magic (spells of this
 * school do not find it), or `magic` (no magical detection finds it). A sense without `magic` is natural: nothing
 * stops it.
 * @param {{magic?: string|true}} sense  `magic`: the school of the spell that grants it, or true for a magical effect with no
 *   school.
 * @param {string[]} wards
 */
export function wardedAgainst(sense, wards) {
  if ( !sense?.magic || !wards?.length ) return false;
  return wards.includes("magic") || ((typeof sense.magic === "string") && wards.includes(sense.magic));
}

/** What a declared sight can pierce (`through`): Darkness. Never fog, which stops all sight. */
export const SENSE_THROUGH = Object.freeze(["darkness"]);

/** What a sense can depend on (`needs`): it goes out while its bearer is Blinded (`sight`) or Deafened (`hearing`). */
export const SENSE_NEEDS = Object.freeze(["sight", "hearing"]);

/**
 * What a sense says about a target: `"sight"`, `"locate"`, `"presence"`, `"aura"`, or null.
 *
 * A sense that locates depends neither on light nor on the Invisible condition. A sight (`kind: "sight"`), yes: it does not see an
 * Invisible target, fog always stops it, and Darkness too, unless it pierces it (`through: ["darkness"]`).
 * @param {{kind: string, range: number, walls?: false, reveals?: "presence", magic?: string|true, through?: string[],
 *   needs?: "sight"|"hearing"}} sense  `range`: in the unit of `distance`.
 * @param {{distance: number, walled: boolean, matches: boolean, wards: string[], blind?: boolean, deaf?: boolean,
 *   invisible?: boolean, fog?: boolean, darkness?: boolean}} facts  `walled`: a wall separates them; `matches`: the target is one
 *   of those the sense detects; `wards`: what the target is protected from; `blind`, `deaf`: the bearer is Blinded, Deafened;
 *   `invisible`: the target is Invisible to them; `fog`, `darkness`: an area that blocks sight between them, or around one of them.
 */
export function senseVerdict(sense, { distance, walled, matches, wards, blind=false, deaf=false, invisible=false, fog=false,
  darkness=false }) {
  if ( !sense || !matches ) return null;
  if ( !(distance <= sense.range) ) return null;
  if ( ((sense.needs === "sight") && blind) || ((sense.needs === "hearing") && deaf) ) return null;
  if ( walled && (sense.walls !== false) ) return null;
  if ( wardedAgainst(sense, wards) ) return null;
  if ( SENSE_REVEALS.includes(sense.reveals) ) return sense.reveals;
  if ( sense.kind === "sight" ) {
    if ( invisible || fog ) return null;
    if ( darkness && !sense.through?.includes("darkness") ) return null;
  }
  return sense.kind;
}

/** Le plus fort de plusieurs verdicts, ou null. */
export function bestVerdict(verdicts) {
  let best = -1;
  for ( const verdict of verdicts ) best = Math.max(best, SENSE_VERDICTS.indexOf(verdict));
  return (best < 0) ? null : SENSE_VERDICTS[best];
}

/**
 * `detectedAs`: for senses, a creature can also count as other types than its own (it "is perceived as" an
 * Undead). Does what the sense detects (`detects`) hold for the target as it is, or as one of these types? Never
 * for anything but senses: neither the attack nor the saving throw reads these types.
 * @param {object|null} detects  The sense's condition (core/triggers.mjs `holds`); absent: any creature.
 * @param {object} facts  The facts about the target.
 * @param {string[]} [alsoTypes]  The types under which it is also perceived.
 */
export function detectsTarget(detects, facts, alsoTypes=[]) {
  if ( holds(detects, facts) ) return true;
  return alsoTypes.some(type => holds(detects, { ...facts, "target.creatureType": type }));
}

/**
 * `senseNeeds`: the sheet's senses (detection modes: `blindsight`…) turned off right now, because they depend on their
 * bearer's sight or hearing and they are Blinded or Deafened — a Blindsight by echolocation.
 * @param {Array<Record<string, "sight"|"hearing">>} needs  The `senseNeeds` of the bearer's items.
 * @param {{blind?: boolean, deaf?: boolean}} state
 * @returns {string[]}  The ids of the modes turned off.
 */
export function mutedSenses(needs, { blind=false, deaf=false }={}) {
  const muted = new Set();
  for ( const declared of needs ?? [] ) {
    for ( const [mode, need] of Object.entries(declared ?? {}) ) {
      if ( ((need === "sight") && blind) || ((need === "hearing") && deaf) ) muted.add(mode);
    }
  }
  return Array.from(muted);
}

/**
 * Setting `anonymousLocated`: is a creature perceived without being seen — heard (`heard`) or located by a sense (`located`) —
 * shown without its image or its name? Its position is known, not its identity. An aura (`aura`) is placed on what is seen:
 * never.
 * @param {"heard"|"located"|"aura"|null} kind  What the token is displayed for on this client.
 * @param {boolean} rule  The world setting.
 */
export function hidesIdentity(kind, rule) {
  return !!rule && ((kind === "heard") || (kind === "located"));
}

/**
 * Does a creature displayed by a declared sense carry the "located, not seen" mark? Yes if none of this client's observers
 * SEES it through a declared sense (`sight`: sight through walls) — seen, it keeps the outline, without the mark or
 * the Disadvantage it announces.
 * @param {Array<"sight"|"locate"|"presence"|"aura"|null>} verdicts  What each observer's declared senses say about it.
 */
export function onlyLocated(verdicts) {
  return !(verdicts ?? []).includes("sight");
}

/**
 * Issue #107: does the observer know where the target is? `located`: it sees the target or locates it (`canLocate`, which rules
 * out a creature Hidden from it). A sense that locates without sight (Tremorsense, a declared `locate` sense) still pinpoints a
 * Hidden creature's square (`sensed`): the creature stays unseen and keeps its Hidden state — attacks against it keep the
 * Disadvantage of an unseen target, and nothing reveals it. Sight never finds a Hidden creature here: that is the Search action.
 * @param {{located: boolean|null, hidden: boolean, sensed: boolean|null}} facts  `hidden`: Hidden from this observer.
 * @returns {boolean|null}  null: the vision cannot tell.
 */
export function pinpoints({ located, hidden, sensed }) {
  if ( (located !== false) || !hidden ) return located;
  return sensed;
}

/**
 * Issue #107: is a creature drawn for a declared sense's verdict? A sense that locates draws it, Hidden or not (its square is
 * known); a declared sight draws it unless it is Hidden from the observer.
 * @param {"sight"|"locate"|"presence"|"aura"|null} verdict
 * @param {boolean} hidden  Hidden from this observer.
 */
export function drawsSensed(verdict, hidden) {
  return (verdict === "locate") || ((verdict === "sight") && !hidden);
}
