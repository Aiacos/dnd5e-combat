/**
 * Climbing (SPEC §192, batch 1: walls; batch 2: ceilings; batch 3: content, §195). Pure core.
 *
 * 2024 rules (Player's Handbook, glossary "Climbing", "Climb Speed"): climbing requires no roll — each foot costs one
 * extra foot without a Climb Speed (the cost is dnd5e's, action `climb`), nothing extra with one. The DC 15 Strength
 * (Athletics) exists only "at the GM's option": it is the "house" world setting (`climbRules`), which asks for it every turn
 * (every 10 s outside combat) and makes the creature fall on a failure. A Prone, Incapacitated, Grappled creature or one with
 * Speed 0 does not hold on to the wall: it falls (dnd5e only re-evaluates the fall after a move, the engine triggers it).
 */

/** DC of the Strength (Athletics) check to hold on to a wall ("house" setting). */
export const CLIMB_DC = 15;
/** DC of the check to reach or hold a ceiling without the capability ("house" setting, §192.2: the proposal). */
export const CEILING_DC = 20;
/** Outside combat, the equivalent of a turn: 10 s (like the new Hide attempt, §183). */
export const CLIMB_CHECK_SECONDS = 10;
/** Without a ceiling or budget (outside combat), a creature does not climb higher in one go. */
export const MAX_CLIMB_CELLS = 20;

/**
 * Does a segment (a wall edge) touch a rectangle (a token's footprint), within `tolerance`? The rectangle is widened by the
 * tolerance, then we look for an intersection with the segment: an endpoint inside, or the segment crossing it (Liang–Barsky).
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {number} [tolerance]
 */
export function segmentTouchesRect(a, b, rect, tolerance=0) {
  const x0 = rect.x - tolerance, y0 = rect.y - tolerance;
  const x1 = rect.x + rect.width + tolerance, y1 = rect.y + rect.height + tolerance;
  const inside = p => (p.x >= x0) && (p.x <= x1) && (p.y >= y0) && (p.y <= y1);
  if ( inside(a) || inside(b) ) return true;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return false; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
  }
  return t0 <= t1;
}

/**
 * Is the wall one that can be climbed? Not an open door, not a wall without movement restriction, not a wall placed by
 * a spell (`spell`: its identifier, or null) except Wall of Stone.
 * @param {{move: boolean, openDoor: boolean, spell?: string|null}} wall
 */
export function isClimbableWall({ move, openDoor, spell=null }) {
  if ( !move || openDoor ) return false;
  return !spell || (spell === "wall-of-stone");
}

/**
 * The speed that bounds the turn when climbing: the climb speed if the sheet has one, otherwise walking (the ×2 is in
 * dnd5e's cost).
 * @param {Record<string, number>} speeds  Prepared speeds.
 * @returns {{speed: number, native: boolean}}  `native`: a real climb speed.
 */
export function climbSpeed(speeds) {
  const climb = Number(speeds?.climb) || 0;
  if ( climb > 0 ) return { speed: climb, native: true };
  return { speed: Number(speeds?.walk) || 0, native: false };
}

/** What a foot of climbing costs, as a multiple: 2 without a climb speed, 1 with one (dnd5e, `walkFallback`). */
export const climbMultiplier = speeds => (climbSpeed(speeds).native ? 1 : 2);

/**
 * Why a climber no longer holds on to the wall, or null: Prone, Incapacitated, Grappled, or no more speed (Restrained, Paralyzed…).
 * @param {{prone?: boolean, incapacitated?: boolean, grappled?: boolean, speed?: number}} state
 * @returns {"prone"|"incapacitated"|"grappled"|"noSpeed"|null}
 */
export function climbFallReason({ prone=false, incapacitated=false, grappled=false, speed=0 }={}) {
  if ( prone ) return "prone";
  if ( incapacitated ) return "incapacitated";
  if ( grappled ) return "grappled";
  if ( !(speed > 0) ) return "noSpeed";
  return null;
}

/**
 * How many cells one can climb in one go: what the remaining movement pays for (a cell costs `gridDistance × multiplier`), under
 * the ceiling (`ceilingCells`: free cells above, Infinity without a ceiling), never more than `MAX_CLIMB_CELLS`.
 * @param {{remaining: number, gridDistance: number, multiplier: number, ceilingCells?: number}} p
 */
export function climbableCells({ remaining, gridDistance, multiplier, ceilingCells=Infinity }) {
  const affordable = Number.isFinite(remaining) ? Math.floor((remaining / (gridDistance * multiplier)) + 1e-6) : MAX_CLIMB_CELLS;
  const room = Number.isFinite(ceilingCells) ? Math.max(0, Math.floor(ceilingCells + 1e-6)) : MAX_CLIMB_CELLS;
  return Math.max(0, Math.min(affordable, room, MAX_CLIMB_CELLS));
}

/** Is the "house" mode check due: never done, or done more than `intervalMs` ago? */
export const climbCheckDue = (lastAt, now, intervalMs) => !Number.isFinite(lastAt) || ((now - lastAt) >= intervalMs);

/* -------------------------------------------- */
/*  Plafonds (lot 2)                            */
/* -------------------------------------------- */

/**
 * The dnd5e identifiers that grant walking on ceilings (§192.3): the Spider Climb spell (and the monster trait with the same
 * identifier), the Slippers of Spider Climbing and the Cloak of Arachnida from the Dungeon Master's Guide. A neighbor declares
 * its own through content (`climbsCeilings: true`, `api.content.register`).
 */
export const CEILING_IDENTIFIERS = Object.freeze(["spider-climb", "slippers-of-spider-climbing", "cloak-of-arachnida"]);

/**
 * Does an item (its identifier, its content entry) grant walking on ceilings? On a slippery surface (`slippery`, §195), not an
 * item that cannot hold on a slippery surface (`notOnSlippery`: the Slippers of Spider Climbing).
 */
export function grantsCeiling(identifier, entry=null, { slippery=false }={}) {
  if ( slippery && (entry?.notOnSlippery === true) ) return false;
  return CEILING_IDENTIFIERS.includes(identifier) || (entry?.climbsCeilings === true);
}

/**
 * The elevation of the feet of a creature hanging from a ceiling: the ceiling minus its height (`depth` in cells).
 * null without a ceiling.
 * @param {number} ceiling        Elevation of the ceiling (Infinity: none).
 * @param {number} depth          Height of the creature, in cells.
 * @param {number} gridDistance
 */
export function ceilingPerch(ceiling, depth, gridDistance) {
  if ( !Number.isFinite(ceiling) ) return null;
  return ceiling - (depth * gridDistance);
}

/** Is the creature hanging from this ceiling (its head against it)? */
export function hangsFrom(elevation, depth, gridDistance, ceiling) {
  const perch = ceilingPerch(ceiling, depth, gridDistance);
  return (perch !== null) && (Math.abs(elevation - perch) < 1e-6);
}

/**
 * The vertical mirror of a token on the ceiling (§192.4 point 8): the vertical scale inverted, the original scale kept to
 * restore it when leaving the ceiling — a token already mirrored goes back upright, which is indeed "head down" for it.
 */
export const flippedScale = scaleY => -(Number(scaleY) || 1);

/* -------------------------------------------- */
/*  Contenu (lot 3)                             */
/* -------------------------------------------- */

/**
 * The effect changes that a `grantsSpeeds` rule (§195: Athlete, "a climb speed equal to your Speed") gives the bearer:
 * `"walk"` is worth the Speed read now (`walk`), a number is worth itself; same shape as the dnd5e capabilities that give a
 * speed (`system.attributes.movement.<vitesse>`, `upgrade`). A null value gives nothing.
 * @param {Record<string, "walk"|number>} rule
 * @param {number} walk
 * @returns {Array<{key: string, type: string, value: string}>}
 */
export function grantedSpeedChanges(rule, walk) {
  const out = [];
  for ( const [type, value] of Object.entries(rule ?? {}) ) {
    const speed = (value === "walk") ? (Number(walk) || 0) : (Number(value) || 0);
    if ( speed > 0 ) out.push({ key: `system.attributes.movement.${type}`, type: "upgrade", value: String(speed) });
  }
  return out;
}

/** Are the changes of an effect the wanted ones (same keys, types, values; order does not matter)? */
export function sameSpeedChanges(current, wanted) {
  const norm = list => (list ?? []).map(c => `${c.key}|${c.type}|${String(c.value)}`).sort().join(";");
  return norm(current) === norm(wanted);
}

/**
 * Acrobatic Movement (§195, Monk 9): "without armor or shield, […] vertical surfaces during your turn". In combat, on its own
 * turn only; outside combat, always (there is no turn — nothing makes it fall).
 * @param {{armor?: boolean, shield?: boolean, inCombat?: boolean, ownTurn?: boolean}} state
 */
export function acrobaticAllowed({ armor=false, shield=false, inCombat=false, ownTurn=false }={}) {
  if ( armor || shield ) return false;
  return !inCombat || ownTurn;
}

/**
 * Does the Monk who was ending their turn running on the wall fall? Yes if still there (climbing, above the ground), not if they
 * came back down or reached the ceiling (they do not climb up there this way).
 * @param {{acrobatic?: boolean, climbing?: boolean, aboveGround?: boolean, onCeiling?: boolean}} state
 */
export const acrobaticFallDue = ({ acrobatic=false, climbing=false, aboveGround=false, onCeiling=false }={}) =>
  acrobatic && climbing && aboveGround && !onCeiling;

/**
 * §209: hoisting onto a ledge (roof, wall walk, upper floor) from the wall being climbed. The floor of the neighboring cell must be
 * higher than the climber's feet and no higher than their head (they reach it with their hands), and there must be enough room
 * above to stand.
 * Returns the height left to climb, or null if the ledge is not within reach.
 * @param {{feet: number, height: number, ground: number, ceiling?: number}} data
 *   `height`: the token's height; `ground`: the floor of the neighboring cell; `ceiling`: the ceiling above it (Infinity: none).
 * @returns {number|null}
 */
export function ledgeRise({ feet, height, ground, ceiling=Infinity }) {
  const eps = 1e-6;
  if ( !Number.isFinite(ground) || !(ground > feet + eps) || (ground > feet + height + eps) ) return null;
  if ( (ceiling - ground) < height - eps ) return null;
  return ground - feet;
}

/**
 * §209: what hoisting costs: the height left, at the climbing price (`multiplier`: 2 without a climb speed), plus the cell where
 * one gets a footing. Grid units.
 */
export const ledgeCost = ({ rise, multiplier, gridDistance }) => (rise * multiplier) + gridDistance;

/* -------------------------------------------- */
/*  The gauge of the climbing window (§215)      */
/* -------------------------------------------- */

/**
 * The falling dice (dnd5e, rules/falling.mjs: 1d6 per 10 ft, 20d6 at most) for a height above the ground, in the grid
 * unit (`step`: 10 in feet, 3 in meters).
 */
/** §215: blind outside combat, the climb in one go is bounded (we do not offer 100 ft in the dark). */
export const HIDDEN_CLIMB_CELLS = 6;

export const fallDice = (height, step=10) => Math.max(0, Math.min(20, Math.floor((height + 1e-6) / step)));

/**
 * The gauge of the "Climb" / "Descend" window: the wall seen in profile, cell by cell.
 *  - Climbing: the cells above the climber's feet; one can choose those that the turn's movement pays for and, if the top is
 *    seen (`seen`), that the ceiling allows (`ceilingFeet`: the highest elevation of the feet under the ceiling). The top (`top`:
 *    a ledge `{ kind: "ledge", at }` to put the feet on, or the ceiling `{ kind: "ceiling", at }`) is shown only if seen —
 *    otherwise nothing gives it away, not even the number of cells: one chooses from one's movement alone, and the climb stops
 *    at the ceiling.
 *  - Descending: the cells under the feet down to the ground (`ground`).
 * @returns {{cells: Array<{n: number, at: number, choosable: boolean}>, choosable: number, top: object|null, hidden: boolean}}
 */
export function climbGauge({ feet, ground=0, gridDistance, height=gridDistance, remaining, multiplier, ceilingFeet=Infinity, top=null, seen=true, down=false, marks=[] }) {
  const affordable = climbableCells({ remaining, gridDistance, multiplier });
  if ( down ) {
    const depth = Math.max(0, Math.floor(((feet - ground) / gridDistance) + 1e-6));
    const choosable = Math.min(affordable, depth);
    const cells = Array.from({ length: depth }, (_, i) => ({ n: i + 1, at: feet - ((i + 1) * gridDistance), choosable: (i + 1) <= choosable }));
    return { cells, choosable, top: null, hidden: false, marks: [], topCells: 0 };
  }
  const real = climbableCells({ remaining, gridDistance, multiplier, ceilingCells: (ceilingFeet - feet) / gridDistance });
  // Blind and with no movement limit (outside combat), no more than `HIDDEN_CLIMB_CELLS` cells in one go.
  const choosable = seen ? real : (Number.isFinite(remaining) ? affordable : Math.min(affordable, HIDDEN_CLIMB_CELLS));
  // The cells shown: those one can choose, up to the top if seen — under a ledge, the cell from which one hoists onto it (head at
  // the height of the ledge); under a ceiling, the cell where the head touches it (`ceilingFeet`).
  const below = top?.kind === "ledge" ? (top.at - height) : ceilingFeet;
  const toTop = (seen && top && Number.isFinite(below)) ? Math.max(0, Math.floor(((below - feet) / gridDistance) + 1e-6)) : 0;
  // §216: the boundary of the next level is visible even out of range (cells greyed out up to it) — under a seen ceiling,
  // not beyond.
  // Only a seen ceiling stops the gauge and the markers; a ledge does not (the wall may continue).
  const limit = (seen && ["ceiling", "wallEnd"].includes(top?.kind)) ? (top.at - feet) : Infinity;
  const ledge = seen && (top?.kind === "ledge");
  // The next marker (beyond the ledge when there is one: that of the ledge already reads).
  const nextMark = marks.find(m => (m.at > (ledge ? top.at + 1e-6 : feet)) && ((m.at - feet) <= limit + 1e-6));
  const toMark = nextMark ? Math.ceil(((nextMark.at - feet) / gridDistance) - 1e-6) : 0;
  // Under a seen ledge, the gauge shows the ledge and a little above it (two cells, or up to the next level), not the whole height
  // one could climb: the "Cells" field allows going higher.
  const count = Math.min(MAX_CLIMB_CELLS, ledge ? Math.min(choosable, Math.max(toTop + 2, toMark)) : Math.max(choosable, toTop, toMark));
  const cells = Array.from({ length: count }, (_, i) => ({ n: i + 1, at: feet + ((i + 1) * gridDistance), choosable: (i + 1) <= choosable }));
  const shownTop = feet + (count * gridDistance) + height;
  return { cells, choosable, top: seen ? top : null, hidden: !seen, topCells: (seen && top) ? Math.min(choosable, toTop) : 0,
    marks: marks.filter(m => (m.at > feet) && (m.at <= shownTop + 1e-6) && (m.at <= limit + feet + 1e-6)) };
}
