/**
 * Cover (SPEC §14.1, P1 b; 2024 rules and the DMG grid method): from a corner of
 * the attacker's space — the best one for them —, draw a line to each of the four corners
 * of the target's space. No line blocked: no cover; one or two: half cover (+2 AC);
 * three: three-quarters cover (+5); four: total cover (untargetable). An interposed creature
 * never gives more than half cover (2024), whether it is an ally or an enemy of the target.
 *
 * Geometry in pixels; what blocks a line (walls, surfaces) is a predicate supplied by
 * the adapter. The corners are inset slightly (`inset`): a line that runs exactly along a wall
 * or grazes a creature's corner does not count. A corner that the wall separates from its creature's center (cell cut by a
 * cave wall) is brought back in front of the wall (§239). Pure functions, no dependency on Foundry.
 */

/** Sizes whose body, even dead, remains an obstacle (user request 2026-09-26). */
const CORPSE_COVER_SIZES = Object.freeze(["lg", "huge", "grg"]);

/**
 * Does an interposed creature's body give cover? Alive, always; dead, only if it is Large or larger
 * (a Medium or smaller corpse, lying on the ground, does not cover).
 * @param {{dead: boolean, size?: string}} body
 */
export function bodyGivesCover({ dead, size }) {
  return !dead || CORPSE_COVER_SIZES.includes(size);
}

/** The cover degrees and their bonus to AC; `null` = untargetable. */
export const COVER = Object.freeze({
  none: { bonus: 0 },
  half: { bonus: 2 },
  threeQuarters: { bonus: 5 },
  total: { bonus: null }
});

const DEGREES = ["none", "half", "half", "threeQuarters", "total"];

/** §172: the stronger of two cover degrees. */
export function strongerCover(a, b) {
  const rank = d => ["none", "half", "threeQuarters", "total"].indexOf(d);
  return rank(b) > rank(a) ? b : a;
}

/**
 * @typedef {object} Rect
 * @property {number} x  Coin haut-gauche.
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/** The rectangle inset by `inset` on each side (never beyond its center). */
export function shrink(rect, inset) {
  const dx = Math.min(inset, rect.width / 2 - 1e-6);
  const dy = Math.min(inset, rect.height / 2 - 1e-6);
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width - 2 * dx, height: rect.height - 2 * dy };
}

/** Les quatre coins d'un rectangle. */
export function corners({ x, y, width, height }) {
  return [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }];
}

/** Does the segment [a, b] cross the INTERIOR of the rectangle? (Liang–Barsky; running along an edge does not count) */
export function segmentCrossesRect(a, b, rect) {
  const eps = 1e-6;
  const x0 = rect.x + eps, y0 = rect.y + eps, x1 = rect.x + rect.width - eps, y1 = rect.y + rect.height - eps;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return false; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
  }
  return t1 - t0 > 1e-9;   // a simple tangency (a brushed corner) does not count
}

/**
 * §239: the (inset) corners of a space, each brought back by `clip` toward the center when a wall separates them. On a map whose
 * walls do not follow the grid (a cave), a cell's corner can fall behind the wall: the line leading to it would be blocked whatever
 * the attacker, and the creature against the wall would have half cover against everyone (issue #14).
 */
function clipped(rect, inset, clip) {
  const points = corners(shrink(rect, inset));
  if ( !clip ) return points;
  const centre = { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) };
  return points.map(p => clip(centre, p) ?? p);
}

/**
 * The point from `centre` toward `corner` stopped `margin` before the obstacle `hit` (null: nothing between, the corner stays).
 * @param {{x,y}} centre
 * @param {{x,y}} corner
 * @param {{x,y}|null} hit
 * @param {number} margin
 */
export function pullBack(centre, corner, hit, margin) {
  if ( !hit ) return corner;
  const full = Math.hypot(corner.x - centre.x, corner.y - centre.y);
  if ( full < 1e-9 ) return corner;
  const k = Math.max(0, Math.hypot(hit.x - centre.x, hit.y - centre.y) - margin) / full;
  return { x: centre.x + ((corner.x - centre.x) * k), y: centre.y + ((corner.y - centre.y) * k) };
}

/** §476: a wall's "grate" choices (wall configuration, "DAS · Grille" section). */
export const GRATE_MODES = Object.freeze(["auto", "grate", "solid"]);

/**
 * §476 (feedback from Fanarie, 2026-11-18): is this wall that stops movement a grate (§468)?
 *  - the wall's choice wins: "grate", "solid" (solid wall);
 *  - otherwise ("auto"): the world setting `grateWalls` — any wall that does not block sight is a grate, except a wall placed by
 *    a spell (Wall of Force: `zone` flag) or marked ethereal (§225), which stays solid.
 * A window ("proximity" sight) or a terrain wall ("limited" sight) blocks sight: never a grate by default.
 * @param {{mode?: string, auto?: boolean, blocksSight?: boolean, spellWall?: boolean}} wall
 * @returns {boolean}
 */
export function grateOf({ mode="auto", auto=false, blocksSight=true, spellWall=false }={}) {
  if ( mode === "grate" ) return true;
  if ( mode === "solid" ) return false;
  return !!auto && !blocksSight && !spellWall;
}

/**
 * §518 (Discord, SpitFire, 2026-11-22): the cover of an attack made despite a refusal ("attack anyway"). Total cover usually means
 * an automatic miss (AC `null`, core/attack.mjs): forced, the attack would have been rolled for nothing, without damage. The forced
 * refusal is carried through: the obstacle still protects, at the strongest of the covers that allow attacking —
 * three-quarters (+5). The other degrees do not change.
 * @param {{degree: string, bonus: number|null}|null} cover
 * @returns {object|null}
 */
export function forcedCover(cover) {
  if ( cover?.degree !== "total" ) return cover ?? null;
  return { ...cover, degree: "threeQuarters", bonus: COVER.threeQuarters.bonus, forced: true };
}

/**
 * §518 (Discord, SpitFire, 2026-11-22: Baileywiki's Restored Keep): is a window open for THIS attacker? A Foundry window
 * stops movement and lets the sight of whoever is near it through ("proximity" sight, threshold: `canvas/layers/walls.mjs:474`,
 * `Edge#applyThreshold`). When the attacker's sight passes through it (threshold reached), they shoot through the opening: it
 * does not cut their cover lines. The wall's choice wins ("grate", "solid wall": a closed pane); a spell wall never opens.
 * @param {{mode?: string, spellWall?: boolean, seenThrough?: boolean}} wall  `seenThrough`: sight threshold reached from
 *                                                                            the attacker.
 * @returns {boolean}
 */
export function windowOpen({ mode="auto", spellWall=false, seenThrough=false }={}) {
  if ( (mode === "grate") || (mode === "solid") || spellWall ) return false;
  return !!seenThrough;
}

/**
 * The cover a target benefits from against an attacker.
 * @param {object} context
 * @param {Rect} context.attacker                     The attacker's space.
 * @param {Rect} context.target                       The target's space.
 * @param {Rect[]} [context.bodies]                   Spaces of the other creatures (neither the attacker nor the target).
 * @param {(a: {x,y}, b: {x,y}) => boolean|string} [context.blocked]  Does an obstacle (wall, surface) cut the line? A string
 *                                                    ("wall", "surface") says which (#33: cover sources); `true` means "wall".
 *                                                    "grate" (§468): only a grate — never more than three-quarters cover.
 * @param {number} [context.inset]                    Inset of the corners and bodies, in pixels.
 * @param {(centre: {x,y}, corner: {x,y}) => {x,y}} [context.clipAttacker]  §239: moves an attacker's corner to the walls' side
 *                                                    where its center is (a corner inside the rock is not its space).
 * @param {(centre: {x,y}, corner: {x,y}) => {x,y}} [context.clipTarget]    §239: likewise for the target.
 * @returns {{degree: "none"|"half"|"threeQuarters"|"total", bonus: number|null, blockedLines: number, byCreature: boolean,
 *            sources: string[]}}  `sources`: everything that cuts the lines of the chosen corner ("wall", "surface", "creature"),
 *            even what does not decide the degree.
 */
export function coverBetween({ attacker, target, bodies=[], blocked=() => false, inset=0, clipAttacker=null, clipTarget=null }) {
  const from = clipped(attacker, inset, clipAttacker);
  const to = clipped(target, inset, clipTarget);
  const solids = bodies.map(r => shrink(r, inset));
  let best = null;
  for ( const a of from ) {
    let walls = 0;
    let grates = 0;
    let creatures = 0;
    const kinds = new Set();
    for ( const b of to ) {
      const hit = blocked(a, b);
      // §468: a grate (bars, portcullis) cuts the line without being total cover — it counts as a wall for the degree, capped
      // at three-quarters cover; its source stays "wall".
      if ( hit === "grate" ) { walls++; grates++; kinds.add("wall"); }
      else if ( hit ) { walls++; kinds.add((typeof hit === "string") ? hit : "wall"); }
      else if ( solids.some(r => segmentCrossesRect(a, b, r)) ) creatures++;
    }
    let degree = DEGREES[walls];
    if ( (degree === "total") && grates ) degree = "threeQuarters";
    let byCreature = false;
    if ( (degree === "none") && creatures ) { degree = "half"; byCreature = true; }
    const rank = DEGREES.indexOf(degree);
    // #33: a creature that also cuts lines from this corner is cited, even when the wall decides the degree (covers do not
    // add up: only the strongest counts).
    if ( creatures ) kinds.add("creature");
    // The attacker chooses the corner that leaves the least cover to its target.
    if ( !best || (rank < best.rank) ) best = { rank, degree, blockedLines: walls + (byCreature ? creatures : 0), byCreature, sources: [...kinds] };
    if ( best.rank === 0 ) break;
  }
  return { degree: best.degree, bonus: COVER[best.degree].bonus, blockedLines: best.blockedLines, byCreature: best.byCreature,
    sources: (best.degree === "none") ? [] : best.sources };
}
