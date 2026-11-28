/**
 * §493 (B13): reaction of a creature caught in an area ("Insect Shield"). Pure functions, no dependency on Foundry.
 */

/**
 * The shape of an activity's area (dnd5e's `target.template.type`, config.mjs `areaTargetTypes`: "cone", "line", "sphere",
 * "cube", "cylinder", "radius", "circle", "square", "wall"…), null with no area.
 * @param {object|null} activity
 * @returns {string|null}
 */
export function areaShapeOf(activity) {
  const type = activity?.target?.template?.type;
  return ((typeof type === "string") && type) ? type : null;
}

/**
 * Is the creature spared the area's damage? Without `ifSourceFails`, as soon as the reaction is taken; with it, only if the
 * author's save is known and failed (save absent, unreadable or successful: the damage goes through).
 * @param {{taken: boolean, ifSourceFails?: boolean, sourceSave?: {success?: boolean}|null}} args
 */
export function sparedFromArea({ taken, ifSourceFails=false, sourceSave=null }) {
  if ( !taken ) return false;
  if ( !ifSourceFails ) return true;
  return sourceSave?.success === false;
}
