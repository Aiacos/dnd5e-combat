/**
 * §86: an area that the content has placed automatically (`selfZone`, by activity id). Yolande's Regal Presence ("Surround Self")
 * and Conjure Woodland Beings ("Cast") do have a 10 ft Emanation — inherited from the item's target (`override: false`) —,
 * but `target.prompt` is false: dnd5e provides no placement (`create.measuredTemplate`, activity/mixin.mjs:451), so neither
 * area nor replay. The content says "place it" and gives the template, which is only used if the data has none. §91: an activity
 * that is not of personal range ("Interdiction", touch) has this template placed with the mouse (runtime/self-area.mjs,
 * `withTemplate`). Read by the self placement (adapter/self-area.mjs, runtime/self-area.mjs), the elevation slice and the sphere
 * (adapter/space.mjs), the plan (adapter/usage.mjs).
 */

import { contentOf } from "./content.mjs";

/** The template that the content declares for this activity, or null. */
function declaredZone(activity) {
  return activity?.item ? (contentOf(activity.item).entry?.selfZone?.[activity.id] ?? null) : null;
}

/**
 * The activity's template: the data's if it has a type, otherwise the one the content declares.
 * @param {Activity} activity
 * @returns {{type: string, size?: number, width?: number, height?: number, units?: string, count?: number|string,
 *   stationary?: boolean}|null}
 */
export function templateOf(activity) {
  const own = activity?.target?.template;
  if ( own?.type ) return own;
  const declared = declaredZone(activity);
  return declared ? { count: 1, ...declared } : null;
}

/**
 * §91: the activity seen with the supplied template — for dnd5e's mouse placement (`TemplatePlacement.fromActivity`, which reads
 * only `target.template`, the item, the uuid, `getRollData` and `getUsageToken`). Nothing is written: a read-only proxy.
 * @param {Activity} activity
 * @returns {Activity}
 */
export function withTemplate(activity) {
  const target = { ...activity.target, template: templateOf(activity) };
  return new Proxy(activity, {
    get(object, key) {
      if ( key === "target" ) return target;
      const value = Reflect.get(object, key, object);
      return (typeof value === "function") ? value.bind(object) : value;
    }
  });
}

/** Does the content have this activity's area placed automatically, whether or not dnd5e provides for it? */
export function suppliesTemplate(activity) {
  return !!declaredZone(activity);
}
