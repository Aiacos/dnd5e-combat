/**
 * §225: a creature's plane read from dnd5e 6.0 — the `ethereal` status (config.mjs, `statusEffects.ethereal`, applied by
 * Etherealness, Blink, Oil of Etherealness; dnd5e does nothing else with it than `neverBlockMovement`). Rule in the core
 * (core/plane.mjs).
 *
 * Batch 2, what lets one see the Ethereal from the Material Plane:
 *  - "Ethereal Plane" in the special senses (`system.attributes.senses.special`, free string): See Invisibility and the
 *    Wizard's Third Eye add it to their data (PHB 2024) — no limit other than sight;
 *  - Truesight (`senses.ranges.truesight`, data/shared/senses-field.mjs): within its range;
 *  - Ethereal Sight (MM trait, identifier `ethereal-sight`): 60 ft.
 */

import { MODULE_ID } from "../constants.mjs";
import { samePlane as samePlaneOf, planeOf, perceivesAcross, crossesEtherealWall, ETHEREAL } from "../core/plane.mjs";
import { identifierOf } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";

/** Rule ranges, in feet (converted to the scene's grid). */
const ETHEREAL_SIGHT_FT = 60;   // Ethereal Sight (MM 2024)
const BORDER_VIEW_FT = 60;      // from the Ethereal, "nothing beyond 60 ft" (Etherealness, Blink)
const SPECIAL_SENSE = /ethereal|éthéré/i;

/** The statuses of a token (document or canvas object), of an actor, or null. */
function statusesOf(thing) {
  const actor = thing?.actor ?? ((thing?.documentName === "Actor") ? thing : null) ?? thing?.document?.actor ?? null;
  return actor?.statuses ?? null;
}

/** Is the creature (token or actor) on the Ethereal Plane? */
export function isEthereal(thing) {
  return planeOf(statusesOf(thing)) === ETHEREAL;
}

/** Two creatures (tokens or actors) on the same plane? Whatever is not a creature (null, a point) is on the Material Plane. */
export function samePlane(a, b) {
  return samePlaneOf(statusesOf(a), statusesOf(b));
}

/** How far the actor sees into the Ethereal Plane from the Material Plane, in grid units; null: it does not see it. */
export function etherealSightOf(actor, gridUnits, factors=readUnitFactors()) {
  const senses = actor?.system?.attributes?.senses;
  if ( !senses ) return null;
  if ( SPECIAL_SENSE.test(senses.special ?? "") ) return Infinity;
  let range = null;
  const truesight = Number(senses.ranges?.truesight ?? 0);
  if ( truesight > 0 ) range = lengthIn(truesight, senses.units ?? "ft", gridUnits, factors);
  if ( actor.items?.some(i => identifierOf(i).id === "ethereal-sight") ) {
    range = Math.max(range ?? 0, lengthIn(ETHEREAL_SIGHT_FT, "ft", gridUnits, factors));
  }
  return range;
}

/** The MM ghost: its Ethereal Form leaves it "visible on the Material Plane … and vice versa". */
export function seenAcrossPlanes(actor) {
  return !!actor?.items?.some(i => (i.type === "feat") && (identifierOf(i).id === "etherealness"));
}

/**
 * Can the observer perceive the target, as far as the plane goes (the rest of the view decides afterwards)? Tokens (documents).
 * Always true on the same plane; from one plane to another, the core's rule.
 */
export function perceivesPlane(observer, target) {
  if ( !observer || !target || (observer === target) ) return true;
  const observerPlane = planeOf(statusesOf(observer));
  const targetPlane = planeOf(statusesOf(target));
  if ( observerPlane === targetPlane ) return true;
  const units = target.parent?.grid?.units ?? "ft";
  const factors = readUnitFactors();
  return perceivesAcross({
    observerPlane, targetPlane,
    distance: distanceBetween(observer, target).value,
    etherealSight: etherealSightOf(observer.actor, units, factors),
    limit: lengthIn(BORDER_VIEW_FT, "ft", units, factors),
    visibleAcross: seenAcrossPlanes(target.actor)
  });
}

/** §225, batch 3: the scene walls that stop ethereal travel (`flags.dnd5e-combat.ethereal`), on this level. `c` segments. */
export function etherealWallsOf(scene, level=null) {
  return (scene?.walls ?? []).filter(w => (w.flags?.[MODULE_ID]?.ethereal === true)
    && (!level || !w.levels?.size || w.levels.has(level))).map(w => w.c);
}

/** §225, batch 3: does a step from one point to the other (centers) cross a wall that stops ethereal travel? */
export function etherealWallBetween(scene, from, to, level=null) {
  const walls = etherealWallsOf(scene, level);
  return walls.length > 0 && crossesEtherealWall(from, to, walls);
}
