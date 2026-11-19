/**
 * Sens déclarés par du contenu (clé `sense`) et protections contre la détection (`wardsDetection`) lus sur les acteurs. Règle au
 * cœur (core/senses.mjs) ; la scène — distance, mur — est lue ici et par l'appelant (adapter/vision.mjs).
 */

import { sensesIn, senseVerdict, bestVerdict } from "../core/senses.mjs";
import { holds } from "../core/triggers.mjs";
import { tablesStamp } from "../content/index.mjs";
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
 * Ce qui a été lu d'un acteur, gardé tant que rien n'a changé : `canSee` le demande pour chaque paire de tokens (boucle de
 * Discrétion, légalité, IA des PNJ), et presque aucun acteur n'a de sens déclaré. Oublié pour un acteur quand un de ses items ou
 * de ses effets change (`forgetSenses(actor)`, runtime/vision.mjs), pour tous quand le tour ou l'heure du monde avance (un effet
 * peut se suspendre sans être modifié) ; relu de lui-même si une table du contenu ou la surcouche du monde a changé.
 */
const read = new WeakMap();
let epoch = 0;

/** Ce qui a été lu de cet acteur ne vaut plus ; sans acteur : de tous. */
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
 * Les sens déclarés que l'acteur a en ce moment : ceux des items qu'il possède, et ceux que lui donnent les effets qu'il porte
 * (`via: "effect"`, d'un effet précis de l'item si `fromEffect`). Presque aucun item ne déclare cette clé : on ne compose l'entrée
 * (`contentOf`) que de celui dont une couche la porte (`declaresKey`), comme pour `seesThroughOwnDarkness`. Tableau gardé et
 * partagé (`readOf`) : ne pas le modifier.
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
 * Ce dont les effets que porte l'acteur le protègent (`wardsDetection` de l'item qui les a posés) : `magic`, des écoles. Tableau
 * gardé et partagé : ne pas le modifier.
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
