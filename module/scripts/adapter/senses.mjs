/**
 * Sens déclarés par du contenu (clé `sense`) et protections contre la détection (`wardsDetection`) lus sur les acteurs. Règle au
 * cœur (core/senses.mjs) ; la scène — distance, mur — est lue ici et par l'appelant (adapter/vision.mjs).
 */

import { sensesIn, senseVerdict, bestVerdict } from "../core/senses.mjs";
import { holds } from "../core/triggers.mjs";
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

/**
 * Ce que les sens déclarés de l'observateur disent de la cible : `"sight"`, `"locate"`, `"presence"`, ou null. Tokens (documents).
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @param {{distance: () => number, walled: () => boolean}} scene  Lus par l'appelant, et seulement si un sens est en jeu : la
 *   distance qui les sépare (unité de la grille) ; un mur de vue entre eux (pour un sens que les murs arrêtent).
 */
export function sensedBy(observer, target, scene) {
  const senses = declaredSensesOf(observer?.actor);
  if ( !senses.length || !target?.actor ) return null;
  const distance = scene.distance();
  const units = target.parent?.grid?.units ?? "ft";
  const factors = readUnitFactors();
  const wards = detectionWardsOf(target.actor);
  let facts = null;
  let walled = null;
  return bestVerdict(senses.map(sense => {
    const range = lengthIn(sense.range, sense.units ?? "ft", units, factors);
    if ( !(distance <= range) ) return null;
    if ( sense.detects ) {
      facts ??= factsFor({ source: observer.actor, target: target.actor, sourceToken: observer, targetToken: target });
      if ( !holds(sense.detects, facts) ) return null;
    }
    if ( sense.walls !== false ) walled ??= scene.walled();
    return senseVerdict({ ...sense, range }, { distance, walled: walled === true, matches: true, wards });
  }));
}
