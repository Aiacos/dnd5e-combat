/**
 * Attaques multiples d'un monstre (SPEC §18.4, M1) : ce que l'action permet, lu dans le texte ANGLAIS d'origine de
 * l'item (sous Babele, `flags.babele.originalPayload.description`), puis ce qu'une suite d'utilisations y fait tenir.
 *
 * Le Monster Manual cite ses attaques en enrichers, lisibles sans deviner : `[[/item Rend]]` (nom anglais),
 * `[[/item .mmBite0000000000]]` (id de l'item), `[[/item .mmSpellcasting00.Activity.<id>]]` (activité), et les sorts en
 * `@UUID[Compendium.….spells.Item.<id>]{Nom}` ; quelques fiches écrivent le nom en clair (« three Slam attacks »).
 * Chaque référence devient une CLÉ (`id:…`, `name:…`, `activity:…`, `spell:…`) ; l'adaptateur donne les clés d'une
 * utilisation, et une utilisation tient dans le plan si l'une de ses clés y figure — rien n'est résolu d'avance.
 *
 * Formes reconnues (307 créatures du MM, balayage du 2026-09-26) :
 *  - « makes three Rend attacks »                          un groupe de 3
 *  - « makes two attacks, using A or B in any combination » un groupe de 2, A ou B
 *  - « makes one A attack and two B attacks »              deux groupes
 *  - « makes three A attacks or two B attacks »            deux options (idem « …, or it makes two C attacks »)
 *  - « It can replace one attack / any attack / the Claw attack with a use of X (or Y) », « … with a Bite attack »,
 *    « … with a use of Spellcasting to cast <sort> »       remplacement : prend la place d'une attaque
 *  - « … and uses X (if available) », « … and it can use Spellcasting to cast <sort> »   usage en plus
 *  - « uses Eye Rays three times » (Tyrannœils, Spectateur)  un groupe de 3 utilisations de la capacité
 *  - « makes as many Bite attacks as it has heads » (Hydre) : sans borne (le nombre de têtes n'est pas une donnée)
 * Coquilles du MM tolérées : « makes » absent (Tigre-garou), « attacks » absent (Ancien dragon de bronze), point collé.
 *
 * Sans texte anglais lisible (fiche écrite en français ou en portugais, prose anglaise aux noms en minuscules), la lecture en
 * clair (`parseTranslated`) : les noms de la fiche reconnus dans le texte, une attaque sans nom valant n'importe quelle attaque
 * (`ANY_ATTACK`). Sans elle, le plan était nul et le nombre d'attaques n'était plus limité (§442).
 *
 * Pur : des chaînes et des objets simples.
 */

/**
 * L'identifiant d'Attaques multiples, quelle que soit la fiche : celui du MM 2024 (`multiattack`), ceux que dnd5e tire du nom
 * d'une fiche importée sans identifiant ou traduite (« Attaque multiple », « Attaques multiples », « Multiattaque »), et
 * ceux d'un nom à précision (« Multiattack (Human or Hybrid Form Only) » → `multiattack-human-or-hybrid-form-only`), et ceux
 * qu'un module de créatures préfixe (`cos-rahadin-attaques-multiples`, `cos-ithuriel-etoile-attaques-multiples`).
 */
export function isMultiattackId(id) {
  const s = String(id ?? "");
  return ["multiattack", "multiattaque", "attaque-multiple", "attaques-multiples"]
    .some(base => (s === base) || s.startsWith(`${base}-`) || s.endsWith(`-${base}`));
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** « Remplacer n'importe quelle attaque » : autant qu'il y en a. Pas d'Infinity : le plan voyage en JSON (budget). */
export const ANY = 99;

const PLAIN_NAME = "[A-Z][A-Za-z'’-]*(?:\\s+(?:of\\s+)?[A-Z(][A-Za-z'’()-]*)*";
const REF = `(?:«\\d+»|${PLAIN_NAME})`;
const NUM = "(one|two|three|four|five|six|seven|eight|\\d+)";
/** Le même, sans le drapeau `i` : une expression qui lit des noms en clair doit garder la casse (« one Claws attack and one Root attack »). */
const NUM_CS = `(${Object.keys(NUMBERS).map(w => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`).join("|")}|\\d+)`;
/** Clés d'une attaque au corps à corps, à distance (« makes two melee attacks ») ; l'adaptateur les donne à l'activité d'attaque. */
export const MELEE_ATTACK = "kind:melee";
export const RANGED_ATTACK = "kind:ranged";
const KIND_KEYS = { melee: MELEE_ATTACK, ranged: RANGED_ATTACK };

/**
 * Remplace les références par des jetons `«n»` et nettoie le HTML. Les jetons évitent qu'un point d'uuid coupe une phrase.
 * @returns {{text: string, refs: string[]}}  refs[n] = clé de la référence n
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

/** Clé d'un argument d'enricher `[[/item …]]`. */
function refKey(arg) {
  if ( !arg ) return "unknown:";
  const activity = arg.match(/\.Activity\.([A-Za-z0-9]{16})$/);
  if ( activity ) return `activity:${activity[1]}`;
  const id = arg.replace(/^\./, "");
  if ( /^[A-Za-z0-9]{16}$/.test(id) ) return `id:${id}`;
  return `name:${arg.toLowerCase()}`;
}

/** Les clés d'une liste « A or B », « A, B, or C », « (A) X or (B) Spellcasting to cast Y ». */
function refsOf(phrase, refs) {
  const out = [];
  for ( let part of phrase.split(/\s*(?:,\s*or\s+|,\s*|\bor\b|\band\b|\beither\b|\([A-Z]\))\s*/) ) {
    part = part.trim();
    if ( !part ) continue;
    // « Spellcasting to cast X » : c'est le sort qui compte.
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

/** Les groupes d'une option : « two attacks, using A or B in any combination », « one A attack and two B attacks ». */
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
  // « two melee attacks », « two ranged weapon attacks », « two weapon attacks » : une sorte d'attaque, pas un nom (B01).
  const kind = option.match(new RegExp(`^\\s*${NUM}\\s+(?:(melee|ranged)\\s+)?(?:weapon\\s+)?attacks?\\s*$`, "i"));
  if ( kind && (kind[2] || /weapon/i.test(option)) ) return [{ n: count(kind[1]), refs: [kind[2] ? KIND_KEYS[kind[2].toLowerCase()] : ANY_ATTACK] }];
  // « two attacks: one with its Claws and one with its Root » : le total annoncé, puis le détail — seul le détail compte (B01).
  const detail = option.match(new RegExp(`^\\s*${NUM}\\s+(?:(?:melee|ranged|weapon)\\s+)*attacks?\\s*:\\s*(.*)$`, "i"));
  if ( detail ) {
    const parts = [...detail[2].matchAll(new RegExp(`${NUM_CS}\\s+(?:attacks?\\s+)?with\\s+(?:its|his|her|their|an?|the)?\\s*(${REF}(?:\\s*(?:,\\s*or|,|or)\\s+${REF})*)`, "g"))];
    const groups = parts.map(m => ({ n: count(m[1]), refs: refsOf(m[2], refs) })).filter(g => g.refs.length);
    if ( groups.length && (groups.length === parts.length) ) return groups;
  }
  const groups = [];
  // Sans `i` : un nom en clair commence par une majuscule, sinon « Bite attack and two Rend » passerait pour un seul nom (B01).
  const re = new RegExp(`${NUM_CS}\\s+(${REF}(?:\\s*(?:,\\s*or|,|or)\\s+${REF})*)\\s+attacks?\\b`, "g");
  for ( const m of option.matchAll(re) ) {
    const keys = refsOf(m[2], refs);
    if ( keys.length ) groups.push({ n: count(m[1]), refs: keys });
  }
  // « makes three Rend. » : le mot « attacks » manque (Ancien dragon de bronze).
  const bare = !groups.length && option.match(new RegExp(`^\\s*${NUM}\\s+(${REF})\\s*$`, "i"));
  if ( bare ) {
    const keys = refsOf(bare[2], refs);
    // « makes two attacks » : « attacks » n'est pas un nom — n'importe quelle attaque. Avant, un groupe sans clé : rien n'y tenait.
    if ( keys.length ) groups.push({ n: count(bare[1]), refs: keys });
    else if ( /^attacks?$/i.test(bare[2].trim()) ) groups.push({ n: count(bare[1]), refs: [ANY_ATTACK] });
  }
  return groups.length ? groups : null;
}

/**
 * Le plan d'Attaques multiples, ou null si le texte ne se laisse pas lire.
 * @param {string} html  description anglaise de l'item
 * @returns {{options: Array<Array<{n: number, refs: string[]}>>, replace: Array<{n: number, refs: string[], of: string[]|null}>,
 *   extra: Array<{refs: string[]}>}|null}
 */
export function parseMultiattack(html, { names=[] }={}) {
  const english = parseEnglish(html);
  const plain = parseTranslated(html, names);
  if ( !english ) return plain;
  // Le texte anglais garde la main ; un remplacement ou un usage en plus qu'il n'a pas su lire (« replace one of those attacks
  // with ray of light », nom en minuscules) se prend dans la lecture en clair.
  if ( plain && !english.replace.length ) english.replace = plain.replace;
  if ( plain && !english.extra.length ) english.extra = plain.extra;
  return english;
}

/**
 * « two melee attacks, only one of which can be a Bite attack » : un groupe de 2 devient 1 attaque quelconque du groupe + 1 qui
 * n'est pas une Morsure (`except`) — la Morsure ne tient qu'une fois. Seulement pour une option d'un seul groupe.
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
    // Usages en plus : « and uses X (if available) », « and it can use Spellcasting to cast X ».
    const plus = body.match(/,?\s*and (?:it )?(?:can )?uses?\s+(.*)$/i);
    if ( plus ) {
      const keys = refsOf(plus[1].replace(/\s*if available$/i, "").replace(/\s+if it .*$/i, ""), refs);
      if ( keys.length ) extra.push({ refs: keys });
      body = body.slice(0, plus.index);
    }
    // « two melee attacks, only one of which can be a bite attack » : au plus tant d'attaques de celle-là (B01).
    let cap = null;
    const only = body.match(new RegExp(`,?\\s*(?:but\\s+)?only\\s+${NUM}\\s+of\\s+(?:which|them|these|those)\\s+can\\s+be\\s+(?:an?\\s+|with\\s+(?:its\\s+)?)?(.*?)(?:\\s+attacks?)?$`, "i"));
    if ( only ) {
      const keys = refsOf(only[2], refs);
      const name = only[2].trim().toLowerCase();
      cap = { n: count(only[1]), refs: keys.length ? keys : (/^[a-z][a-z' -]*$/.test(name) ? [`name:${name}`] : []) };
      body = body.slice(0, only.index);
    }
    // Options : « three A attacks or two B attacks », « one A attack and one B attack, or it makes two C attacks »,
    // « two melee attacks or uses Shocking Bolt twice » (B01).
    const parts = body.replace(new RegExp(`\\battacks?,?\\s+or\\s+(?:it makes\\s+)?(?=${NUM}\\b|uses?\\s)`, "gi"), "attacks|").split("|");
    let parsed = parts.map(p => groupsOf(p, refs));
    if ( cap?.refs.length && parsed.every(Boolean) ) parsed = parsed.map(groups => capGroups(groups, cap));
    if ( parsed.every(Boolean) ) options = parsed;
  }
  return options ? { options, replace, extra } : null;
}

/* -------------------------------------------- */
/*  Texte traduit (français, portugais du Brésil) */
/* -------------------------------------------- */

/**
 * Clé d'une utilisation qui est une attaque, quelle qu'elle soit : « effectue deux attaques », sans dire lesquelles.
 * L'adaptateur la donne à toute activité d'attaque (`useKeysOf`).
 */
export const ANY_ATTACK = "kind:attack";

const TR_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const TR_NUM = `(?:${Object.keys(TR_NUMBERS).join("|")}|\\d+)`;
/** Lettres avant / après un mot (accents compris) : `\b` ne connaît pas « é ». */
const NOT_L = "(?<![\\p{L}\\d«])";   // « : un jeton de référence (`«2»`) n'est pas un nombre
const NOT_R = "(?![\\p{L}\\d])";
const trCount = word => TR_NUMBERS[word.toLowerCase()] ?? Number(word);
const tokensOf = (phrase, refs) => [...new Set([...phrase.matchAll(/«(\d+)»/g)].map(m => refs[Number(m[1])]).filter(k => k && (k !== "unknown:")))];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Attaques multiples d'une fiche écrite en français ou en portugais (pas de texte anglais d'origine : module de créatures,
 * fiche faite à la main), ou d'un texte anglais en prose que `parseEnglish` ne lit pas (« makes three attacks with his blades
 * A and/or B », noms en minuscules). Les références `[[/item …]]` et `@UUID[…]` se lisent comme en anglais ; les capacités nommées en clair
 * se reconnaissent par les noms de la fiche (`names` : `[nom affiché, clé]`). Une attaque sans nom vaut n'importe quelle attaque
 * (`ANY_ATTACK`). Formes :
 *  - « effectue / réalise / fait / porte deux attaques », « … trois attaques avec ses lames A et/ou B »,
 *    « … deux attaques, réparties à sa guise entre A et B », « … une attaque de A, une attaque de B et une de C »,
 *    « … trois attaques de A ou deux attaques de B » (options) ;
 *  - « Il peut remplacer une attaque / l'une de ces attaques / n'importe quelle attaque / l'attaque de A par (une utilisation
 *    de) X » ;
 *  - « … et utilise / recourt à X » (usage en plus) ;
 *  - portugais : « realiza / faz / executa dois ataques », « pode substituir um ataque por X ».
 */
function parseTranslated(html, names=[]) {
  let { text, refs } = tokenize(html);
  text = text.replace(/[’]/g, "'");
  // Les noms en clair, les plus longs d'abord (« Lame d'épouvante » avant « Lame »).
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
    // Usage en plus : « et utilise X », « puis recourt à X », « e usa X ».
    const plus = body.match(/,?\s*(?:et|puis|e|and)\s+(?:il\s+|elle\s+|ele\s+|ela\s+|it\s+)?(?:peut\s+|pode\s+|can\s+)?(?:utilise[rz]?|recourt à|recourir à|usa|usar|utiliza|uses?)\s+(.*)$/iu);
    if ( plus ) {
      const keys = tokensOf(plus[1], refs);
      if ( keys.length ) extra.push({ refs: keys });
      body = body.slice(0, plus.index);
    }
    // Options : « trois attaques de A ou deux attaques de B », « …, ou il effectue deux attaques de C ».
    const parts = body.split(new RegExp(`,?\\s+(?:ou|or)\\s+(?:il\\s+|elle\\s+|ele\\s+|ela\\s+|it\\s+)?(?:effectue\\s+|réalise\\s+|realiza\\s+|faz\\s+|makes\\s+)?(?=${TR_NUM}${NOT_R})`, "iu"));
    const parsed = parts.map(p => translatedGroups(p, refs));
    if ( parsed.length && parsed.every(Boolean) ) options = parsed;
  }
  return options ? { options, replace, extra } : null;
}

/** Les groupes d'une option : chaque nombre ouvre un groupe, les références qui le suivent sont les siennes. */
function translatedGroups(option, refs) {
  // « makes three melee attacks: two with A and one with B » : le total annoncé, puis le détail — seul le détail compte.
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
 * Élargit chaque clé du plan à toutes celles du même item de la fiche : « Claw » par son nom et `.mmClaw…` par son id
 * désignent la même Griffe (Chimère : « replace the Claw attack », le groupe la cite par id).
 * @param {object} plan
 * @param {Array<string[]>} catalog  les clés de chaque item (et de chaque activité d'incantation) de la fiche
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
/*  Plan déclaré (clé de contenu `multiattackPlan`, B01) */
/* -------------------------------------------- */

/**
 * Une clé de plan déclarée : `id:<id>`, `name:<nom anglais en minuscules>`, `identifier:<identifiant dnd5e>`, `activity:<id>`,
 * `spell:<uuid>`, ou une sorte d'attaque `kind:attack` / `kind:melee` / `kind:ranged`.
 */
const PLAN_KEY = /^(?:(?:id|name|identifier|activity|spell):.+|kind:(?:attack|melee|ranged))$/;
const isCount = n => Number.isInteger(n) && (n > 0) && (n <= ANY);
const isKeys = (list, empty=false) => Array.isArray(list) && (empty || list.length) && list.every(k => (typeof k === "string") && PLAN_KEY.test(k));

/**
 * Les erreurs d'un `multiattackPlan` déclaré : `{ options: [[{ n, refs, except? }]], replace?: [{ n, refs, of? }], extra?: [{ refs }] }`.
 * Un groupe est un maximum : `n` attaques au plus qui citent l'une de ses `refs` et aucune de ses `except`.
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

/** Le plan déclaré, complété (`replace`, `extra` vides par défaut) et copié ; null s'il est invalide. */
export function declaredPlan(plan) {
  if ( !plan || validatePlan(plan).length ) return null;
  return {
    options: plan.options.map(groups => groups.map(g => ({ n: g.n, refs: [...g.refs], ...(g.except ? { except: [...g.except] } : {}) }))),
    replace: (plan.replace ?? []).map(r => ({ n: r.n, refs: [...r.refs], of: r.of ? [...r.of] : null })),
    extra: (plan.extra ?? []).map(e => ({ refs: [...e.refs] }))
  };
}

/** Nombre d'attaques de l'option la plus longue (affichage « attaques 1/3 »). */
export function attackCount(plan) {
  return Math.max(0, ...(plan?.options ?? []).map(groups => groups.reduce((s, g) => s + g.n, 0)));
}

/**
 * La suite d'utilisations tient-elle dans le plan ? Chaque utilisation se range : attaque d'un groupe qui la cite,
 * remplacement (prend la place d'une attaque d'un groupe, celui du `of` s'il est dit), ou usage en plus (une fois
 * chacun). Essai de toutes les répartitions : quelques utilisations au plus.
 * @param {object} plan  rendu par `parseMultiattack`
 * @param {Array<string[]>} uses  les clés de chaque utilisation, dans l'ordre
 * @returns {{attacks: number}|null}  attaques comptées (hors usages en plus), ou null si la suite ne tient pas
 */
export function fitMultiattack(plan, uses) {
  if ( !plan ) return null;
  const has = (keys, list) => keys.some(k => list.includes(k));
  // Un groupe accepte l'utilisation qui cite l'une de ses clés et aucune de ses exclusions (« only one of which can be a Bite »).
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
 * §18.19 : ce qui reste d'Attaques multiples ouvertes, item par item (HUD, suivi de combat). Un item fait partie du plan si
 * l'une de ses utilisations y tient seule ; il y tient encore si elle tient après celles déjà faites.
 * @param {object} plan
 * @param {string[][]} used                                  Clés des utilisations déjà faites.
 * @param {Array<{id: string, uses: string[][]}>} candidates  Chaque item, avec les clés de chacune de ses activités.
 * @returns {{left: string[], spent: string[]}}  `left` : encore jouables ; `spent` : du plan, mais plus rien pour eux.
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
