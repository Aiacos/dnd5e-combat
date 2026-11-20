/**
 * §493 (B13) : réaction d'une créature prise dans une zone (Bouclier d'insectes). Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * La forme de la zone d'une activité (`target.template.type` de dnd5e, config.mjs `areaTargetTypes` : "cone", "line", "sphere",
 * "cube", "cylinder", "radius", "circle", "square", "wall"…), null sans zone.
 * @param {object|null} activity
 * @returns {string|null}
 */
export function areaShapeOf(activity) {
  const type = activity?.target?.template?.type;
  return ((typeof type === "string") && type) ? type : null;
}

/**
 * La créature est-elle épargnée des dégâts de la zone ? Sans `ifSourceFails`, dès que la réaction est prise ; avec, seulement si la
 * sauvegarde de l'auteur est connue et ratée (sauvegarde absente, illisible ou réussie : les dégâts passent).
 * @param {{taken: boolean, ifSourceFails?: boolean, sourceSave?: {success?: boolean}|null}} args
 */
export function sparedFromArea({ taken, ifSourceFails=false, sourceSave=null }) {
  if ( !taken ) return false;
  if ( !ifSourceFails ) return true;
  return sourceSave?.success === false;
}
