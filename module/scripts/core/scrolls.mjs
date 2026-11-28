/**
 * §48: the spell a scroll contains. Pure functions.
 *
 * dnd5e 6 makes a scroll as a consumable (`system.type.value === "scroll"`) that copies the spell's activities, effects
 * and properties, but keeps the identifier of the base scroll (`spell-scroll`, `spell-scroll-2nd-level`) and says
 * nowhere which spell it is (documents/item.mjs:1346, `createScrollFromSpell`); only the level is noted, in
 * `flags.dnd5e.spellLevel`. World scrolls come from three paths, surveyed in `ravenloft-test` on 2026-10-02:
 *  - dnd5e (sheet, merchant): "Parchemin: Mot de guérison", English spell name in `flags.babele.originalName`;
 *  - D&D Beyond import: "Parchemin: Command", English spell name in `flags.ddbimporter.originalName`;
 *  - old ones: "Spell Scroll: Spiritual Weapon", with no hint other than the name.
 * Hence: the identifier the engine itself sets at creation (`stamped`), otherwise candidates drawn from these names, validated
 * against the index of known spells (French and English names, identifiers).
 */

/**
 * A text as an identifier the way dnd5e forms it (utils.mjs, `formatIdentifier`: "a/b" → "a-b", then the core's
 * `slugify({ strict: true })`, common/primitives/string.mjs:73: accents transliterated, spaces and hyphens into one
 * hyphen, any other character REMOVED — "Melf's" → "melfs").
 */
export function slug(text) {
  return String(text ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
    .replace(/[\s-]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** The names of the base scroll, not of a spell ("Spell Scroll, 1st Level", "Parchemin de sort : 1er niveau"). */
const BASE = /^(spell-scroll|parchemin)(-|$)|^(\d+(st|nd|rd|th|er|e)-level|\d+(er|e)-niveau|cantrip|sorts?-mineurs?)$/;

/** The spell name in a scroll name: what follows the colon, or the whole name if there is none. */
export function spellPartOf(name) {
  const text = String(name ?? "");
  const at = text.lastIndexOf(":");
  return (at >= 0 ? text.slice(at + 1) : text).trim();
}

/**
 * The candidate identifiers of a scroll, from the most to the least reliable: the original (English) names before the shown name.
 * @param {object} names
 * @param {string} [names.name]                 The item's name.
 * @param {string[]} [names.originalNames=[]]   Babele, D&D Beyond import.
 * @returns {string[]}
 */
export function scrollCandidates({ name, originalNames=[] }={}) {
  const out = [];
  for ( const text of [...originalNames, name] ) {
    const candidate = slug(spellPartOf(text));
    if ( candidate && !BASE.test(candidate) && !out.includes(candidate) ) out.push(candidate);
  }
  return out;
}

/**
 * The spell of a scroll, or null.
 * @param {object} args
 * @param {{identifier: string, level?: number, school?: string}|null} [args.stamped]  Set by the engine at creation.
 * @param {string[]} args.candidates                     scrollCandidates.
 * @param {Map<string, {identifier: string, level?: number, school?: string}>} args.known
 *   The spell index: identifier, French name and English name (as a `slug`) → the spell.
 * @param {number|null} [args.level]                     `flags.dnd5e.spellLevel.value` of the scroll.
 * @returns {{identifier: string, level: number|null, school: string|null}|null}
 */
export function scrollSpell({ stamped=null, candidates=[], known=new Map(), level=null }) {
  const found = stamped?.identifier ? stamped : candidates.map(c => known.get(c)).find(Boolean);
  if ( !found?.identifier ) return null;
  const lvl = Number.isFinite(level) ? level : (Number.isFinite(found.level) ? found.level : null);
  return { identifier: found.identifier, level: lvl, school: found.school ?? null };
}

/**
 * O8g (§350): reading a spell scroll (Dungeon Master's Guide 2024, "Spell Scroll") — "if the spell is on your class's list,
 * you can read the scroll and cast its spell […]; otherwise it is unintelligible. If the spell is on your list but of a
 * higher level than you can cast, make an ability check with your spellcasting ability (DC 10 + the spell's level); on a
 * failure, the spell disappears from the scroll". Use Magic Device (Rogue): "any scroll; a cantrip or
 * level 1 spell is cast without a check, beyond that an Intelligence (Arcana) check DC 10 + level".
 * @param {{level: number, onList: boolean, anyScroll?: boolean, maxLevel?: number}} reader
 * @returns {{access: "free"|"check"|"refused", via: "class"|"device"|null, dc: number|null}}
 */
export function scrollAccess({ level, onList, anyScroll=false, maxLevel=0 }) {
  const lvl = Math.max(0, Number(level) || 0);
  if ( !onList && !anyScroll ) return { access: "refused", via: null, dc: null };
  if ( lvl === 0 ) return { access: "free", via: onList ? "class" : "device", dc: null };
  if ( onList && (lvl <= (Number(maxLevel) || 0)) ) return { access: "free", via: "class", dc: null };
  if ( anyScroll && (lvl <= 1) ) return { access: "free", via: "device", dc: null };
  // A check: the class's (spellcasting ability) if the spell is on its list, otherwise Intelligence (Arcana).
  return { access: "check", via: onList ? "class" : "device", dc: 10 + lvl };
}

/** O8g (§350): a character's highest spell slot level (slots or Pact Magic), 0 without slots. */
export function highestSlotLevel(spells={}) {
  let best = 0;
  for ( const [key, slot] of Object.entries(spells ?? {}) ) {
    const level = (key === "pact") ? Number(slot?.level) : Number(/^spell(\d)$/.exec(key)?.[1]);
    if ( Number.isFinite(level) && (Number(slot?.max) > 0) ) best = Math.max(best, level);
  }
  return best;
}
