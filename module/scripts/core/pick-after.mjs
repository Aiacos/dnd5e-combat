/**
 * §438 : une manifestation suivie d'une sauvegarde « sur une créature de votre choix dans l'émanation » (Courroux des mers du Manuel
 * 3.0.0 : l'activité utilitaire « Manifest Ocean Spray » pose l'émanation, la sauvegarde est l'activité sœur). La règle 2024 enchaîne
 * les deux sous la même action Bonus (décision de l'utilisateur, 2026-11-14) : `pickTargets.after` nomme, pour l'activité qui manifeste,
 * l'activité qui suit et autour de qui l'on choisit (`self` : le lanceur ; `targets` : les créatures visées par la manifestation —
 * Courroux des mers « Another », niveau 14). Règles pures.
 */

/** Ce qui suit l'utilisation de cette activité, ou null. Une activité qui résout elle-même (forme 2.2.0 : la sauvegarde) n'enchaîne rien. */
export function chainedPickOf(rule, activityId, activityType) {
  const next = rule?.after?.[activityId] ?? null;
  return (next && (activityType === "utility")) ? next : null;
}

/** La liste de choix vaut-elle pour cette activité ? Pas pour la manifestation utilitaire, qui pose l'émanation au lieu de viser. */
export function picksFor(rule, activityId, activityType) {
  if ( !rule?.activities?.includes(activityId) ) return false;
  return !chainedPickOf(rule, activityId, activityType);
}

/**
 * La distance retenue d'une créature : la plus courte à l'un des centres, chacun avec son rayon. Rend null hors de toute émanation.
 * @param {Array<{distance: number, radius: number}>} centers
 * @returns {number|null}
 */
export function withinCenters(centers) {
  const inside = centers.filter(c => Number.isFinite(c.distance) && (c.distance <= c.radius + 1e-6)).map(c => c.distance);
  return inside.length ? Math.min(...inside) : null;
}
