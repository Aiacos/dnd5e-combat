/**
 * Familiars (SPEC §107): Find Familiar (PHB 2024, `find-familiar`), the druid's Wild Companion (`wild-companion`) and the
 * warlock's Pact of the Chain (`pact-of-the-chain`), declared `summon.familiar` (content/summons.mjs). Pure functions.
 *
 * Rules (PHB 2024, Find Familiar): "a familiar can't attack, but it can take other actions as
 * normal"; "as a Magic action, you can temporarily dismiss the familiar into a pocket dimension";
 * "as a Magic action while it is temporarily dismissed, you can make it reappear in an unoccupied space within
 * 9 m of you"; "whenever the familiar drops to 0 Hit Points or disappears into the pocket dimension, it
 * leaves behind in its space anything it was carrying".
 */

/** The distance at which the familiar reappears, in feet (rule constant, converted like the rest: SPEC §5.7). */
export const RECALL_RANGE = Object.freeze({ value: 30, units: "ft" });

/** The cost of each of the master's gestures in combat: the Magic action, an action. */
export const POCKET_COST = "action";

/**
 * The basic actions a familiar receives: all except those that attack (`attack: true` in the table — the unarmed
 * attack and its Grapple / Shove).
 * @param {Record<string, {attack?: boolean}>} table  BASIC_ACTIONS (content/actions.mjs).
 * @returns {string[]}
 */
export function familiarBasicKinds(table) {
  return Object.entries(table ?? {}).filter(([, def]) => def?.attack !== true).map(([kind]) => kind);
}

/** Item types a creature carries (objects), as opposed to its abilities. */
const CARRIED_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/**
 * What the familiar "carries": the objects on its sheet, except its natural weapons (Talons, Bite: weapon of type "natural"),
 * its natural armor (equipment "natural") and the engine's items (basic actions). Plain data:
 * `{ id, type, system: { type: { value } }, flags }`.
 * @param {object[]} items
 * @param {string} moduleId
 * @returns {string[]}  The ids.
 */
export function carriedItemIds(items, moduleId) {
  return (items ?? []).filter(i => CARRIED_TYPES.has(i?.type)
    && !(((i.type === "weapon") || (i.type === "equipment")) && (i.system?.type?.value === "natural"))
    && !i.flags?.[moduleId]?.basicAction).map(i => i.id ?? i._id);
}

/**
 * What refuses the reappearance cell: "far" (beyond range), "occupied" (a creature occupies it), or null.
 * @param {{distance: number, limit: number, occupied: boolean}} args
 */
export function recallProblem({ distance, limit, occupied }) {
  if ( !Number.isFinite(distance) || (distance > limit + 1e-6) ) return "far";
  if ( occupied ) return "occupied";
  return null;
}

/**
 * The creation data of the token coming back from the pocket: those of the dismissed token (its delta included: HP, effects,
 * items), without its id or its statistics, without a follow order, placed at the chosen cell, at the master's level and elevation.
 * @param {object} stored    `TokenDocument#toObject()` at the time of dismissal.
 * @param {{x: number, y: number, elevation?: number, level?: string|null}} at
 * @param {string} moduleId
 */
export function recalledTokenData(stored, { x, y, elevation=0, level=null }, moduleId) {
  const { _id, _stats, ...data } = structuredClone(stored ?? {});
  const ours = data.flags?.[moduleId];
  if ( ours ) {
    delete ours.follow;
    if ( !Object.keys(ours).length ) delete data.flags[moduleId];
  }
  // The trace of the previous movement (V14: `_movementHistory`) no longer applies to this new token.
  delete data._movementHistory;
  return { ...data, x, y, elevation, ...(level ? { level } : {}) };
}
