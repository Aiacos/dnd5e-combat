/**
 * Casting spells from a linked creature's space (content key `castFromBearer`): Gaze of Two Minds — the caster may cast as if in
 * their own space or the other creature's while the two are within the stated distance. The link is the item's effect carried by
 * the touched creature. Pure functions.
 */

/** Does the link hold? The creature carries the effect, on the same scene, at this distance or less from the caster (same units). */
export function linkHolds(measured, limit) {
  return Number.isFinite(measured) && Number.isFinite(limit) && (measured <= limit + 1e-6);
}

/** The key's errors. Empty = valid. */
export function validateCastFromBearer(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && Number.isFinite(rule.distance) && (rule.distance > 0)
    && (typeof rule.units === "string") && rule.units && Object.keys(rule).every(k => ["distance", "units"].includes(k));
  return ok ? [] : [`${at}castFromBearer: { distance, units }`];
}
