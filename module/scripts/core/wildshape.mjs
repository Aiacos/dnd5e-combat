/**
 * Wild Shape (SPEC §16.39), the part computed without Foundry. 2024 PHB rules (druid):
 *  - known forms: 4 at level 2, 6 at level 4, 8 at level 8 ("Known Forms" column);
 *  - a form is taken from the known forms, within the limits of the activity's profile — maximum CR, type (Beast), and
 *    no flying speed before level 8 (dnd5e: `profiles[].cr`, `types`, `movement` excluded).
 * Pure functions.
 */

/** Le nombre de formes connues d'un druide de ce niveau. */
export function knownFormsMax(druidLevel) {
  if ( druidLevel >= 8 ) return 8;
  if ( druidLevel >= 4 ) return 6;
  if ( druidLevel >= 2 ) return 4;
  return 0;
}

/**
 * Why this form is not allowed by this profile, or null.
 * @param {{cr: number|null, type: string|null, fly: number}} form        The creature (CR, type, flying speed).
 * @param {{maxCr: number|null, types: string[], noMovement: string[]}} limits  The activity's profile.
 * @returns {"cr"|"type"|"fly"|null}
 */
export function formRefusal(form, { maxCr=null, types=[], noMovement=[] }={}) {
  if ( Number.isFinite(maxCr) && Number.isFinite(form.cr) && (form.cr > maxCr) ) return "cr";
  if ( types.length && !types.includes(form.type) ) return "type";
  if ( noMovement.includes("fly") && (form.fly > 0) ) return "fly";
  return null;
}

/** Must the form end? "It ends if you are Incapacitated or if you die" (and at 0 HP, you drop out of it). */
export function formMustEnd({ hp, statuses=[] }, incapacitating=[]) {
  if ( Number.isFinite(hp) && (hp <= 0) ) return true;
  return statuses.some(s => incapacitating.includes(s));
}

/* -------------------------------------------- */
/*  Cercle de la Lune : deux identifiants (§432) */
/* -------------------------------------------- */

/** The two identifiers of the subclass: `moon` (Player's Handbook 2.2.0), `circle-moon` (dnd5e 6.1 preset). */
const MOON_IDS = Object.freeze(["circle-moon", "moon"]);
const MOON_LEVELS = /@subclasses\.(circle-moon|moon)\.levels/g;
const BOTH_LEVELS = `max(${MOON_IDS.map(id => `@subclasses.${id}.levels`).join(", ")})`;

/**
 * §432: a Wild Shape preset formula (minimum AC, Temporary Hit Points) that reads the Circle of the Moon level under only one of
 * the two identifiers — returned reading the greater of the two. dnd5e 6.0 writes `@subclasses.moon.levels`, dnd5e 6.1
 * `@subclasses.circle-moon.levels`, and the Player's Handbook subclass is still called `moon`: in 6.1, the Moon druid
 * lost their minimum AC and Temporary Hit Points. A formula that already names both, or neither, comes back unchanged.
 */
export function moonLevelsFormula(formula) {
  if ( typeof formula !== "string" ) return formula;
  const named = new Set(Array.from(formula.matchAll(MOON_LEVELS), m => m[1]));
  if ( named.size !== 1 ) return formula;
  return formula.replace(MOON_LEVELS, BOTH_LEVELS);
}

/** §432: the spell lists kept under the form (`subclass:circle-moon`) — with that of the other identifier, if one is there. */
export function moonSpellLists(lists) {
  const all = Array.from(lists ?? []);
  const keys = MOON_IDS.map(id => `subclass:${id}`);
  if ( !keys.some(k => all.includes(k)) ) return all;
  return Array.from(new Set([...all, ...keys]));
}
