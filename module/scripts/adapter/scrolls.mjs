/**
 * §48: a spell scroll plays like the spell it contains — casting the spell, without a spell slot (core/scrolls.mjs).
 *
 * What counts as "casting a spell" (isSpellCast): Counterspell, breaking Invisibility and stealth, rage, verbal component,
 * boosted cantrip, "Spell Shaper", Revivify, Dispel and Advantage on saves given by its effects, and the spell's declared
 * content (identifierOf, adapter/content.mjs). What does not count, because a scroll spends no slot and is not "a spell of
 * your class": the limit of one spell with a slot per turn, Disciple of Life, the pools recharged by a slot, upcasting,
 * Metamagic, `classSpell`, `cantripOf`.
 *
 * The spell index (French and English names, identifiers) is built at `ready`, on the item compendium indexes
 * (`getIndex` with `system.identifier`, `system.level`, `system.school`) and the world's spells.
 */

import { MODULE_ID } from "../constants.mjs";
import { scrollCandidates, scrollSpell, slug, scrollAccess, highestSlotLevel } from "../core/scrolls.mjs";
import { identifierOf } from "./content.mjs";
import { potionOfCast } from "./potions.mjs";

/** slug (identifier, displayed name, English name) → { identifier, level, school }. */
const known = new Map();

function remember(identifier, names, level, school) {
  if ( !identifier ) return;
  const entry = { identifier, level: Number.isFinite(Number(level)) ? Number(level) : null, school: school ?? null };
  for ( const key of [identifier, ...names.map(slug)] ) if ( key && !known.has(key) ) known.set(key, entry);
}

/** Builds the spell index. Call at `ready` (the compendiums are there, Babele has translated their indexes). */
export async function buildSpellIndex() {
  known.clear();
  for ( const item of game.items ?? [] ) {
    if ( item.type === "spell" ) remember(item.system.identifier, [item.name, item.flags?.babele?.originalName ?? ""], item.system.level, item.system.school);
  }
  for ( const pack of game.packs ?? [] ) {
    if ( pack.documentName !== "Item" ) continue;
    let index;
    try { index = await pack.getIndex({ fields: ["system.identifier", "system.level", "system.school", "flags.babele.originalName"] }); }
    catch { continue; }
    for ( const e of index ) {
      if ( e.type !== "spell" ) continue;
      remember(e.system?.identifier || slug(e.flags?.babele?.originalName ?? e.name), [e.name, e.flags?.babele?.originalName ?? ""],
        e.system?.level, e.system?.school);
    }
  }
  return known.size;
}

/** Est-ce un parchemin de sort ? */
export const isScroll = item => (item?.type === "consumable") && (item.system?.type?.value === "scroll");

/**
 * The spell of a scroll `{ identifier, level, school }`, or null (not a scroll, or spell not found).
 *
 * A scroll made from a compendium (`createScrollFromCompendiumSpell`, documents/item.mjs) does not copy the spell: it
 * carries a "cast" activity pointing to it, like a wand; using it casts the real spell (a cached spell item), which the
 * engine sees as such. That scroll is therefore NOT a spell itself — otherwise the engine would see two castings (two
 * Counterspell windows). Only scrolls with copied activities (`createScrollFromSpell` of a world spell, imports,
 * old ones) are recognized here.
 */
export function scrollSpellOf(item) {
  if ( !isScroll(item) ) return null;
  if ( (item.system?.activities ?? []).some?.(a => a.type === "cast") ) return null;
  const flags = item.flags ?? {};
  const originalNames = [flags.babele?.originalName, flags.ddbimporter?.originalName].filter(Boolean);
  return scrollSpell({
    stamped: flags[MODULE_ID]?.scroll ?? null,
    candidates: scrollCandidates({ name: item.name, originalNames }),
    known,
    level: Number(flags.dnd5e?.spellLevel?.value ?? NaN)
  });
}

/**
 * Does using this item cast a spell? A spell, or a scroll whose spell is known — not the spell that a potion
 * makes you cast (§53: drinking is not casting a spell).
 */
export const isSpellCast = item => ((item?.type === "spell") && !potionOfCast(item)) || !!scrollSpellOf(item);

/** The level of the spell cast (spell or scroll), 0 otherwise. */
export function spellLevelOf(item) {
  if ( item?.type === "spell" ) return Number(item.system.level) || 0;
  return scrollSpellOf(item)?.level ?? 0;
}

/** The school of the spell cast (spell or scroll), or null. */
export function spellSchoolOf(item) {
  if ( item?.type === "spell" ) return item.system.school ?? null;
  return scrollSpellOf(item)?.school ?? null;
}

/**
 * `dnd5e.createScrollFromSpell` (documents/item.mjs, after the data is composed): the engine notes on the scroll the
 * spell it contains, which dnd5e does not keep.
 */
export function stampScroll(spell, scrollData) {
  if ( (spell?.type !== "spell") || !scrollData ) return;
  const identifier = spell.system?.identifier;
  if ( !identifier ) return;
  scrollData.flags ??= {};
  scrollData.flags[MODULE_ID] = { ...(scrollData.flags[MODULE_ID] ?? {}), scroll: {
    identifier, level: Number(scrollData.flags.dnd5e?.spellLevel?.value ?? spell.system.level) || 0, school: spell.system.school ?? null
  } };
}

/**
 * O8g (§350): the scroll's activity behind a use — that of the scroll itself, or, for the cached spell that a "cast"
 * activity casts (`flags.dnd5e.cachedFor`, documents/activity/cast.mjs: `use` passes to the spell), the "cast" activity of its
 * scroll. Null otherwise.
 */
export function scrollActivityOf(activity) {
  if ( isScroll(activity?.item) ) return activity;
  // `cachedFor` is a uuid relative to the actor: dnd5e resolves it with `linkedActivity` (data/item/spell.mjs).
  const cast = activity?.item?.flags?.dnd5e?.cachedFor ? (activity.item.system?.linkedActivity ?? null) : null;
  return ((cast?.type === "cast") && isScroll(cast.item)) ? cast : null;
}

/**
 * O8g (§350): the spell that this scroll activity reads `{ identifier, level }`, or null — a scroll with a "cast" activity (made
 * from a compendium: the activity targets the real spell) as well as a scroll with copied activities (`scrollSpellOf`).
 */
export function scrollReadOf(activity) {
  const item = activity?.item;
  if ( !isScroll(item) ) return null;
  if ( activity.type !== "cast" ) return scrollSpellOf(item);
  const spell = fromUuidSync(activity.spell?.uuid ?? "", { strict: false });
  const flags = item.flags ?? {};
  const byName = scrollSpell({ stamped: flags[MODULE_ID]?.scroll ?? null, known, level: Number(flags.dnd5e?.spellLevel?.value ?? NaN),
    candidates: scrollCandidates({ name: item.name, originalNames: [flags.babele?.originalName].filter(Boolean) }) });
  const identifier = spell?.system?.identifier || byName?.identifier || null;
  const level = Number(activity.spell?.level ?? spell?.system?.level ?? byName?.level);
  return identifier ? { identifier, level: Number.isFinite(level) ? level : 0 } : null;
}

/**
 * O8g (§350): what a character can do with this scroll (`scrollAccess`) — the spell list of its classes and subclasses
 * (dnd5e registry `dnd5e.registry.spellLists`), Use Magic Device, its highest slot; the ability of the
 * check: that of the class whose list carries the spell, otherwise Intelligence (Arcana). Null: not a scroll, not a character,
 * or registry not ready (nothing is imposed).
 */
export function scrollReadingFor(activity, actor) {
  activity = scrollActivityOf(activity);
  const read = scrollReadOf(activity);
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if ( !read || (actor?.type !== "character") || !registry?.ready ) return null;
  const owners = [...Object.entries(actor.classes ?? {}).map(([id, cls]) => ({ cls, list: registry.forType("class", id) })),
    ...Object.entries(actor.subclasses ?? {}).map(([id, sub]) => ({ cls: sub.class ?? null, list: registry.forType("subclass", id) }))];
  const owner = owners.find(o => o.list?.identifiers?.has?.(read.identifier)) ?? null;
  const anyScroll = Array.from(actor.items ?? []).some(i => identifierOf(i).id === "use-magic-device");
  const access = scrollAccess({ level: read.level, onList: !!owner, anyScroll, maxLevel: highestSlotLevel(actor.system?.spells) });
  const ability = (access.via === "class")
    ? (owner?.cls?.system?.spellcasting?.ability || actor.system?.attributes?.spellcasting || "int") : "int";
  return { ...read, ...access, ability, skill: (access.via === "device") ? "arc" : null };
}
