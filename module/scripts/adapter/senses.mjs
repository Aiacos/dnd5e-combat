/**
 * Senses declared by content (key `sense`) and protections against detection (`wardsDetection`) read on actors. Rule in the
 * core (core/senses.mjs); the scene — distance, wall — is read here and by the caller (adapter/vision.mjs).
 */

import { sensesIn, senseVerdict, bestVerdict, detectsTarget, mutedSenses } from "../core/senses.mjs";
import { tablesStamp } from "../content/index.mjs";
import { contentOf, declaresKey, worldOverrides } from "./content.mjs";
import { originItemOf, comesFromItemEffect, factsFor } from "./facts.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

/** An actor's Active Effects, with the item that placed them. */
function* effectOrigins(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) yield { effect, item };
  }
}

/**
 * What was read from an actor, kept as long as nothing has changed: `canSee` asks for it for each pair of tokens (Stealth loop,
 * legality, NPC AI), and almost no actor has a declared sense. Forgotten for an actor when one of its items or its effects
 * changes (`forgetSenses(actor)`, runtime/vision.mjs), for all when the turn or the world time advances (an effect
 * can suspend without being modified); reread by itself if a content table or the world overlay has changed.
 */
const read = new WeakMap();
let epoch = 0;

/** What was read from this actor is no longer valid; without an actor: from all of them. */
export function forgetSenses(actor=null) {
  if ( actor ) read.delete(actor);
  else epoch++;
}

function readOf(actor) {
  const overrides = worldOverrides();
  const tables = tablesStamp();
  const kept = read.get(actor);
  if ( kept && (kept.epoch === epoch) && (kept.tables === tables) && (kept.overrides === overrides) ) return kept;
  const fresh = { epoch, tables, overrides, senses: Object.freeze(readSenses(actor, overrides)),
    wards: Object.freeze(readWards(actor, overrides)) };
  read.set(actor, fresh);
  return fresh;
}

/**
 * The declared senses the actor has right now: those of the items it owns, and those given to it by the effects it carries
 * (`via: "effect"`, from a specific effect of the item if `fromEffect`). Almost no item declares this key: the entry is composed
 * (`contentOf`) only for the one that a layer carries it (`declaresKey`), as for `seesThroughOwnDarkness`. Array kept and
 * shared (`readOf`): do not modify it.
 * @param {Actor} actor
 * @returns {readonly object[]}
 */
export function declaredSensesOf(actor) {
  return actor ? readOf(actor).senses : [];
}

function readSenses(actor, overrides) {
  const out = [];
  for ( const item of actor.items ?? [] ) {
    if ( !declaresKey(item, "sense", overrides) ) continue;
    for ( const sense of sensesIn(contentOf(item).entry) ) if ( sense.via !== "effect" ) out.push(sense);
  }
  for ( const { effect, item } of effectOrigins(actor) ) {
    if ( !declaresKey(item, "sense", overrides) ) continue;
    for ( const sense of sensesIn(contentOf(item).entry) ) {
      if ( (sense.via === "effect") && (!sense.fromEffect || comesFromItemEffect(effect, sense.fromEffect)) ) out.push(sense);
    }
  }
  return out;
}

/**
 * What the effects the actor carries protect it from (`wardsDetection` of the item that placed them): `magic`, schools. Array
 * kept and shared: do not modify it.
 * @param {Actor} actor
 * @returns {readonly string[]}
 */
export function detectionWardsOf(actor) {
  return actor ? readOf(actor).wards : [];
}

function readWards(actor, overrides) {
  const wards = new Set();
  for ( const { item } of effectOrigins(actor) ) {
    if ( !declaresKey(item, "wardsDetection", overrides) ) continue;
    for ( const ward of contentOf(item).entry?.wardsDetection ?? [] ) wards.add(ward);
  }
  return Array.from(wards);
}

/** The creature types under which the senses also perceive this actor (`detectedAs` of the items it owns). */
export function detectedTypesOf(actor) {
  const overrides = worldOverrides();
  const types = new Set();
  for ( const item of actor?.items ?? [] ) {
    if ( !declaresKey(item, "detectedAs", overrides) ) continue;
    for ( const type of contentOf(item).entry?.detectedAs ?? [] ) types.add(type);
  }
  return Array.from(types);
}

/**
 * The senses on this token's sheet (detection mode ids) that are switched off right now: those that an item it owns says depend on
 * sight or hearing (`senseNeeds`), when it is Blinded or Deafened. The items are only read in one of those two states.
 * @param {TokenDocument} observer
 * @returns {string[]}
 */
export function mutedSensesOf(observer) {
  const actor = observer?.actor;
  const blind = !!observer?.hasStatusEffect?.(CONFIG.specialStatusEffects.BLIND);
  const deaf = actor?.statuses?.has?.("deafened") ?? false;
  if ( !actor || (!blind && !deaf) ) return [];
  const overrides = worldOverrides();
  const needs = [];
  for ( const item of actor.items ?? [] ) {
    if ( declaresKey(item, "senseNeeds", overrides) ) needs.push(contentOf(item).entry?.senseNeeds);
  }
  return needs.length ? mutedSenses(needs, { blind, deaf }) : [];
}

/**
 * What the observer's declared senses say about the target: `"sight"`, `"locate"`, `"presence"`, `"aura"`, or null. Tokens
 * (documents).
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{distance: () => number, walled: () => boolean, blind?: () => boolean, deaf?: () => boolean,
 *   invisible?: () => boolean, blocked?: () => {fog: boolean, darkness: boolean}}} scene  Read by the caller, and only if a
 *   sense needs it: the distance between them (grid unit); a sight wall between them (for a sense that walls
 *   stop); the observer Blinded, Deafened (`needs`); for sight, the target Invisible to it, and the area that blocks
 *   sight between them.
 */
export function sensedBy(observer, target, scene) {
  const senses = declaredSensesOf(observer?.actor);
  if ( !senses.length || !target?.actor ) return null;
  const distance = scene.distance();
  const units = target.parent?.grid?.units ?? "ft";
  const factors = readUnitFactors();
  const wards = detectionWardsOf(target.actor);
  let facts = null;
  let alsoTypes = null;
  let walled = null;
  return bestVerdict(senses.map(sense => {
    const range = lengthIn(sense.range, sense.units ?? "ft", units, factors);
    if ( !(distance <= range) ) return null;
    if ( sense.detects ) {
      facts ??= factsFor({ source: observer.actor, target: target.actor, sourceToken: observer, targetToken: target });
      alsoTypes ??= detectedTypesOf(target.actor);
      if ( !detectsTarget(sense.detects, facts, alsoTypes) ) return null;
    }
    if ( (sense.needs === "sight") && scene.blind?.() ) return null;
    if ( (sense.needs === "hearing") && scene.deaf?.() ) return null;
    if ( sense.walls !== false ) walled ??= scene.walled();
    const sight = (sense.kind === "sight") && !sense.reveals;
    const blocked = sight ? (scene.blocked?.() ?? {}) : {};
    return senseVerdict({ ...sense, range }, { distance, walled: walled === true, matches: true, wards,
      invisible: sight && !!scene.invisible?.(), fog: !!blocked.fog, darkness: !!blocked.darkness });
  }));
}
