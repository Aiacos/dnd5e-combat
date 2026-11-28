/**
 * The FACTS a registry condition can be about (core/triggers.mjs), read from
 * dnd5e 6.0. Kept apart from the declarations so that content validation (adapter/content.mjs)
 * knows the keys without depending on the registry.
 *
 * Verified in dnd5e 6.0.3:
 *  - an effect placed by the effects panel carries its origin in `system.origin`
 *    (`activity`, `item`, `effect`, `message`), and `ActiveEffect5e#prepareBaseData` turns it into
 *    `effect.origin` (documents/active-effect.mjs:332-335): the item an effect comes from can be found,
 *    hence its identifier and its actor.
 */

import { areaShapeOf } from "../core/area-shield.mjs";
import { seesBetween, canSee } from "./vision.mjs";
import { chargedFeet } from "./variants.mjs";
import { lightOnToken, inSunlight } from "./illumination.mjs";
import { inRunningWater } from "./running-water.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { contentOf, identifierOf, enchantmentSourcesOf, hasClassFeature } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { isWithinRange } from "../core/units.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { speedIsZero } from "../core/movement.mjs";
import { subtypeMatches } from "../core/eligibility.mjs";
import { isDeadActor } from "./death.mjs";
import { spellClassOf } from "./spell-class.mjs";
import { isObjectToken } from "./bodies.mjs";
import { hasNotActedYet } from "../core/sneak.mjs";
import { isSpellCast, spellSchoolOf, scrollSpellOf } from "./scrolls.mjs";
import { knownCastLevel, castLevelAtMost, castLevelAtLeast } from "../core/counter.mjs";
import { grapplerOf } from "./grapple.mjs";
import { areEnemies, areAllies } from "./factions.mjs";
import { isVanilla } from "./vanilla-state.mjs";
import { wearsArmor } from "../core/armor.mjs";
import { attackedMatches } from "../core/attacked-this-turn.mjs";
import { attackedDuring } from "./attacked-this-turn.mjs";

/** §484: does this token stand in Bright Light (torch, spell, daylight)? Without a token: no. */
const isBright = doc => !!doc && (lightOnToken(doc)?.level === LIGHT.BRIGHT);
/** Issue #69, block 6: the light where the token stands is this level (dim, darkness). No token or no ready scene: false. */
const isLit = (doc, level) => !!doc && (lightOnToken(doc)?.level === level);

/**
 * §491: the armor pieces the actor wears (equipped `equipment` items of type light / medium / heavy / shield; dnd5e config.mjs
 * `armorTypes`), described for `wearsArmor` (core/armor.mjs): category, base armor (`system.type.baseItem`, key of `armorIds`),
 * identifier, and the material imposed by the item (`flags["dnd5e-combat"].metal`).
 */
export function armorPieces(actor) {
  return (actor?.items ?? []).filter(i => (i.type === "equipment") && i.system?.equipped).map(i => {
    const metal = i.flags?.["dnd5e-combat"]?.metal;
    return { category: i.system.type?.value ?? null, base: i.system.type?.baseItem || null, identifier: i.system.identifier ?? null,
      ...(typeof metal === "boolean" ? { metal } : {}) };
  });
}

/** dnd5e size ranks (config.mjs, `actorSizes`), for "Large or smaller". */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/** An actor's token on the current scene: the one given, otherwise its linked token, otherwise the first placed. */
export function tokenOf(actor, given=null) {
  if ( given ) return given;
  if ( !actor ) return null;
  if ( actor.token ) return actor.token;
  return actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/**
 * §232: the item that encloses this actor (Otiluke's Resilient Sphere, content `encloses`) — one of its Active Effects comes
 * from it — or null.
 * @param {Actor|null} actor
 * @returns {Item|null}
 */
export function enclosingItem(actor) {
  for ( const effect of actor?.effects ?? [] ) {
    // The caster's Concentration also comes from the item: it does not enclose them.
    if ( effect.disabled || effect.isSuppressed || effect.statuses?.has?.("concentrating") ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.encloses === true) ) return item;
  }
  return null;
}

/**
 * §232: the sphere that separates two actors — one of theirs when they are not the same ("nothing passes through it, in either
 * direction"), or null.
 * @returns {Item|null}
 */
export function enclosureBetween(a, b) {
  if ( !a || !b || (a === b) ) return null;
  return enclosingItem(a) ?? enclosingItem(b);
}

/** The item an effect placed on an actor comes from, or null. */
export function originItemOf(effect) {
  const origin = effect.system?.origin ?? {};
  const uuid = origin.activity ?? origin.item ?? effect.origin;
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  // §93: an origin left by the data toward the COMPENDIUM item (Ravenloft: `origin` written in the pack's effect) — which
  // `fromUuidSync` only resolves if it is already cached, and which is in any case not the actor's item. The effect placed from
  // the sheet's item keeps a trace of it (`_stats.duplicateSource`, the effect of that item): that is what is followed.
  if ( !doc || doc.pack ) {
    // §438: the Handbook 3.0.0 writes `system.origin.item` = the COMPENDIUM item in its effects, which a copy keeps (dnd5e only
    // rewrites it when it applies the effect itself, through the activity). The origin written on the effect (`origin` of the
    // source: dnd5e 6.1 replaces it in the prepared data with `system.origin`) says which sheet item placed it.
    const own = effect._source?.origin;
    const written = (own && (own !== uuid)) ? fromUuidSync(own, { strict: false }) : null;
    const writtenItem = written ? (written.documentName === "Item" ? written : (written.item ?? null)) : null;
    if ( writtenItem && !writtenItem.pack ) return writtenItem;
    const copied = effect._stats?.duplicateSource ? fromUuidSync(effect._stats.duplicateSource, { strict: false }) : null;
    const owner = copied?.parent;
    if ( owner?.documentName === "Item" && !owner.pack ) return owner;
  }
  // An effect placed by an activity's area (`zoneEffects`) has the behavior of its region as origin: the region carries
  // the activity that placed it (`flags.dnd5e.activity`), hence the item (Magic Circle: the mark of whoever stands in the circle).
  if ( ["Region", "RegionBehavior"].includes(doc?.documentName) ) {
    const region = (doc.documentName === "Region") ? doc : doc.parent;
    const placed = fromUuidSync(region?.getFlag?.("dnd5e", "activity") ?? "", { strict: false });
    return placed?.item ?? null;
  }
  if ( doc ) return doc.documentName === "Item" ? doc : (doc.item ?? null);
  // §53: the item no longer exists (a potion drunk, the last of its stack) — dnd5e keeps a copy of the destroyed item in the use
  // message (`deltas.deleted`, documents/chat-message.mjs `getAssociatedItem`), which the effect references.
  if ( uuid && origin.message ) {
    // `origin.message` is a uuid ("ChatMessage.<id>"), seen in play on 2026-10-02.
    const stored = game.messages?.get(String(origin.message).split(".").pop())?.getAssociatedItem?.();
    if ( stored?.documentName === "Item" ) return stored;
  }
  // An effect transferred by an actor's item (feat, equipped object) lives on the item itself.
  return effect.parent?.documentName === "Item" ? effect.parent : null;
}

/**
 * §485: the effects the actor carries and whose save it can replay (Indomitable: "an effect or condition that affects it […]
 * without effect if that effect or condition did not result from a failed saving throw"). An Active Effect placed by a save
 * activity (`system.origin.activity`; for an effect placed by a chained save attack, the save of its item, like
 * `saveActivityOf` of runtime/triggers.mjs), coming from ANOTHER actor — neither its own Concentration, nor its own effects, nor
 * an effect that the activity places on a successful save (`onSave`), nor an effect left to dnd5e (§395).
 * @returns {Array<{effect: ActiveEffect, activity: Activity}>}
 */
export function savableEffectsOf(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || isVanilla(effect) ) continue;
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const uuid = effect.system?.origin?.activity ?? null;
    const origin = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    const item = origin?.item ?? originItemOf(effect);
    if ( !item || (item.actor === actor) ) continue;
    const activity = (origin?.type === "save") ? origin
      : (Array.from(item.system?.activities ?? []).find(a => a.type === "save") ?? null);
    if ( !activity ) continue;
    const applied = (activity.effects ?? []).find(e => comesFromItemEffect(effect, e._id ?? e.id));
    if ( applied?.onSave === true ) continue;
    out.push({ effect, activity });
  }
  return out;
}

/**
 * §16.36: does the actor carry an Active Effect from an item that prevents it from benefiting from the Invisible condition
 * ("Star Dust", Faerie Fire: `revealsInvisible`)? Only if it is Invisible — otherwise there is nothing to remove.
 */
export function revealedInvisible(actor, observer=null) {
  if ( !actor?.statuses?.has?.("invisible") ) return false;
  if ( knownTo(actor, observer) ) return true;   // §284: Mind Spike, against its caster only
  for ( const effect of actor.appliedEffects ?? actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.revealsInvisible === true) ) return true;
  }
  return false;
}

/**
 * §284: has `observer` (actor) cast on `actor` an Active Effect from a `knownToOrigin` item (Mind Spike: "you always know where it
 * is; it cannot Hide from you, and the Invisible condition gives it nothing against you")?
 */
export function knownTo(actor, observer) {
  if ( !actor || !observer || (actor === observer) ) return false;
  for ( const effect of actor.appliedEffects ?? actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.knownToOrigin === true) && (item.actor?.uuid === observer.uuid) ) return true;
  }
  return false;
}

/**
 * §161: does the observer see Invisible creatures (See Invisibility: "you see Invisible creatures and objects as if they were
 * visible") — an Active Effect from an item with `seesInvisible` content?
 */
export function seesInvisible(actor) {
  // §306: a special sense that names Invisible creatures (Third Eye, See Invisibility option: "Invisible creatures").
  if ( /invisib/i.test(actor?.system?.attributes?.senses?.special ?? "") ) return true;
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.seesInvisible === true) ) return true;
  }
  return false;
}

/**
 * §353: does the ranged attack made with this weapon target its sworn enemy (`swornEnemy`: Oathbow) — a target that carries
 * the `swornEnemy.effect` effect from this weapon? Returns the weapon's name, or null.
 */
export function swornEnemyOf(activity, targetToken, attackMode=null) {
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.swornEnemy : null;
  if ( !rule || (activity.type !== "attack") ) return null;
  const ranged = (activity.attack?.type?.value === "ranged") || (attackMode?.startsWith?.("thrown") === true);
  if ( !ranged ) return null;
  const actor = targetToken?.actor;
  const marked = (actor?.effects ?? []).some(e => !e.disabled && comesFromItemEffect(e, rule.effect) && (originItemOf(e) === item));
  return marked ? item.name : null;
}

/**
 * §438: the activity of the origin item that placed this effect, when it can be found — the origin written by dnd5e
 * (`system.origin.activity`, then `profile`: effect-application.mjs `_prepareEffectData`), otherwise the copied source (`_stats`)
 * compared with the effects of each activity (item effect, or `Compendium…` remote effect of the Handbook 3.0.0 placed by
 * `placeRemoteEffect`).
 * @returns {string|null}
 */
export function originActivityIdOf(effect, item) {
  const activities = item?.system?.activities;
  if ( !effect || !activities ) return null;
  const origin = effect.system?.origin ?? {};
  const fromUuid = typeof origin.activity === "string" ? origin.activity.split(".").pop() : null;
  if ( fromUuid && activities.get?.(fromUuid) ) return fromUuid;
  const stats = effect._stats ?? {};
  const sources = [stats.duplicateSource, stats.compendiumSource].filter(u => typeof u === "string");
  for ( const activity of activities ) {
    for ( const ref of activity.effects ?? [] ) {
      if ( origin.profile && (ref._id === origin.profile) ) return activity.id;
      const uuid = ref.uuid ?? ref.effect?.uuid ?? null;
      if ( uuid && sources.includes(uuid) ) return activity.id;
      if ( sources.some(u => u.endsWith(`.ActiveEffect.${ref._id}`)) ) return activity.id;
    }
  }
  return null;
}

/**
 * Does the effect come from the item effect of this id? dnd5e's effects panel copies the item effect keeping its source
 * (`_stats.duplicateSource`, or `compendiumSource` from a compendium: effect-application.mjs, `_prepareEffectData`).
 */
export function comesFromItemEffect(effect, id) {
  if ( effect.id === id ) return true;
  const stats = effect._stats ?? {};
  return [stats.duplicateSource, stats.compendiumSource].some(uuid => typeof uuid === "string" && uuid.endsWith(`.ActiveEffect.${id}`));
}

/**
 * Does the actor carry an Active Effect coming from an item with this identifier — and, if `source` is given, from that actor?
 * `spec`: the identifier, or `{ item, effect }` for ONE effect of the item (§37: Bestow Curse — "Cursed Resilience", not the
 * other curses of the same spell).
 */
/** §95 : l'acteur porte-t-il un effet actif d'un item de cet identifiant (Forme d'effroi, Courroux sauvage) ? */
export const carriesEffectFrom = (actor, identifier) => hasEffectFrom(actor, identifier);

function hasEffectFrom(actor, spec, source=null) {
  const identifier = (typeof spec === "string") ? spec : spec?.item;
  const effectId = (typeof spec === "string") ? null : (spec?.effect ?? null);
  // `appliedEffects` (core): the actor's effects AND those its items transfer to it — dnd5e 6 no longer copies
  // the latter into `actor.effects` (seen on 2026-09-25, scenario `degats-bonus`).
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( effectId && !comesFromItemEffect(effect, effectId) ) continue;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== identifier) ) continue;
    if ( !source || (item.actor?.uuid === source.uuid) ) return true;
  }
  // §447: an active enchantment on an item of the actor counts too ("Savage Wrath": the transformation profile, enabled on the
  // item itself, runtime/enchant.mjs — dnd5e never transfers an effect cited by an activity, it is not in `appliedEffects`).
  for ( const owned of actor?.items ?? [] ) {
    for ( const effect of owned.effects ?? [] ) {
      if ( (effect.type !== "enchantment") || effect.disabled ) continue;
      if ( effectId && !comesFromItemEffect(effect, effectId) ) continue;
      const item = originItemOf(effect) ?? owned;
      if ( identifierOf(item).id !== identifier ) continue;
      if ( !source || (item.actor?.uuid === source.uuid) ) return true;
    }
  }
  return false;
}

/** "Within 10 ft" between two tokens (3D, grid unit), or null if one is missing. */
function within(a, b, { distance, units }) {
  if ( !a || !b || (a.parent !== b.parent) ) return null;
  try { return isWithinRange(distanceBetween(a, b), { value: distance, units }, readUnitFactors()); }
  catch { return null; }
}

/**
 * Pack Tactics: "at least one ally of the attacker within 5 ft of the target, who is not Incapacitated".
 * Ally = same side (token disposition), other than the attacker, on the same scene, neither defeated nor hidden.
 */
function allyNear(sourceToken, targetToken, range) {
  if ( !sourceToken || !targetToken || (sourceToken.parent !== targetToken.parent) ) return null;
  for ( const other of sourceToken.parent.tokens ) {
    if ( (other === sourceToken) || (other === targetToken) || !other.actor || other.hidden ) continue;
    if ( isObjectToken(other) ) continue;   // a controlled object or ground pile is not an ally (§16.15, §16.60)
    if ( !areAllies(other, sourceToken) ) continue;
    const statuses = other.actor.statuses ?? new Set();
    if ( INCAPACITATING.some(s => statuses.has(s)) || statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    if ( within(other, targetToken, range) === true ) return true;
  }
  return false;
}

/**
 * Duplicity (§16.18): is an object summoned by the source with item `item` within `distance` of the target, and does the target
 * see it (without simulated vision, taken as seen)?
 */
function summonNear(source, targetToken, { item, distance, units }={}) {
  if ( !source || !targetToken ) return null;
  for ( const token of targetToken.parent.tokens ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin");
    if ( !origin || token.hidden ) continue;
    const from = fromUuidSync(origin, { strict: false });
    if ( (from?.actor?.uuid !== source.uuid) || (item && (identifierOf(from).id !== item)) ) continue;
    if ( within(token, targetToken, { distance, units }) !== true ) continue;
    if ( canSee(targetToken, token) === false ) continue;
    return true;
  }
  return false;
}

/**
 * Assassinate (§20): in the first round of the current combat, has the target not yet played its turn? Out of combat: no.
 * The target's rank is that of its token in the combat order (`combat.turns`).
 */
function notActedYet(targetToken) {
  const combat = game.combat;
  if ( !combat?.started || !targetToken ) return false;
  const index = combat.turns.findIndex(c => (c.tokenId === targetToken.id) && (c.sceneId === targetToken.parent?.id));
  return hasNotActedYet({ round: combat.round, turn: combat.turn, targetTurn: (index < 0) ? null : index });
}

/** The damage types an activity can deal: its parts, and the base damage of the weapon it takes over. */
function damageTypesOf(activity) {
  const out = new Set();
  for ( const part of activity?.damage?.parts ?? [] ) for ( const t of part.types ?? [] ) out.add(t);
  if ( activity?.damage?.includeBase ) for ( const t of activity.item?.system?.damage?.base?.types ?? [] ) out.add(t);
  return Array.from(out);
}

/** An actor's prepared speeds (`movement.speeds` in dnd5e 6, `movement` before), or null. */
function movementSpeedsOf(actor) {
  const movement = actor?.system?.attributes?.movement;
  return movement ? (movement.speeds ?? movement) : null;
}

/** Is it this actor's turn in the current combat? Out of combat: no. */
function ownTurn(actor) {
  const current = game.combat?.started ? game.combat.combatant?.actor : null;
  return !!current && !!actor && (current.uuid === actor.uuid);
}

/** An actor's HP and their current maximum (`effectiveMax`: max + tempmax, data/actor/templates/attributes.mjs:468). */
function hpOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return null;
  return { value: hp.value ?? 0, max: hp.effectiveMax ?? ((hp.max ?? 0) + (hp.tempmax ?? 0)) };
}
export const isWounded = actor => { const hp = hpOf(actor); return !!hp && (hp.max > 0) && (hp.value < hp.max); };
const isBloodied = actor => { const hp = hpOf(actor); return !!hp && (hp.max > 0) && (hp.value > 0) && (hp.value <= hp.max / 2); };

/** An actor's creature type ("undead", "fiend"…), as dnd5e stores it in `details.type.value`. */
export const creatureTypeOf = actor => actor?.system?.details?.type?.value ?? null;
/** Is the creature's subtype this one (or one of these)? Case-insensitive; without a subtype: no. */
const subtypeIs = (actor, want) => subtypeMatches(actor?.system?.details?.type?.subtype, want);

/** Does the actor know a language, or is it telepathic (dnd5e `traits.languages`: languages, free text, telepathy)? */
export function speaksLanguage(actor) {
  const languages = actor?.system?.traits?.languages;
  if ( !languages ) return false;
  return ((languages.value?.size ?? 0) > 0) || !!languages.custom || (Number(languages.communication?.telepathy?.value ?? 0) > 0);
}

/** Does one of the actor's natural attacks deal poison damage (venomous creature)? The weapon, and its attacks. */
export function isPoisonous(actor) {
  const poison = types => (types?.has?.("poison") ?? types?.includes?.("poison")) === true;
  const attacksWithPoison = item => Array.from(item.system.activities ?? [])
    .some(a => (a.type === "attack") && (a.damage?.parts ?? []).some(p => poison(p.types)));
  return Array.from(actor?.items ?? []).some(item => (item.type === "weapon") && (item.system?.type?.value === "natural")
    && (poison(item.system.damage?.base?.types) || attacksWithPoison(item)));
}

/**
 * Does the actor carry magic: a magical Active Effect (dnd5e 6.1's `system.magical` mark, which the engine also places),
 * or a magic item (property `mgc`) it carries on its person — equipped, or simply carried outside a container (a potion on the
 * belt, a wand, a ring not yet put on)? What a Detect Magic shows on a visible creature.
 * A magic item stowed in a bag is not visible: no aura for it.
 */
export function carriesMagic(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( !effect.disabled && !effect.isSuppressed && (effect.system?.magical === true) ) return true;
  }
  const magic = properties => (properties?.has?.("mgc") ?? properties?.includes?.("mgc")) === true;
  return Array.from(actor?.items ?? []).some(item => magic(item.system?.properties)
    && ((item.system?.equipped === true) || !item.system?.container));
}

/** The conditions an actor is immune to (dnd5e `traits.ci`: "charmed", "exhaustion"…). */
export const conditionImmunitiesOf = actor => Array.from(actor?.system?.traits?.ci?.value ?? []);

/**
 * §268: the conditions an actor is immune to against this source — its own, plus those that an effect it carries wards off when the
 * source is of a given type (`wardsConditions`: Protection from Evil and Good, "the target can't be Charmed or Frightened by
 * them"). With no known source: its own.
 */
export function conditionImmunitiesAgainst(actor, source) {
  const own = conditionImmunitiesOf(actor);
  const type = source ? creatureTypeOf(source) : null;
  if ( !type ) return own;
  const warded = (actor?.effects ?? []).filter(e => !e.disabled && !e.isSuppressed).flatMap(e => {
    const rule = contentOf(originItemOf(e)).entry?.wardsConditions;
    return (rule && rule.types.includes(type)) ? rule.statuses : [];
  });
  return [...new Set([...own, ...warded])];
}

/**
 * §279: the kind of a weapon attack, for rules that name a list of them — "unarmed" (unarmed strike, classified so by
 * dnd5e: `attack.type.classification`), otherwise dnd5e's weapon type (`simpleM`, `martialM`, `natural`, `improv`…).
 */
export function weaponKind(activity) {
  if ( activity?.attack?.type?.classification === "unarmed" ) return "unarmed";
  return activity?.item?.system?.type?.value ?? null;
}

/**
 * §481: the casting level of a spell for the `spell.*` facts — the one the moment knows (`castLevel`), otherwise the one the
 * item carries: dnd5e scales the copy of a message's spell (`getAssociatedItem({ scaled: true })`,
 * documents/chat-message.mjs:719, `scaledClone` → `flags.dnd5e.scaling`, documents/item.mjs:531), a spell cast by a "cast"
 * activity takes its level (`linkedActivity.spell.level`), a scroll its own.
 */
function castLevelKnown(activity, castLevel) {
  const item = activity?.item;
  const scroll = (item && (item.type !== "spell")) ? scrollSpellOf(item) : null;
  return knownCastLevel({
    castLevel, isSpell: (item?.type === "spell") || !!scroll,
    level: scroll ? scroll.level : item?.system?.level,
    scaling: Number(item?.flags?.dnd5e?.scaling) || 0,
    linkedLevel: item?.system?.linkedActivity?.spell?.level ?? null
  });
}

/**
 * A moment's facts. `source`: who acts; `target`: who is affected; `activity`: what is used;
 * `sourceToken` / `targetToken`: their tokens when the moment knows them (otherwise found through the actor).
 * `castLevel`: the level the spell is cast at, when the moment knows it (carries `castsSpell`, §481).
 * `turnKey`: the turn the "this turn" facts are about (§492: the turn that just ended, at `enemyTurnEnd`); else the current turn.
 * A key absent here is unknown to the core, and a condition that uses it never holds.
 */
/** §505: do two tokens overlap (at least one cell in common), on the same scene? */
export function sharesSpace(a, b) {
  const A = a?.document ?? a;
  const B = b?.document ?? b;
  if ( !A || !B || (A === B) || (A.parent !== B.parent) || !A.parent?.grid ) return false;
  const grid = A.parent.grid;
  const box = t => ({ x: t._source.x, y: t._source.y, w: (t._source.width ?? 1) * grid.sizeX, h: (t._source.height ?? 1) * grid.sizeY });
  const p = box(A);
  const q = box(B);
  const eps = 1;
  return (p.x < q.x + q.w - eps) && (q.x < p.x + p.w - eps) && (p.y < q.y + q.h - eps) && (q.y < p.y + p.h - eps);
}

export function factsFor({ source=null, target=null, activity=null, sourceToken=null, targetToken=null, attackMode=null, damageTypes=null, condition=null, self=null, selfToken=null, resolution=null, castLevel=null, turnKey=null }={}) {
  const properties = activity?.item?.system?.properties;
  const spellLevel = castLevelKnown(activity, castLevel);
  // "A melee attack": attack activity of melee type, except a roll in thrown or ranged mode
  // (same rule as dnd5e, data/activity/attack-data.mjs, `getRollData`: `roll.attack.type`).
  const ranged = !!attackMode && (attackMode.includes("thrown") || (attackMode === "ranged"));
  const isMelee = (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !ranged;
  return {
    "activity.type": activity?.type ?? null,
    "activity.isAttack": activity?.type === "attack",
    "activity.isSpell": isSpellCast(activity?.item),   // §48: a scroll too
    "activity.isWeapon": activity?.item?.type === "weapon",
    "activity.isMelee": isMelee,
    // §279 : le genre d'arme (`weaponKind` : "unarmed", "simpleM", "martialM", "improv"…), null hors arme — { "activity.weaponKind": ["unarmed", "simpleM"] }.
    "activity.weaponKind": weaponKind(activity),
    // The base weapon (`system.type.baseItem`: "longbow", "shortbow"…), null for a non-weapon or without a base — a magic weapon
    // keeps its own, whatever its name: { "activity.baseItem": ["longbow", "shortbow"] } (Bracers of Archery).
    "activity.baseItem": ((activity?.item?.type === "weapon") && activity.item.system?.type?.baseItem) || null,
    "activity.identifier": activity?.item ? identifierOf(activity.item).id : null,
    "activity.id": activity?.id ?? null,
    // §493 (B13): the shape of the activity's area ("cone", "line", "sphere"…), null without an area —
    // { "activity.areaShape": ["cone", "line"] }.
    "activity.areaShape": areaShapeOf(activity),
    // §32: a spell of this class (Innate Sorcery: "Sorcerer spells") — the spell's class (`spellClassOf`), or the actor's.
    "activity.classSpell": cls => (activity?.item?.type === "spell")
      && ((spellClassOf(activity.item) || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
    // §32: the actor resists this damage type (Elemental Affinity: the chosen type is that of the resistance granted).
    "source.resists": type => (source?.system?.traits?.dr?.value?.has?.(type) ?? source?.system?.traits?.dr?.value?.includes?.(type)) === true,
    // §29: the item carries an enchantment coming from an item with this identifier (pact weapon: "pact-of-the-blade"; Repelling
    // Blast placed on Eldritch Blast: "repelling-blast").
    // O5b (§340): the origin object also found by the id of the enchantment effect, when it is no longer on the sheet
    // (adapter/content.mjs).
    "activity.enchantedBy": id => (activity?.item?.effects ?? []).some(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment"))
      && (identifierOf(originItemOf(e) ?? {}).id === id)) || enchantmentSourcesOf(activity?.item).includes(id),
    // §28: a spell's school (`system.school`: "evo" Evocation, "abj" Abjuration…) — "Improved Evocation".
    "activity.school": spellSchoolOf(activity?.item),   // §48: that of a scroll's spell
    // §481: the level the spell is cast at (null outside a spell) — "a spell of level 3 or lower":
    // { "spell.castLevelAtMost": 3 }.
    "spell.castLevel": spellLevel,
    "spell.castLevelAtMost": n => castLevelAtMost(spellLevel, n),
    "spell.castLevelAtLeast": n => castLevelAtLeast(spellLevel, n),
    // §27: "any Cleric cantrip" (Potent Spellcasting) — a cantrip filed under this class (`spellClassOf`);
    // a spell added by hand has none: it counts if the actor has this class.
    "activity.cantripOf": cls => (activity?.item?.type === "spell") && (Number(activity.item.system.level) === 0)
      && ((spellClassOf(activity.item) || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
    // §24: "its damage counts as bludgeoning, piercing, or slashing damage" (Parry) — the types of the activity's parts,
    // and those of the weapon if it takes them over. With no known activity (pre-check "can it react?", runtime/reactions.mjs,
    // `canReactToHit`), it is taken as yes: the real window knows the attack.
    "activity.dealsType": types => !activity || damageTypesOf(activity).some(t => [types].flat().includes(t)),
    // Item property (dnd5e keys: "hvy" Heavy, "two" Two-Handed, "fin" Finesse, "sil" Silvered…).
    "activity.hasProperty": id => (properties?.has?.(id) ?? properties?.includes?.(id)) === true,
    // A condition, or one of a list (`["grappled", "restrained"]`): the form given by the header of core/triggers.mjs.
    "source.hasStatus": id => [id].flat().some(s => source?.statuses?.has(s) === true),
    "source.hasEffect": id => hasEffectFrom(source, id),
    // §30: under a Wild Shape (dnd5e: the polymorphed actor, `isPolymorphed`) — Primal Strike, "Lunar Form".
    "source.wildShaped": want => (!!source?.isPolymorphed === want),
    // §26: "the die of your Hunter's Mark becomes a d10" ("Relentless Slayer") — does the actor have an item with this identifier?
    "source.hasFeature": id => (source?.items ?? []).some(i => identifierOf(i).id === id),
    // §431: the actor has an item with this identifier (or one of them) granted by this class — `potent-spellcasting`, shared
    // by the Cleric and the Druid in dnd5e 6.1's SRD: { "source.hasClassFeature": { id: "potent-spellcasting", class: "cleric" } }.
    "source.hasClassFeature": ({ id, class: cls }={}) => hasClassFeature(source, id, cls),
    // §302: the target has an item with this identifier (Trance: "does not sleep").
    "target.hasFeature": id => (target?.items ?? []).some(i => identifierOf(i).id === id),
    // §302: the attack's ability (dnd5e: `activity.ability`, the best one for a Finesse weapon) — Ray of Enfeeblement.
    "activity.ability": id => [id].flat().includes(activity?.ability ?? null),
    "target.hasStatus": id => [id].flat().some(s => target?.statuses?.has(s) === true),
    "target.hasEffect": id => hasEffectFrom(target, id),
    "target.hasEffectFrom": id => hasEffectFrom(target, id, source),
    // K1 (§334): the target carries this mark (temporary immunity after a success: `immune:<identifiant>`).
    "target.hasMark": mark => (target?.effects ?? []).some(e => e.flags?.["dnd5e-combat"]?.mark === mark),
    // §133: the targeted creature wields a weapon equipped with this property (Defensive Duelist: "Finesse"); it is the
    // reactor itself (Protection: "a target other than you"); the reactor carries a shield.
    // §135: the wounded creature resists one of the types of this damage (Boon of Energy Resistance: Energy Redirection).
    // §138: would the hit that just hit `target` become a miss with n more AC (Shield: +5)? Never on a Critical
    // Hit (a natural 20 always hits); with no known resolution (before the window), it is not ruled out.
    "hit.stoppableBy": n => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      const total = resolution?.attack?.roll?.total;
      if ( !hit || !Number.isFinite(total) ) return true;
      if ( hit.critical ) return false;
      const ac = Number.isFinite(hit.ac) ? hit.ac : (target?.system?.attributes?.ac?.value ?? 0);
      return total < ac + (hit.cover?.bonus ?? 0) + Number(n);
    },
    // O5c (§341): the hit that just hit `target` is a Critical Hit (Sword of Sharpness: "on a 20 on the d20").
    "hit.critical": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return !!hit?.critical === want;
    },
    // §489: the attack roll that just missed `target` is a natural 1 (critical miss) — the roll rerolled by a Parry if there was
    // one (`rerolled` of the target), otherwise the attack's. Riposte "if the new roll is a critical miss".
    "attack.fumble": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return ((hit?.rerolled ?? resolution?.attack?.roll)?.isFumble === true) === want;
    },
    // §489: the attacker had to reroll against `target` (step `reroll` of a reaction of the target).
    "attack.rerolled": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return !!hit?.rerolled === want;
    },
    "damage.resisted": want => ((damageTypes ?? []).some(t => target?.system?.traits?.dr?.value?.has?.(t) === true) === want),
    "target.wieldsProperty": prop => (target?.items ?? []).some(i => (i.type === "weapon") && i.system.equipped && i.system.properties?.has?.(prop)),
    "target.isSelf": want => (!!self && !!target && (self === target)) === want,
    // §301: a weapon (not a natural weapon) in hand — Interception: "you wield a shield or a Simple or Martial weapon".
    "self.wieldsWeapon": want => (self?.items ?? []).some(i => (i.type === "weapon") && i.system.equipped && ["simpleM", "simpleR", "martialM", "martialR"].includes(i.system.type?.value)) === want,
    // §491: the target wears armor — true / false (body armor), a category ("heavy", ["medium", "heavy"], "shield"), or
    // { material: "metal", category? } (Shocking Grasp, Heat Metal). Table of metal armors: core/armor.mjs.
    "target.wearsArmor": want => wearsArmor(armorPieces(target), want),
    "self.hasShield": want => (self?.items ?? []).some(i => (i.type === "equipment") && (i.system.type?.value === "shield") && i.system.equipped) === want,
    // §132: the target is Grappled by the attacker (Grappler: "Advantage on attack rolls against a creature you are grappling").
    // §334: the attacker charged the target at least this many feet in a straight line just before ("Tusks of the Elephant").
    // §334: the attacker stands in Bright Light (Sunlight Sensitivity, Light Sensitivity).
    "source.inBrightLight": want => ((!!sourceToken && (lightOnToken(sourceToken)?.level === LIGHT.BRIGHT)) === want),
    "source.inSunlight": want => ((!!sourceToken && inSunlight(sourceToken)) === want),
    // §484: the same facts on the creature itself (`self`: the bearer of the trait at the start of its turn, the one making a
    // check) and on the target — in sunlight, in Bright Light, in running water (marked region or scene,
    // adapter/running-water.mjs). Without a token: false.
    "source.inRunningWater": want => (inRunningWater(tokenOf(source, sourceToken)) === want),
    "self.inSunlight": want => ((!!tokenOf(self, selfToken) && inSunlight(tokenOf(self, selfToken))) === want),
    "self.inBrightLight": want => (isBright(tokenOf(self, selfToken)) === want),
    "self.inRunningWater": want => (inRunningWater(tokenOf(self, selfToken)) === want),
    "target.inSunlight": want => ((!!tokenOf(target, targetToken) && inSunlight(tokenOf(target, targetToken))) === want),
    "target.inBrightLight": want => (isBright(tokenOf(target, targetToken)) === want),
    "target.inRunningWater": want => (inRunningWater(tokenOf(target, targetToken)) === want),
    // Issue #69, block 6: the light where the attacker, the creature itself or the target stands — dim, or darkness (magical
    // Darkness included). The light of the place, not what anyone perceives of it: "Advantage against a target in dim light
    // or darkness" is written `any: [{ "target.inDimLight": true }, { "target.inDarkness": true }]`.
    "source.inDimLight": want => (isLit(tokenOf(source, sourceToken), LIGHT.DIM) === want),
    "source.inDarkness": want => (isLit(tokenOf(source, sourceToken), LIGHT.DARK) === want),
    "self.inDimLight": want => (isLit(tokenOf(self, selfToken), LIGHT.DIM) === want),
    "self.inDarkness": want => (isLit(tokenOf(self, selfToken), LIGHT.DARK) === want),
    "target.inDimLight": want => (isLit(tokenOf(target, targetToken), LIGHT.DIM) === want),
    "target.inDarkness": want => (isLit(tokenOf(target, targetToken), LIGHT.DARK) === want),
    "source.chargedFeet": feet => !!sourceToken && !!targetToken && (chargedFeet(sourceToken, targetToken) >= (Number(feet) || 0)),
    // §505 (B25): is the target within the source's space (a swarm that shares the cells of its victims) — both tokens
    // overlap on the same scene, validated positions (`_source`).
    "target.sharesSpaceWithSource": want => (sharesSpace(tokenOf(source, sourceToken), tokenOf(target, targetToken)) === want),
    "target.grappledBySource": want => ((target?.effects ?? []).some(e => e.statuses?.has?.("grappled") && (grapplerOf(e) === source)) === want),
    // §281: the reverse — the source is Grappled by the target (an enemy grappled by the reactor ends its turn: "Final Grip").
    "source.grappledByTarget": want => ((source?.effects ?? []).some(e => e.statuses?.has?.("grappled") && (grapplerOf(e) === target)) === want),
    // §37: the attacker carries an effect that the TARGET placed (Bestow Curse: "Disadvantage on attack rolls against you").
    "source.hasEffectFromTarget": id => hasEffectFrom(source, id, target),
    // Attacker's creature type (Protection from Evil and Good: Aberration, Celestial, Elemental, Fey, Fiend, Undead).
    "source.creatureType": creatureTypeOf(source),
    // §157: the attacker has one of these senses (dnd5e `senses.ranges`, data/shared/senses-field.mjs:15) — Blur: "a creature
    // with Blindsight or Truesight is not affected".
    // §164: is the target on the source's side (not hostile)? Summon Celestial: healing for allies, burning for enemies.
    "target.allied": want => {
      const s = tokenOf(source, sourceToken), t = tokenOf(target, targetToken);
      return (!!s && !!t && !areEnemies(s, t)) === want;
    },
    "source.hasSense": names => [names].flat().some(n => Number(source?.system?.attributes?.senses?.ranges?.[n]) > 0),
    // §16.8: the target's type ("humanoid"…) and its condition immunities (Sleep: immunity to Exhaustion).
    "target.creatureType": creatureTypeOf(target),
    // The target's subtype (dnd5e `details.type.subtype`: "Demon", "Devil"…), case-insensitive — Demon
    // Armor: "Disadvantage on attack rolls against demons".
    "target.creatureSubtype": want => subtypeIs(target, want),
    // Declared senses (`sense.detects`): the target knows a language or is telepathic; it is venomous.
    "target.speaksLanguage": want => (speaksLanguage(target) === want),
    "target.poisonous": want => (isPoisonous(target) === want),
    "target.carriesMagic": want => (carriesMagic(target) === want),
    "target.immuneTo": id => conditionImmunitiesOf(target).includes(id),
    // Armor of Agathys: "while you have these Temporary Hit Points". { "target.hasTempHp": true | false }.
    "target.hasTempHp": want => (((target?.system?.attributes?.hp?.temp ?? 0) > 0) === want),
    // Cloak of Displacement: "while your Speed is 0". { "target.speedZero": true | false }.
    "target.speedZero": want => (speedIsZero(movementSpeedsOf(target)) === want),
    // Trident of Fish Command: "a Beast that has a Swim Speed". { "target.hasSpeed": "swim" } — this mode, or one of a list,
    // with a speed above 0.
    "target.hasSpeed": mode => [mode].flat().some(m => Number(movementSpeedsOf(target)?.[m]) > 0),
    // §16.47: Stabilization — "at 0 Hit Points and not dead".
    "target.atZero": want => ((((target?.system?.attributes?.hp?.value ?? 1) <= 0)) === want),
    "target.isDead": want => (isDeadActor(target) === want),
    // §19.6: an HP threshold (for example 50 or less).
    "target.hpAtMost": n => ((target?.system?.attributes?.hp?.value ?? Infinity) <= n),
    // Grave Domain: a wounded creature ("Death's Pull"); "Bloodied" (2024 rules:
    // at half its HP or fewer — Sentinel at Death's Door). Current maximum: `hp.effectiveMax`.
    "target.wounded": want => (isWounded(target) === want),
    // §22: "on each of your turns" (Divine Fury, Frenzy) — it is the source's turn in the current combat.
    "source.onOwnTurn": want => (ownTurn(source) === want),
    // The current combat is in its first round (Doppelganger's Slam: "with Advantage during the first round of each
    // combat").
    "combat.firstRound": want => ((!!game.combat?.started && (game.combat.round === 1)) === want),
    // Assassinate (§20): a creature that has not yet acted, in the first round of combat.
    "target.hasNotActed": want => (notActedYet(tokenOf(target, targetToken)) === want),
    "target.bloodied": want => (isBloodied(target) === want),
    // "When you reach Cleric level 11": { class: "cleric", level: 11 } (dnd5e class identifier).
    "source.classLevelAtLeast": ({ class: cls, level }={}) => ((source?.classes?.[cls]?.system?.levels ?? 0) >= level),
    // Pack Tactics: an ally of the attacker, not Incapacitated, within { distance, units } of the target.
    // Duplicity: the attacker's illusion within { item, distance, units } of the target, who sees it.
    "source.summonNearTarget": rule => summonNear(source, tokenOf(target, targetToken), rule ?? {}) === true,
    "source.allyNearTarget": range => allyNear(tokenOf(source, sourceToken), tokenOf(target, targetToken), range ?? {}) === true,
    // "Large or smaller": dnd5e rank (tiny < sm < med < lg < huge < grg).
    // `"source"`: "your size or smaller" ("Rider's Shield") — the size of the creature that acts.
    "target.sizeAtMost": size => {
      const rank = SIZE_RANK[target?.system?.traits?.size];
      const limit = SIZE_RANK[(size === "source") ? source?.system?.traits?.size : size];
      return (rank !== undefined) && (limit !== undefined) && (rank <= limit);
    },
    // "A creature within 10 ft of you": { distance, units }, in 3D (P2). Without tokens: unknown, false.
    "target.within": range => within(tokenOf(source, sourceToken), tokenOf(target, targetToken), range ?? {}) === true,
    // P1: "a creature you can see". When it cannot be told (vision out of service,
    // no token), it is taken as seen: vision restricts, it never forbids through ignorance.
    "target.seesSource": want => ((seesBetween(target, source) ?? true) === want),
    // "If the assailant sees the target" (Faerie Fire). Same fallback: without vision, taken as seen.
    "source.seesTarget": want => ((seesBetween(source, target) ?? true) === want),
    // §19: "wounded" window — does the damage received count as one of these types? (Absorb Elements: acid, cold,
    // fire, lightning, thunder.) Unknown types (damage outside resolution): false.
    "damage.hasType": types => (damageTypes ?? []).some(t => [types].flat().includes(t)),
    // §19.8: "suffers a condition" window — is the condition suffered one of these?
    "condition.gained": ids => !!condition && [ids].flat().includes(condition),
    // "Another is hit" window (allyIsHit): `self` is the creature that can react, `target` the one that is hit —
    // a Bloodied, visible creature, within 18 m at most (Sentinel at Death's Door).
    "target.nearSelf": range => within(tokenOf(self, selfToken), tokenOf(target, targetToken), range ?? {}) === true,
    "self.seesTarget": want => ((seesBetween(self, target) ?? true) === want),
    // §34: the attacker within the reactor's range ("Protective Flare": a visible creature within 9 m at most).
    "source.nearSelf": range => within(tokenOf(self, selfToken), tokenOf(source, sourceToken), range ?? {}) === true,
    "self.seesSource": want => ((seesBetween(self, source) ?? true) === want),
    // §447: the reactor carries an effect of the item ("Prowling Reprisal": only transformed by "Savage Wrath").
    "self.hasEffect": id => hasEffectFrom(self, id),
    // The bearer has this status, or one of a list (`rollAdvantage`: "while Bloodied").
    "self.hasStatus": id => [id].flat().some(s => self?.statuses?.has(s) === true),
    // §485: the reactor carries an effect whose save it can replay (Indomitable) — `savableEffectsOf`.
    "self.hasSavableEffect": want => ((savableEffectsOf(self).length > 0) === want),
    // §492: the source attacked the creature (`self`, otherwise `target`) during this turn — true / false,
    // "melee", "ranged" or a list.
    // "When a hostile creature ends its turn after attacking it in melee": { "source.attackedSelfThisTurn": "melee" }.
    "source.attackedSelfThisTurn": want => attackedMatches(attackedDuring(source, self ?? target, { turn: turnKey }), want)
  };
}
