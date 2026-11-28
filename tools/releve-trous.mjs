/**
 * Gap survey (2026-10-22): what the spell and feat reading survey (`prive/RELEVE_SORTS.md`, `RELEVE_DONS.md`) may have
 * missed, searched mechanically in the data — not in the hand-read text. For each spell, feat, class feature and species trait
 * of the premium Player's Handbook (and the SRD 2024 spells of dnd5e), cross-checked with what the engine declares (`CONTENT`):
 *  - `ref-morte`:    an id (activity or effect) cited by the engine entry does not exist on the item — the rule hooks onto nothing;
 *  - `effet-orphelin`: an effect of the item that no activity applies, that is not transferred and that the engine does not
 *    cite ("Cadaveric State");
 *  - `lien-casse`:   an activity applies an effect absent from the item;
 *  - `etat-absent`:  the text imposes a condition ("the Prone condition") that no effect of the item carries and that the
 *    engine does not cite;
 *  - `degats-vides`: a damage part with no dice or formula (the pregens' spear, §151);
 *  - `sans-degats`:  the text announces damage / healing dice, no activity carries any, the engine declares none;
 *  - `montee`:       spell of level ≥ 1 whose text increases the dice at a higher level, without `scaling` on the part or activity;
 *  - `tour-sans-montee`: cantrip with dice without "whole" scaling;
 *  - `moitie`:       "half as much damage" in the text and `onSave` ≠ half, or the reverse;
 *  - `cle-inconnue`: effect change on a key absent from dnd5e's actor data (Medium Armor Master, §130);
 *  - `portee-soi`:   "personal" range of an activity that targets a creature (survey §124, repeated);
 *  - `ident-orphelin`: an engine entry whose identifier exists in no data read (typo, rename);
 *  - `srdRenamed`:   a renamed SRD 2024 item (same document id as the Handbook, other identifier) without its rule.
 * Reads a COPY of the LevelDB databases, writes nothing to the repository: the JSON (premium text) goes where requested,
 * outside the repository.
 *   node tools/releve-trous.mjs <Foundry Data folder> <acteur.json> <output.json>
 * `acteur.json`: a player character and an NPC read by the connector (`get-actor`), as an array — the list of valid keys.
 */
import { cpSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const [data, actorFile, out] = process.argv.slice(2);
if ( !data || !actorFile || !out ) { console.error("usage : node tools/releve-trous.mjs <Data> <acteurs.json> <sortie.json>"); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), "releve-trous-"));

async function read(dir, fn) {
  if ( !existsSync(dir) ) return;
  const copy = join(tmp, String(Math.random()).slice(2));
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(dir) ) if ( f !== "LOCK" ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, value] of db.iterator() ) fn(key, value);
  await db.close();
}

const text = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/* ---- les items lus ---- */
const PHB = join(data, "modules/dnd-players-handbook/packs");
const SOURCES = [
  { book: "PHB", dir: join(PHB, "spells") }, { book: "PHB", dir: join(PHB, "feats") },
  { book: "PHB", dir: join(PHB, "classes") }, { book: "PHB", dir: join(PHB, "origins") },
  { book: "SRD", dir: join(data, "systems/dnd5e/packs/spells24") }, { book: "SRD", dir: join(data, "systems/dnd5e/packs/feats24") },
  { book: "SRD", dir: join(data, "systems/dnd5e/packs/classfeatures") }, { book: "SRD", dir: join(data, "systems/dnd5e/packs/origins24") }
];
// Seulement pour savoir quels identifiants existent (orphelins) : bestiaires, objets, Ravenloft, DMG.
const KNOWN_ONLY = [
  join(PHB, "equipment"), join(PHB, "actors"), join(data, "modules/dnd-monster-manual/packs/actors"),
  join(data, "modules/dnd-monster-manual/packs/features"), join(data, "modules/dnd-dungeon-masters-guide/packs/equipment"),
  join(data, "modules/dnd-dungeon-masters-guide/packs/features"), join(data, "modules/dnd-dungeon-masters-guide/packs/actors"),
  join(data, "modules/dnd-ravenloft-horrors-within/packs/options"), join(data, "modules/dnd-ravenloft-horrors-within/packs/items"),
  join(data, "modules/dnd-ravenloft-horrors-within/packs/actors"), join(data, "systems/dnd5e/packs/equipment24"),
  join(data, "systems/dnd5e/packs/monsterfeatures24"), join(data, "systems/dnd5e/packs/actors24")
];

const items = [];
const effectsOf = new Map();
for ( const { book, dir } of SOURCES ) {
  await read(dir, (key, value) => {
    if ( key.startsWith("!items.effects!") ) {
      const id = `${dir}|${key.split("!")[2].split(".")[0]}`;
      if ( !effectsOf.has(id) ) effectsOf.set(id, []);
      effectsOf.get(id).push(value);
    }
    else if ( key.startsWith("!items!") && ["spell", "feat"].includes(value.type) ) items.push({ book, dir, item: value });
  });
}
const known = new Set(items.map(i => i.item.system?.identifier).filter(Boolean));
const knownIds = new Map();   // identifier → ids (activities, effects) of all its versions, bestiaries included
const noteIds = (ident, item, effects=[]) => {
  if ( !ident ) return;
  if ( !knownIds.has(ident) ) knownIds.set(ident, new Set());
  const set = knownIds.get(ident);
  for ( const id of Object.keys(item.system?.activities ?? {}) ) set.add(id);
  for ( const e of effects.concat(item.effects ?? []) ) if ( typeof e === "object" ) set.add(e._id);
};
const embeddedEffects = new Map();
for ( const dir of KNOWN_ONLY ) {
  await read(dir, (key, value) => {
    if ( key.startsWith("!actors.items.effects!") || key.startsWith("!items.effects!") ) {
      const owner = key.split("!")[2].split(".").at(-2);
      if ( !embeddedEffects.has(owner) ) embeddedEffects.set(owner, []);
      embeddedEffects.get(owner).push(value._id);
    }
    else if ( key.startsWith("!actors.items!") || key.startsWith("!items!") ) {
      const ident = value.system?.identifier;
      if ( ident ) { known.add(ident); noteIds(ident, value, (embeddedEffects.get(value._id) ?? []).map(_id => ({ _id }))); }
    }
  });
}
for ( const { dir, item } of items ) noteIds(item.system?.identifier, item, effectsOf.get(`${dir}|${item._id}`) ?? []);

/* ---- the valid actor keys ---- */
const actors = JSON.parse(readFileSync(actorFile, "utf8"));
const keys = new Set();
const walk = (obj, path) => {
  if ( !obj || (typeof obj !== "object") || Array.isArray(obj) ) { keys.add(path); return; }
  keys.add(path);
  for ( const [k, v] of Object.entries(obj) ) walk(v, `${path}.${k}`);
};
for ( const a of [actors].flat() ) walk(a.system, "system");
// Derived values that the source data does not have (prepared by dnd5e): accepted under a known parent.
const DERIVED = new Set(["value", "max", "min", "bonus", "mod", "total", "dc", "bonuses", "tempmax", "temp", "effectiveMax", "mode",
  "flat", "calc", "formula", "armor", "shield", "cover", "abilities", "all"]);
const flagKeys = new Set();
const cfgPath = join(data, "systems/dnd5e/dnd5e.mjs");
if ( existsSync(cfgPath) ) {
  const src = readFileSync(cfgPath, "utf8");
  const block = src.slice(src.indexOf("DND5E.characterFlags = {"), src.indexOf("DND5E.characterFlags = {") + 20000);
  for ( const m of block.matchAll(/^ {2}(\w+): \{/gm) ) flagKeys.add(m[1]);
}
const keyOk = key => {
  if ( !key ) return true;
  if ( key.startsWith("flags.dnd5e.") ) return !flagKeys.size || flagKeys.has(key.split(".")[2]) || /^(initiative|spellCriticalThreshold|meleeCriticalDamageDice|weaponCriticalThreshold|tavernBrawler)/.test(key.split(".")[2]);
  if ( key.startsWith("flags.") || key.startsWith("macro.") || key.startsWith("ATL.") || key.startsWith("ATE.") ) return true;
  if ( !key.startsWith("system.") ) return true;
  if ( keys.has(key) ) return true;
  // Old keys that dnd5e 6 renames on application (documents/active-effect.mjs:80-86), prepared values.
  if ( /^system\.attributes\.movement\.(speed|walk|burrow|climb|fly|jump|swim)$/.test(key) ) return true;
  if ( /^system\.(scale\.|traits\.dm\.amount\.|attributes\.hp\.bonuses\.)/.test(key) ) return true;
  const parts = key.split(".");
  for ( let i = parts.length - 1; i > 1; i-- ) {
    const parent = parts.slice(0, i).join(".");
    if ( keys.has(parent) && parts.slice(i).every(p => DERIVED.has(p) || /^(str|dex|con|int|wis|cha|mwak|rwak|msak|rsak|check|save|skill|spell|attack|damage|walk|fly|swim|climb|burrow|hover|units|darkvision|blindsight|tremorsense|truesight|special)$/.test(p)) ) return true;
  }
  return false;
};

/* ---- the surveys ---- */
const CONDITIONS = { Blinded: "blinded", Charmed: "charmed", Deafened: "deafened", Frightened: "frightened", Grappled: "grappled",
  Incapacitated: "incapacitated", Invisible: "invisible", Paralyzed: "paralyzed", Petrified: "petrified", Poisoned: "poisoned",
  Prone: "prone", Restrained: "restrained", Stunned: "stunned", Unconscious: "unconscious", Exhaustion: "exhaustion" };
const idsIn = (value, acc=new Set()) => {
  // An id is 16 characters; a schema key name sometimes too ("difficultTerrain"): a camelCase word is not one,
  // except the readable ids of premium modules ("phbsplCompulsion").
  if ( typeof value === "string" ) {
    if ( /^[A-Za-z0-9]{16}$/.test(value) && (!/^[a-z]+([A-Z][a-z]+)+$/.test(value) || /^(phb|mm|dmg|rhw|hotb|dnd5e)/.test(value)) ) acc.add(value);
  }
  else if ( Array.isArray(value) ) value.forEach(v => idsIn(v, acc));
  else if ( value && (typeof value === "object") ) for ( const [k, v] of Object.entries(value) ) { idsIn(k, acc); idsIn(v, acc); }
  return acc;
};
const changesOf = e => e.changes ?? e.system?.changes ?? [];
const rows = [];
const allFeats = [];
const seen = new Set();
for ( const { book, dir, item } of items ) {
  const s = item.system ?? {};
  const ident = s.identifier ?? "";
  // The same identifier in the PHB and the SRD: the PHB first, the SRD only if it has no PHB version.
  const dedupe = `${item.type}|${ident}`;
  if ( (book === "SRD") && seen.has(dedupe) ) continue;
  seen.add(dedupe);
  const effects = effectsOf.get(`${dir}|${item._id}`) ?? [];
  const effectIds = new Set(effects.map(e => e._id));
  const activities = Object.values(s.activities ?? {});
  const activityIds = new Set(activities.map(a => a._id));
  const entry = CONTENT[ident];
  const entryIds = entry ? idsIn(entry) : new Set();
  const entryText = entry ? JSON.stringify(entry) : "";
  const desc = text(s.description?.value);
  const findings = [];
  const add = (kind, detail) => findings.push({ kind, detail });

  // ref-morte: id cited by the engine, absent from this item (and from every version of this identifier).
  for ( const id of entryIds ) {
    if ( activityIds.has(id) || effectIds.has(id) ) continue;
    if ( knownIds.get(ident)?.has(id) ) continue;
    if ( /^dnd5eactivity\d{3}$/.test(id) ) { add("ref-morte", `${id} (activité générique absente)`); continue; }
    // An id of another item (a spell cited by a feature): flagged separately, less serious.
    const elsewhere = [...knownIds.entries()].find(([, set]) => set.has(id))?.[0];
    if ( !elsewhere ) add("ref-morte", id);
  }
  // Effets.
  const posed = new Set(activities.flatMap(a => (a.effects ?? []).map(e => e._id)));
  for ( const a of activities ) for ( const e of a.effects ?? [] ) if ( !effectIds.has(e._id) ) add("lien-casse", `${a.type} ${a.name || a._id} → ${e._id}`);
  for ( const e of effects ) {
    if ( e.transfer || posed.has(e._id) || entryIds.has(e._id) ) continue;
    if ( e.type === "enchantment" && activities.some(a => a.type === "enchant") ) continue;
    // An effect targeted by an enchantment `riders` or named by the engine.
    if ( entryText.includes(JSON.stringify(e.name)) ) continue;
    add("effet-orphelin", `${e.name} (${e._id})${e.statuses?.length ? ` [${e.statuses.join(", ")}]` : ""}`);
  }
  for ( const e of effects.filter(e => e.type !== "enchantment") ) for ( const c of changesOf(e) ) if ( !keyOk(c.key) ) add("cle-inconnue", `${e.name} : ${c.key} = ${c.value}`);
  // Announced conditions.
  const statuses = new Set(effects.flatMap(e => e.statuses ?? []));
  for ( const [name, id] of Object.entries(CONDITIONS) ) {
    const re = new RegExp(`(have|has|gains?|give[sn]?|is|are|be|becomes?|knocked|fall|falls)\\s+(the\\s+)?${name}\\s+condition|${name} condition (until|for)`, "i");
    const m = desc.match(re);
    if ( !m ) continue;
    // A precondition ("unless you have the Incapacitated condition") is not an imposed condition.
    if ( /(unless|if|while|isn't|aren't|don't|doesn't|lack|not|without)[^.]{0,40}$/i.test(desc.slice(Math.max(0, m.index - 50), m.index)) ) continue;
    if ( statuses.has(id) || entryText.includes(`"${id}"`) ) continue;
    if ( new RegExp(`(immun\\w* to|ends? the|remove[sd]? the|end one|doesn't have|can't (have|be))[^.]{0,40}${name}`, "i").test(desc) && !new RegExp(`(has|have|gains?) the ${name}`, "i").test(desc) ) continue;
    add("etat-absent", name);
  }
  // Damage.
  const dmgParts = activities.flatMap(a => (a.damage?.parts ?? []).map(p => ({ a, p })));
  for ( const { a, p } of dmgParts ) {
    const hasDice = (p.number && p.denomination) || p.custom?.enabled && p.custom?.formula?.trim() || String(p.bonus ?? "").trim();
    if ( !hasDice ) add("degats-vides", `${a.type} ${a.name || a._id}`);
  }
  const textDice = /\b\d*d(4|6|8|10|12|20)\b[^.]{0,40}\b(\w+ )?(damage|Hit Points)/i.test(desc);
  const anyRoll = dmgParts.length || activities.some(a => a.healing?.number || a.healing?.custom?.formula || a.healing?.bonus);
  const engineRoll = /formula|damage|dice|heal/i.test(entryText);
  if ( textDice && !anyRoll && !engineRoll && activities.length ) add("sans-degats", desc.match(/\b\d*d(4|6|8|10|12|20)\b[^.]{0,40}/i)?.[0]);
  if ( item.type === "spell" ) {
    const higher = desc.split(/Using a Higher-Level Spell Slot\.?|At Higher Levels\.?/i)[1] ?? "";
    const cantrip = desc.split(/Cantrip Upgrade\.?/i)[1] ?? "";
    const scaled = dmgParts.some(({ p }) => p.scaling?.mode || p.scaling?.number || p.scaling?.formula)
      || activities.some(a => a.healing?.scaling?.mode || a.healing?.scaling?.number || a.healing?.scaling?.formula);
    if ( (s.level >= 1) && /(damage|healing|Hit Points|temporary)[^.]*increases by \d*d\d+|increases by \d*d\d+[^.]*(damage|healing)/i.test(higher) && !scaled && !/scal|perLevel|higher/i.test(entryText) ) add("montee", higher.slice(0, 120));
    if ( (s.level === 0) && /increases by|\d+d\d+/i.test(cantrip) && dmgParts.length && !dmgParts.some(({ p }) => p.scaling?.mode) && !/scal|cantrip/i.test(entryText) ) add("tour-sans-montee", cantrip.slice(0, 120));
    const half = /half as much damage|half damage|half the damage/i.test(desc);
    const saves = activities.filter(a => (a.type === "save") && a.damage?.parts?.length);
    if ( half && saves.length && !saves.some(a => a.damage?.onSave === "half") ) add("moitie", `texte : moitié ; onSave = ${saves.map(a => a.damage?.onSave || "none").join("/")}`);
    // The engine fixes the part on a success (`saveDamage`): no longer a gap.
    if ( !half && saves.some(a => (a.damage?.onSave === "half") && !entry?.saveDamage?.[a._id]) && !/half/i.test(desc) ) add("moitie", "onSave = half, le texte ne le dit pas");
  }
  // Personal range toward a creature.
  for ( const a of activities ) {
    const range = a.range?.override ? a.range?.units : s.range?.units;
    const affects = a.target?.override ? a.target?.affects?.type : s.target?.affects?.type;
    const template = a.target?.override ? a.target?.template?.type : s.target?.template?.type;
    if ( (range === "self") && ["creature", "ally", "enemy", "willing"].includes(affects) && !template && !/ranges|self/i.test(entryText) ) add("portee-soi", `${a.type} ${a.name || a._id} → ${affects}`);
  }
  if ( (item.type === "feat") && (book === "PHB") ) allFeats.push({ name: item.name, identifier: ident, id: item._id, cls: s.requirements ?? "" });
  if ( findings.length ) rows.push({ book, type: item.type, subtype: s.type?.value ?? "", level: s.level, name: item.name, identifier: ident, id: item._id,
    engine: entry ? Object.keys(entry).filter(k => k !== "source") : [], findings, text: desc.slice(0, 1500) });
}
// An SRD 2024 item that keeps the Handbook's document id under another identifier ("black-tentacles" for
// "evards-black-tentacles"): without its own entry or alias, it lacks the Handbook rule in a world without the premium Handbook.
const phbById = new Map(items.filter(i => i.book === "PHB").map(i => [i.item._id, i.item.system?.identifier]));
const srdRenamed = items.filter(i => i.book === "SRD").map(i => ({ srd: i.item.system?.identifier, phb: phbById.get(i.item._id), name: i.item.name }))
  .filter(x => x.phb && x.srd && (x.phb !== x.srd) && CONTENT[x.phb] && !CONTENT[x.srd]);
const orphans = Object.keys(CONTENT).filter(id => !known.has(id) && !/^cos-|^das-|^test/.test(id) && !CONTENT[id]?.source);
writeFileSync(out.replace(/.json$/, "") + "-aptitudes.json", JSON.stringify(allFeats));
writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), items: items.length, rows, orphans, srdRenamed }, null, 1));
const count = {};
for ( const r of rows ) for ( const f of r.findings ) count[f.kind] = (count[f.kind] ?? 0) + 1;
console.log(`${items.length} items lus, ${rows.length} avec un relevé :`, count, `; identifiants du moteur sans donnée : ${orphans.length} ; renommés au SRD sans règle : ${srdRenamed.map(x => x.srd).join(", ") || "aucun"}`);
