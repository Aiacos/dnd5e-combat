/**
 * §491: "the target wears armor (metal)" — fact `target.wearsArmor` (adapter/facts.mjs). Pure rule: the adapter describes the
 * pieces the actor has equipped (`armorPieces`), this module says whether they meet the condition.
 *
 * dnd5e has no material (config.mjs `armorTypes`: light, medium, heavy, natural, shield; `armorIds`: the base armor). The material
 * is therefore read from the base armor (`system.type.baseItem`, otherwise the item's identifier), in the table below; an item can
 * impose it itself through `flags["dnd5e-combat"].metal` (true / false), for a campaign armor or a shield.
 */

/** Categories of worn armor (dnd5e `armorTypes`, without "natural": natural armor is not worn). */
export const ARMOR_CATEGORIES = Object.freeze(["light", "medium", "heavy", "shield"]);

/** The categories that count as "wearing armor" when the condition names nothing (`true`): a shield is not one. */
const BODY = Object.freeze(["light", "medium", "heavy"]);

/**
 * Metal base armors, by dnd5e `armorIds` key and by item identifier (SRD 5.2 / PHB 2024). The shield is not in it: it
 * can be made of wood; a metal shield is marked by the item's flag.
 */
export const METAL_ARMOR = Object.freeze(new Set([
  "chainshirt", "scalemail", "breastplate", "halfplate", "ringmail", "chainmail", "splint", "plate",
  "chain-shirt", "scale-mail", "half-plate", "half-plate-armor", "ring-mail", "chain-mail", "splint-armor", "plate-armor"
]));

/** Is this piece made of metal? The item's flag first, then the base armor, then the identifier. */
export function isMetal(piece) {
  if ( typeof piece?.metal === "boolean" ) return piece.metal;
  return METAL_ARMOR.has(piece?.base ?? "") || METAL_ARMOR.has(piece?.identifier ?? "");
}

/** Is the form of a `target.wearsArmor` condition valid? (for content validation) */
export function validArmorArg(arg) {
  if ( typeof arg === "boolean" ) return true;
  const cats = v => [v].flat().length && [v].flat().every(c => ARMOR_CATEGORIES.includes(c));
  if ( (typeof arg === "string") || Array.isArray(arg) ) return !!cats(arg);
  if ( !arg || (typeof arg !== "object") ) return false;
  const keys = Object.keys(arg);
  if ( !keys.length || keys.some(k => !["material", "category"].includes(k)) ) return false;
  if ( ("material" in arg) && (arg.material !== "metal") ) return false;
  if ( ("category" in arg) && !cats(arg.category) ) return false;
  return true;
}

/**
 * Do the pieces meet the condition?
 *  - `true` / `false`: wears (or not) a body armor — light, medium or heavy;
 *  - `"heavy"` / `["medium", "heavy"]` / `"shield"`: a piece of one of these categories;
 *  - `{ material: "metal" }`: a metal piece (shield included if marked metal); `{ material: "metal", category: "heavy" }`: both.
 * An unknown form never holds.
 * @param {Array<{category: string, base?: string, identifier?: string, metal?: boolean}>} pieces  the equipped pieces
 * @param {boolean|string|string[]|{material?: "metal", category?: string|string[]}} want
 * @returns {boolean}
 */
export function wearsArmor(pieces, want) {
  const worn = (pieces ?? []).filter(p => ARMOR_CATEGORIES.includes(p?.category));
  if ( typeof want === "boolean" ) return worn.some(p => BODY.includes(p.category)) === want;
  if ( !validArmorArg(want) ) return false;
  if ( (typeof want === "string") || Array.isArray(want) ) return worn.some(p => [want].flat().includes(p.category));
  return worn.some(p => (!want.category || [want.category].flat().includes(p.category))
    && (!want.material || isMetal(p)));
}
