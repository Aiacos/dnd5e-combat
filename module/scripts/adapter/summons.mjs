/**
 * Summoned creatures (SPEC §16.13, B12), read and written in Foundry. Verified in dnd5e 6.0.3:
 *  - the "summon" activity places the tokens (documents/activity/summon.mjs, `placeSummons`); the summoned actor carries
 *    `flags.dnd5e.summon.origin` = uuid of the summoner's item (`fetchExisting`, option `origin`);
 *  - the system does not put them in combat, and does not remove them when Concentration drops: a token is not a
 *    "dependent" (`ActiveEffect5e#getDependents`: effects, items, activities).
 * The engine, on the active GM, at token creation: attaches it to the summoner's Concentration on that item
 * (`flags["dnd5e-combat"].summonedBy` = uuid of the effect), and adds it to combat according to the content (`summon.initiative`).
 */

import { MODULE_ID } from "../constants.mjs";
import { initiativeAfter } from "../core/turn.mjs";
import { summonRuleOf } from "./content.mjs";
import { expiryTime } from "../core/area.mjs";
import { readTimeFactors } from "./areas.mjs";
import { summonChoices, profilesAtLevel, mmActorId, srdMonsterId, actorIdOf } from "../core/summon.mjs";

/**
 * §383: what a "summon" activity lets you choose at placement (profiles available at this level — `availableProfiles`,
 * documents/activity/summon.mjs —, sizes, creature types). All false for another activity.
 */
export function summonChoicesOf(activity) {
  if ( activity?.type !== "summon" ) return summonChoices();
  return summonChoices({ profiles: activity.availableProfiles?.length ?? 0, sizes: activity.creatureSizes?.size ?? 0,
    types: activity.creatureTypes?.size ?? 0 });
}

/**
 * §386: where to look for the creature of a 2014 SRD profile, in order (user's decision): the 2024 Monster Manual (premium
 * module), then the 2024 SRD creatures shipped by dnd5e (`dnd5e.actors24`) — same `mm…` identifiers in both.
 */
export const MM_ACTORS = "dnd-monster-manual.actors";
export const SRD24_ACTORS = "dnd5e.actors24";
/** §392: dnd5e's 2014 SRD creatures — the last resort, and the target of the DMG's broken links. */
export const SRD14_ACTORS = "dnd5e.monsters";
const REPAIR_PACKS = [MM_ACTORS, SRD24_ACTORS, "dnd-players-handbook.actors", "dnd-dungeon-masters-guide.actors"];

/** §392: the uuid of an actor with the same id as a broken link, in the first actor compendium that has it; null otherwise. */
function repairedActorUuid(uuid) {
  const id = actorIdOf(uuid);
  if ( !id || !game.packs ) return null;
  const actorPacks = game.packs.filter(p => p.documentName === "Actor");
  const rank = p => { const i = REPAIR_PACKS.indexOf(p.collection); return (i >= 0) ? i : ((p.collection === SRD14_ACTORS) ? 99 : 50); };
  const found = actorPacks.filter(p => p.index?.has(id)).sort((a, b) => rank(a) - rank(b))[0];
  return found ? `Compendium.${found.collection}.Actor.${id}` : null;
}
const PREFERRED_PACKS = [MM_ACTORS, SRD24_ACTORS];

/**
 * §386 (user's request): the creature to summon for a profile that designates a dnd5e 2014 SRD creature
 * (`dnd5e.monsters`: the ghouls, ghasts, wights and mummies of Create Undead) — the same one (English name → `mmActorId`)
 * in the 2024 Monster Manual, otherwise in dnd5e's 2024 SRD, otherwise the profile's uuid. The compendium indexes are
 * loaded at world startup.
 */
export function preferredSummonUuid(uuid) {
  // §392: a broken link to a 2014 SRD creature (the DMG points `dnd-dungeon-masters-guide.actors.Actor.<id>` to an id that
  // exists only in `dnd5e.monsters`: Axe of the Dwarvish Lords, Bag of Tricks, Horn of Valhalla… summoned nothing).
  // The 2024 SRD objects of dnd5e do the opposite (`dnd5e.actors24.Actor.phbmobWeasel0000`, a Player's Handbook creature): the
  // same id is searched in all the actor compendiums, in the order of `REPAIR_PACKS`, then the others, the 2014 SRD last.
  let source = uuid;
  if ( uuid && !srdMonsterId(uuid) && !fromUuidSync(uuid, { strict: false }) ) source = repairedActorUuid(uuid) ?? uuid;
  if ( !srdMonsterId(source) ) return source;
  const id = mmActorId(fromUuidSync(source, { strict: false })?.name);
  if ( id ) {
    for ( const packId of PREFERRED_PACKS ) {
      if ( game.packs?.get(packId)?.index?.has(id) ) return `Compendium.${packId}.Actor.${id}`;
    }
  }
  return source;
}

/**
 * §386: the profiles of a "summon" activity that designate a 2014 SRD creature pointed at the Monster Manual one, on the
 * COPY of the item that dnd5e uses (like the count, §385; `placeSummons` rereads `profile.uuid`). Returns the updated activity.
 */
export function applyPreferredActors(activity) {
  const item = activity?.item;
  const source = item?._source?.system?.activities?.[activity.id]?.profiles;
  if ( !Array.isArray(source) ) return activity;
  let changed = false;
  const profiles = source.map(p => {
    const uuid = preferredSummonUuid(p.uuid);
    if ( uuid === p.uuid ) return p;
    changed = true;
    return { ...p, uuid };
  });
  if ( !changed ) return activity;
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.profiles`]: profiles });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  return item.system.activities.get(activity.id) ?? activity;
}

/**
 * §385: how many creatures a profile places at level `level` (its `count` formula with `@item.level` at that level, like
 * `getPlacement`, documents/activity/summon.mjs). Null if the formula is not fixed (dice: no choice offered).
 */
export function summonCountAt(activity, profile, level, formula=null) {
  try {
    const data = activity.getRollData?.() ?? {};
    const rollData = { ...data, item: { ...(data.item ?? {}), level } };
    // §387: a content formula (`summon.chooseCount`) takes precedence over the profile's.
    const roll = new Roll(String(formula || profile?.count || "1"), rollData);
    if ( !roll.isDeterministic ) return null;
    return Math.max(0, Math.floor(Number(roll.evaluateSync().total) || 0));
  } catch(err) { return null; }
}

/** §385: the profiles of a "summon" activity allowed at level `level`. */
export function summonProfilesAt(activity, level) {
  return profilesAtLevel(Array.from(activity?.profiles ?? []), level);
}

/**
 * §385: the levels to cast at: each slot that remains (pact included), at least the spell's level; with none, the spell's level
 * alone (`slot` null: the GM will cast without a slot, §77). `{ slot, level, label }`.
 */
export function castLevelsOf(activity) {
  const base = Number(activity?.item?.system?.level) || 0;
  const spells = activity?.actor?.system?.spells ?? {};
  const out = [];
  for ( const [key, slot] of Object.entries(spells) ) {
    if ( !/^(spell\d+|pact)$/.test(key) ) continue;
    const level = Number(slot?.level) || 0;
    if ( (level >= base) && ((Number(slot?.value) || 0) > 0) ) out.push({ slot: key, level, label: slot.label ?? key, left: Number(slot.value) });
  }
  out.sort((a, b) => (a.level - b.level) || (Number(a.slot === "pact") - Number(b.slot === "pact")));
  return out.length ? out : [{ slot: null, level: base, label: null, left: 0 }];
}

/**
 * §385: the chosen count, written on the COPY of the item that dnd5e uses (`Activity#use` clones the item; placement rereads
 * the profile: `placeSummons` → `getPlacement`, `profile.count`) — verified in play: 1 ghoul placed instead of 3. Like §77,
 * `repairSelfUses`.
 * Returns the updated activity.
 */
export function applySummonCount(activity, profileId, count) {
  const item = activity?.item;
  const source = item?._source?.system?.activities?.[activity.id]?.profiles;
  if ( !Array.isArray(source) || !(count >= 1) ) return activity;
  const profiles = source.map(p => (p._id === profileId) ? { ...p, count: String(count) } : p);
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.profiles`]: profiles });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  return item.system.activities.get(activity.id) ?? activity;
}

/**
 * §198: the own duration of a summon without Concentration — that of the activity that placed it (`flags.dnd5e.summon.activity`),
 * otherwise the spell's (Mage Hand: 1 minute, issue #8). Null with Concentration (it ends with it, runtime/concentration.mjs);
 * an instantaneous, permanent or special duration (Find Steed, Find Familiar) gives no end time (`expiryTime` only
 * knows the units of `CONFIG.DND5E.timeUnits`).
 */
function ownDurationOf(tokenDoc, item) {
  const activity = item.system?.activities?.get?.(tokenDoc?.actor?.getFlag?.("dnd5e", "summon.activity") ?? "") ?? null;
  const duration = activity?.duration?.units ? activity.duration : item.system?.duration;
  if ( !duration?.units ) return null;
  if ( activity?.duration?.concentration || item.requiresConcentration || item.system?.properties?.has?.("concentration") ) return null;
  return { value: duration.value, units: duration.units };
}

/**
 * §16.39: a creature summoned by an item that declares `summon.lasts` gets its end time (`flags["dnd5e-combat"].expiresAt`,
 * world time in seconds). §198: without `summon.lasts`, the spell's own duration when it has no Concentration. Active GM. Returns
 * the time noted, or null.
 */
export async function noteSummonExpiry(tokenDoc, now=game.time.worldTime) {
  const item = summonItemOf(tokenDoc);
  // §305: a summon that leaves at the Long Rest (Wild Companion) has no end time.
  if ( item && (summonRuleOf(item)?.endsOnLongRest === true) ) return null;
  const lasts = item ? (summonRuleOf(item)?.lasts ?? ownDurationOf(tokenDoc, item)) : null;
  if ( !lasts ) return null;
  // §107: a familiar recalled from its pocket dimension keeps the end time noted at its summoning.
  if ( Number.isFinite(tokenDoc.getFlag(MODULE_ID, "expiresAt")) ) return null;
  let value = Number(lasts.value);
  if ( !Number.isFinite(value) ) {
    try { value = Roll.safeEval(Roll.replaceFormulaData(String(lasts.value), item.getRollData?.() ?? {}, { missing: 0 })); }
    catch { return null; }
  }
  const at = expiryTime(now, { value, units: lasts.units }, readTimeFactors());
  if ( at === null ) return null;
  await tokenDoc.setFlag(MODULE_ID, "expiresAt", at);
  return at;
}

/** The summoned tokens whose end time has passed, on all scenes. */
export function expiredSummons(now=game.time.worldTime) {
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      const at = token.getFlag(MODULE_ID, "expiresAt");
      if ( Number.isFinite(at) && (at <= now) ) out.push(token);
    }
  }
  return out;
}

/**
 * §230: the summons that a new one replaces — those of the same item (`flags.dnd5e.summon.origin`,
 * documents/activity/summon.mjs:264), created before it, on all scenes, when the item's content says `summon.replaces`
 * (Find Steed). Active GM.
 * @param {TokenDocument} tokenDoc  The token that has just been created.
 * @returns {TokenDocument[]}
 */
export function replacedSummons(tokenDoc) {
  const origin = tokenDoc?.actor?.getFlag?.("dnd5e", "summon.origin");
  const item = origin ? fromUuidSync(origin, { strict: false }) : null;
  if ( !item || (summonRuleOf(item)?.replaces !== true) ) return [];
  const born = tokenDoc._stats?.createdTime ?? Infinity;
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( (token === tokenDoc) || (token.id === tokenDoc.id) ) continue;
      if ( token.actor?.getFlag?.("dnd5e", "summon.origin") !== origin ) continue;
      if ( (token._stats?.createdTime ?? 0) < born ) out.push(token);
    }
  }
  return out;
}

/** The item that summoned this token, or null. */
export function summonItemOf(tokenDoc) {
  const uuid = tokenDoc?.actor?.getFlag?.("dnd5e", "summon.origin");
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
}

/**
 * O8f (§349): a `summon.hostile` summon ("The Skull", Scroll of Titan Summoning) — Hostile token, and the summoned actor
 * (the world's, which an unlinked token inherits) no longer belongs to any player: dnd5e creates it in the summoner's name.
 * Active GM. Returns true if done.
 */
export async function makeSummonHostile(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  if ( summonRuleOf(item)?.hostile !== true ) return false;
  const hostile = CONST.TOKEN_DISPOSITIONS.HOSTILE;
  if ( tokenDoc.disposition !== hostile ) await tokenDoc.update({ disposition: hostile });
  const actor = (tokenDoc.actorLink === false) ? (tokenDoc.baseActor ?? game.actors.get(tokenDoc.actorId)) : tokenDoc.actor;
  if ( actor && !actor.pack ) {
    const ownership = Object.fromEntries(Object.entries(actor.ownership ?? {})
      .map(([id, level]) => [id, ((id === "default") || !game.users.get(id)?.isGM) ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE : level]));
    if ( Object.entries(ownership).some(([id, level]) => actor.ownership[id] !== level) ) await actor.update({ ownership });
  }
  return true;
}

/** L'effet de concentration de l'invocateur sur cet item, ou null. */
export function concentrationOn(item) {
  const actor = item?.actor;
  for ( const effect of actor?.effects ?? [] ) {
    if ( !effect.statuses?.has?.("concentrating") ) continue;
    const data = effect.getFlag("dnd5e", "item") ?? {};
    if ( (data.id === item.id) || (data.data?._id === item.id) ) return effect;
  }
  return null;
}

/**
 * Attaches a summoned creature to its summoner's Concentration. Returns the effect, or null (no Concentration).
 * @param {TokenDocument} tokenDoc
 */
export async function tieSummonToConcentration(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const effect = concentrationOn(item);
  if ( !effect ) return null;
  // §16.15: `endsSpell` — removing this item will end Concentration (runtime/pilot.mjs). Noted on the token: at its
  // deletion, the synthetic actor of an unlinked token is no longer reliable.
  const summon = summonRuleOf(item) ?? {};
  await tokenDoc.update({ [`flags.${MODULE_ID}`]: { summonedBy: effect.uuid,
    ...(summon.endsSpell ? { endsSpell: true } : {}), ...(summon.endsAtZero ? { endsAtZero: true } : {}) } });
  return effect;
}

/** Removes the summoned creatures that a Concentration effect that has just ended maintained (and their combatants). */
export async function removeSummonsOf(effectUuid) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const tokens = scene.tokens.filter(t => t.getFlag(MODULE_ID, "summonedBy") === effectUuid);
    if ( !tokens.length ) continue;
    const ids = new Set(tokens.map(t => t.id));
    for ( const combat of game.combats ) {
      const gone = combat.combatants.filter(c => (c.sceneId === scene.id) && ids.has(c.tokenId)).map(c => c.id);
      if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
    }
    await scene.deleteEmbeddedDocuments("Token", [...ids]);
    removed += ids.size;
  }
  return removed;
}

/**
 * Puts a summoned creature in the combat where its summoner is, according to the item's content (`summon.initiative`):
 * `after` = right after them; `own` = it rolls its own Initiative. Returns the combatant, or null.
 * @param {TokenDocument} tokenDoc
 */
export async function joinSummonerCombat(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = summonRuleOf(item);
  if ( !rule || (rule.initiative === "none") ) return null;
  const summoner = item.actor;
  const combat = game.combats.find(c => c.started && c.combatants.some(x => x.actor === summoner)
    && ((c.scene === tokenDoc.parent) || !c.scene));
  if ( !combat || combat.combatants.some(c => c.tokenId === tokenDoc.id) ) return null;
  const mine = combat.combatants.find(c => c.actor === summoner);
  const data = { tokenId: tokenDoc.id, sceneId: tokenDoc.parent.id, actorId: tokenDoc.actorId, hidden: tokenDoc.hidden };
  if ( (rule.initiative === "after") && Number.isFinite(mine?.initiative) ) {
    const others = combat.combatants.filter(c => c !== mine).map(c => c.initiative);
    data.initiative = initiativeAfter(mine.initiative, others);
  }
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [data]);
  if ( combatant && (rule.initiative === "own") ) await combat.rollInitiative([combatant.id]);
  return combatant ?? null;
}
