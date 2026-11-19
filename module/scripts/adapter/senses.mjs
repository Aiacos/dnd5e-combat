/**
 * Sens déclarés par du contenu (clé `sense`) et protections contre la détection (`wardsDetection`) lus sur les acteurs. Règle au
 * cœur (core/senses.mjs) ; la scène — distance, mur — est lue ici et par l'appelant (adapter/vision.mjs).
 */

import { sensesIn, senseVerdict, bestVerdict, detectsTarget, mutedSenses } from "../core/senses.mjs";
import { contentOf, declaresKey, worldOverrides } from "./content.mjs";
import { originItemOf, comesFromItemEffect, factsFor } from "./facts.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

/** Les effets actifs d'un acteur, avec l'item qui les a posés. */
function* effectOrigins(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) yield { effect, item };
  }
}

/**
 * Les sens déclarés que l'acteur a en ce moment : ceux des items qu'il possède, et ceux que lui donnent les effets qu'il porte
 * (`via: "effect"`, d'un effet précis de l'item si `fromEffect`). Presque aucun item ne déclare cette clé : on ne compose l'entrée
 * (`contentOf`) que de celui dont une couche la porte (`declaresKey`), comme pour `seesThroughOwnDarkness`.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function declaredSensesOf(actor) {
  if ( !actor ) return [];
  const overrides = worldOverrides();
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

/** Ce dont les effets que porte l'acteur le protègent (`wardsDetection` de l'item qui les a posés) : `magic`, des écoles. */
export function detectionWardsOf(actor) {
  const overrides = worldOverrides();
  const wards = new Set();
  for ( const { item } of effectOrigins(actor) ) {
    if ( !declaresKey(item, "wardsDetection", overrides) ) continue;
    for ( const ward of contentOf(item).entry?.wardsDetection ?? [] ) wards.add(ward);
  }
  return Array.from(wards);
}

/** Les types de créature sous lesquels les sens perçoivent aussi cet acteur (`detectedAs` des items qu'il possède). */
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
 * Les sens de la fiche de ce token (ids de modes de détection) éteints en ce moment : ceux qu'un item qu'il possède dit dépendre de
 * la vue ou de l'ouïe (`senseNeeds`), quand il est Aveuglé ou Assourdi. Les items ne sont lus que dans l'un de ces deux états.
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
 * Ce que les sens déclarés de l'observateur disent de la cible : `"sight"`, `"locate"`, `"presence"`, ou null. Tokens (documents).
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{distance: () => number, walled: () => boolean, blind?: () => boolean, deaf?: () => boolean,
 *   invisible?: () => boolean, blocked?: () => {fog: boolean, darkness: boolean}}} scene  Lus par l'appelant, et seulement si un
 *   sens en a besoin : la distance qui les sépare (unité de la grille) ; un mur de vue entre eux (pour un sens que les murs
 *   arrêtent) ; l'observateur Aveuglé, Assourdi (`needs`) ; pour une vue, la cible Invisible pour lui, et la zone qui bloque la
 *   vue entre eux.
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
