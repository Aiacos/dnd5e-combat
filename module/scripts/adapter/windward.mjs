/**
 * §403: Gust of Wind (`windward`) — the extra cost of a path toward the caster in the lasting Line (core/windward.mjs).
 * The areas: those of the scene whose item declares `windward`, the caster read from the area's state (`source`).
 * Costs: those of the core path's points (`cost`), otherwise the distance measured on the grid.
 */

import { windwardExtra } from "../core/windward.mjs";
import { contentOf } from "./content.mjs";
import { lastingRegions, readAreaState, isInside } from "./areas.mjs";

/** The scene's `windward` areas, with the token of their caster. */
function windwardZones(scene) {
  return lastingRegions(scene).map(region => {
    const state = readAreaState(region);
    const item = game.messages.get(state?.usage)?.getAssociatedActivity?.()?.item;
    if ( !item || (contentOf(item).entry?.windward !== true) ) return null;
    const caster = state.source ? fromUuidSync(state.source, { strict: false }) : null;
    return caster ? { region, caster } : null;
  }).filter(Boolean);
}

/**
 * The extra cost, in grid units, of the path `origin` → `waypoints` (token positions), or 0.
 * @param {TokenDocument} token
 * @param {object} origin
 * @param {object[]} waypoints
 */
export function windwardCost(token, origin, waypoints) {
  const scene = token?.parent;
  if ( !scene || !waypoints?.length ) return 0;
  const zones = windwardZones(scene).filter(z => z.caster !== token);
  if ( !zones.length ) return 0;
  const positions = [origin, ...waypoints].map(w => ({ ...token._source, ...w }));
  let extra = 0;
  for ( const { region, caster } of zones ) {
    const points = positions.map((p, i) => {
      const center = token.getCenterPoint(p);
      const cost = (i === 0) ? 0 : (Number.isFinite(p.cost) ? p.cost
        : scene.grid.measurePath([token.getCenterPoint(positions[i - 1]), center]).distance);
      return { x: center.x, y: center.y, inside: isInside(token, region, p), cost };
    });
    extra += windwardExtra(points, caster.getCenterPoint(caster._source));
  }
  return extra;
}
