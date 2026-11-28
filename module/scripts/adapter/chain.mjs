/**
 * §286: Chain Lightning — "three bolts then leap from that target toward a maximum of three other targets […] 9 m or less
 * from the first" (key `chain`: `{ radius, units }`). The number of targets is the data's (`affects.count`,
 * "@item.level - 2": group targeting already holds it, §16.33); the first target is the first designated.
 */

import { contentOf } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** The item's chain rule, or null. */
export function chainOf(item) {
  return item ? (contentOf(item).entry?.chain ?? null) : null;
}

/** The limit distance around the first target, in its scene's unit. */
export function chainLimit(rule, first) {
  return lengthIn(rule.radius, rule.units, first.parent.grid.units);
}

/**
 * The secondary targets too far from the first, in designation order.
 * @param {Activity} activity
 * @param {TokenDocument[]} targets  The first one first.
 * @returns {TokenDocument[]}  [] without a rule, or with fewer than two targets.
 */
export function chainOutliers(activity, targets) {
  const rule = chainOf(activity?.item);
  const [first, ...others] = targets ?? [];
  if ( !rule || !first?.parent ) return [];
  const limit = chainLimit(rule, first);
  return others.filter(t => t?.parent && (distanceBetween(first, t).value > limit + 1e-6));
}
