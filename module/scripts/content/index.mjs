/**
 * The content shipped with the module, in one table per dnd5e identifier (core/content.mjs for the
 * schema, SPEC §13.4 for the overlay). Updating this folder updates all the actors
 * of the world, PCs and NPCs, without writing anything on their sheets.
 *
 * Another module can add its own table (creatures of a campaign, options of a supplement): `registerTable(source,
 * table)`, called by the public API `api.content.register` or the hook `dnd5e-combat.registerContent` (runtime/content.mjs).
 * Each registered table is merged on top of the shipped content, entry by entry (`mergeEntries`), in the order of the
 * registrations. `SHIPPED` stays the shipped content alone; `CONTENT` is the content in force, which the whole engine reads.
 */

import { TRIGGERS } from "./triggers.mjs";
import { AURAS } from "./auras.mjs";
import { EMANATIONS, REGENERATIONS, FORTITUDES, MONSTER_BASIC_ACTIONS, NO_OPPORTUNITY, DRAINS, SWALLOWS, SPACE_SHARERS } from "./emanations.mjs";
import { CHOICES } from "./choices.mjs";
import { TARGETS, EFFECT_EXPIRIES, USAGE_LIMITS, ENCHANT_TARGETS, PACTS } from "./targets.mjs";
import { TRACES, TRACE_RULES } from "./traces.mjs";
import { TELEPORTS } from "./teleports.mjs";
import { MAGICAL, ANTIMAGIC_ZONES, ANTIMAGIC_ZONE_LASTS } from "./antimagic.mjs";
import { ABSORBS } from "./absorbs.mjs";
import { SUMMONS, PLACES_SUMMONS, TARGETED_SUMMONS } from "./summons.mjs";
import { MOVABLES } from "./movables.mjs";
import { LIGHTS, REVEALS_INVISIBLE } from "./lights.mjs";
import { TETHERS } from "./tethers.mjs";
import { BANISHES, ENDS_WHEN, WARDS_CONDITIONS } from "./endings.mjs";
import { DAMAGE_SHIELDS, HIT_DICE_HEALS } from "./defenses.mjs";
import { BREAKS_ON, NO_REACTIONS, ACTION_OR_BONUS, SINGLE_ATTACK, SPELL_FAILURES, NO_ATTACKS_OR_SPELLS, NO_SPELLS, KNOWN_TO_ORIGIN, CONTROL, CURES, FIGHTING_ADVANTAGE, SAVED_EFFECTS, SIZE_CHANGES, ORDER_LISTS, FLEE_ON_FAILED_SAVE } from "./spells.mjs";
import { RAVENLOFT } from "./ravenloft.mjs";
import { MONSTERS } from "./monsters.mjs";
import { ROGUE } from "./rogue.mjs";
import { FIGHTER } from "./fighter.mjs";
import { BARBARIAN } from "./barbarian.mjs";
import { CANTRIPS } from "./cantrips.mjs";
import { MONK } from "./monk.mjs";
import { PALADIN } from "./paladin.mjs";
import { RANGER } from "./ranger.mjs";
import { CLERIC } from "./cleric.mjs";
import { WIZARD } from "./wizard.mjs";
import { WARLOCK } from "./warlock.mjs";
import { DRUID } from "./druid.mjs";
import { SPECIES } from "./species.mjs";
import { FEATS } from "./feats.mjs";
import { SORCERER } from "./sorcerer.mjs";
import { BARD } from "./bard.mjs";
import { SPELL_RULES } from "./spell-rules.mjs";
import { GEAR } from "./gear.mjs";
import { ITEM_FIXES } from "./item-fixes.mjs";
import { GM_ALERTS } from "./gm-alerts.mjs";
import { mergeEntries } from "../core/content.mjs";
import { SOURCE_IDENTIFIERS } from "./sources.mjs";
import { BURSTS, RECASTS, TURN_STARTS, BOLTS, OBSCURES, HEAL_MAX, DUPLICATES, SAVE_ADVANTAGES, ON_FELL, BONUS_ATTACKS, REACTIVE_SPELLS, FREE_SOMATIC, PROJECTILES, LEAPS } from "./bursts.mjs";

/**
 * The "per building block" tables: a table (`identifiant → valeur`, or a list of identifiers: the value `true`) and the entry key
 * it fills, in the order in which they are written. Key `null`: the value is a piece of entry, copied as is (links).
 */
export const BRICKS = Object.freeze([
  [TRIGGERS, "triggers"], [AURAS, "aura"], [EMANATIONS, "emanation"], [REGENERATIONS, "regeneration"],
  [FORTITUDES, "fortitude"], [MONSTER_BASIC_ACTIONS, "basicActions"], [NO_OPPORTUNITY, "noOpportunity"], [DRAINS, "drain"],
  [SWALLOWS, "swallow"], [SPACE_SHARERS, "sharesSpace"], [PLACES_SUMMONS, "placesSummons"], [TARGETED_SUMMONS, "targetedSummon"], [CHOICES, "choice"],
  [TARGETS, "targets"], [EFFECT_EXPIRIES, "effectsExpire"], [USAGE_LIMITS, "usageLimits"],
  [ENCHANT_TARGETS, "enchantTarget"], [PACTS, "pact"], [TRACES, "trace"], [TRACE_RULES, "trace"], [TELEPORTS, "teleport"],
  [ABSORBS, "absorb"], [SUMMONS, "summon"], [MOVABLES, "movable"], [BURSTS, "burst"], [RECASTS, "recast"], [BOLTS, "bolt"],
  [OBSCURES, "obscures"], [LIGHTS, "light"], [REVEALS_INVISIBLE, "revealsInvisible"], [HEAL_MAX, "healMax"],
  [DUPLICATES, "duplicates"], [SAVE_ADVANTAGES, "saveAdvantage"], [ON_FELL, "onFell"], [REACTIVE_SPELLS, "reactiveSpell"], [FREE_SOMATIC, "freeSomatic"],
  [PROJECTILES, "projectiles"], [LEAPS, "leap"], [BONUS_ATTACKS, "bonusAttack"], [TURN_STARTS, "atTurnStart"],
  [TETHERS, null], [DAMAGE_SHIELDS, "damageShield"], [HIT_DICE_HEALS, "hitDiceHeal"], [BREAKS_ON, "breaksOn"],
  [NO_REACTIONS, "noReactions"], [ACTION_OR_BONUS, "actionOrBonus"], [SINGLE_ATTACK, "singleAttack"], [SPELL_FAILURES, "spellFailure"], [NO_ATTACKS_OR_SPELLS, "noAttacksOrSpells"], [NO_SPELLS, "noSpells"], [KNOWN_TO_ORIGIN, "knownToOrigin"], [CURES, "cures"],
  [FIGHTING_ADVANTAGE, "advantageIfFighting"], [SAVED_EFFECTS, "savedEffects"], [SIZE_CHANGES, "resize"],
  [ORDER_LISTS, "orders"], [ENDS_WHEN, "endsWhen"], [BANISHES, "banishes"], [WARDS_CONDITIONS, "wardsConditions"],
  [GM_ALERTS, "gmAlert"], [MAGICAL, "magical"], [ANTIMAGIC_ZONES, "antimagicZone"], [ANTIMAGIC_ZONE_LASTS, "zoneLasts"]
].map(Object.freeze));

/**
 * The complete entry tables, merged on top of the building blocks in this order (`mergeEntries`): the flight by Reaction
 * (§147), the Ravenloft options (§19.9), the classes and species of the Player's Handbook (§20), the feats (§129), the spells with
 * multiple rules (§37), the items (§49), the corrections to their data (§335).
 */
export const ENTRY_TABLES = Object.freeze([
  FLEE_ON_FAILED_SAVE, CONTROL, RAVENLOFT, MONSTERS, ROGUE, FIGHTER, BARBARIAN, CANTRIPS, MONK, PALADIN, RANGER, CLERIC, WIZARD, WARLOCK,
  DRUID, SPECIES, FEATS, SORCERER, BARD, SPELL_RULES, GEAR, ITEM_FIXES
]);

/**
 * Gap survey (2026-10-22): the spells that the 2024 SRD of dnd5e renames (without the mage's name) keep the document id and the
 * activity and effect ids of the Player's Handbook (checked in `packs/spells24`), but not its identifier. Without the premium
 * Handbook, these spells had no rule. SRD identifier → Handbook identifier; the entry written under one holds for the other, and an
 * entry of its own for each, if there is one, wins.
 * (Bigby's Hand, `arcane-hand`, has its own: content/summons.mjs.)
 */
export const SRD_ALIASES = Object.freeze({
  "black-tentacles": "evards-black-tentacles", "acid-arrow": "melfs-acid-arrow", "resilient-sphere": "otilukes-resilient-sphere",
  "arcane-sword": "mordenkainens-sword", "faithful-hound": "mordenkainens-faithful-hound",
  "magnificent-mansion": "mordenkainens-magnificent-mansion",
  // §438: Player's Handbook 3.0.0 also takes these SRD identifiers.
  "storm-of-radiance": "jallarzis-storm-of-radiance",
  // Same gap, outside the mage spells already surveyed: one spell and three items that the 2024 SRD renames while keeping the
  // document id and the book's activity and effect ids (checked in `dnd5e.spells24` and `dnd5e.equipment24`, dnd5e 6.1.0).
  "freezing-sphere": "otilukes-freezing-sphere", "iron-bands": "iron-bands-of-bilarro", "crawler-mucus": "carrion-crawler-mucus",
  "spiders-sting": "lolths-sting",
  // Secret Chest: the entry is written under the SRD identifier; the Player's Handbook keeps the mage's name (same document id,
  // same activity ids, checked in `dnd5e.spells24` and the Handbook module).
  "secret-chest": "leomunds-secret-chest"
});

function build() {
  const table = {};
  for ( const [source, key] of BRICKS ) {
    if ( Array.isArray(source) ) { for ( const id of source ) (table[id] ??= {})[key] = true; }
    else for ( const [id, value] of Object.entries(source) ) {
      if ( key ) (table[id] ??= {})[key] = value;
      else Object.assign((table[id] ??= {}), value);
    }
  }
  for ( const source of ENTRY_TABLES ) {
    for ( const [id, entry] of Object.entries(source) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  }
  // In both directions: the entry written under one of the two identifiers holds for the other, which has none (an entry of
  // its own wins).
  for ( const [srd, phb] of Object.entries(SRD_ALIASES) ) {
    if ( table[phb] && !table[srd] ) table[srd] = table[phb];
    else if ( table[srd] && !table[phb] ) table[phb] = table[srd];
  }
  return Object.freeze(table);
}

/** The content shipped with the engine, alone. */
export const SHIPPED = build();

/** The content in force: the shipped content, plus the registered tables. Same object for the whole session (read by reference). */
export const CONTENT = { ...SHIPPED };

/** The tables registered by other modules: `source` (module id) → table `{ identifiant: entrée }`, in order. */
const REGISTERED = new Map();

/** Rebuilds `CONTENT` in place: the shipped content, then each registered table merged on top. */
/** How many times the composed content was rebuilt: a table registered or removed. For whoever keeps a reading of the content. */
let stamp = 0;
export const tablesStamp = () => stamp;

function rebuild() {
  stamp++;
  for ( const id of Object.keys(CONTENT) ) delete CONTENT[id];
  Object.assign(CONTENT, SHIPPED);
  for ( const table of REGISTERED.values() ) {
    for ( const [id, entry] of Object.entries(table) ) CONTENT[id] = mergeEntries([CONTENT[id] ?? null, entry]);
  }
}

/**
 * Registers (or replaces) a module's table. Validates nothing: runtime/content.mjs passes only valid entries here.
 * @param {string} source  The id of the module that brings it.
 * @param {Record<string, object>} table  `{ identifiant dnd5e: entrée }`.
 * @returns {string[]}  The registered identifiers.
 */
export function registerTable(source, table) {
  REGISTERED.set(source, Object.freeze({ ...table }));
  rebuild();
  return Object.keys(table);
}

/** Removes a module's table (and its sources, §277). @returns {boolean} Whether it was registered. */
export function unregisterTable(source) {
  const had = REGISTERED.delete(source);
  if ( REGISTERED_SOURCES.delete(source) ) rebuildSources();
  if ( had ) rebuild();
  return had;
}

/**
 * §277: the sources (document id → identifier) shipped (content/sources.mjs) then registered by other modules, in the order
 * of the registrations — the last one wins. Same object for the whole session (read by reference, adapter/content.mjs
 * `identifierOf`).
 */
export const SOURCES = { ...SOURCE_IDENTIFIERS };

/** The registered sources: `source` (module id) → `{ id de document: identifiant }`, in order. */
const REGISTERED_SOURCES = new Map();

function rebuildSources() {
  for ( const id of Object.keys(SOURCES) ) delete SOURCES[id];
  Object.assign(SOURCES, SOURCE_IDENTIFIERS);
  for ( const map of REGISTERED_SOURCES.values() ) Object.assign(SOURCES, map);
}

/**
 * §277: registers (or replaces, or removes with an empty table) a module's sources. Validates nothing: runtime/content.mjs passes
 * only valid pairs here. @returns {string[]} The registered document ids.
 */
export function registerSources(source, sources) {
  if ( sources && Object.keys(sources).length ) REGISTERED_SOURCES.set(source, Object.freeze({ ...sources }));
  else REGISTERED_SOURCES.delete(source);
  rebuildSources();
  return Object.keys(sources ?? {});
}

/** The registered sources: `{ source: { id de document: identifiant } }`. */
export function registeredSources() {
  return Object.fromEntries(Array.from(REGISTERED_SOURCES, ([source, map]) => [source, { ...map }]));
}

/** What is registered: `{ source: [identifiants] }`. */
export function registeredTables() {
  return Object.fromEntries(Array.from(REGISTERED, ([source, table]) => [source, Object.keys(table)]));
}
