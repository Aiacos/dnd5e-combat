/**
 * #33 (continued): what the line of sight draws (ui/attack-line.mjs) — the two ends (centers of the attacker,
 * at its arrival cell if it approaches, and of the target), the colored segments (core/attack-line.mjs) and the distance.
 * Read on this client, with the preview's cover (adapter/cover-preview.mjs): for a player, a creature they do not
 * perceive does not cut the line.
 */

import { attackLineSegments, segmentEntry } from "../core/attack-line.mjs";
import { rangeIssue } from "../core/range.mjs";
import { coverPreviewOf } from "./cover-preview.mjs";
import { coverBodies, rectOf, eyeElevation, canJudgeCover } from "./cover.mjs";
import { canSee } from "./vision.mjs";
import { committedPosition, distanceBetween, rangeOf } from "./turn.mjs";
import { lengthIn, readUnitFactors } from "./units.mjs";

const centre = r => ({ x: r.x + (r.width / 2), y: r.y + (r.height / 2) });

/**
 * Where, on the line from a to b (0–1), the first obstacle of one of these sources lies. First on the axis of centers;
 * if the axis crosses nothing (the cover comes from the corner lines: a wall section beside the axis), the first obstacle on the
 * lines from the attacker's center to the target's corners, projected onto the axis; null if none.
 */
function firstObstacle(attacker, target, a, b, pa, sources, seenOnly) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if ( length < 1e-6 ) return null;
  const level = attacker.parent.levels?.get?.(pa.level ?? attacker._source.level) ?? undefined;
  const eye = eyeElevation(attacker, pa);
  const bodies = sources.includes("creature") ? coverBodies(attacker, target, seenOnly).map(t => rectOf(t)) : [];
  // The position of a point on the axis a → b (projection), as a fraction.
  const along = p => (((p.x - a.x) * (b.x - a.x)) + ((p.y - a.y) * (b.y - a.y))) / (length * length);
  const hitsOn = end => {
    const hits = [];
    if ( sources.includes("wall") ) {
      const points = CONFIG.Canvas.polygonBackends.move.testCollision({ ...a, elevation: eye }, { ...end, elevation: eye },
        { type: "move", mode: "all", level }) ?? [];
      for ( const p of (Array.isArray(points) ? points : []) ) hits.push(along(p));
    }
    for ( const r of bodies ) {
      const t = segmentEntry(a, end, r);
      if ( t !== null ) hits.push(along({ x: a.x + ((end.x - a.x) * t), y: a.y + ((end.y - a.y) * t) }));
    }
    return hits;
  };
  let hits = hitsOn(b);
  if ( !hits.length ) {
    const inset = attacker.parent.grid.size * 0.1;
    const r = rectOf(target);
    const corners = [{ x: r.x + inset, y: r.y + inset }, { x: r.x + r.width - inset, y: r.y + inset },
      { x: r.x + inset, y: r.y + r.height - inset }, { x: r.x + r.width - inset, y: r.y + r.height - inset }];
    hits = corners.flatMap(hitsOn);
  }
  return hits.length ? Math.max(0, Math.min(1, Math.min(...hits))) : null;
}

/**
 * The line of sight of an attack, for this client; null outside an attack or when the scene is not displayed here.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]          Attacker's position at the end of its approach.
 * @param {boolean} [options.unreachable]  The approach does not arrive, or the target is out of range: the whole line in red.
 * @returns {{from: {x,y}, to: {x,y}, segments: Array, distance: {value: number, units: string}, range: string|null}|null}
 */
export function attackLineOf(attacker, target, activity, { posA, unreachable=false, attackMode=null }={}) {
  if ( (activity?.type !== "attack") || !attacker?.parent || (attacker.parent !== target?.parent) ) return null;
  if ( !canJudgeCover(attacker.parent) ) return null;
  const pa = posA ? { ...committedPosition(attacker), ...posA } : committedPosition(attacker);
  const from = centre(rectOf(attacker, pa));
  const to = centre(rectOf(target));
  const seenOnly = !game.user?.isGM;
  const cover = coverPreviewOf(attacker, target, activity, { posA, attackMode });
  const degree = cover?.degree ?? "none";
  const obstacleAt = (degree !== "none") ? firstObstacle(attacker, target, from, to, pa, cover.sources ?? [], seenOnly) : null;

  const distance = distanceBetween(attacker, target, { posA });
  const range = rangeOf(activity, attackMode);
  const factors = readUnitFactors();
  const issue = rangeIssue(distance, range, factors);
  let rangeEnd = null;
  if ( issue === "outOfRange" ) {
    const reach = lengthIn(range.long ?? range.value, range.units, distance.units, factors);
    rangeEnd = (distance.value > 0) ? Math.max(0, Math.min(1, reach / distance.value)) : 0;
  }
  const unseen = canSee(attacker, target) === false;
  return {
    from, to, distance, range: issue,
    segments: attackLineSegments({ degree, obstacleAt, rangeEnd, unreachable, unseen })
  };
}
