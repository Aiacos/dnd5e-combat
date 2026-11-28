/**
 * §285: control spells (batch 3 of the 2026-10-30 workstreams). Pure: what the Confusion table imposes, and the direction
 * drawn for wandering.
 *
 * Confusion (PHB 2024), 1d10 at the start of each of its turns:
 *   1     it takes no action and spends all its movement in a random direction (1d8 for the direction);
 *   2–6   it does not move and takes no action;
 *   7–8   it makes a melee attack against a random creature within its reach, otherwise it takes no action;
 *   9–10  it chooses its behavior.
 */

/**
 * @param {number} d10
 * @returns {{ kind: "wander"|"idle"|"lash"|"free", move: boolean, action: boolean }}
 *   `move`: it keeps its movement; `action`: it keeps its action.
 */
export function confusionBehavior(d10) {
  if ( d10 <= 1 ) return { kind: "wander", move: true, action: false };
  if ( d10 <= 6 ) return { kind: "idle", move: false, action: false };
  if ( d10 <= 8 ) return { kind: "lash", move: false, action: true };
  return { kind: "free", move: true, action: true };
}

import { MOVE_DIRECTIONS as COMPASS } from "./content/enums.mjs";

/** The eight grid directions, in the order of a 1d8 (north, then clockwise). `di`: row. */
export const DIRECTIONS = Object.freeze([
  { di: -1, dj: 0 }, { di: -1, dj: 1 }, { di: 0, dj: 1 }, { di: 1, dj: 1 },
  { di: 1, dj: 0 }, { di: 1, dj: -1 }, { di: 0, dj: -1 }, { di: -1, dj: -1 }
]);

/**
 * §497: the direction of a random move (`move` step, `random` mode: Infestation). `directions`: the allowed directions
 * (`MOVE_DIRECTIONS`, n, ne, e, se, s, sw, w, nw; all eight by default), in die order; `face`: the 1dN result, N = their
 * number.
 * @param {string[]|null|undefined} directions
 * @param {number} face
 * @returns {{key: string, di: number, dj: number}|null}  null if the face or a direction is unknown.
 */
export function randomDirection(directions, face) {
  const keys = (Array.isArray(directions) && directions.length) ? directions : COMPASS;
  const key = keys[Math.round(face) - 1];
  const index = COMPASS.indexOf(key);
  if ( index < 0 ) return null;
  return { key, ...DIRECTIONS[index] };
}

/** §497: the number of faces of a random move's die. */
export function randomDie(directions) {
  return (Array.isArray(directions) && directions.length) ? directions.length : COMPASS.length;
}

/**
 * The cells targeted by wandering: from the farthest (`cells` steps in the d8 direction) to the nearest, bounded by the
 * scene (`bounds`: { i0, j0, i1, j1 }, top-left corner of the footprint `size` { w, h }). The walk takes the first one reachable.
 */
export function wanderCells(from, d8, cells, size, bounds) {
  const dir = DIRECTIONS[(Math.max(1, Math.min(8, d8)) - 1)];
  const out = [];
  for ( let n = cells; n >= 1; n-- ) {
    const i = from.i + (dir.di * n), j = from.j + (dir.dj * n);
    if ( (i < bounds.i0) || (j < bounds.j0) || ((i + size.h - 1) > bounds.i1) || ((j + size.w - 1) > bounds.j1) ) continue;
    out.push({ i, j });
  }
  return out;
}
