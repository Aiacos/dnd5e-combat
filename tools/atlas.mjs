#!/usr/bin/env node
/**
 * Automation atlas (2026-10-28): each spell, feat, feature, item and creature ability of the premium modules, with its structuring
 * fields (activation, range, targets, area, duration, attack, damage, healing, save, effects, summoning, uses,
 * movement, engine rules) and, for each one, who handles it:
 *  - `das`: an engine rule (`CONTENT`, by identifier);
 *  - `sys`: the item's dnd5e data, which the engine resolves generically;
 *  - `man`: the text announces it, neither the data nor the engine carries it (left to the GM);
 *  - `bad`: data defect (empty damage part, missing linked effect).
 * Overall status: the reading survey (`prive/RELEVE_SORTS.md`) when there is one, otherwise deduced from the fields. Versions:
 * fingerprint of the premium data, fingerprint of the engine entry, last commit that touched it; the history (fingerprints and
 * statuses, no text) is kept in `prive/atlas/historique.json`, one more line per item at each change.
 * Reads a COPY of the LevelDB databases (Foundry locks them). The JSON produced contains the premium text: it goes outside the
 * repository.
 *   node tools/atlas.mjs <output folder> [Foundry Data folder]
 * Output: `atlas-<onglet>.json` (spells, feats, features, items, creatures), `atlas-briques.json` (§367), `atlas-resume.json`,
 * the local page `atlas.html` (if `prive/` is there; double-click to open it), and `prive/ATLAS.md` (counts, no text).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT, SOURCES } from "../module/scripts/content/index.mjs";
import { ENTRY_KEYS, STEP_TYPES } from "../module/scripts/core/content/enums.mjs";
import { MOMENTS } from "../module/scripts/core/triggers.mjs";
import { withDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { monsterTextLayer } from "../module/scripts/core/monster-layer.mjs";
import { mergeEntries } from "../module/scripts/core/content.mjs";
import { readDrain } from "../module/scripts/core/drain.mjs";

const [out, data = "F:/Foundry V14/Data"] = process.argv.slice(2);
if ( !out ) { console.error("usage : node tools/atlas.mjs <dossier de sortie> [Data]"); process.exit(1); }
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "atlas-"));
const ENGINE_VERSION = JSON.parse(readFileSync("module/module.json", "utf8")).version;
const TODAY = new Date().toISOString().slice(0, 10);

const MODULES = [
  { id: "dnd-players-handbook", label: "PHB 2024", packs: ["spells", "feats", "classes", "origins", "equipment", "actors"],
    fr: "../Foundry dnd5 module trad player manuel du joueur/module/compendium/fr" },
  { id: "dnd-dungeon-masters-guide", label: "DMG 2024", packs: ["equipment", "features", "actors"],
    fr: "../Foundry dnd5 module trad Game master/module/compendium/fr" },
  { id: "dnd-monster-manual", label: "MM 2025", packs: ["actors"], fr: "../Foundry dnd5 module trad bestiaire/compendium/fr" },
  { id: "dnd-ravenloft-horrors-within", label: "Ravenloft", packs: ["options", "items", "actors"],
    fr: "../Foundry dnd5 module trad Ravenloft/module/compendium/fr" },
  { id: "dnd-heroes-borderlands", label: "Heroes of the Borderlands", packs: ["options", "items", "actors"], fr: null }
];

async function read(dir, fn) {
  if ( !existsSync(dir) ) return;
  const copy = join(tmp, String(Math.random()).slice(2));
  mkdirSync(copy, { recursive: true });
  // Only the database files: LevelDB sometimes leaves a `lost/` folder (repair), which the copy refused (ERR_FS_EISDIR).
  for ( const f of readdirSync(dir) ) if ( (f !== "LOCK") && statSync(join(dir, f)).isFile() ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, value] of db.iterator() ) fn(key, value);
  await db.close();
}

const text = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ")
  .replace(/\s+/g, " ").trim();
const hash = v => createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 8);
const units = { ft: "ft", mi: "mi", m: "m", km: "km", self: "personnelle", touch: "contact", spec: "spéciale", any: "illimitée" };

/* ---- engine key categories ---- */
const CATS = {
  at: ["hitRider", "smite", "advantageIfFighting", "critMark", "halfOnMiss", "rangedFeat", "bonusAttack", "projectiles", "replacesAttack",
    "sneakAttack", "cunningStrikes", "cunningStrikeMax", "afterSneak", "sneakBonus", "savageAttacker", "piercer", "peerlessAim",
    "overwhelmingStrike", "reckless", "greatWeaponFighting", "thrownDamage", "flurry", "martialArts", "commandStrike", "sweep", "onNatural1",
    "critMove", "studiedAttacks", "oneAttack", "rolledAc", "heroicWarrior", "stunningStrike", "openHand", "oneAttack", "reactiveStrike",
    "interposeShield", "opportunityDisadvantage", "combatInspiration", "scoreFloor"],
  dm: ["saveDamage", "drain", "burst", "bolt", "storm", "lifesteal", "damageShield", "ignoresResistance", "elementalAdept",
    "spellDamageTypes", "potentCantrip", "empower", "discharge", "grappleDamage", "burns", "kindles", "flammable", "noDamage", "hpTiers",
    "byWounds", "absorb", "thrownDamage", "rage", "persistentRage", "swallow"],
  he: ["cures", "curesAll", "healMax", "healsDownedMax", "supremeHealing", "revivesFull", "regeneration", "hitDiceHeal", "healingRerolls",
    "fortifiedHealing", "lastStandHeal", "discipleOfLife", "blessedHealer", "tempHpPool", "stabilizes", "blocksHealing", "wardsAtZero",
    "stableAtZero", "atZero", "relentless", "endurance", "absorbsDamage"],
  sv: ["saveAdvantage", "savedEffects", "saveDisadvantageFor", "willingFails", "saveAdvantageSize", "fleeOnFailedSave", "evasion",
    "fortitude", "pendingDie", "portent", "rollBonus", "elusive"],
  ar: ["emanation", "aura", "walls", "thinWall", "pointWall", "cellWall", "zoneAffects", "selfZone", "obscures", "difficultTerrain",
    "zoneEffects", "zoneCharges", "zoneEnd", "casterPulse", "movable", "globe", "encloses", "barrier", "wallSide", "wallAura", "slippery",
    "prismatic", "coverThrough", "sculptSpells", "scatter"],
  tg: ["targets", "castTargets", "ranges", "cantripRange", "enchantTarget"],
  du: ["endsWhen", "effectEnds", "breaksOn", "actionEnds", "effectsExpire", "atTurnStart", "keepsConcentration", "concentrationBreaker", "recast",
    "recastCost", "holdsStill"],
  ef: ["effectChanges", "effectWhile", "effectStatuses", "effectThen", "effectsIf", "grantsSpeeds", "grantsResistances", "seesInvisible",
    "revealsInvisible", "levitate", "blink", "resize", "endsOwnConditions", "endsCurses", "dispel", "potionEffect", "light",
    "carriedLight", "noReactions", "noActions", "noOpportunityAttacks", "duplicates"],
  su: ["summon", "placesSummons", "orders"],
  us: ["usageLimits", "actionOrBonus", "grantsAction", "limitedAction", "basicActions", "slotRecovery", "regainOnInitiative", "metamagic",
    "ritualAdept", "extraFirstTurn", "pact", "spellRecall"],
  mv: ["teleport", "afterTeleport", "jump", "leap", "movesAfter", "swapPlaces", "transpose", "etherealShift", "climbsOnTurn", "fleetStep",
    "noOpportunity", "tether", "sharesSpace", "quickStand", "critMove", "haltOnReaction"]
};
// End events announced by the text. `fixed`: a deadline that the duration of a dnd5e effect is enough to carry; `engine`: what,
// in the engine's content entry, carries this type of end.
const END_EVENTS = [
  { id: "resave", label: "sauvegarde répétée", engine: /"resave"|"repeatsSave"/,
    re: /\brepeats? the save|\bmakes? (another|a new) [^.]{0,30}saving throw at the (end|start) of each of its turns|at the (end|start) of each of its turns, (it|the target|the creature) (can )?(makes?|repeats?)/i },
  { id: "damage", label: "fin sur dégâts", engine: /"isDamaged"|"breaksOn":\[[^\]]*"damage"/,
    re: /\b(ends?|wakes? up)[^.]{0,40}\b(if|when) (it|the target|the creature|they) takes? (any )?damage|\bdamage ends (the|this)/i },
  { id: "acts", label: "fin si le porteur attaque ou lance un sort", engine: /"breaksOn"|"isDamaged"[^\]]*"type":"remove"/,
    re: /\bends (early )?(for (it|that target) )?(if|when) [^.]{0,50}\b(makes? an attack|attack roll|casts? a spell|deals damage)/i },
  { id: "action", label: "action pour mettre fin", engine: /"actionEnds"|"escape"/,
    re: /\b(can )?(take|use) an action to [^.]{0,60}(end|escape|free)|\bas an action, [^.]{0,40}(end|escape)/i },
  { id: "distance", label: "fin hors de portée", engine: /"tether"|"effectEnds"|"apart"/,
    re: /\bends (early )?if [^.]{0,60}(more than|farther than|beyond) \d+ feet/i },
  // 2026-10-29 (Kaalisti audit): a trigger that removes the effect (`"type":"remove"`: wounded Suggestion, Armor of Agathys with
  // no Temporary Hit Points), the tether of Hexblade's Curse (`tether`) and the copies of Mirror Image (`duplicates`) also carry
  // an early end.
  { id: "early", label: "fin anticipée (autre)", engine: /"effectEnds"|"breaksOn"|"zoneEnd"|"endsOwnConditions"|"concentrationBreaker"|"effectsExpire"|"endsWhen"|"type":"remove"|"tether"|"duplicates"/,
    re: /\b(spell|effect) ends (early )?(if|when|for)|\bends early\b/i },
  { id: "nextTurn", label: "fin du prochain tour", fixed: true, engine: /"effectEnds"|"atTurnStart"|"effectsExpire"/,
    re: /\buntil the (start|end) of (your|its|the \w+'s) next turn/i },
  { id: "thisTurn", label: "fin de ce tour", fixed: true, engine: /"effectEnds"|"atTurnStart"|"effectsExpire"/,
    re: /\buntil the (start|end) of (your|its) turn\b/i }
];
const END_STATUS = { das: "DAS", sys: "système", man: "manuel" };
/** Content keys that carry no game rule (data fix, GM alert, source). */
const NOT_A_RULE = new Set(["source", "dataFixes", "gmAlert"]);
// Passages that name what a field looks for without announcing it (§450, §451): removed from the text before that field's test.
// Surveyed on all premium modules: a general filter ("not", "no", "isn't" before the match) would remove real damage and real
// saving throws ("isn't cast into the fissure but takes 4d6 Psychic damage"); each field therefore has its own, precise phrasings.
const CANT = "(?:can['’]?t|cannot|can not|doesn['’]t|don['’]t|won['’]t|unable to|no longer)";
const negated = parts => new RegExp(parts.join("|"), "gi");
const NEGATED = {
  // Prohibition ("can't regain… or gain Temporary Hit Points"), absence ("no [Concentration or] Temporary Hit Points"),
  // waiting condition ("until it regains any Hit Points").
  he: negated([
    `\\b${CANT}\\s+(?:\\w+\\s+){0,2}?(?:regain|gain|receive)\\b[^.;]{0,40}?hit points(?:,? (?:or|and) (?:gain|receive) temporary hit points)?`,
    "\\bno (?:\\w+ or )?temporary hit points\\b",
    "\\buntil (?:it|they|the \\w+) regains? any hit points\\b"]),
  // "until you can't reach the creature to make a melee attack", "you can forgo making a ranged attack roll".
  at: negated([`\\b(?:${CANT}|forgo)\\s+(?:[\\w’']+\\s+){0,4}?(?:make|making) (?:a|an|one) (?:melee|ranged) (?:weapon |spell )?attack(?: roll)?`]),
  // A size limit is not an area: "no larger than a 10-foot Cube", "can't exceed 50 contiguous 10-foot Cubes".
  ar: negated(["\\b(?:no|not) (?:larger|bigger) than [^.;]{0,30}?\\d+-foot(?:-\\w+)?[- ]\\w+",
    `\\b${CANT}\\s+exceed\\s+\\d+\\s+contiguous\\s+\\d+-foot[- ]\\w+`]),
  // "creatures can't teleport", "no one can teleport", "can't enter or exit the area using teleportation".
  // §460: a spell named by its link ("@UUID[…]{Teleport}" in a Spellcasting list) is that spell's line, not a movement of
  // the ability.
  mv: negated([`\\b(?:${CANT}|no one can)\\s+(?:[\\w’']+\\s+){0,6}?teleport\\w*`, "@UUID\\[[^\\]]*\\]\\{[^}]*\\}"]),
  // "it can't be summoned again".
  su: negated([`\\b${CANT}\\s+be\\s+(?:summon|conjur)\\w*`])
};
// A delay before taking an action again ("can't take this action again until the start of its next turn", legendary actions) is not
// the end of an effect; "can't make Opportunity Attacks until the start of its next turn" is one, and stays.
const END_NEGATED = negated([`\\b${CANT}\\s+(?:take|use|do)\\s+(?:this action|this benefit|it|so|that)\\s+again\\s+until the (?:start|end) of (?:your|its|the \\w+['’]s) next turn`]);
const notSaid = (desc, f) => (NEGATED[f] ? desc.replace(NEGATED[f], " ") : desc);
const CAT_OF = new Map();
for ( const [cat, keys] of Object.entries(CATS) ) for ( const k of keys ) if ( !CAT_OF.has(k) ) CAT_OF.set(k, cat);

/* ---- surveys, sweeps, scenarios, commits ---- */
const reading = new Map();
if ( existsSync("prive/RELEVE_SORTS.md") ) {
  for ( const m of readFileSync("prive/RELEVE_SORTS.md", "utf8").matchAll(/^\| [^|]+ \| `([^`]+)` \| ([^|]+) \| ([^|]*) \|/gm) ) {
    reading.set(m[1], { status: m[2].trim(), missing: m[3].trim() });
  }
}
const READING_TO = { moteur: "das", dnd5e: "sys", partiel: "part", trou: "man", "hors-combat": "off", manuel: "gm" };
// Feat survey: its lines name the feats in French (sometimes grouped, the English in parentheses), with no identifier.
const fold = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const featReading = new Map();
if ( existsSync("prive/RELEVE_DONS.md") ) {
  for ( const m of readFileSync("prive/RELEVE_DONS.md", "utf8").matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]*) \|$/gm) ) {
    const state = m[2].trim();
    if ( /^(État|---)/.test(state) ) continue;
    const g = /^FAUX/.test(state) ? "bad" : /^(Plus tard|À FAIRE)/i.test(state) ? "man"
      : /^(FAIT|MOTEUR|Attaque réactive|Observateur FAIT)/.test(state) ? (/: non|à faire|pas d'/.test(state) ? "part" : "das")
      : /^OK/.test(state) ? "sys" : null;
    if ( !g ) continue;
    for ( const part of m[1].split(/,|\/| et /) ) {
      for ( const name of [part.replace(/\(.*?\)/g, ""), ...(part.match(/\(([^)]+)\)/g) ?? []).map(s => s.slice(1, -1))] ) {
        if ( fold(name) ) featReading.set(fold(name), { status: state, missing: m[3].trim(), g });
      }
    }
  }
}
// Identifiers that the engine code names outside the content tables (Two-Weapon Fighting, Weapon Master…): a DAS rule too.
const codeRefs = new Set();
for ( const f of readdirSync("module/scripts", { recursive: true }).map(String).filter(f => f.endsWith(".mjs") && !/^content[\\/]/.test(f)) ) {
  for ( const m of readFileSync(join("module/scripts", f), "utf8").matchAll(/["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)["'`]/g) ) codeRefs.add(m[1]);
}
const ADVANCEMENT = { AbilityScoreImprovement: "caractéristiques", Trait: "maîtrises", ItemGrant: "objets ou sorts accordés",
  ItemChoice: "choix d'objets ou de sorts", ScaleValue: "valeur d'échelle", HitPoints: "points de vie", Size: "taille", Subclass: "sous-classe",
  ModifyItem: "enchantement d'un autre objet" };
const sweeps = new Map();
if ( existsSync("prive/balayages") ) {
  for ( const f of readdirSync("prive/balayages").filter(f => f.endsWith(".json")).sort() ) {
    for ( const row of JSON.parse(readFileSync(join("prive/balayages", f), "utf8")) ) {
      const issues = row.runs.flatMap(r => r.issues);
      sweeps.set(row.identifier, { at: f.replace(/^\w+-|\.json$/g, ""), ok: !issues.length && !!row.runs.length,
        note: issues.length ? issues.join(" ; ").slice(0, 300) : (row.runs.length ? "" : "non joué") });
    }
  }
}
// Term-by-term review (2026-10-31, `prive/repasse/verdicts.json`): verdict per item (uuid), discrepancies, paraphrased terms.
const review = new Map();
if ( existsSync("prive/repasse/verdicts.json") ) {
  for ( const v of JSON.parse(readFileSync("prive/repasse/verdicts.json", "utf8")).items ?? [] ) {
    review.set(v.uuid, v);
    for ( const u of v.uuids ?? [] ) if ( !review.has(u) ) review.set(u, v);   // a creature ability read once applies to its copies
  }
}
const REVIEW_LABEL = { conforme: "conforme", "corrigé": "corrigé", partiel: "partiel", faux: "faux", mj: "MJ", "hors-combat": "hors combat", progression: "progression" };
const scenarioFiles = readdirSync("tools/scenarios", { recursive: true }).filter(f => f.endsWith(".mjs"));
const scenarioText = scenarioFiles.map(f => [f.replace(/\.mjs$/, "").replace(/\\/g, "/"), readFileSync(join("tools/scenarios", f), "utf8")]);
// Index built once (2026-11-15): searching `"ident"` in each scenario for each line took 4 s out of 11. An identifier
// has no quotation mark: `"ident"` appears in a text exactly when ident is the text between two consecutive quotation marks.
const scenarioIndex = new Map();
for ( const [name, t] of scenarioText ) {
  let prev = t.indexOf("\"");
  for ( let next = t.indexOf("\"", prev + 1); next !== -1; prev = next, next = t.indexOf("\"", prev + 1) ) {
    const between = t.slice(prev + 1, next);
    if ( !scenarioIndex.has(between) ) scenarioIndex.set(between, []);
    const list = scenarioIndex.get(between);
    if ( list.at(-1) !== name ) list.push(name);
  }
}
const scenariosOf = ident => scenarioIndex.get(ident) ?? [];
const log = execFileSync("git", ["log", "-p", "--no-color", "--format=@@@%h %ad %s", "--date=short", "--", "module/scripts/content"],
  { encoding: "utf8", maxBuffer: 1 << 30 });
const commitsOf = new Map();
let commit = null;
for ( const line of log.split("\n") ) {
  if ( line.startsWith("@@@") ) { commit = line.slice(3); continue; }
  if ( !commit ) continue;
  // A top-level entry of a content table (two spaces of indentation), bare or quoted.
  for ( const m of line.matchAll(/^[+-] {2}["']?([a-z][a-z0-9-]*)["']?\s*:/g) ) {
    if ( !commitsOf.has(m[1]) ) commitsOf.set(m[1], []);
    const list = commitsOf.get(m[1]);
    if ( !list.includes(commit) ) list.push(commit);
  }
}

/* ---- lecture des modules ---- */
const CONDITIONS = { Blinded: "blinded", Charmed: "charmed", Deafened: "deafened", Frightened: "frightened", Grappled: "grappled",
  Incapacitated: "incapacitated", Invisible: "invisible", Paralyzed: "paralyzed", Petrified: "petrified", Poisoned: "poisoned",
  Prone: "prone", Restrained: "restrained", Stunned: "stunned", Unconscious: "unconscious", Exhaustion: "exhaustion" };
const ITEM_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
const rows = [];
const versions = {};

function babele(mod, pack) {
  if ( !mod.fr ) return {};
  const f = join(mod.fr, `${mod.id}.${pack}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).entries ?? {} : {};
}

function tabOf(item) {
  if ( item.type === "spell" ) return "sorts";
  if ( ITEM_TYPES.has(item.type) ) return "objets";
  if ( item.type !== "feat" ) return null;
  const t = item.system?.type?.value ?? "";
  if ( t === "feat" ) return "dons";
  if ( t === "monster" ) return null;
  return "aptitudes";
}

for ( const mod of MODULES ) {
  const manifest = join(data, "modules", mod.id, "module.json");
  if ( !existsSync(manifest) ) continue;
  const version = JSON.parse(readFileSync(manifest, "utf8")).version;
  versions[mod.id] = { label: mod.label, version };
  for ( const pack of mod.packs ) {
    const dir = join(data, "modules", mod.id, "packs", pack);
    const fr = babele(mod, pack);
    const items = [];
    const actors = new Map();
    const effects = new Map();
    await read(dir, (key, v) => {
      if ( key.startsWith("!items.effects!") || key.startsWith("!actors.items.effects!") ) {
        // "item" or "actor.item": the Monster Manual creatures share their item ids.
        const owner = key.split("!")[2].split(".").slice(0, -1).join(".");
        if ( !effects.has(owner) ) effects.set(owner, []);
        effects.get(owner).push(v);
      }
      else if ( key.startsWith("!items!") ) items.push({ item: v });
      else if ( key.startsWith("!actors.items!") ) items.push({ item: v, actorId: key.split("!")[2].split(".")[0] });
      else if ( key.startsWith("!actors!") ) actors.set(v._id, v);
    });
    for ( const { item, actorId } of items ) {
      let tab;
      let owner = null;
      if ( actorId ) {
        const actor = actors.get(actorId);
        if ( !actor || (actor.type !== "npc") ) continue;
        if ( !["weapon", "feat"].includes(item.type) && !Object.keys(item.system?.activities ?? {}).length ) continue;
        if ( item.type === "spell" ) continue;
        tab = "creatures";
        const afr = fr[actor.name] ?? fr[actor._id];
        owner = { en: actor.name, fr: afr?.name ?? null, cr: actor.system?.details?.cr ?? null, type: actor.system?.details?.type?.value ?? "",
          tr: afr?.items?.[item._id] ?? afr?.items?.[item.name] ?? null };
      }
      else tab = tabOf(item);
      if ( !tab ) continue;
      const frEntry = owner ? owner.tr : (fr[item.name] ?? fr[item._id]);
      rows.push(describe({ item, tab, mod, version, pack, owner, actorId, frEntry,
        effects: effects.get(actorId ? `${actorId}.${item._id}` : item._id) ?? [] }));
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

/* ---- une ligne ---- */
function dice(p) {
  if ( !p ) return "";
  if ( p.custom?.enabled ) return p.custom.formula || "∅";
  const d = p.number && p.denomination ? `${p.number}d${p.denomination}` : "";
  const b = p.bonus ? (d ? `+${p.bonus}` : p.bonus) : "";
  return `${d}${b}` || "∅";
}
function range(r) {
  if ( !r ) return "";
  if ( ["self", "touch", "spec", "any"].includes(r.units) ) return units[r.units];
  return r.value ? `${r.value}${r.long ? `/${r.long}` : ""} ${units[r.units] ?? r.units ?? ""}`.trim() : (r.reach ? `allonge ${r.reach}` : "");
}
function duration(d) {
  if ( !d?.units ) return "";
  if ( d.units === "inst" ) return "instantanée";
  if ( d.units === "perm" ) return "permanente";
  return `${d.value ?? ""} ${d.units}`.trim();
}
function activation(a) {
  if ( !a?.type ) return "";
  return `${a.value && (a.value !== 1) ? `${a.value} ` : ""}${a.type}${a.condition ? ` (${a.condition})` : ""}`;
}

/**
 * The identifier under which the engine recognizes the item, like `identifierOf` (adapter/content.mjs): first its compendium
 * source (content/sources.mjs — "actor.item", then the id alone), then `system.identifier`, then the kebab-case name, which dnd5e
 * writes at the creation of an item without an identifier. Before (§441) the atlas only read `system.identifier`: the Ravenloft
 * features with no identifier (Form of Dread, Vampiric Bite…) appeared there as "dnd5e only" although the engine automates them.
 */
function kebab(name) {
  return String(name ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/[\s-]+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function identOf(item, actorId) {
  return (actorId ? SOURCES[`${actorId}.${item._id}`] : null) ?? SOURCES[item._id] ?? (item.system?.identifier || kebab(item.name));
}

/**
 * §455: the data as the Core renders it, `dataFixes` applied (core/data-fixes.mjs `withDataFixes`, as at the creation of the item
 * and by the diagnostic). The history fingerprint (`h`) remains that of the raw premium data.
 */
function fixedForAtlas(item, effects, fixes) {
  const { data, fields } = withDataFixes({ ...item, effects }, fixes);
  if ( !fields.length ) return { item, effects, fixed: [] };
  const { effects: fixedEffects, ...fixedItem } = data;
  return { item: fixedItem, effects: fixedEffects, fixed: fields };
}

function describe({ item: rawItem, tab, mod, version, pack, owner, actorId, frEntry, effects: rawEffects }) {
  const ident = identOf(rawItem, actorId);
  const shipped = CONTENT[ident];
  const { item, effects, fixed } = fixedForAtlas(rawItem, rawEffects, shipped?.dataFixes);
  // §460: on a creature ability, the engine also plays the "text" layer (K1–K12, core/monster-layer.mjs) — ends, pushes,
  // drains, absorptions read from the English text —, under the shipped content (adapter/content.mjs, `contentOf`). The atlas
  // did not read it: what it carries appeared as "carried by nobody".
  const html = owner ? String(item.system?.description?.value ?? "") : "";
  const textEntry = owner ? monsterTextLayer({ html, identifier: ident, swallow: !!shipped?.swallow,
    effects: effects.map(e => ({ id: e._id, statuses: e.statuses ?? [], changes: e.changes ?? e.system?.changes ?? [] })),
    activities: Object.entries(item.system?.activities ?? {}).map(([id, a]) => ({ id: a._id ?? id, name: a.name ?? "", type: a.type,
      activation: { type: a.activation?.type, condition: a.activation?.condition ?? "" }, effects: (a.effects ?? []).map(e => e._id ?? e.id),
      onSave: a.damage?.onSave ?? null, range: { value: a.range?.value ?? null, units: a.range?.units ?? "", special: a.range?.special ?? "" },
      template: a.target?.template?.type ? { type: a.target.template.type, size: a.target.template.size ?? "", units: a.target.template.units ?? "",
        count: a.target.template.count ?? "" } : false, target: { type: a.target?.affects?.type ?? "", count: a.target?.affects?.count ?? "",
        special: a.target?.affects?.special ?? "" } })) }) : null;
  const entry = textEntry ? mergeEntries([textEntry, shipped ?? null]) : shipped;
  const textKeys = textEntry ? Object.keys(textEntry).filter(k => !shipped || !(k in shipped)) : [];
  const s = item.system ?? {};
  const rawS = rawItem.system ?? {};
  const acts = Object.values(s.activities ?? {});
  const engine = entry ? Object.keys(entry).filter(k => k !== "source") : [];
  const inCode = !entry && codeRefs.has(ident);
  // Does the Core carry a rule for this item (a content entry other than a data fix, or engine code)?
  const coversRule = inCode || engine.some(k => !NOT_A_RULE.has(k));
  const desc = text(s.description?.value);
  const effectIds = new Set(effects.map(e => e._id));
  const first = acts[0] ?? {};

  // Valeurs.
  const attacks = acts.filter(a => a.type === "attack").map(a => {
    const t = a.attack?.type ?? {};
    const bonus = a.attack?.bonus ? ` +${a.attack.bonus}` : "";
    return `${t.value ?? ""} ${t.classification ?? ""}${bonus}`.trim() || "attaque";
  });
  const damages = [];
  let emptyDamage = false;
  for ( const a of acts ) {
    const parts = a.damage?.parts ?? [];
    for ( const p of parts ) {
      const f = dice(p);
      if ( f === "∅" ) emptyDamage = true;
      damages.push(`${f} ${(p.types ?? []).join("/")}`.trim());
    }
    if ( a.type === "attack" && a.damage?.includeBase && (item.type === "weapon") && s.damage?.base ) {
      damages.unshift(`${dice(s.damage.base)} ${(s.damage.base.types ?? []).join("/")}`.trim());
    }
  }
  if ( !acts.length && s.damage?.base?.denomination ) damages.push(`${dice(s.damage.base)} ${(s.damage.base.types ?? []).join("/")}`.trim());
  const heals = acts.filter(a => a.healing && (a.healing.number || a.healing.bonus || a.healing.custom?.formula))
    .map(a => `${dice(a.healing)} ${(a.healing.types ?? []).join("/")}`.trim());
  const saves = acts.filter(a => a.type === "save" && a.save).map(a => {
    const ab = [a.save.ability].flat().filter(Boolean).join("/");
    const dc = a.save.dc?.formula || (a.save.dc?.calculation ? a.save.dc.calculation : "");
    return `${ab}${dc ? ` DD ${dc}` : ""}${a.damage?.onSave ? ` · ${a.damage.onSave}` : ""}`;
  });
  const tmpl = acts.map(a => a.target?.template).concat([s.target?.template]).find(t => t?.type);
  const area = tmpl ? `${tmpl.type} ${tmpl.size ?? ""}${tmpl.units ? ` ${tmpl.units}` : ""}${tmpl.count > 1 ? ` ×${tmpl.count}` : ""}`.trim() : "";
  const aff = acts.map(a => a.target?.affects).concat([s.target?.affects]).find(t => t?.type || t?.count);
  const targets = aff ? `${aff.count ?? ""} ${aff.type ?? ""}${aff.special ? ` (${aff.special})` : ""}`.trim() : "";
  const dur = duration(s.duration) || duration(acts.find(a => a.duration?.override)?.duration);
  const conc = (s.properties ?? []).includes("concentration") || acts.some(a => a.duration?.concentration);
  const ritual = (s.properties ?? []).includes("ritual");
  const summons = acts.filter(a => ["summon", "transform"].includes(a.type))
    .map(a => `${a.type === "summon" ? "invocation" : "métamorphose"} (${(a.profiles ?? []).length} profil${(a.profiles ?? []).length > 1 ? "s" : ""})`);
  const uses = [];
  if ( s.uses?.max ) uses.push(`${s.uses.max}${(s.uses.recovery ?? []).length ? ` / ${(s.uses.recovery ?? []).map(r => r.period === "recharge" ? `recharge ${r.formula}` : r.period).join(", ")}` : ""}`);
  for ( const a of acts ) if ( a.uses?.max ) uses.push(`${a.name || a.type} : ${a.uses.max}${(a.uses.recovery ?? []).map(r => r.period === "recharge" ? ` (recharge ${r.formula})` : ` / ${r.period}`).join("")}`);
  const statuses = [...new Set(effects.flatMap(e => e.statuses ?? []))];
  const effectNames = effects.map(e => `${e.name}${e.transfer ? " (passif)" : ""}${(e.changes ?? e.system?.changes ?? []).length ? ` [${(e.changes ?? e.system?.changes).length} chgt]` : ""}`);
  const others = [...new Set(acts.map(a => a.type).filter(t => !["attack", "save", "damage", "heal", "summon", "transform"].includes(t)))];

  // Data defects.
  const bad = [];
  if ( emptyDamage ) bad.push("part de dégâts vide");
  const posed = new Set(acts.flatMap(a => (a.effects ?? []).map(e => e._id)));
  // §452: the "ModifyItem" progression of dnd5e 6.1 (Handbook 3.0.0) sets an enchantment of the item on another item of the
  // character (Enhanced Strikes → unarmed strike, Poisoned Weapons → Cunning Strike…): this effect is set, with no activity.
  for ( const adv of Object.values(s.advancement ?? {}) ) {
    if ( adv.type === "ModifyItem" ) for ( const c of adv.configuration?.changes ?? [] ) if ( c._id ) posed.add(c._id);
  }
  // §438: a "remote effect" of dnd5e 6.1 (`uuid` to an effects compendium, Handbook 3.0.0) is not on the item: not a defect.
  for ( const a of acts ) for ( const e of a.effects ?? [] ) if ( !e.uuid && !effectIds.has(e._id) ) bad.push(`effet lié absent (${a.name || a.type})`);
  const entryText = entry ? JSON.stringify(entry) : "";
  // §455: a data effect that nothing sets, on an item whose rule the Core carries through its own mechanism (Reckless Attack,
  // Aura of Devotion, Eldritch Frailty), is not a defect: a note. §457: likewise an effect that the engine entrusts to the GM
  // through an alert (`gmAlert`: the +2 of a book after 48 hours of reading).
  const notes = [];
  for ( const e of effects ) {
    if ( e.transfer || posed.has(e._id) || entryText.includes(e._id) || entryText.includes(JSON.stringify(e.name)) ) continue;
    if ( (e.type === "enchantment") && acts.some(a => a.type === "enchant") ) continue;
    if ( coversRule ) notes.push(`effet de la donnée inutilisé, règle portée par le moteur : ${e.name}`);
    else if ( entry?.gmAlert ) notes.push(`effet laissé au MJ (alerte du moteur) : ${e.name}`);
    else bad.push(`effet jamais posé : ${e.name}`);
  }
  if ( fixed.length ) notes.push(`donnée corrigée par le moteur (dataFixes) : ${fixed.length} champ${fixed.length > 1 ? "s" : ""}`);

  // What the text announces, each field tested on the text stripped of its negated passages (`NEGATED`). Healing (§450): a
  // prohibition ("can't regain Hit Points or gain Temporary Hit Points") or a condition ("until it regains any Hit Points")
  // announces no healing — 49 creature abilities out of 82 counted that way (the swarm ×15, the Spellcasting note on Shapechange
  // ×12, poisons and curses); "regains 1 Hit Point" (singular) counts. The other fields (§451): see `NEGATED`.
  const says = {
    at: /\b(melee|ranged) (weapon |spell )?attack roll|\bmake (a|an|one) (melee|ranged) (spell )?attack|\bspell attack\b/i.test(notSaid(desc, "at")),
    dm: /\b\d+d\d+\b[^.]{0,60}\bdamage\b|\bdamage equal to\b/i.test(desc),
    he: /\bregains? [^.]{0,40}hit points?\b(?! maximum)|\bTemporary Hit Points\b/i.test(notSaid(desc, "he")),
    sv: /\b(make|makes|succeed on|must succeed on) (a|an) \w+ saving throw|\b\w+ Saving Throw:/i.test(desc),
    ar: /\b\d+-foot(-radius|-long|-wide)?[- ](Emanation|Sphere|Cone|Cube|Line|Cylinder|radius)/i.test(notSaid(desc, "ar")),
    mv: /\bteleport|\bpush(ed|es)? [^.]{0,30}\b\d+ feet|\bpull(ed|s)? [^.]{0,30}\b\d+ feet/i.test(notSaid(desc, "mv")),
    su: /\bsummon|\bconjure|\bcreate[sd]? [^.]{0,30}\b(creature|spirit|servant)/i.test(notSaid(desc, "su"))
  };
  const announced = [];
  for ( const [name, id] of Object.entries(CONDITIONS) ) {
    const re = new RegExp(`(have|has|gains?|give[sn]?|is|are|be|becomes?|knocked|falls?)\\s+(the\\s+)?${name}\\s+condition|${name} condition (until|for)`, "i");
    const m = desc.match(re);
    if ( !m ) continue;
    if ( /(unless|if|while|isn['’]t|aren['’]t|don['’]t|doesn['’]t|lack|not|without|immun\w*)[^.]{0,40}$/i.test(desc.slice(Math.max(0, m.index - 50), m.index)) ) continue;
    if ( statuses.includes(id) || entryText.includes(`"${id}"`) ) continue;
    announced.push(name);
  }

  // End: the duration of the effects in the data (V14: { value, units, expiry }), and each end event announced by the text,
  // carried by the engine, by the duration of an effect (fixed end), or by nothing.
  const span = d => {
    if ( !d?.value || !d.units ) return "";
    if ( d.units !== "seconds" ) return `${d.value} ${{ rounds: "round", turns: "tour" }[d.units] ?? d.units}${d.value > 1 ? "s" : ""}`;
    const v = d.value;
    return v % 86400 === 0 ? `${v / 86400} j` : v % 3600 === 0 ? `${v / 3600} h` : v % 60 === 0 ? `${v / 60} min` : `${v} s`;
  };
  const effectEnd = [...new Set(effects.filter(e => !e.transfer).map(e => span(e.duration)).filter(Boolean))];
  const turnBound = effects.some(e => !e.transfer && ["rounds", "turns"].includes(e.duration?.units));
  const endText = desc.replace(END_NEGATED, " ");
  const ends = END_EVENTS.filter(e => e.re.test(endText)).map(e => ({ id: e.id, label: e.label,
    s: e.engine.test(entryText) ? "das" : (e.fixed && turnBound) ? "sys" : "man" }));
  // An early end already counted under a specific type is not counted twice.
  const endList = ends.filter(e => (e.id !== "early") || !ends.some(o => ["damage", "acts", "distance"].includes(o.id)));

  // Statuts par champ.
  const das = cat => engine.some(k => CAT_OF.get(k) === cat);
  const S = {};
  const field = (key, sys, man, isBad=false) => { S[key] = isBad ? "bad" : das(key) ? "das" : sys ? "sys" : man ? "man" : ""; };
  field("at", attacks.length, says.at);
  field("dm", damages.length, says.dm && !damages.length, emptyDamage);
  // §460: a drain that the text says gives back to the drainer ("regains Hit Points equal to that amount", runtime/drain.mjs)
  // is a carried heal. `lifesteal` (runtime/lifesteal.mjs) also gives HP back to the author.
  const healsBack = !!entry?.lifesteal || (!!entry?.drain && readDrain(owner ? html : (s.description?.value ?? "")).regains);
  S.he = healsBack ? "das" : null;
  if ( !healsBack ) field("he", heals.length, says.he);
  field("sv", saves.length, says.sv);
  field("ar", area, says.ar);
  field("tg", targets, false);
  field("du", dur && (dur !== "instantanée"), false);
  field("ef", effects.length, announced.length, bad.some(b => b.startsWith("effet")));
  field("su", summons.length, says.su && !summons.length && (tab !== "creatures"));
  field("us", uses.length, false);
  // §460: a declared push or pull (`move` step of a trigger, content or K8 text) is a carried movement.
  field("mv", false, says.mv);
  if ( (S.mv === "man") && /"type":"move"/.test(entryText) ) S.mv = "das";
  // End: the worst of the announced events; with no event, the duration of an effect is enough (system).
  S.fi = endList.some(e => e.s === "man") ? "man" : endList.some(e => e.s === "sys") ? "sys" : endList.length ? "das"
    : effectEnd.length ? "sys" : "";
  const script = engine.filter(k => !CAT_OF.has(k));
  S.sp = (script.length || inCode) ? "das" : "";
  // dnd5e progressions (abilities, proficiencies, granted spells): what the system applies by itself when the item is added.
  const advancements = [...new Set(Object.values(s.advancement ?? {}).map(a => ADVANCEMENT[a.type] ?? a.type))];
  S.pg = advancements.length ? "sys" : "";
  // A "man" field that the engine covers with a general rule (triggers, choice) remains to be checked: the survey settles it.
  const values = Object.values(S);

  // Statut global.
  const rd = (tab === "sorts") ? reading.get(ident)
    : (tab === "dons") ? (featReading.get(fold(frEntry?.name)) ?? featReading.get(fold(item.name)) ?? null) : null;
  const rdKey = rd ? (rd.g ?? READING_TO[rd.status.replace(/\s*\(.*$/, "")] ?? null) : null;
  let g;
  if ( rdKey ) g = rdKey;
  else if ( values.includes("bad") ) g = "bad";
  else if ( values.includes("man") ) g = (values.includes("das") || values.includes("sys")) ? "part" : "man";
  else if ( engine.length || inCode ) g = "das";
  else if ( values.includes("sys") ) g = "sys";
  else g = "text";

  const frName = frEntry?.name ?? null;
  const frDesc = frEntry?.description ? text(frEntry.description) : "";
  const uid = actorId ? `${mod.id}/${pack}/${actorId}/${item._id}` : `${mod.id}/${pack}/${item._id}`;
  const sweep = sweeps.get(ident);
  const scen = ident ? scenariosOf(ident) : [];
  const commits = commitsOf.get(ident) ?? [];
  const dataHash = hash({ s: { activities: rawS.activities, damage: rawS.damage, duration: rawS.duration, target: rawS.target, range: rawS.range, uses: rawS.uses,
    properties: rawS.properties, level: rawS.level }, e: rawEffects.map(e => ({ c: e.changes ?? e.system?.changes, st: e.statuses, t: e.transfer })) });

  return {
    k: uid, t: tab, n: item.name, f: frName, i: ident,
    m: mod.label, mv: version, p: pack, u: actorId ? `Compendium.${mod.id}.${pack}.Actor.${actorId}.Item.${item._id}` : `Compendium.${mod.id}.${pack}.Item.${item._id}`,
    o: owner ? (owner.fr ?? owner.en) : null, oe: owner?.en ?? null, ocr: owner?.cr ?? null, oty: owner?.type ?? null,
    ty: `${item.type}${s.type?.value ? ` · ${s.type.value}${s.type.subtype ? `/${s.type.subtype}` : ""}` : ""}`,
    lv: item.type === "spell" ? s.level : (s.requirements || (s.prerequisites?.level ? `niv. ${s.prerequisites.level}` : "")),
    sc: item.type === "spell" ? (s.school ?? "") : (s.rarity || ""),
    ac: activation(s.activation) || activation(first.activation),
    rg: range(s.range) || range(acts.find(a => a.range?.units)?.range),
    tg: targets, ar: area, du: dur, co: conc, ri: ritual,
    at: attacks.join(" · "), dm: damages.join(" · "), he: heals.join(" · "), sv: saves.join(" · "),
    ef: effectNames.join(" · "), st: statuses, an: announced, su: summons.join(" · "), us: uses.join(" · "),
    ot: others.join(", "), mvt: says.mv ? "annoncé" : "",
    pg: advancements.join(" · "),
    fi: [...effectEnd.map(x => `effet ${x}`), ...endList.map(e => `${e.label} (${END_STATUS[e.s]})`)].join(" · "), fe: endList.map(e => `${e.id}:${e.s}`),
    eng: inCode ? ["code du moteur"] : engine.map(k => textKeys.includes(k) ? `${k} (texte)` : k), ej: entry ? JSON.stringify(entry).slice(0, 1200) : "",
    S, g, bad, nb: notes,
    rd: rd ? rd.status : "", rdm: rd?.missing ?? "",
    sw: sweep ? `${sweep.ok ? "✓" : "✗"} ${sweep.at}${sweep.note ? ` — ${sweep.note}` : ""}` : "",
    sn: scen.length, sl: scen.slice(0, 8).join(", "),
    ...reviewFields(review.get(actorId ? `Compendium.${mod.id}.${pack}.Actor.${actorId}.Item.${item._id}` : `Compendium.${mod.id}.${pack}.Item.${item._id}`)),
    cm: commits[0] ?? "", cn: commits.length,
    h: dataHash, eh: shipped ? hash(JSON.stringify(shipped)) : "",
    d: (frDesc || desc).slice(0, 2500), dl: frDesc ? "fr" : "en"
  };
}

// Review: `rp` verdict, `rpg` highest severity, `rpm` discrepancies (one line each), `rpt` terms with impact (compact JSON),
// `rpl` batch.
function reviewFields(v) {
  if ( !v ) return { rp: "", rpg: "", rpm: "", rpt: "", rpl: "" };
  const order = ["haute", "moyenne", "basse"];
  const worst = order.find(g => (v.ecarts ?? []).some(e => e.gravite === g)) ?? "";
  return { rp: REVIEW_LABEL[v.verdict] ?? v.verdict, rpg: worst, rpl: `${v.lot ?? ""}${v.verdictInitial ? ` · était ${v.verdictInitial}` : ""}`,
    rpm: (v.ecarts ?? []).map(e => `[${e.gravite}] ${e.quoi}${e.chantier ? ` (${e.chantier})` : ""}`).join("\n"),
    rpt: JSON.stringify((v.termes ?? []).filter(t => t.impact).map(t => [t.t, t.ok, t.moteur])) };
}

/* ---- historique (empreintes et statuts seulement) ---- */
const histPath = "prive/atlas/historique.json";
mkdirSync("prive/atlas", { recursive: true });
const hist = existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf8")) : { runs: [], items: {} };
const previous = hist.runs.at(-1)?.date ?? null;
hist.runs.push({ date: TODAY, engine: ENGINE_VERSION, modules: versions, rows: rows.length });
for ( const r of rows ) {
  const list = hist.items[r.k] ??= [];
  const last = list.at(-1);
  const now = { d: TODAY, v: ENGINE_VERSION, mv: r.mv, h: r.h, eh: r.eh, g: r.g };
  if ( !last ) { list.push(now); r.ch = previous ? "nouveau" : ""; }
  else if ( (last.h !== r.h) || (last.eh !== r.eh) || (last.g !== r.g) ) {
    r.ch = [last.h !== r.h ? "données" : "", last.eh !== r.eh ? "moteur" : "", last.g !== r.g ? `statut ${last.g}→${r.g}` : ""].filter(Boolean).join(", ");
    if ( last.d === TODAY ) list[list.length - 1] = now;
    else list.push(now);
  }
  else r.ch = "";
  r.rev = list.length;
  r.hi = list.map(x => `${x.d} · DAS ${x.v} · ${x.mv} · ${x.g}${x.eh ? ` · règle ${x.eh}` : ""}`).join("\n");
}
writeFileSync(histPath, JSON.stringify(hist));

/* ---- sorties ---- */
const TABS = ["sorts", "dons", "aptitudes", "objets", "creatures"];
const summary = [];
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab).sort((a, b) => (a.o ?? "").localeCompare(b.o ?? "") || (a.f ?? a.n).localeCompare(b.f ?? b.n));
  writeFileSync(join(out, `atlas-${tab}.json`), JSON.stringify(list));
  const byG = {};
  for ( const r of list ) byG[r.g] = (byG[r.g] ?? 0) + 1;
  const byField = {};
  for ( const r of list ) for ( const [f, st] of Object.entries(r.S) ) if ( st ) { byField[f] ??= {}; byField[f][st] = (byField[f][st] ?? 0) + 1; }
  for ( const [g, n] of Object.entries(byG) ) summary.push({ tab, kind: "statut", key: g, n });
  for ( const [f, c] of Object.entries(byField) ) for ( const [st, n] of Object.entries(c) ) summary.push({ tab, kind: "champ", key: `${f}:${st}`, n });
  const byEnd = {};
  for ( const r of list ) for ( const e of r.fe ) byEnd[e] = (byEnd[e] ?? 0) + 1;
  for ( const [key, n] of Object.entries(byEnd) ) summary.push({ tab, kind: "fin", key, n });
  const byReview = {};
  for ( const r of list ) if ( r.rp ) byReview[r.rp] = (byReview[r.rp] ?? 0) + 1;
  for ( const [key, n] of Object.entries(byReview) ) summary.push({ tab, kind: "repasse", key, n });
}
/* ---- building blocks (§367): the content keys, moments and steps of the engine, from its code ---- */
// Description: the schema comment of core/content.mjs (keys, `{ type }` steps), the text of MOMENTS (core/triggers.mjs).
function schemaDocs() {
  const lines = readFileSync("module/scripts/core/content.mjs", "utf8").split(/\r?\n/);
  const keys = new Map(), steps = new Map();
  let cur = null;
  const split = rest => { const m = rest.match(/^(.*?\S)\s{2,}(\S.*)$/); return m ? { sig: m[1], d: [m[2]] } : { sig: rest.trim(), d: [] }; };
  for ( const line of lines ) {
    let m = line.match(/^ \*     ([a-zA-Z]+)\?: (.*)$/);
    if ( m ) { const v = split(`${m[1]}?: ${m[2]}`); cur = v; if ( !keys.has(m[1]) ) keys.set(m[1], v); continue; }
    m = line.match(/^ \*   \{ type: "(\w+)"(.*)$/);
    if ( m ) { const v = split(`{ type: "${m[1]}"${m[2]}`); cur = v; if ( !steps.has(m[1]) ) steps.set(m[1], v); continue; }
    m = line.match(/^ \*\s{20,}(\S.*)$/);
    if ( m && cur ) { cur.d.push(m[1]); continue; }
    cur = null;
  }
  return { keys, steps };
}
const docs = schemaDocs();
const tabOfIdent = new Map();
for ( const r of rows ) if ( r.i && !tabOfIdent.has(r.i) ) tabOfIdent.set(r.i, new Set());
for ( const r of rows ) if ( r.i ) tabOfIdent.get(r.i).add(r.t);
const stepsIn = entry => (entry.triggers ?? []).flatMap(t => [...(t.do ?? []), ...(t.else ?? [])]);
const momentsIn = entry => (entry.triggers ?? []).flatMap(t => [t.on].flat());
const brickRow = (kind, key, doc, users) => {
  const text = doc ? doc.d.join(" ").replace(/\s+/g, " ") : "";
  const sec = (`${doc?.sig ?? ""} ${text}`.match(/§\s?\d+|[CKO]\d+[a-z]?/) ?? [""])[0].replace(/\s/g, "");
  const per = Object.fromEntries(TABS.map(t => [t, users.filter(i => tabOfIdent.get(i)?.has(t)).length]));
  return { k: `${kind}:${key}`, b: key, kd: kind, sig: doc?.sig ?? "", d: text, s: sec, u: users.length,
    ex: users.slice(0, 12).join(", "), ...per, doc: doc ? 1 : 0 };
};
const idents = Object.keys(CONTENT);
const bricks = [
  ...ENTRY_KEYS.map(k => brickRow("clé", k, docs.keys.get(k), idents.filter(i => CONTENT[i] && (k in CONTENT[i])))),
  ...Object.entries(MOMENTS).map(([k, en]) => brickRow("moment", k, { sig: `on: "${k}"`, d: [en] }, idents.filter(i => momentsIn(CONTENT[i] ?? {}).includes(k)))),
  ...STEP_TYPES.map(k => brickRow("étape", k, docs.steps.get(k), idents.filter(i => stepsIn(CONTENT[i] ?? {}).some(st => st?.type === k))))
].sort((a, b) => b.u - a.u || a.b.localeCompare(b.b));
writeFileSync(join(out, "atlas-briques.json"), JSON.stringify(bricks));
for ( const kind of ["clé", "moment", "étape"] ) {
  const l = bricks.filter(b => b.kd === kind);
  summary.push({ tab: "briques", kind: "briques", key: kind, n: l.length });
  summary.push({ tab: "briques", kind: "briques", key: `${kind}:inutilisée`, n: l.filter(b => !b.u).length });
  summary.push({ tab: "briques", kind: "briques", key: `${kind}:sans doc`, n: l.filter(b => !b.doc).length });
}

// The local page only reads lines: the survey's metadata are lines too.
const meta = [["date", TODAY], ["engine", ENGINE_VERSION], ["previous", previous ?? ""], ["rows", String(rows.length)],
  ["modules", Object.values(versions).map(v => `${v.label} ${v.version}`).join(" · ")]];
for ( const [key, v] of meta ) summary.push({ tab: "*", kind: "meta", key, n: 0, v });
writeFileSync(join(out, "atlas-resume.json"), JSON.stringify(summary));

const label = { das: "DAS", sys: "système", part: "partiel", man: "manuel", gm: "MJ", off: "hors combat", text: "texte", bad: "défaut" };
const md = ["# Atlas de l'automatisation", "",
  `Généré le ${TODAY} par \`tools/atlas.mjs\` (moteur ${ENGINE_VERSION}). Comptes seulement ; le détail (texte premium) est hors dépôt, dans la`,
  "page locale « Atlas d'automatisation DAS » (`atlas.html` à côté des JSON). Statuts : relevé de lecture pour les sorts, sinon déduits des champs (`das` règle du",
  "moteur, `sys` données dnd5e résolues par le moteur, `man` annoncé par le texte et porté par personne, `bad` défaut de données).", "",
  `Modules : ${Object.values(versions).map(v => `${v.label} ${v.version}`).join(" · ")}.`, "",
  "| Onglet | Items | " + Object.values(label).join(" | ") + " |", "|---|---|" + Object.keys(label).map(() => "---|").join("")];
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab);
  md.push(`| ${tab} | ${list.length} | ${Object.keys(label).map(g => list.filter(r => r.g === g).length || "").join(" | ")} |`);
}
md.push("", "## Champs annoncés et portés par personne (`man`)", "");
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab);
  const counts = Object.fromEntries(Object.keys(CATS).map(c => [c, list.filter(r => r.S[c] === "man").length]));
  md.push(`- **${tab}** : ${Object.entries(counts).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(" · ") || "aucun"}`);
}
md.push("", "## Types de fin (événements annoncés par le texte)", "",
  "Par type : items où le moteur le porte (DAS), où la durée d'un effet dnd5e suffit (système), où rien ne le porte (manuel).", "",
  "| Type de fin | " + TABS.join(" | ") + " |", "|---|" + TABS.map(() => "---|").join(""));
for ( const e of END_EVENTS ) {
  md.push(`| ${e.label} | ${TABS.map(tab => { const l = rows.filter(r => r.t === tab);
    const n = st => l.filter(r => r.fe.includes(`${e.id}:${st}`)).length;
    return [n("das") && `${n("das")} DAS`, n("sys") && `${n("sys")} sys`, n("man") && `${n("man")} man`].filter(Boolean).join(" · ") || "";
  }).join(" | ")} |`);
}
md.push("", "## Repasse terme par terme (`prive/repasse/`)", "", "| Onglet | Relus | " + Object.values(REVIEW_LABEL).join(" | ") + " | écart haut |",
  "|---|---|" + Object.keys(REVIEW_LABEL).map(() => "---|").join("") + "---|");
for ( const tab of TABS ) {
  const list = rows.filter(r => (r.t === tab) && r.rp);
  if ( list.length ) md.push(`| ${tab} | ${list.length} | ${Object.values(REVIEW_LABEL).map(l => list.filter(r => r.rp === l).length || "").join(" | ")} | ${list.filter(r => r.rpg === "haute").length || ""} |`);
}
md.push("", "## Briques du moteur", "",
  "Les clés de contenu (`core/content/enums.mjs`), les moments de déclencheur (`core/triggers.mjs`) et les étapes (`do: [{ type }]`)",
  "qu'un item peut déclarer, par nombre d'entrées de contenu qui s'en servent. Détail (description, exemples, onglets) : onglet",
  "« Briques » de la page locale.", "");
for ( const kind of ["clé", "moment", "étape"] ) {
  const l = bricks.filter(b => b.kd === kind);
  md.push(`- **${kind}s** : ${l.length}, dont ${l.filter(b => !b.u).length} sans usage dans le contenu livré et ${l.filter(b => !b.doc).length} sans description dans le schéma`);
}
md.push("", "| Brique | Genre | § | Entrées | " + TABS.join(" | ") + " |", "|---|---|---|---|" + TABS.map(() => "---|").join(""));
for ( const b of bricks ) md.push(`| \`${b.b}\` | ${b.kd} | ${b.s} | ${b.u} | ${TABS.map(t => b[t] || "").join(" | ")} |`);
md.push("", "## Défauts de données", "");
for ( const r of rows.filter(r => r.bad.length).slice(0, 400) ) md.push(`- ${r.t} · ${r.o ? `${r.o} · ` : ""}${r.f ?? r.n} \`${r.i}\` (${r.m}) : ${r.bad.join(" ; ")}`);
writeFileSync("prive/ATLAS.md", md.join("\n"));
console.log(`${rows.length} lignes → ${out}`);
for ( const tab of TABS ) console.log(`  ${tab} : ${rows.filter(r => r.t === tab).length}`);

// Local atlas page (2026-11-14, replaces the online dashboard): its code is in the private notes, which build it
// next to the JSON (it embeds their text). Without `prive/`, only the JSON are written.
const PAGE = "prive/atlas/tableau-page.mjs";
if ( existsSync(PAGE) ) {
  const { writePage } = await import(new URL(`../${PAGE}`, import.meta.url));
  console.log(`page locale : ${writePage(out)}`);
}
