/**
 * Multiattack of a monster (SPEC §18.4, M1): what the action allows, read from the item's original ENGLISH text
 * (under Babele, `flags.babele.originalPayload.description`), then what a sequence of uses fits into it.
 *
 * The Monster Manual cites its attacks in enrichers, readable without guessing: `[[/item Rend]]` (English name),
 * `[[/item .mmBite0000000000]]` (item id), `[[/item .mmSpellcasting00.Activity.<id>]]` (activity), and spells as
 * `@UUID[Compendium.….spells.Item.<id>]{Nom}`; some sheets write the name in plain text ("three Slam attacks").
 * Each reference becomes a KEY (`id:…`, `name:…`, `activity:…`, `spell:…`); the adapter gives the keys of a
 * use, and a use fits in the plan if one of its keys appears there — nothing is resolved in advance.
 *
 * Recognized forms (307 MM creatures, sweep of 2026-09-26):
 *  - "makes three Rend attacks"                          a group of 3
 *  - "makes two attacks, using A or B in any combination" a group of 2, A or B
 *  - "makes one A attack and two B attacks"              two groups
 *  - "makes three A attacks or two B attacks"            two options (same as "…, or it makes two C attacks")
 *  - "It can replace one attack / any attack / the Claw attack with a use of X (or Y)", "… with a Bite attack",
 *    "… with a use of Spellcasting to cast <spell>"      replacement: takes the place of an attack
 *  - "… and uses X (if available)", "… and it can use Spellcasting to cast <spell>"   extra use
 *  - "uses Eye Rays three times" (Beholder, Spectator)  a group of 3 uses of the ability
 *  - "makes as many Bite attacks as it has heads" (Hydra): unbounded (the number of heads is not data)
 * MM typos tolerated: "makes" missing (Weretiger), "attacks" missing (Ancient Bronze Dragon), stuck-on period.
 *
 * With no readable English text (sheet written in French or Portuguese, English prose with lowercase names), the plain-text reading
 * (`parseTranslated`): the sheet's names recognized in the text, an attack without a name meaning any attack
 * (`ANY_ATTACK`). Without it, the plan was null and the number of attacks was no longer limited (§442).
 *
 * Pure: strings and simple objects.
 */

/**
 * The identifier of Multiattack, whatever the sheet: the 2024 MM's (`multiattack`), those that dnd5e derives from the name
 * of a sheet imported without an identifier or translated ("Attaque multiple", "Attaques multiples", "Multiattaque"), and
 * those of a name with a qualifier ("Multiattack (Human or Hybrid Form Only)" → `multiattack-human-or-hybrid-form-only`), and those
 * that a creature module prefixes (`cos-rahadin-attaques-multiples`, `cos-ithuriel-etoile-attaques-multiples`).
 */
export function isMultiattackId(id) {
  const s = String(id ?? "");
  return ["multiattack", "multiattaque", "attaque-multiple", "attaques-multiples"]
    .some(base => (s === base) || s.startsWith(`${base}-`) || s.endsWith(`-${base}`));
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** "Replace any attack": as many as there are. No Infinity: the plan travels as JSON (budget). */
export const ANY = 99;

const PLAIN_NAME = "[A-Z][A-Za-z'’-]*(?:\\s+(?:of\\s+)?[A-Z(][A-Za-z'’()-]*)*";
const REF = `(?:«\\d+»|${PLAIN_NAME})`;
const NUM = "(one|two|three|four|five|six|seven|eight|\\d+)";
/** The same, without the `i` flag: an expression that reads plain-text names must keep the case ("one Claws attack and one Root attack"). */
const NUM_CS = `(${Object.keys(NUMBERS).map(w => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`).join("|")}|\\d+)`;
/** Keys of a melee or ranged attack ("makes two melee attacks"); the adapter gives them to the attack activity. */
export const MELEE_ATTACK = "kind:melee";
export const RANGED_ATTACK = "kind:ranged";
const KIND_KEYS = { melee: MELEE_ATTACK, ranged: RANGED_ATTACK };

/**
 * Replaces references with `«n»` tokens and cleans the HTML. The tokens keep a uuid's dot from cutting a sentence.
 * @returns {{text: string, refs: string[]}}  refs[n] = key of reference n
 */
export function tokenize(html) {
  const refs = [];
  const token = key => { refs.push(key); return ` «${refs.length - 1}» `; };
  const text = String(html ?? "")
    .replace(/@UUID\[([^\]]*\.spells\.Item\.[^\]]*)\](?:\{[^}]*\})?/g, (_, uuid) => token(`spell:${uuid}`))
    .replace(/\[\[\/item\s*([^\]]*)\]\](?:\{[^}]*\})?/g, (_, arg) => token(refKey(arg.trim())))
    .replace(/\[\[lookup[^\]]*\]\](?:\{[^}]*\})?/g, " it ")
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\(level \d+ version\)/gi, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/’/g, "'")
    .replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").replace(/\.(?=[A-Z])/g, ". ").trim();
  return { text, refs };
}

/** Key of a `[[/item …]]` enricher argument. */
function refKey(arg) {
  if ( !arg ) return "unknown:";
  const activity = arg.match(/\.Activity\.([A-Za-z0-9]{16})$/);
  if ( activity ) return `activity:${activity[1]}`;
  const id = arg.replace(/^\./, "");
  if ( /^[A-Za-z0-9]{16}$/.test(id) ) return `id:${id}`;
  return `name:${arg.toLowerCase()}`;
}

/** The keys of a list "A or B", "A, B, or C", "(A) X or (B) Spellcasting to cast Y". */
function refsOf(phrase, refs) {
  const out = [];
  for ( let part of phrase.split(/\s*(?:,\s*or\s+|,\s*|\bor\b|\band\b|\beither\b|\([A-Z]\))\s*/) ) {
    part = part.trim();
    if ( !part ) continue;
    // "Spellcasting to cast X": the spell is what counts.
    const cast = part.match(/to cast\s+(.*)$/i);
    if ( cast ) part = cast[1];
    for ( const m of part.matchAll(new RegExp(REF, "g")) ) {
      const t = m[0].match(/^«(\d+)»$/);
      out.push(t ? refs[Number(t[1])] : `name:${m[0].trim().toLowerCase()}`);
    }
  }
  return [...new Set(out.filter(k => k !== "unknown:"))];
}

const count = word => NUMBERS[word.toLowerCase()] ?? Number(word);

/** The groups of an option: "two attacks, using A or B in any combination", "one A attack and two B attacks". */
function groupsOf(option, refs) {
  const any = option.match(new RegExp(`${NUM} attacks?,? using (.*?) in any combination`, "i"));
  if ( any ) {
    const keys = refsOf(any[2], refs);
    return keys.length ? [{ n: count(any[1]), refs: keys }] : null;
  }
  const heads = option.match(new RegExp(`as many (${REF}) attacks as`, "i"));
  if ( heads ) return [{ n: ANY, refs: refsOf(heads[1], refs) }];
  const times = option.match(new RegExp(`^\\s*uses? (${REF}) (twice|thrice|${NUM} times)`, "i"));
  if ( times ) return [{ n: { twice: 2, thrice: 3 }[times[2].toLowerCase()] ?? count(times[3]), refs: refsOf(times[1], refs) }];
  // "two melee attacks", "two ranged weapon attacks", "two weapon attacks": a kind of attack, not a name (B01).
  const kind = option.match(new RegExp(`^\\s*${NUM}\\s+(?:(melee|ranged)\\s+)?(?:weapon\\s+)?attacks?\\s*$`, "i"));
  if ( kind && (kind[2] || /weapon/i.test(option)) ) return [{ n: count(kind[1]), refs: [kind[2] ? KIND_KEYS[kind[2].toLowerCase()] : ANY_ATTACK] }];
  // "two attacks: one with its Claws and one with its Root": the announced total, then the detail — only the detail counts (B01).
  const detail = option.match(new RegExp(`^\\s*${NUM}\\s+(?:(?:melee|ranged|weapon)\\s+)*attacks?\\s*:\\s*(.*)$`, "i"));
  if ( detail ) {
    const parts = [...detail[2].matchAll(new RegExp(`${NUM_CS}\\s+(?:attacks?\\s+)?with\\s+(?:its|his|her|their|an?|the)?\\s*(${REF}(?:\\s*(?:,\\s*or|,|or)\\s+${REF})*)`, "g"))];
    const groups = parts.map(m => ({ n: count(m[1]), refs: refsOf(m[2], refs) })).filter(g => g.refs.length);
    if ( groups.length && (groups.length === parts.length) ) return groups;
  }
  const groups = [];
  // Without `i`: a plain-text name starts with a capital, otherwise "Bite attack and two Rend" would pass for a single name (B01).
  const re = new RegExp(`${NUM_CS}\\s+(${REF}(?:\\s*(?:,\\s*or|,|or)\\s+${REF})*)\\s+attacks?\\b`, "g");
  for ( const m of option.matchAll(re) ) {
    const keys = refsOf(m[2], refs);
    if ( keys.length ) groups.push({ n: count(m[1]), refs: keys });
  }
  // "makes three Rend.": the word "attacks" is missing (Ancient Bronze Dragon).
  const bare = !groups.length && option.match(new RegExp(`^\\s*${NUM}\\s+(${REF})\\s*$`, "i"));
  if ( bare ) {
    const keys = refsOf(bare[2], refs);
    // "makes two attacks": "attacks" is not a name — any attack. Before, a group with no key: nothing fit it.
    if ( keys.length ) groups.push({ n: count(bare[1]), refs: keys });
    else if ( /^attacks?$/i.test(bare[2].trim()) ) groups.push({ n: count(bare[1]), refs: [ANY_ATTACK] });
  }
  return groups.length ? groups : null;
}

/**
 * The Multiattack plan, or null if the text cannot be read.
 * @param {string} html  English description of the item
 * @returns {{options: Array<Array<{n: number, refs: string[]}>>, replace: Array<{n: number, refs: string[], of: string[]|null}>,
 *   extra: Array<{refs: string[]}>}|null}
 */
export function parseMultiattack(html, { names=[] }={}) {
  const english = parseEnglish(html);
  const plain = parseTranslated(html, names);
  if ( !english ) return plain;
  // The English text keeps priority; a replacement or an extra use that it could not read ("replace one of those attacks
  // with ray of light", lowercase name) is taken from the plain-text reading.
  if ( plain && !english.replace.length ) english.replace = plain.replace;
  if ( plain && !english.extra.length ) english.extra = plain.extra;
  return english;
}

/**
 * "two melee attacks, only one of which can be a Bite attack": a group of 2 becomes 1 attack of the group of any kind + 1 that
 * is not a Bite (`except`) — the Bite fits only once. Only for an option of a single group.
 */
function capGroups(groups, cap) {
  if ( (groups.length !== 1) || (cap.n >= groups[0].n) ) return groups;
  const [g] = groups;
  return [{ ...g, n: cap.n }, { ...g, n: g.n - cap.n, except: [...new Set([...(g.except ?? []), ...cap.refs])] }];
}

function parseEnglish(html) {
  const { text, refs } = tokenize(html);
  const sentences = text.split(/(?<=\.)\s+/);
  let options = null;
  const replace = [];
  const extra = [];
  for ( let sentence of sentences ) {
    sentence = sentence.replace(/\.$/, "");
    // Remplacement.
    const rep = sentence.match(new RegExp(`can replace (one|two|any|the (${REF})) attacks? with (?:a use of |an? |one use of )?(.*?)(?: attack)?(?: if available)?$`, "i"));
    if ( rep ) {
      const keys = refsOf(rep[3], refs);
      if ( keys.length ) replace.push({ n: rep[2] ? 1 : (rep[1].toLowerCase() === "any" ? ANY : count(rep[1])), refs: keys, of: rep[2] ? refsOf(rep[2], refs) : null });
      continue;
    }
    if ( options ) continue;
    const start = sentence.search(new RegExp(`\\bmakes\\b|\\buses? ${REF} (?:twice|thrice|${NUM} times)|\\b${NUM} attacks?, using`, "i"));
    if ( start < 0 ) continue;
    let body = sentence.slice(start).replace(/^makes\b/i, "");
    // Extra uses: "and uses X (if available)", "and it can use Spellcasting to cast X".
    const plus = body.match(/,?\s*and (?:it )?(?:can )?uses?\s+(.*)$/i);
    if ( plus ) {
      const keys = refsOf(plus[1].replace(/\s*if available$/i, "").replace(/\s+if it .*$/i, ""), refs);
      if ( keys.length ) extra.push({ refs: keys });
      body = body.slice(0, plus.index);
    }
    // "two melee attacks, only one of which can be a bite attack": at most that many attacks of that kind (B01).
    let cap = null;
    const only = body.match(new RegExp(`,?\\s*(?:but\\s+)?only\\s+${NUM}\\s+of\\s+(?:which|them|these|those)\\s+can\\s+be\\s+(?:an?\\s+|with\\s+(?:its\\s+)?)?(.*?)(?:\\s+attacks?)?$`, "i"));
    if ( only ) {
      const keys = refsOf(only[2], refs);
      const name = only[2].trim().toLowerCase();
      cap = { n: count(only[1]), refs: keys.length ? keys : (/^[a-z][a-z' -]*$/.test(name) ? [`name:${name}`] : []) };
      body = body.slice(0, only.index);
    }
    // Options: "three A attacks or two B attacks", "one A attack and one B attack, or it makes two C attacks",
    // "two melee attacks or uses Shocking Bolt twice" (B01).
    const parts = body.replace(new RegExp(`\\battacks?,?\\s+or\\s+(?:it makes\\s+)?(?=${NUM}\\b|uses?\\s)`, "gi"), "attacks|").split("|");
    let parsed = parts.map(p => groupsOf(p, refs));
    if ( cap?.refs.length && parsed.every(Boolean) ) parsed = parsed.map(groups => capGroups(groups, cap));
    if ( parsed.every(Boolean) ) options = parsed;
  }
  return options ? { options, replace, extra } : null;
}

/* -------------------------------------------- */
/*  Translated text (French, Brazilian Portuguese) */
/* -------------------------------------------- */

/**
 * Key of a use that is an attack, any attack: "makes two attacks", without saying which.
 * The adapter gives it to every attack activity (`useKeysOf`).
 */
export const ANY_ATTACK = "kind:attack";

const TR_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const TR_NUM = `(?:${Object.keys(TR_NUMBERS).join("|")}|\\d+)`;
/** Letters before / after a word (accents included): `\b` does not know "é". */
const NOT_L = "(?<![\\p{L}\\d«])";   // «: a reference token (`«2»`) is not a number
const NOT_R = "(?![\\p{L}\\d])";
const trCount = word => TR_NUMBERS[word.toLowerCase()] ?? Number(word);
const tokensOf = (phrase, refs) => [...new Set([...phrase.matchAll(/«(\d+)»/g)].map(m => refs[Number(m[1])]).filter(k => k && (k !== "unknown:")))];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Multiattack of a sheet written in French or Portuguese (no original English text: creature module,
 * hand-made sheet), or of an English prose text that `parseEnglish` does not read ("makes three attacks with his blades
 * A and/or B", lowercase names). The `[[/item …]]` and `@UUID[…]` references are read as in English; abilities named in
 * plain text are recognized by the sheet's names (`names`: `[nom affiché, clé]`). An attack without a name means any
 * attack (`ANY_ATTACK`). Forms:
 *  - "effectue / réalise / fait / porte deux attaques", "… trois attaques avec ses lames A et/ou B",
 *    "… deux attaques, réparties à sa guise entre A et B", "… une attaque de A, une attaque de B et une de C",
 *    "… trois attaques de A ou deux attaques de B" (options);
 *  - "Il peut remplacer une attaque / l'une de ces attaques / n'importe quelle attaque / l'attaque de A par (une utilisation
 *    de) X";
 *  - "… et utilise / recourt à X" (extra use);
 *  - Portuguese: "realiza / faz / executa dois ataques", "pode substituir um ataque por X".
 */
function parseTranslated(html, names=[]) {
  let { text, refs } = tokenize(html);
  text = text.replace(/[’]/g, "'");
  // Plain-text names, longest first ("Lame d'épouvante" before "Lame").
  for ( const [name, key] of [...names].filter(([n]) => n && (n.length > 1)).sort((a, b) => b[0].length - a[0].length) ) {
    const re = new RegExp(`${NOT_L}${escape(name.replace(/[’]/g, "'"))}${NOT_R}`, "giu");
    text = text.replace(re, () => { refs.push(key); return ` «${refs.length - 1}» `; });
  }
  const sentences = text.replace(/\s+/g, " ").split(/(?<=\.)\s+/);
  let options = null;
  const replace = [];
  const extra = [];
  for ( let sentence of sentences ) {
    sentence = sentence.replace(/\.$/, "").trim();
    const rep = sentence.match(/\b(?:remplacer|substituir|replace)\s+(.*?)\s+(?:par|por|with)\s+(.*)$/iu);
    if ( rep ) {
      const keys = tokensOf(rep[2], refs);
      if ( !keys.length ) continue;
      const what = rep[1];
      const named = /\battaque de\b|\bataque de\b|\bthe\s+«\d+»\s+attack\b/i.test(what) ? tokensOf(what, refs) : [];
      let n = 1;
      if ( /n'importe quel|chacune|toutes|qualquer|cada|\bany\b/i.test(what) ) n = ANY;
      else {
        const m = what.match(new RegExp(`${NOT_L}(${TR_NUM})${NOT_R}`, "iu"));
        if ( m && !/l'une|um dos|uma das|one of/i.test(what) ) n = trCount(m[1]);
      }
      replace.push({ n, refs: keys, of: named.length ? named : null });
      continue;
    }
    if ( options ) continue;
    const start = sentence.search(new RegExp(`${NOT_L}(?:effectue|réalise|fait|porte|exécute|mène|realiza|faz|executa|efetua|makes)${NOT_R}`, "iu"));
    if ( start < 0 ) continue;
    let body = sentence.slice(start).replace(/^\S+\s*/u, "");
    if ( !new RegExp(`^${TR_NUM}${NOT_R}`, "iu").test(body) ) continue;
    // Extra use: "et utilise X", "puis recourt à X", "e usa X".
    const plus = body.match(/,?\s*(?:et|puis|e|and)\s+(?:il\s+|elle\s+|ele\s+|ela\s+|it\s+)?(?:peut\s+|pode\s+|can\s+)?(?:utilise[rz]?|recourt à|recourir à|usa|usar|utiliza|uses?)\s+(.*)$/iu);
    if ( plus ) {
      const keys = tokensOf(plus[1], refs);
      if ( keys.length ) extra.push({ refs: keys });
      body = body.slice(0, plus.index);
    }
    // Options: "trois attaques de A ou deux attaques de B", "…, ou il effectue deux attaques de C".
    const parts = body.split(new RegExp(`,?\\s+(?:ou|or)\\s+(?:il\\s+|elle\\s+|ele\\s+|ela\\s+|it\\s+)?(?:effectue\\s+|réalise\\s+|realiza\\s+|faz\\s+|makes\\s+)?(?=${TR_NUM}${NOT_R})`, "iu"));
    const parsed = parts.map(p => translatedGroups(p, refs));
    if ( parsed.length && parsed.every(Boolean) ) options = parsed;
  }
  return options ? { options, replace, extra } : null;
}

/** The groups of an option: each number opens a group, the references that follow it are its own. */
function translatedGroups(option, refs) {
  // "makes three melee attacks: two with A and one with B": the announced total, then the detail — only the detail counts.
  const detail = option.replace(new RegExp(`^${TR_NUM}\\s+(?:(?:melee|ranged|weapon)\\s+)?(?:attacks?|attaques?(?:\\s+(?:au corps à corps|à distance))?|ataques?)\\s*:\\s*`, "iu"), "");
  if ( (detail !== option) && new RegExp(`^${TR_NUM}${NOT_R}`, "iu").test(detail) ) option = detail;
  const head = new RegExp(`${NOT_L}(${TR_NUM})(?=\\s+(?:attaques?|ataques?|attacks?|de|d'|do|da|with)${NOT_R}|\\s*d')`, "giu");
  const starts = [...option.matchAll(head)];
  if ( !starts.length || (starts[0].index > 0) ) return null;
  const groups = starts.map((m, i) => {
    const chunk = option.slice(m.index + m[0].length, starts[i + 1]?.index ?? option.length);
    const keys = tokensOf(chunk, refs);
    return { n: trCount(m[1]), refs: keys.length ? keys : [ANY_ATTACK] };
  });
  return groups.every(g => Number.isInteger(g.n) && (g.n > 0)) ? groups : null;
}

/**
 * Widens each key of the plan to all those of the same sheet item: "Claw" by its name and `.mmClaw…` by its id
 * designate the same Claw (Chimera: "replace the Claw attack", the group cites it by id).
 * @param {object} plan
 * @param {Array<string[]>} catalog  the keys of each item (and of each casting activity) of the sheet
 */
export function expandPlan(plan, catalog) {
  if ( !plan ) return null;
  const widen = refs => [...new Set((refs ?? []).flatMap(k => [k, ...catalog.filter(keys => keys.includes(k)).flat()]))];
  return {
    options: plan.options.map(groups => groups.map(g => ({ ...g, refs: widen(g.refs), ...(g.except ? { except: widen(g.except) } : {}) }))),
    replace: plan.replace.map(r => ({ ...r, refs: widen(r.refs), of: r.of ? widen(r.of) : null })),
    extra: plan.extra.map(e => ({ ...e, refs: widen(e.refs) }))
  };
}

/* -------------------------------------------- */
/*  Declared plan (content key `multiattackPlan`, B01) */
/* -------------------------------------------- */

/**
 * A declared plan key: `id:<id>`, `name:<nom anglais en minuscules>`, `identifier:<identifiant dnd5e>`, `activity:<id>`,
 * `spell:<uuid>`, or a kind of attack `kind:attack` / `kind:melee` / `kind:ranged`.
 */
const PLAN_KEY = /^(?:(?:id|name|identifier|activity|spell):.+|kind:(?:attack|melee|ranged))$/;
const isCount = n => Number.isInteger(n) && (n > 0) && (n <= ANY);
const isKeys = (list, empty=false) => Array.isArray(list) && (empty || list.length) && list.every(k => (typeof k === "string") && PLAN_KEY.test(k));

/**
 * The errors of a declared `multiattackPlan`: `{ options: [[{ n, refs, except? }]], replace?: [{ n, refs, of? }],
 * extra?: [{ refs }] }`.
 * A group is a maximum: at most `n` attacks that cite one of its `refs` and none of its `except`.
 * @returns {string[]}
 */
export function validatePlan(plan, at="") {
  const errors = [];
  const err = msg => errors.push(`${at}multiattackPlan${msg}`);
  if ( !plan || (typeof plan !== "object") || Array.isArray(plan) ) return [`${at}multiattackPlan: object`];
  for ( const k of Object.keys(plan) ) if ( !["options", "replace", "extra"].includes(k) ) err(`.${k}: unknown key`);
  if ( !Array.isArray(plan.options) || !plan.options.length ) err(".options: non-empty array of options");
  else plan.options.forEach((groups, o) => {
    if ( !Array.isArray(groups) || !groups.length ) return err(`.options[${o}]: non-empty array of groups`);
    groups.forEach((g, i) => {
      const where = `.options[${o}][${i}]`;
      if ( !g || (typeof g !== "object") ) return err(`${where}: object`);
      for ( const k of Object.keys(g) ) if ( !["n", "refs", "except"].includes(k) ) err(`${where}.${k}: unknown key`);
      if ( !isCount(g.n) ) err(`${where}.n: positive integer`);
      if ( !isKeys(g.refs) ) err(`${where}.refs: non-empty array of plan keys`);
      if ( ("except" in g) && !isKeys(g.except) ) err(`${where}.except: non-empty array of plan keys`);
    });
  });
  if ( ("replace" in plan) ) {
    if ( !Array.isArray(plan.replace) ) err(".replace: array");
    else plan.replace.forEach((r, i) => {
      if ( !r || (typeof r !== "object") ) return err(`.replace[${i}]: object`);
      for ( const k of Object.keys(r) ) if ( !["n", "refs", "of"].includes(k) ) err(`.replace[${i}].${k}: unknown key`);
      if ( !isCount(r.n) ) err(`.replace[${i}].n: positive integer`);
      if ( !isKeys(r.refs) ) err(`.replace[${i}].refs: non-empty array of plan keys`);
      if ( (r.of != null) && !isKeys(r.of) ) err(`.replace[${i}].of: non-empty array of plan keys`);
    });
  }
  if ( ("extra" in plan) ) {
    if ( !Array.isArray(plan.extra) ) err(".extra: array");
    else plan.extra.forEach((e, i) => {
      if ( !e || (typeof e !== "object") ) return err(`.extra[${i}]: object`);
      for ( const k of Object.keys(e) ) if ( k !== "refs" ) err(`.extra[${i}].${k}: unknown key`);
      if ( !isKeys(e.refs) ) err(`.extra[${i}].refs: non-empty array of plan keys`);
    });
  }
  return errors;
}

/** The declared plan, completed (`replace`, `extra` empty by default) and copied; null if it is invalid. */
export function declaredPlan(plan) {
  if ( !plan || validatePlan(plan).length ) return null;
  return {
    options: plan.options.map(groups => groups.map(g => ({ n: g.n, refs: [...g.refs], ...(g.except ? { except: [...g.except] } : {}) }))),
    replace: (plan.replace ?? []).map(r => ({ n: r.n, refs: [...r.refs], of: r.of ? [...r.of] : null })),
    extra: (plan.extra ?? []).map(e => ({ refs: [...e.refs] }))
  };
}

/** Number of attacks of the longest option (display "attaques 1/3"). */
export function attackCount(plan) {
  return Math.max(0, ...(plan?.options ?? []).map(groups => groups.reduce((s, g) => s + g.n, 0)));
}

/**
 * Does the sequence of uses fit in the plan? Each use is placed: attack of a group that cites it,
 * replacement (takes the place of an attack of a group, that of the `of` if given), or extra use (once
 * each). All distributions are tried: a few uses at most.
 * @param {object} plan  returned by `parseMultiattack`
 * @param {Array<string[]>} uses  the keys of each use, in order
 * @returns {{attacks: number}|null}  attacks counted (excluding extra uses), or null if the sequence does not fit
 */
export function fitMultiattack(plan, uses) {
  if ( !plan ) return null;
  const has = (keys, list) => keys.some(k => list.includes(k));
  // A group accepts the use that cites one of its keys and none of its exclusions ("only one of which can be a Bite").
  const fits = (keys, group) => has(keys, group.refs) && !(group.except && has(keys, group.except));
  for ( const groups of plan.options ) {
    const free = groups.map(g => g.n);
    const replaced = plan.replace.map(() => 0);
    const extraUsed = plan.extra.map(() => false);
    let attacks = 0;
    const place = i => {
      if ( i === uses.length ) return true;
      const keys = uses[i];
      for ( const [g, group] of groups.entries() ) {
        if ( (free[g] < 1) || !fits(keys, group) ) continue;
        free[g]--; attacks++;
        if ( place(i + 1) ) return true;
        free[g]++; attacks--;
      }
      for ( const [r, rule] of plan.replace.entries() ) {
        if ( (replaced[r] >= rule.n) || !has(keys, rule.refs) ) continue;
        for ( const [g, group] of groups.entries() ) {
          if ( (free[g] < 1) || (rule.of && !has(rule.of, group.refs)) ) continue;
          free[g]--; replaced[r]++; attacks++;
          if ( place(i + 1) ) return true;
          free[g]++; replaced[r]--; attacks--;
        }
      }
      for ( const [e, rule] of plan.extra.entries() ) {
        if ( extraUsed[e] || !has(keys, rule.refs) ) continue;
        extraUsed[e] = true;
        if ( place(i + 1) ) return true;
        extraUsed[e] = false;
      }
      return false;
    };
    if ( place(0) ) return { attacks };
  }
  return null;
}

/**
 * §18.19: what remains of open Multiattack, item by item (HUD, combat tracking). An item is part of the plan if
 * one of its uses fits alone; it still fits if it fits after those already made.
 * @param {object} plan
 * @param {string[][]} used                                  Keys of the uses already made.
 * @param {Array<{id: string, uses: string[][]}>} candidates  Each item, with the keys of each of its activities.
 * @returns {{left: string[], spent: string[]}}  `left`: still playable; `spent`: in the plan, but nothing left for them.
 */
export function multiattackStatus(plan, used, candidates) {
  const left = [];
  const spent = [];
  if ( !plan ) return { left, spent };
  for ( const { id, uses } of candidates ) {
    if ( !uses.some(keys => fitMultiattack(plan, [keys])) ) continue;
    if ( uses.some(keys => fitMultiattack(plan, [...used, keys])) ) left.push(id);
    else spent.push(id);
  }
  return { left, spent };
}
