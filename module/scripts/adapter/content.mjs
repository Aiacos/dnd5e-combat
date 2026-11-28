/**
 * What an item declares to the engine, all layers combined (SPEC §13.4):
 *
 *   item flag  >  world overlay (setting, GM)  >  module content  >  NPC ability text (K1)  >  nothing = native
 *
 * The identifier is dnd5e's (`system.identifier`, kept by copies made from a
 * compendium — verified: Spellbook creates the spell with `toObject()` of the compendium spell). Failing
 * that: the identifier of the compendium source (`_stats.compendiumSource`, which the core
 * fills in at creation, client-document.mjs:990), then the name in kebab-case.
 */

import { MODULE_ID } from "../constants.mjs";
import { mergeEntries, validateEntry, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { CONTENT, SOURCES } from "../content/index.mjs";
import { ENCHANTMENT_SOURCES } from "../content/sources.mjs";
import { BASIC_ACTIONS } from "../content/actions.mjs";
import { factsFor } from "./facts.mjs";
import { scrollSpellOf } from "./scrolls.mjs";
import { isObjectToken } from "./bodies.mjs";
import { monsterTextLayer } from "../core/monster-layer.mjs";
import { sourceKeys } from "../core/source-keys.mjs";

export const OVERRIDES_SETTING = "contentOverrides";

/**
 * §117: per-item content applies only at the Full level (runtime/levels.mjs). When closed, `contentOf` returns nothing: each
 * item keeps dnd5e's behavior and the engine's general rules.
 */
/** §416: the ids of the engine's base actions (content/actions.mjs) — their entry is still read when content is closed. */
const GENERAL_RULES = new Set(Object.values(BASIC_ACTIONS).map(a => a.identifier).filter(Boolean));
let contentEnabled = true;
export function setContentEnabled(enabled) {
  contentEnabled = !!enabled;
}

/** The fact keys that the conditions core knows (to validate an entry). */
export const KNOWN_FACTS = factsFor();

/** Un nom en identifiant, comme dnd5e le forme (utils.mjs:112, `formatIdentifier`). */
const kebab = name => String(name ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3").slugify({ strict: true });

/**
 * The identifier under which an item is recognized, and where it comes from.
 *
 * §19.9: a premium item without an identifier (Ravenloft) gets one when created on a sheet — dnd5e 6 writes it from the name
 * (documents/item.mjs:1146, `_preCreate`), hence from the name TRANSLATED by Babele: "morsure-vampirique". It is recognized by
 * the id of its source (content/sources.mjs), otherwise by its English name, which Babele keeps
 * (`flags.babele.originalName`, 2.9.1).
 */
export function identifierOf(item) {
  if ( !item || (typeof item !== "object") ) return computeIdentifier(item);
  const sig = identifierSignature(item);
  const now = Date.now();
  const hit = identifiers.get(item);
  if ( hit && (hit.sig === sig) && ((now - hit.at) < IDENTIFIER_TTL_MS) ) return hit.value;
  const value = computeIdentifier(item);
  identifiers.set(item, { sig, at: now, value });
  return value;
}

/**
 * §527 (baileywiki's report, 2026-11-24): `identifierOf` runs for every item of every token on each vision refresh — several times
 * per frame while a token walks (`sightRefresh` → `grantAll` → `ownDarknessSight`, `devilsSightRange`). Computing it (name
 * `slugify`, source keys, scroll) took 1.8 s out of a 6 s walk on the bench. The result is kept per item as long as the fields it
 * reads are unchanged (signature); what it reads outside the item (sources registered by a module, a compendium index loaded later,
 * the spells scrolls know) is read again after one second at most.
 */
const IDENTIFIER_TTL_MS = 1000;
const identifiers = new WeakMap();

function identifierSignature(item) {
  const owner = item.actor ?? ((item.parent?.documentName === "Actor") ? item.parent : null);
  const flags = item.flags ?? {};
  return [item.id, item.type, item.name, item.system?.identifier, item._stats?.compendiumSource, flags.dnd5e?.sourceId,
    flags.babele?.originalName, flags.ddbimporter?.originalName, flags.dnd5e?.spellLevel?.value, item.system?.activities?.size,
    JSON.stringify(flags[MODULE_ID]?.scroll ?? null), owner?.id, owner?._stats?.compendiumSource, owner?.flags?.dnd5e?.sourceId].join("\u0001");
}

function computeIdentifier(item) {
  // §48: a scroll is recognized under the identifier of the spell it contains.
  const scroll = scrollSpellOf(item);
  if ( scroll ) return { id: scroll.identifier, from: "scroll" };
  const sourceUuid = item?._stats?.compendiumSource ?? item?.flags?.dnd5e?.sourceId ?? null;
  // §277: the shipped sources (content/sources.mjs) and those that another module registers with its table.
  // §334: first "actor.item" — an item id from the Monster Manual is shared between creatures ("mmBite0000000000"); the key
  // "mmHomunculus0000.mmBite0000000000" targets the Homunculus's bite alone. The source of an embedded item designates the
  // abilities compendium, not the creature: the actor is then read from the one that carries the item (core/source-keys.mjs).
  const owner = item?.actor ?? ((item?.parent?.documentName === "Actor") ? item.parent : null);
  const key = sourceKeys({ itemSource: sourceUuid, itemId: item?.id ?? null, actorId: owner?.id ?? null,
    actorSource: owner?._stats?.compendiumSource ?? owner?.flags?.dnd5e?.sourceId ?? null }).find(k => k in SOURCES);
  const known = key ? SOURCES[key] : null;
  if ( known ) return { id: known, from: "source" };
  const own = item?.system?.identifier;
  const original = item?.flags?.babele?.originalName;
  const translated = !!own && !!original && (own === kebab(item.name)) && (kebab(original) !== own);
  if ( own && !translated ) return { id: own, from: "item" };
  const source = sourceUuid ? fromUuidSync(sourceUuid, { strict: false }) : null;
  if ( source?.system?.identifier ) return { id: source.system.identifier, from: "compendium" };
  if ( original ) return { id: kebab(original), from: "name" };
  if ( own ) return { id: own, from: "item" };
  if ( item?.name ) return { id: kebab(item.name), from: "name" };
  return { id: null, from: null };
}

/**
 * §431: the class of a feature, when several classes share its identifier — dnd5e 6.1's SRD gives `potent-spellcasting`
 * to the Cleric option (`phbClcPotentSpel`) as to the Druid's (`phbFuryPotentSpe`). First `system.classIdentifier` (dnd5e 6.1,
 * data/item/feat.mjs:177, the class that granted the feature through advancement), then the root item of the advancement
 * (dnd5e 6.0, data/abstract/item-data-model.mjs:62), finally the `requirements` text ("Cleric", "Druid") if it names a class
 * of the actor, or if the actor has no class (§433).
 * Nothing certain: null.
 */
export function featureClassOf(item) {
  const own = item?.system?.classIdentifier;
  if ( own ) return own;
  const root = item?.system?.advancementRootItem;
  if ( root?.type === "class" ) return root.identifier ?? root.system?.identifier ?? null;
  if ( root?.type === "subclass" ) return root.system?.classIdentifier || null;
  const written = String(item?.system?.requirements ?? "").trim().toLowerCase();
  if ( !written ) return null;
  const classes = item?.actor?.classes ?? {};
  if ( classes[written] ) return written;
  // §433: an actor with no class at all (NPC carrying the feature) — the text alone is authoritative,
  // if it fits in one word ("Druid").
  return (!Object.keys(classes).length && /^[a-z]+$/.test(written)) ? written : null;
}

/**
 * §431: does the actor have a feature of this identifier (or of one of them) for this class? A feature whose class is known
 * and different does not count; one whose class is unknown counts if the actor has levels in the requested class.
 */
export function hasClassFeature(actor, ids, cls) {
  const wanted = [ids].flat();
  return Array.from(actor?.items ?? []).some(i => {
    if ( !wanted.includes(identifierOf(i).id) ) return false;
    const of = featureClassOf(i);
    return of ? (of === cls) : !!actor?.classes?.[cls];
  });
}

/**
 * O5b (§340): the identifiers of the items whose active enchantment is placed on this item — by the id of the enchantment effect
 * (content/sources.mjs, `ENCHANTMENT_SOURCES`: it remains that of the original effect), otherwise by the item that placed it
 * (`system.origin.activity`, activity/enchant.mjs), when it still exists.
 */
export function enchantmentSourcesOf(item) {
  const out = [];
  const effects = item?.effects;
  if ( !effects || (typeof effects[Symbol.iterator] !== "function") ) return out;
  for ( const effect of effects ) {
    // O9h (§363): a profile of the item activated in place of a self-enchantment (runtime/enchant.mjs) carries its own profile
    // mark — dnd5e does not count it as applied.
    const ownProfile = effect?.flags?.dnd5e?.enchantmentProfile === effect?.id;
    if ( (effect?.type !== "enchantment") || effect.disabled || ((effect.isAppliedEnchantment === false) && !ownProfile) ) continue;
    let id = ENCHANTMENT_SOURCES[effect.id] ?? null;
    if ( !id ) {
      const activity = effect.system?.origin?.activity ?? effect.origin ?? "";
      const itemUuid = String(activity).replace(/\.Activity\.[^.]+$/, "");
      const source = itemUuid ? fromUuidSync(itemUuid, { strict: false }) : null;
      if ( source && (source !== item) && (source.documentName === "Item") ) id = identifierOf(source).id;
    }
    if ( id && !out.includes(id) ) out.push(id);
  }
  return out;
}

/**
 * O5b (§340): what an item's enchantments bring it — the `<identifiant>-enchanted` entry of the item that enchants it
 * (Dragon Slayer, Holy Avenger…). A separate name: the item that places the enchantment, if it remains on the sheet,
 * triggers nothing itself.
 */
function enchantmentLayer(item) {
  const entries = enchantmentSourcesOf(item).map(id => CONTENT[`${id}-enchanted`]).filter(Boolean);
  return entries.length ? mergeEntries(entries) : null;
}

/**
 * The world overlay already read, and the `game.settings` it was read from. `contentOf` asks for it for each item (hundreds of
 * call sites, including sweeps of all of a sheet's items), and reading a world setting is not free: the core searches for it
 * among all the world's settings on each read. It is therefore read only once, until the setting changes
 * (`forgetWorldOverrides`, on its `onChange`: runtime/content.mjs).
 */
let read = null;

/** The setting changed: the overlay will be re-read on the next request. */
export function forgetWorldOverrides() {
  read = null;
}

/** The world overlay: `{ identifiant: entrée }`, held by the GM. Do not modify the returned object: it is shared. */
export function worldOverrides() {
  // `game.settings` is the same object for the whole session; if it changed (another simulated world),
  // what was read is no longer valid.
  if ( read && (read.settings === game.settings) ) return read.entries;
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  const valid = stored && (typeof stored === "object") && (stored.v === CONTENT_VERSION);
  read = { settings: game.settings, entries: (valid ? stored.entries : null) ?? {} };
  return read.entries;
}

/** Writes (or removes, with `null`) the entry of an identifier in the world overlay. GM only. */
export async function setWorldOverride(identifier, entry) {
  const entries = { ...worldOverrides() };
  if ( entry === null ) delete entries[identifier];
  else {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS });
    if ( errors.length ) throw new Error(`${identifier}: ${errors.join("; ")}`);
    entries[identifier] = entry;
  }
  await game.settings.set(MODULE_ID, OVERRIDES_SETTING, { v: CONTENT_VERSION, entries });
  forgetWorldOverrides();   // the setting's `onChange` does it too; here for whoever reads right after the write
  return entries[identifier] ?? null;
}

/** The rank of each entry key in the schema: the order of the keys of an item's layer. */
const KEY_RANK = new Map(ENTRY_KEYS.map((key, rank) => [key, rank]));

/**
 * The entry keys carried by an item's flags, in schema order. We walk the flags (a handful, often none),
 * not the hundreds of schema keys: `contentOf` passes here for each item, and the Bar asks for it for each item of the
 * sheet, several times per cell (measured in play on a sheet of 129 items: 1,160 ms for ten selections, all in this
 * loop).
 * @param {object} flags
 * @returns {string[]}
 */
export function entryKeysOf(flags) {
  const keys = [];
  for ( const key in flags ) if ( KEY_RANK.has(key) ) keys.push(key);
  return (keys.length > 1) ? keys.sort((a, b) => KEY_RANK.get(a) - KEY_RANK.get(b)) : keys;
}

/** What an item carries itself, validated; a wrong entry is ignored (and reported). */
function itemLayer(item) {
  const flags = item?.flags?.[MODULE_ID];
  if ( !flags || (typeof flags !== "object") ) return null;
  const keys = entryKeysOf(flags);
  if ( !keys.length ) return null;
  const layer = {};
  for ( const key of keys ) layer[key] = flags[key];
  const errors = validateEntry(layer, { facts: KNOWN_FACTS });
  if ( errors.length ) {
    console.warn(`${MODULE_ID} | ${item.name}: flags ignored — ${errors.join("; ")}`);
    return null;
  }
  return layer;
}

/**
 * An item's effective entry, layers combined. `null` if nothing is declared anywhere.
 * @returns {{entry: object|null, identifier: string|null, layers: {module: boolean, world: boolean, item: boolean}}}
 */
export function contentOf(item) {
  const { id } = identifierOf(item);
  if ( !contentEnabled ) {
    // §416: an engine base action is a general rule (Assisted level), not an item's content — without the exclusive choice of
    // Unarmed Strike, a failed Grapple set Prone AND Grappled at that level.
    const general = (id && GENERAL_RULES.has(id)) ? (CONTENT[id] ?? null) : null;
    return { identifier: id, entry: general ? mergeEntries([general]) : null, layers: { text: false, module: !!general, world: false, item: false } };
  }
  const layers = { text: textLayer(item), enchant: enchantmentLayer(item), module: id ? CONTENT[id] ?? null : null, world: id ? worldOverrides()[id] ?? null : null, item: itemLayer(item) };
  return {
    identifier: id,
    entry: mergeEntries([layers.text, layers.enchant, layers.module, layers.world, layers.item]),
    layers: { text: !!layers.text, enchant: !!layers.enchant, module: !!layers.module, world: !!layers.world, item: !!layers.item }
  };
}

/** Does a layer (item) carry this key? The test of `mergeEntries` (core/content/merge.mjs). */
const carries = (layer, key) => !!layer && (typeof layer === "object") && (key in layer);

/**
 * Does one of the item's layers carry the key `key`? The same layers as `contentOf`, without merging them: the composed entry
 * only has keys that a layer carries, so "no" here means `contentOf(item).entry?.[key] === undefined`. For whoever looks for
 * a rare key on all the items of a sheet (the view, on every refresh): the merge is done only for the item that declares
 * it. Nothing is kept: the item, its effects, the overlay and the tables are re-read on each call.
 * @param {Item} item
 * @param {string} key                 An entry key (`ENTRY_KEYS`).
 * @param {object} [overrides]         `worldOverrides()` already read by the caller, for a series of items.
 * @returns {boolean}
 */
export function declaresKey(item, key, overrides=worldOverrides()) {
  const { id } = identifierOf(item);
  if ( id && (carries(CONTENT[id], key) || carries(overrides[id], key)) ) return true;
  if ( carries(item?.flags?.[MODULE_ID], key) ) return true;
  if ( enchantmentSourcesOf(item).some(source => carries(CONTENT[`${source}-enchanted`], key)) ) return true;
  return carries(textLayer(item), key);
}

/**
 * K1 (SPEC §322): the lowest layer, read from the original English text of an NPC ability (`core/monster-text.mjs`) —
 * repeated save at the end of its turns, second failure, ends on damage; K2 (§323): death at 0 HP, HP thresholds; K3 (§324):
 * a single effect. The shipped content, the world overlay or the item's flag replace it as soon as they declare their
 * own `triggers`. Not for a spell (its copy follows the spell's rules) nor for a character. Cached per item and text.
 */
const textCache = new Map();

/** §461: range, template and target of an activity, as the data writes them (the source: no prepared range or formula). */
const activityShape = a => ({ range: { value: a.range?.value ?? null, units: a.range?.units ?? "", special: a.range?.special ?? "" },
  template: a.target?.template?.type ? { type: a.target.template.type, size: a.target.template.size ?? "", units: a.target.template.units ?? "",
    count: a.target.template.count ?? "" } : false,
  target: { type: a.target?.affects?.type ?? "", count: a.target?.affects?.count ?? "", special: a.target?.affects?.special ?? "" } });

function textLayer(item) {
  if ( (item?.actor?.type !== "npc") || (item.type === "spell") ) return null;
  const html = item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "";
  if ( !html ) return null;
  const key = `${item.uuid}|${html.length}|${item.effects?.size ?? 0}`;
  if ( textCache.has(key) ) return textCache.get(key);
  // §460: the computation is pure (core/monster-layer.mjs), shared with the ATLAS.
  const layer = monsterTextLayer({ html, identifier: identifierOf(item).id, swallow: !!CONTENT[identifierOf(item).id]?.swallow,
    effects: (item.effects?.contents ?? []).map(e => ({ id: e.id, statuses: [...(e.statuses ?? [])], changes: e.changes ?? [] })),
    activities: Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, name: a.name ?? "", type: a.type,
      activation: { type: a.activation?.type, condition: a.activation?.condition ?? "" }, effects: (a.effects ?? []).map(e => e._id ?? e.id),
      onSave: a.damage?.onSave ?? null, ...activityShape(a._source ?? a) })) });
  if ( textCache.size > 2000 ) textCache.clear();
  textCache.set(key, layer);
  return layer;
}

/** §53: the entry of an identifier without an item (a potion destroyed by drinking it): module content < world overlay. */
export function entryOfIdentifier(id) {
  if ( !contentEnabled ) return null;
  return id ? mergeEntries([CONTENT[id] ?? null, worldOverrides()[id] ?? null]) : null;
}

/**
 * The item that cast a spell copy (`flags.dnd5e.cachedFor` = relative uuid of its casting activity,
 * activity/cast.mjs:118-145), or null. A creature that "casts Hold Person" through an ability
 * (a creature from a third-party module) declares there what ITS version adds to the spell: the spell's outcome steps
 * also read those of this item (adapter/usage.mjs, `outcomeStepsOf`).
 */
export function castItemOf(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item.([A-Za-z0-9]{16}).Activity.[A-Za-z0-9]{16}$/) : null;
  return m ? (item.actor?.items?.get(m[1]) ?? null) : null;
}

/**
 * §438: the summoning rule (`summon`) of an item, and that of the item that cast it when it is a spell copy (`castItemOf`), the
 * latter winning. The Wild Companion from the Player's Handbook 3.0.0 no longer summons itself: its "cast" activity casts Find
 * Familiar, and the familiar's origin (`flags.dnd5e.summon.origin`) is the spell copy — what `wild-companion` declares
 * (departs at the Long Rest) must still apply. Null if neither declares anything.
 */
export function summonRuleOf(item) {
  if ( !item ) return null;
  const own = contentOf(item).entry?.summon ?? null;
  const caster = castItemOf(item);
  const from = caster ? (contentOf(caster).entry?.summon ?? null) : null;
  return (own || from) ? { ...(own ?? {}), ...(from ?? {}) } : null;
}

/** For in-play inspection: what each item of an actor declares, and where from. */
export function inspect(actor) {
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    const { entry, layers } = contentOf(item);
    return { item: item.name, identifier: id, identifierFrom: from, layers, entry };
  }).filter(r => r.entry);
}

/**
 * §123: the range unit of an activity, corrected by the content when the data are wrong (`ranges`, §16.43) — Lay on Hands and the
 * healer's kit are "personal" in the Player's Handbook although they touch a creature. What decides
 * "on self" (aiming on click, map layout) reads this, not `activity.range.units`.
 */
export function rangeUnitsOf(activity) {
  const fixed = activity?.item ? contentOf(activity.item).entry?.ranges?.[activity.id] : null;
  if ( fixed?.units ) return fixed.units;
  const units = activity?.range?.units ?? null;
  // General rule: a "personal" HEAL that targets a creature — a single one, with no area — actually targets another creature
  // (or self). Survey of the Player's Handbook (2026-10-10): Lay on Hands, Healing Hands, "Ultimate Mercy", "Physician's Touch",
  // "Rallying", "Protective Field", "Improved Protective Burst", "Interception" — all healed the caster, whatever the target.
  // With no known range (null): aiming opens up (self included), with no distance check — `ranges` specifies it when the text
  // gives it.
  const affects = activity?.target?.affects;
  const one = !activity?.target?.template?.type && ["", "1"].includes(String(affects?.count ?? "").trim());
  if ( (units !== "self") || !one ) return units;
  if ( (activity?.type === "heal") && HEAL_TARGETS.includes(affects?.type) ) return null;
  // §124: likewise an ability that a player casts themselves (action, Bonus Action), apart from heals and attacks (an attack
  // is already aimed), for which the engine has no rule — Quivering Palm (ending the vibrations), "Restorative Touch",
  // Bastion of Law, "Sacred Halo", "Ancestral Champion", the Ranger's command to the companion, "Psychic Whispers":
  // with no designated target, nothing happened. Those that the engine handles (Flurry of Blows,
  // "Trickster's Transposition", War Priest…) keep their own circuit.
  if ( (activity?.type !== "attack") && PLAYER_ACTIVATIONS.includes(activity?.activation?.type)
    && TARGETS.includes(affects?.type) && !contentOf(activity.item).entry ) return null;
  // §253: a trap (NPC of the creature type "Trap" from the DMG 2024 traps, or an engine object token) has a "personal" range
  // in the data but hits a creature: cast by hand with no designated target, aiming opens up (nothing happened).
  if ( TARGETS.includes(affects?.type) && trapLike(activity?.actor) ) return null;
  return units;
}

const TRAP_TYPE = /^(traps?|pièges?)$/i;

/** §253: a trap actor — custom creature type "Trap" (DMG 2024), or the token of an engine object. */
export function trapLike(actor) {
  const type = actor?.system?.details?.type;
  if ( (type?.value === "custom") && TRAP_TYPE.test(String(type.custom ?? "").trim()) ) return true;
  return isObjectToken(actor?.token);
}

/** §124: the activations that a player triggers themselves (not a Reaction, not an add-on to the hit). */
const PLAYER_ACTIVATIONS = ["action", "bonus"];
/** §124: the targets that designate a creature (or an object) other than the caster. */
const TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any", "enemy", "object"];

/** The targets of a heal that designate a creature other than the caster. */
const HEAL_TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any"];
