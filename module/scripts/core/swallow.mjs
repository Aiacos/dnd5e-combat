/**
 * M8 (SPEC §18.17): Swallow / Engulf (Behir, Purple Worm, Remorhaz, Tarrasque, Kraken, Giant Toad and Giant Frog; Gelatinous
 * Cube, Blob of Annihilation, Shambling Mound). What the original English text says, and when the damage lands.
 * Pure functions, no Foundry.
 */

import { plainStatText as plain } from "./text.mjs";

/**
 * - `damageAt`: "at the start of each of the behir's turns" (`ownerStart`), "at the start of each of its turns"
 *   (`targetStart`: Kraken, Blob, Mound), "at the end of each of the toad's turns" (`ownerEnd`), "At the end of the
 *   frog's next turn" (`ownerEndOnce`: then the frog spits it out); null if the text says nothing;
 * - `threshold`: "If the behir takes 30 damage or more on a single turn from the swallowed creature" — regurgitate.
 * @param {string} html
 * @returns {{damageAt: string|null, threshold: number|null}}
 */
export function readSwallow(html) {
  const text = plain(html);
  let damageAt = null;
  if ( /\bat the end of the [^.]{0,40}'s next turn\b/i.test(text) ) damageAt = "ownerEndOnce";
  else if ( /\bat the start of each of its turns\b/i.test(text) ) damageAt = "targetStart";
  else if ( /\bat the start of each of the [^.]{0,40}'s turns\b/i.test(text) ) damageAt = "ownerStart";
  else if ( /\bat the end of each of the [^.]{0,40}'s turns\b/i.test(text) ) damageAt = "ownerEnd";
  const threshold = Number(text.match(/\btakes (\d+) damage or more on a single turn from\b/i)?.[1]) || null;
  return { damageAt, threshold, ...readSwallowLimits(text) };
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const SIZE_WORDS = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

/**
 * §18.21: what the text limits or adds.
 *  - `capacity`: "can have only one creature swallowed at a time" (1), "up to four creatures swallowed at a time" (4),
 *    "only one creature Grappled by this action at a time" (Mound); null with no written limit;
 *  - `grappling`: "swallows a Medium or smaller target it is grappling" (the target must be grappled by the swallower; elsewhere
 *    the MM says it in the activity's target, read by the adapter);
 *  - `forbids`: "it can't use Bite while it has a swallowed target" → the English name of the forbidden item;
 *  - `repeatsSave`: "repeats the save at the end of each of its turns" (Blob of Annihilation);
 *  - `moving`: "each creature whose space the cube enters for the first time during this move" — engulfing while walking,
 *    `maxSize`: "can move through the spaces of Large or smaller creatures" (dnd5e size key);
 *  - `targetMaxSize`: "swallows a Medium or smaller target it is grappling" (Giant Toad, §45) — the size of what
 *    gets swallowed, when the text states it (elsewhere it is the activity's target: `sizeLimit`).
 */
function readSwallowLimits(text) {
  const count = text.match(/\b(?:only (one)|up to (\w+)) (?:creatures? |targets? )?(?:swallowed|engulfed|Grappled by this action) at a time\b/i);
  const word = (count?.[1] ?? count?.[2] ?? "").toLowerCase();
  const capacity = count ? (NUMBERS[word] ?? (Number(word) || null)) : null;
  const grappling = /\btarget it is grappling\b/i.test(text);
  const forbids = text.match(/\bcan't use ([A-Z][\w' ]*?)(?= while|,|\.| and\b)/)?.[1]?.trim() ?? null;
  const repeatsSave = /\brepeats the save at the end of each of its turns\b/i.test(text);
  const moving = /\bwhose space the [^.]{0,40} enters for the first time during this move\b/i.test(text);
  const size = text.match(/\bspaces of (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1]?.toLowerCase();
  return { capacity, grappling, forbids, repeatsSave, moving, maxSize: size ? SIZE_WORDS[size] : null, targetMaxSize: sizeLimit(text, /\bswallows an? /) };
}

/**
 * The maximum size a text writes: "Medium or smaller", or its translation ("de taille M ou inférieure") — dnd5e size key,
 * or null. `after`: what must come before it (nothing: anywhere in the text).
 */
export function sizeLimit(text, after=null) {
  const source = String(text ?? "");
  const lead = after ? after.source : "";
  const en = source.match(new RegExp(`${lead}(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\\b`, "i"))?.[1]?.toLowerCase();
  if ( en ) return SIZE_WORDS[en];
  const fr = source.match(new RegExp(`${lead}[^.]{0,30}?taille (TP|P|M|G|TG|Gig)\\b[^.]{0,12}inférieure`, "i"))?.[1]?.toUpperCase();
  return fr ? ({ TP: "tiny", P: "sm", M: "med", G: "lg", TG: "huge", GIG: "grg" })[fr] ?? null : null;
}

/** Does a creature of this size fit under the limit (dnd5e size keys)? With no limit, yes. */
export function fitsSize(size, maxSize) {
  if ( !maxSize ) return true;
  const i = SIZES.indexOf(size);
  return (i >= 0) && (i <= SIZES.indexOf(maxSize));
}

/**
 * During a move, which spaces does the swallower enter? Rectangles in pixels: the swallower at each sampled position
 * of the path (start excluded), the others in place. Overlapping at the start does not count ("enters").
 * @param {Array<{x: number, y: number, w: number, h: number}>} path   Swallower positions, start included.
 * @param {Array<{id: string, x: number, y: number, w: number, h: number}>} others
 * @returns {string[]}
 */
export function enteredSpaces(path, others) {
  const overlap = (a, b) => (a.x < b.x + b.w - 1e-6) && (b.x < a.x + a.w - 1e-6) && (a.y < b.y + b.h - 1e-6) && (b.y < a.y + a.h - 1e-6);
  const [start, ...rest] = path;
  return others.filter(o => start && !overlap(start, o) && rest.some(p => overlap(p, o))).map(o => o.id);
}

/**
 * Who takes the damage at this turn change.
 * @param {string|null} damageAt
 * @param {{ended: boolean, started: boolean, targetStarted: boolean, sameTurn: boolean}} at
 *   `ended`: the swallower's turn ends; `started`: it starts; `targetStarted`: the swallowed creature's turn starts;
 *   `sameTurn`: the creature was swallowed during the turn that is ending ("its NEXT turn": not yet).
 */
export function swallowDamageNow(damageAt, { ended=false, started=false, targetStarted=false, sameTurn=false }) {
  if ( damageAt === "ownerStart" ) return started;
  if ( damageAt === "ownerEnd" ) return ended;
  if ( damageAt === "ownerEndOnce" ) return ended && !sameTurn;
  if ( damageAt === "targetStart" ) return targetStarted;
  return false;
}

/** Damage taken during a turn from the inside: is the save needed to avoid regurgitating? */
export function mustRegurgitateSave(threshold, damageThisTurn) {
  return (threshold > 0) && (damageThisTurn >= threshold);
}
