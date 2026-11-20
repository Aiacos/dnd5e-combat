/**
 * §491 : « la cible porte une armure (en métal) » — fait `target.wearsArmor` (adapter/facts.mjs). Règle pure : l'adaptateur décrit les
 * pièces équipées de l'acteur (`armorPieces`), ce module dit si elles répondent à la condition.
 *
 * dnd5e n'a pas de matière (config.mjs `armorTypes` : light, medium, heavy, natural, shield ; `armorIds` : l'armure de base). La matière
 * se lit donc par l'armure de base (`system.type.baseItem`, sinon l'identifiant de l'item), dans la table ci-dessous ; un item peut
 * l'imposer lui-même par `flags["dnd5e-combat"].metal` (true / false), pour une armure de campagne ou un bouclier.
 */

/** Catégories d'armure portée (dnd5e `armorTypes`, sans « natural » : une armure naturelle ne se porte pas). */
export const ARMOR_CATEGORIES = Object.freeze(["light", "medium", "heavy", "shield"]);

/** Les catégories qui font « porter une armure » quand la condition ne nomme rien (`true`) : le bouclier n'en est pas une. */
const BODY = Object.freeze(["light", "medium", "heavy"]);

/**
 * Armures de base en métal, par clé de dnd5e `armorIds` et par identifiant d'item (SRD 5.2 / PHB 2024). Le bouclier n'y est pas : il
 * peut être de bois ; un bouclier de métal se marque par le drapeau de l'item.
 */
export const METAL_ARMOR = Object.freeze(new Set([
  "chainshirt", "scalemail", "breastplate", "halfplate", "ringmail", "chainmail", "splint", "plate",
  "chain-shirt", "scale-mail", "half-plate", "half-plate-armor", "ring-mail", "chain-mail", "splint-armor", "plate-armor"
]));

/** Cette pièce est-elle en métal ? Le drapeau de l'item d'abord, puis l'armure de base, puis l'identifiant. */
export function isMetal(piece) {
  if ( typeof piece?.metal === "boolean" ) return piece.metal;
  return METAL_ARMOR.has(piece?.base ?? "") || METAL_ARMOR.has(piece?.identifier ?? "");
}

/** La forme d'une condition `target.wearsArmor` est-elle valide ? (pour la validation du contenu) */
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
 * Les pièces répondent-elles à la condition ?
 *  - `true` / `false` : porte (ou non) une armure de corps — légère, intermédiaire ou lourde ;
 *  - `"heavy"` / `["medium", "heavy"]` / `"shield"` : une pièce de l'une de ces catégories ;
 *  - `{ material: "metal" }` : une pièce en métal (bouclier compris s'il est marqué métal) ; `{ material: "metal", category: "heavy" }` : les deux.
 * Une forme inconnue ne tient jamais.
 * @param {Array<{category: string, base?: string, identifier?: string, metal?: boolean}>} pieces  les pièces équipées
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
