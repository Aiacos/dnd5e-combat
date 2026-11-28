/**
 * §211: Ready (2024 rules) — an action prepared on one's turn, played later with the Reaction, when a perceivable trigger
 * occurs, until the start of one's next turn. Pure functions: the plan, and what triggers it.
 *
 * The plan is stored in the turn budget (`readied`, core/turn.mjs): reset at the start of the combatant's turn, it expires with it.
 */

/** The offered triggers: an enemy comes within range of the prepared action, attacks, casts a spell. */
export const READY_TRIGGERS = Object.freeze(["enters", "attacks", "casts"]);

/** The budget's prepared plan, or null (`readied: true` without a plan: the action taken, the trigger left to the table). */
export function readyPlanOf(budget) {
  const plan = budget?.readied;
  return (plan && (typeof plan === "object") && plan.activity && READY_TRIGGERS.includes(plan.trigger)) ? plan : null;
}

/**
 * Does what a creature did trigger this plan?
 * @param {object} plan
 * @param {{kind: "enters"|"attacks"|"casts", source: string}} event  `source`: the uuid of the token that acted.
 * @param {{enemies: boolean, reactionAvailable: boolean, incapacitated?: boolean, sees?: boolean|null}} state
 */
export function readyTriggered(plan, event, state) {
  if ( !plan || !event || (plan.trigger !== event.kind) ) return false;
  if ( plan.target && (plan.target !== event.source) ) return false;
  return !!state?.enemies && !!state.reactionAvailable && !state.incapacitated && (state.sees !== false);
}

/**
 * The range that arms the "comes within range" trigger, in the activity's length units: the reach of a melee attack, the normal
 * range of a ranged attack or a spell; "touch" is 5 ft; "self", the size of its area (Burning Hands: its Cone); an unlimited or
 * special range, null (no range trigger).
 * @param {{melee: boolean, reach?: number|null, range?: {value?: number|null, units?: string},
 *   template?: {size?: number|null, units?: string}}} a
 * @returns {{value: number, units: string}|null}
 */
export function readyReach(a) {
  if ( a.melee ) return { value: Number(a.reach) || 5, units: a.range?.units && !["touch", "self"].includes(a.range.units) ? a.range.units : "ft" };
  const units = a.range?.units ?? "ft";
  if ( units === "touch" ) return { value: 5, units: "ft" };
  if ( units === "self" ) return { value: Number(a.template?.size) || 5, units: a.template?.units || "ft" };
  const value = Number(a.range?.value);
  return (Number.isFinite(value) && (value > 0)) ? { value, units } : null;
}
