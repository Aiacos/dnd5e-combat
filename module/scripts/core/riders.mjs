/**
 * What a monster attack carries ON HIT, read from the item's shape (SPEC §18.4, M2 and M3) — never by activity
 * id, which changes from one creature to another in the Monster Manual.
 *
 *  - M2: sibling save. Ghoul's Claw: an attack activity and ONE saving throw activity without a template,
 *    that targets a single creature, and is not used on its own (not as a Bonus Action or Reaction) — the saving throw that
 *    the hit imposes. The MM sometimes gives it an empty or "special" activation, sometimes "action" like the attack
 *    (Ghast, Death Dog, lycanthropes): the action is therefore allowed. The shape is not enough: the PHB's Unarmed Strike
 *    (Grapple/Shove), the Dagger of Venom or the Staff of Withering have it too, without their saving throw
 *    following the hit. The discriminant is the MM's lead-in formula, "is subjected to the following effect" /
 *    "must make the following saving throw" ("est soumise à l'effet suivant" in French), outside a
 *    "Whenever…" sentence (Otyugh: the saving throw comes after a Long Rest, not on a hit). Two saving throws (Petrifying
 *    Bite: first failure, then repeated) or an area (Dao's Earth Blast, an Emanation around the target):
 *    we do not guess, the content declares it (`onHit.save`).
 *  - M3: size gate. "If the target is a Large or smaller creature, it has the Prone condition" — the condition
 *    (or the push) only applies to a target of this size at most. Read in the activity's `target.affects.special`,
 *    or in the "If the target is…" sentence of the description; in English and in the French translation
 *    ("Si la cible est une créature de taille G ou inférieure"), which Babele writes into both fields.
 *
 * Pure: simple objects, no reference to Foundry.
 */

/** dnd5e sizes, by their English name and their French abbreviation (PHB-fr). */
const SIZE_WORDS = {
  tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg",
  tp: "tiny", p: "sm", m: "med", g: "lg", tg: "huge", gig: "grg"
};

const SIZE_EN = /\b(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i;
const SIZE_FR = /\btaille (TP|P|M|G|TG|Gig)\.? ou inf[ée]rieure\b/i;

/**
 * The maximum size written in a piece of text ("Large or smaller", "de taille G ou inférieure").
 * @param {string} text
 * @returns {string|null}  dnd5e size key ("lg"…), null if the text says nothing about it
 */
export function sizeLimitIn(text) {
  const match = String(text ?? "").match(SIZE_EN) ?? String(text ?? "").match(SIZE_FR);
  return match ? SIZE_WORDS[match[1].toLowerCase()] ?? null : null;
}

/** Start of a sentence that sets a condition on the target. */
const TARGET_CLAUSE = /(?:^|[.>]\s*)(?:If (?:the )?target is|Si la cible est)\b([^.]*)/gi;

/**
 * The size gate of an attack: the activity's `target.affects.special` first, otherwise the first sentence
 * "If the target is…" of the description that names a size. The enrichers `[[lookup @target.affects.special
 * activity=ID]]` are replaced there by the value of that activity (the MM often writes the size this way).
 * @param {object} args
 * @param {string} [args.special]      `target.affects.special` of the attack activity
 * @param {string} [args.description]  item description (HTML)
 * @param {(id: string) => string} [args.specialOf]  `affects.special` of a sibling activity, by id
 * @returns {string|null}
 */
export function sizeGateOf({ special="", description="", specialOf=() => "" }={}) {
  const own = sizeLimitIn(special);
  if ( own ) return own;
  const text = String(description ?? "")
    .replace(/\[\[lookup @target\.affects\.special activity=(\w+)\]\](?:\{[^}]*\})?/g, (_, id) => specialOf(id) ?? "")
    // The other enrichers contain dots (`@target.affects.type`) that would cut the sentence.
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " … ")
    .replace(/<[^>]+>/g, " ");
  for ( const [, clause] of text.matchAll(TARGET_CLAUSE) ) {
    const size = sizeLimitIn(clause);
    if ( size ) return size;
  }
  return null;
}

/** Activations allowed for a sibling save: none, special, or the attack's own action. */
const DEPENDENT_ACTIVATIONS = new Set(["", "special", "none", "action"]);

/** MM lead-in: "it is subjected to the following effect", "must make the following saving throw", and in French. */
const LEAD_IN = /(subjected to the following effect|must make the following saving throw|soumise? à l'effet suivant|subit (en outre )?l'effet suivant|(doit|devra) (faire|effectuer) (le jet de sauvegarde|la sauvegarde) suivant)/i;
const NOT_ON_HIT = /\b(Whenever|Each time|Chaque fois|Lorsqu'elle termine|Quand elle termine)\b/i;

/**
 * 2014-format sheets (and their translations): "Hit: … and the target must make a DC 15 Constitution saving throw",
 * "it must succeed on a [[/save con 10]]", "Touché : … elle doit réussir un jet de sauvegarde de Force DD 13". Without a
 * lead-in formula, it is only retained AFTER the "Hit:" / "Touché :" of the description: the PHB's Unarmed Strike
 * ("The target must succeed on a Strength or Dexterity saving throw") and magic weapons ("When you hit…") have none.
 */
const HIT_MARK = /\b(?:Hit|Touch[ée])\s*:/i;
const LEAD_IN_2014 = /\bmust\s+(?:make|succeed on)\s+an?\s+(?:DC\s*\d+\s+[A-Za-z]+\s+saving throw|…)|\b(?:doit|devra)\s+(?:réussir|faire|effectuer)\s+un\s+jet\s+de\s+sauvegarde\b/i;

/** Does the description announce a saving throw that follows the hit? */
export function announcesHitSave(description) {
  const text = String(description ?? "").replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " … ").replace(/<[^>]+>/g, " ").replace(/’/g, "'");
  const onHit = sentence => !NOT_ON_HIT.test(sentence);
  if ( text.split(/(?<=[.:])\s+/).some(sentence => LEAD_IN.test(sentence) && onHit(sentence)) ) return true;
  const hit = text.search(HIT_MARK);
  if ( hit < 0 ) return false;
  return text.slice(hit).split(/(?<=[.:])\s+/).some(sentence => LEAD_IN_2014.test(sentence) && onHit(sentence));
}

/**
 * The item's only saving throw activity (`onHit.save: "sole"`): the one an enchantment adds to the weapon it enchants arrives
 * under a new id at each application (dnd5e, activity/enchant.mjs: the "rider" activities), so it cannot be named by its id.
 * @param {object[]} activities  { id, type }
 * @returns {string|null}  its id; null if there is none, or several
 */
export function soleSaveOf(activities) {
  const saves = Array.from(activities ?? []).filter(a => a?.type === "save");
  return (saves.length === 1) ? (saves[0].id ?? saves[0]._id ?? null) : null;
}

/**
 * The sibling saving throw an attack imposes on a hit, recognized by its shape and the lead-in of its description.
 * @param {object[]} activities  all the item's activities:
 *   { id, type, activation: { type }, target: { template: { type }, affects: { count } } }
 * @param {string} description   item description (HTML)
 * @returns {string|null}  id of the saving throw activity
 */
export function siblingSaveOf(activities, description) {
  if ( !announcesHitSave(description) ) return null;
  const list = Array.from(activities ?? []);
  if ( !list.some(a => a?.type === "attack") ) return null;
  const saves = list.filter(a => a?.type === "save");
  if ( saves.length !== 1 ) return null;
  const [save] = saves;
  if ( !DEPENDENT_ACTIVATIONS.has(save.activation?.type ?? "") ) return null;
  if ( save.target?.template?.type ) return null;
  const count = String(save.target?.affects?.count ?? "").trim();
  if ( count && (count !== "1") ) return null;
  return save.id ?? null;
}
