/**
 * L'ouïe (§62) lue dans Foundry : l'observateur entend-il la cible ? Surdité (état Assourdi), cible cachée (effet de Furtivité
 * du moteur, adapter/search.mjs), cible morte, et les murs et planchers qui arrêtent le son (moteur de collision `sound` et
 * Surfaces du cœur, niveaux). Positions validées (`_source`). La règle est dans core/hearing.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { hears, hearingRange, beyondHearing } from "../core/hearing.mjs";
import { tokenCenter, distanceBetween } from "./turn.mjs";
import { hiddenDcOf } from "./search.mjs";
import { isObjectToken } from "./bodies.mjs";
import { trapLike } from "./content.mjs";
import { blockedBetween, isSenseless } from "./vision.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

/**
 * Un mur ou un plancher qui arrête le son sépare-t-il les deux tokens ? Comme la vue du cœur (detection-mode.mjs:211-259), les
 * murs et les Surfaces (régions `defineSurface`, scene.mjs:836) sont testés séparément : les murs dans le niveau de chacun, les
 * Surfaces de tous les niveaux (un plancher rattaché au seul niveau du dessus arrête aussi le son qui monte). Une cible dans un
 * niveau qu'on ne voit pas depuis le sien (`Level#visibility.levels`, token.mjs:399-417) n'est pas entendue non plus : sinon elle
 * serait « détectée », et le cœur estomperait pour elle l'image du niveau qui la recouvre.
 */
function soundBlocked(observer, target) {
  const scene = observer.parent;
  const levels = scene.levels;
  const own = levels?.get?.(observer.level);
  if ( own && (target.level !== observer.level) && !target.includedInLevel?.(own) ) return true;
  const a = tokenCenter(observer);
  const b = tokenCenter(target);
  if ( scene.testSurfaceCollision?.(a, b, { type: "sound", mode: "any" }) === true ) return true;
  const backend = CONFIG.Canvas.polygonBackends?.sound;
  if ( !backend ) return false;
  for ( const id of new Set([observer.level, target.level]) ) {
    const level = levels?.get?.(id);
    if ( backend.testCollision(a, b, { type: "sound", mode: "any", level: level ?? undefined }) === true ) return true;
  }
  return false;
}

/** Réglage `hearingRange` : la portée de chaque acteur, en pieds, pour la formule en cours (lue une fois, pas à chaque paire). */
let ranges = new WeakMap();

/** La fiche, ses effets ou ses objets ont changé, ou le réglage : les portées se relisent. */
export function clearHearingRanges() {
  ranges = new WeakMap();
}

/**
 * Réglage `hearingRange` : la portée d'ouïe de l'observateur, dans l'unité de sa scène ; null — sans portée — quand le réglage est
 * vide (la règle officielle). La formule est évaluée avec les données de jet de l'acteur (`@skills.prc.passive`…), en pieds.
 * @param {TokenDocument} observer
 * @returns {number|null}
 */
export function hearingRangeOf(observer) {
  let formula = "";
  try { formula = String(game.settings.get(MODULE_ID, "hearingRange") ?? "").trim(); } catch { formula = ""; }
  const actor = observer?.actor;
  if ( !formula || !actor ) return null;
  let known = ranges.get(actor);
  if ( known?.formula !== formula ) {
    let value = null;
    try { value = Roll.safeEval(Roll.replaceFormulaData(formula, actor.getRollData?.() ?? {}, { missing: "0" })); }
    catch { value = null; }
    known = { formula, feet: hearingRange(value) };
    ranges.set(actor, known);
  }
  if ( known.feet === null ) return null;
  return lengthIn(known.feet, "ft", observer.parent?.grid?.units ?? "ft", readUnitFactors());
}

/**
 * L'observateur entend-il la cible ?
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {boolean}
 */
export function canHear(observer, target) {
  if ( !observer || !target || (observer === target) || target.hidden || (observer.parent !== target.parent) ) return false;
  const statuses = s => target.actor?.statuses?.has(s) ?? false;
  return hears({
    // Réglage `unconsciousSenses` : Inconscient, il n'entend plus rien non plus.
    deafened: (observer.actor?.statuses?.has("deafened") ?? false) || isSenseless(observer),
    hidden: hiddenDcOf(target.actor) !== null,
    // §255 : un objet (piège posé, arme spirituelle) ou un acteur piège ne fait pas de bruit — un piège repéré hors de vue se
    // montrait « entendu ».
    silent: statuses("dead") || isObjectToken(target) || trapLike(target.actor),
    // Issue #42 : Silence — « aucun son ne peut naître dans la Sphère ni la traverser » : la cible dedans, ou le trait qui les relie
    // la traversant (l'observateur dedans est déjà Assourdi par la zone, §37.4).
    soundBlocked: soundBlocked(observer, target) || blockedBetween(observer, target).silence,
    outOfRange: outOfHearing(observer, target)
  });
}

/** La cible est-elle au-delà de la portée d'ouïe de l'observateur ? Sans portée, la distance n'est pas lue. */
function outOfHearing(observer, target) {
  const range = hearingRangeOf(observer);
  return (range !== null) && beyondHearing(distanceBetween(observer, target).value, range);
}
