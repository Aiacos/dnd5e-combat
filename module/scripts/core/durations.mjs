/**
 * M4 (SPEC §18.7): the duration of a condition written in the text — "until the end of its next turn", "jusqu'au début du tour
 * suivant du monstre" — translated into dnd5e 6 native expiry (`duration.expiry`, active-effect.mjs:112 and 881-908):
 *  - `targetStart` / `targetEnd`: at the start / end of the next turn of the creature that carries the effect;
 *  - `sourceStart` / `sourceEnd`: at the start / end of the next turn of the one that applied it.
 * The system skips the turn in which the effect was applied: "the end of its next turn" holds as written.
 *
 * Who is "its"? In English "its" and "the target's": the bearer (on oneself, bearer and source coincide);
 * "the <monster>'s", "the attacking creature's", "the user's", "your": the source. In French (MM-fr, PHB-fr),
 * "son tour suivant", "son propre tour" and "de la cible": the bearer; "du tour suivant du / de la / de l' <X>"
 * and "votre": the source.
 *
 * Pure: strings.
 */

const PATTERNS = [
  // English. §79: "before the end of your next turn" (Guiding Bolt, Eldritch Strike) bounds the effect like "until".
  { re: /(?:until|before) the (start|end) of (?:its|their|the target's) (?:own )?next turn/gi, who: "target" },
  { re: /(?:until|before) the (start|end) of (?:your|the (?!target's)[^.;,]{1,60}?'s) next turn/gi, who: "source" },
  // French.
  { re: /(?:jusqu'(?:au (début)|à la (fin))|avant (?:le (début)|la (fin))) de son (?:propre )?tour suivant/gi, who: "target" },
  { re: /(?:jusqu'(?:au (début)|à la (fin))|avant (?:le (début)|la (fin))) du (?:prochain )?tour (?:suivant )?de la cible/gi, who: "target" },
  { re: /(?:jusqu'(?:au (début)|à la (fin))|avant (?:le (début)|la (fin))) de votre (?:prochain )?tour(?: suivant)?/gi, who: "source" },
  { re: /(?:jusqu'(?:au (début)|à la (fin))|avant (?:le (début)|la (fin))) du (?:prochain )?tour suivant (?:du|de la|de l'|des)(?! cible)/gi, who: "source" }
];

const EDGE = { start: "Start", end: "End", "début": "Start", fin: "End" };

/** Flat text: enrichers and tags removed, straight apostrophes. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\[\[lookup[^\]]*\]\](?:\{([^}]*)\})?/g, (_, label) => label ?? "it")
    .replace(/&Reference\[(\w+)[^\]]*\]/g, "«$1»")
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ").trim();
}

/**
 * Does the text name one of these conditions? An effect's own description that names its condition is authoritative, even
 * without a duration: we do not go looking in the item for the duration of another effect of the same condition
 * (Death Tyrant: two rays apply Restrained).
 */
export function namesStatus(html, statuses=[]) {
  const wanted = new Set(statuses.map(s => String(s).toLowerCase()));
  return [...plainText(html).matchAll(/«(\w+)»/g)].some(m => wanted.has(m[1].toLowerCase()));
}

/** All the durations of a sentence, in order. */
function expiriesIn(sentence) {
  const found = [];
  for ( const { re, who } of PATTERNS ) {
    for ( const m of sentence.matchAll(re) ) {
      const edge = EDGE[(m.slice(1).find(Boolean) ?? "").toLowerCase()];
      if ( edge ) found.push({ at: m.index, expiry: `${who}${edge}` });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.expiry);
}

/**
 * The expiry to set from a text, or null if it says nothing certain.
 *  - Effect that carries conditions: only the sentence that names one counts (`&Reference[Paralyzed]`). A duration written
 *    elsewhere belongs to something else (Power Word Stun: "Speed 0 until the start of your next turn" is not
 *    the duration of Stunned; Open Hand Technique: the Topple does not expire with the Addle).
 *  - Effect without a condition: only if `alone` (the text is the description of the effect itself) and there is only one duration.
 *  - `fallback` (§79): the item text of an effect applied with a generic "1 turn", duration already wrong — if no sentence
 *    names the effect's condition (or it carries none), the duration of the text when it writes only one (Menacing Attack:
 *    "Frightened" without a link; Caltrops, "Slash", "Zealous Presence": effects without a condition). Different durations:
 *    nothing.
 * @param {string} html
 * @param {string[]} [statuses]  conditions of the effect ("paralyzed"…)
 * @param {{alone?: boolean, fallback?: boolean}} [options]
 * @returns {"targetStart"|"targetEnd"|"sourceStart"|"sourceEnd"|null}
 */
export function expiryFromText(html, statuses=[], { alone=false, fallback=false }={}) {
  const text = plainText(html);
  if ( !text ) return null;
  const sentences = text.split(/(?<=[.;:])\s+/);
  const unique = () => {
    const all = [...new Set(sentences.flatMap(expiriesIn))];
    return (all.length === 1) ? all[0] : null;
  };
  const wanted = new Set(statuses.map(s => String(s).toLowerCase()));
  if ( wanted.size ) {
    let named = false;
    for ( const sentence of sentences ) {
      // The duration that FOLLOWS the mention of the condition (Githzerai Psion: "(A) Charmed until the start… or (B) Prone" — the
      // Topple does not have the duration of the Charm).
      const mention = [...sentence.matchAll(/«(\w+)»/g)].find(m => wanted.has(m[1].toLowerCase()));
      if ( mention ) named = true;
      const found = mention ? expiriesIn(sentence.slice(mention.index)) : [];
      if ( found.length ) return found[0];
    }
    return (fallback && !named) ? unique() : null;
  }
  return (alone || fallback) ? unique() : null;
}

/**
 * §403: the duration and Concentration of a spell by slot (Bestow Curse: "level 4, Concentration up to 10 minutes;
 * level 5+, no Concentration, 8 hours (5–6) or 24 hours (7–8); level 9, until dispelled"). `rule`: tiers
 * `{ from, seconds?, concentration? }`; the last one whose `from` ≤ `level` applies. Returns null below the first tier, otherwise
 * `{ seconds: number|null, concentration: boolean }` — `seconds` null: until dispelled; `concentration` true by default.
 * @param {Array<{from: number, seconds?: number, concentration?: boolean}>} rule
 * @param {number} level
 */
export function durationAtLevel(rule, level) {
  const tier = [...(rule ?? [])].sort((a, b) => a.from - b.from).filter(t => t.from <= level).pop();
  if ( !tier ) return null;
  return { seconds: Number.isFinite(tier.seconds) ? tier.seconds : null, concentration: tier.concentration !== false };
}
