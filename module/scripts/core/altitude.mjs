/**
 * Movement mode and elevation (SPEC §17.4, user request of 2026-09-26). Pure core.
 *
 * A mode says where the body is relative to the ground beneath it:
 *  - walk, crawl: on the ground, always;
 *  - fly: at least 5 ft above the ground;
 *  - burrow: at least 5 ft below the ground.
 * The other modes (climb, swim, jump, teleportation, fall) leave the elevation as it is.
 *
 * The "ground" is computed by the adapter (surface that stops movement under the token, otherwise the base of the level).
 */

/** Where a mode puts the body: `ground`, `air`, `under`, or null (free). */
const PLACEMENT = { walk: "ground", crawl: "ground", fly: "air", burrow: "under" };

export const placementOf = action => PLACEMENT[action] ?? null;

/** La vitesse de la fiche qu'un mode demande (null : aucune). */
const SPEED = { fly: "fly", burrow: "burrow" };

export const speedFor = action => SPEED[action] ?? null;

/**
 * Why this mode is refused to a creature, or null. Flying or burrowing requires the matching speed.
 * @param {string} action
 * @param {Record<string, number>} speeds  Prepared speeds of the sheet.
 * @returns {"noSpeed"|null}
 */
export function modeRefusal(action, speeds) {
  const speed = speedFor(action);
  if ( !speed ) return null;
  return (Number(speeds?.[speed]) > 0) ? null : "noSpeed";
}

/**
 * The elevation consistent with a mode, as close as possible to the wanted elevation.
 * @param {string} action
 * @param {number} elevation   Wanted elevation.
 * @param {number} ground      Elevation of the ground at that spot.
 * @param {number} clearance   Minimum gap to the ground when flying or burrowing (5 ft, in the scene's unit).
 * @param {number} [ceiling]   Highest elevation at which to set the feet when flying: under the ceiling, head included. A
 *                             ceiling lower than  does not win out (one flies at 5 ft anyway).
 */
export function coherentElevation(action, elevation, ground, clearance, ceiling=Infinity) {
  switch ( placementOf(action) ) {
    case "ground": return ground;
    case "air": return Math.min(Math.max(elevation, ground + clearance), Math.max(ceiling, ground + clearance));
    case "under": return Math.min(elevation, ground - clearance);
    default: return elevation;
  }
}

/**
 * The vertical movement that a mode change imposes, or null if there is none: take off, land, burrow in,
 * come back up. `action` is the mode in which this movement is made (one goes down flying, comes up burrowing).
 * A change to a ground mode from a free mode (climb, jump…) moves nothing: if the body is in the air,
 * it is a fall, which dnd5e handles ("Falling" condition).
 * @param {string} from        Current mode.
 * @param {string} to          Requested mode.
 * @param {number} elevation   Current elevation.
 * @param {number} ground
 * @param {number} clearance
 * @param {number} [ceiling]
 * @returns {{elevation: number, action: string}|null}
 */
export function modeShift(from, to, elevation, ground, clearance, ceiling=Infinity) {
  const target = coherentElevation(to, elevation, ground, clearance, ceiling);
  if ( Math.abs(target - elevation) < 1e-6 ) return null;
  if ( placementOf(to) !== "ground" ) return { elevation: target, action: to };
  if ( ["air", "under"].includes(placementOf(from)) ) return { elevation: target, action: from };
  return null;
}

/**
 * Aligns a path with the ground according to the mode of each step.
 *  - On the ground, the body follows the ground: a step of at most `step` (5 ft), going up as well as down. Higher, it
 *    must climb (`tooHigh`, path refused); lower, it is a fall: the path stops at the edge, over the void,
 *    and dnd5e puts the creature "Falling" (`falls`). `lenient` (the GM): the ground is followed whatever happens.
 *  - Flying, never below `sol + clearance` nor above `ceiling`; burrowing, never above `sol − clearance`.
 *  - The other modes are not touched.
 * @param {{elevation: number}} origin                               Starting point (current elevation).
 * @param {{elevation: number, action: string, ground: number, ceiling?: number}[]} waypoints
 * @param {{clearance: number, step: number, lenient?: boolean}} options
 * @returns {{elevations: number[], kept: number, issue: "tooHigh"|"falls"|null, changed: boolean}}
 *   `elevations`: one per point kept; `kept`: number of points kept.
 */
export function alignPath(origin, waypoints, { clearance, step, lenient=false }) {
  const elevations = [];
  let previous = origin.elevation;
  let changed = false;
  for ( const w of waypoints ) {
    let elevation = coherentElevation(w.action, w.elevation, w.ground, clearance, w.ceiling ?? Infinity);
    if ( !lenient && (placementOf(w.action) === "ground") ) {
      const rise = elevation - previous;
      if ( rise > step + 1e-6 ) return { elevations, kept: elevations.length, issue: "tooHigh", changed: true };
      if ( -rise > step + 1e-6 ) {
        // The step over the void: one goes there, at the elevation one comes from, and stops there.
        elevations.push(previous);
        return { elevations, kept: elevations.length, issue: "falls", changed: true };
      }
    }
    if ( Math.abs(elevation - w.elevation) > 1e-6 ) changed = true;
    elevations.push(elevation);
    previous = elevation;
  }
  return { elevations, kept: elevations.length, issue: null, changed };
}

/**
 * Is an A* step, from one cell to a neighbour, possible on the ground? The same step of at most `step`: the A* neither
 * climbs nor jumps into the void.
 */
export const groundStepAllowed = (fromGround, toGround, step) => Math.abs(toGround - fromGround) <= step + 1e-6;

/**
 * §238: what the menu of one's own token offers for flight — `takeOff` (fly up: 5 ft above the ground), `land` (land:
 * descend while flying to the ground), or null.
 *  - Land: flying, or in the air in a ground mode on a creature that flies (`effectiveMode`).
 *  - Take off: in a ground mode, on the ground, with a fly Speed (Prone, Grappled… bring it to 0) and room under the ceiling.
 *  - The other modes (climb, swim, burrow) have nothing here: climbing has its own entries.
 * @param {{mode: string, airborne: boolean, flySpeed: number, ground: number, ceiling: number, clearance: number}} state
 *   `ceiling`: the highest elevation at which to set the feet when flying (adapter/altitude.mjs `boundsUnder`).
 * @returns {"takeOff"|"land"|null}
 */
export function flightChoice({ mode, airborne, flySpeed, ground, ceiling=Infinity, clearance }) {
  const placement = placementOf(mode);
  const flies = Number(flySpeed) > 0;
  if ( placement === "air" ) return "land";
  if ( placement !== "ground" ) return null;
  if ( airborne ) return flies ? "land" : null;
  if ( !flies || (ceiling < ground + clearance - 1e-6) ) return null;
  return "takeOff";
}
