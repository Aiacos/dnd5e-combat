/**
 * Straight-line rush (SPEC §57, "Wind Strike"): arrival cell, creatures passed through, use without a template. Extracted from
 * runtime/actions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { committedPosition, distanceBetween, usageTokenOf } from "../adapter/turn.mjs";
import { straightCells } from "../core/dash.mjs";
import { describeTarget } from "../adapter/areas.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { transposeOf } from "../adapter/pilot.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { walk, cellOf } from "../adapter/movement.mjs";
import { canSeePoint, isVisionAvailable } from "../adapter/vision.mjs";
import { loc, notice, log } from "./shared.mjs";
import { occupiedAt } from "./actions.mjs";
import { relaunchUse } from "./relaunch.mjs";

/* -------------------------------------------- */
/*  Straight-line rush (§57)                    */
/* -------------------------------------------- */

/** The straight-line rush an activity declares (`lineDash`), or null. */
export function lineDashOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.lineDash : null;
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return rule;
}

/** "A maximum distance equal to its speed": the walking Speed, in the scene's unit (null: none). */
export function dashLimit(token) {
  const movement = token.actor?.system.attributes?.movement;
  const walk = Number(movement?.speeds?.walk ?? movement?.walk);
  if ( !Number.isFinite(walk) ) return null;
  return lengthIn(walk, movement.units ?? token.parent.grid.units, token.parent.grid.units);
}

/**
 * What forbids this arrival cell, or null: too far, in place, occupied, out of sight, or a wall on the straight line
 * (the rush passes creatures, not walls). Returns `[clé de notification, clé du retour au curseur]`.
 */
export function dashProblem(token, to, limit) {
  if ( (cellOf(token, to).i === cellOf(token).i) && (cellOf(token, to).j === cellOf(token).j) ) return ["Ruee.SurPlace", null];
  const travelled = distanceBetween(token, token, { posB: { x: to.x, y: to.y } }).value;
  if ( (limit !== null) && (travelled > limit + 1e-6) ) return ["Teleport.TropLoin", "Retour.TropLoin"];
  if ( occupiedAt(token, to) ) return ["Teleport.CaseOccupee", "Retour.CaseOccupee"];
  const center = token.getCenterPoint ? token.getCenterPoint(to) : { x: to.x, y: to.y };
  if ( isVisionAvailable() && (canSeePoint(token, { ...center, elevation: to.elevation ?? 0 }) === false) ) return ["Teleport.NonVue", "Retour.NonVue"];
  const from = token.getCenterPoint ? token.getCenterPoint(committedPosition(token)) : null;
  if ( from && token.object?.checkCollision(center, { origin: from, type: "move", mode: "any" }) ) return ["Ruee.Mur", "Retour.Mur"];
  return null;
}

/**
 * The creatures at `reach` or less from a space the creature passes through from its cell to `to` ("each creature located 1.50 m
 * or less from a space it passes through"): alive, not hidden, on its level — allies included, itself excepted.
 * Engine distance (3D, grid diagonals) from each position of the path.
 */
export function dashTargets(token, to, rule) {
  const grid = token.parent.grid;
  let reach = lengthIn(rule.reach, rule.units, grid.units);
  const path = straightCells(cellOf(token), cellOf(token, to)).map(c => grid.getTopLeftPoint(c));
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const level = token._source.level ?? null;
  return token.parent.tokens.filter(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && !other.actor.statuses?.has(defeated) && ((other._source.level ?? null) === level)
    && path.some(p => distanceBetween(token, other, { posA: { x: p.x, y: p.y } }).value <= reach + 1e-6));
}

/**
 * What refuses this arrival cell (top-left corner) for this activity's rush, in plain text, or null: the cell is fine.
 * For aiming (ui/pointer.mjs), which shows it on hover and keeps the aim open on a refused click.
 * @returns {{text: string, short: string}|null}
 */
export function dashRefusal(activity, destination) {
  const token = usageTokenOf(activity);
  if ( !token || !lineDashOf(activity) ) return { text: "", short: "" };
  const limit = dashLimit(token);
  const problem = dashProblem(token, { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 }, limit);
  if ( !problem ) return null;
  const text = loc(problem[0], { distance: limit, units: token.parent.grid.units });
  // §412: too far, cell taken, not in sight — rules, forceable; in place, a wall on the path — not.
  return { text, short: problem[1] ? loc(problem[1]) : text, forceable: DASH_FORCEABLE.has(problem[0]), occupied: problem[0] === "Teleport.CaseOccupee" };
}

/** §412: the rush refusals that can be forced. */
const DASH_FORCEABLE = new Set(["Teleport.TropLoin", "Teleport.CaseOccupee", "Teleport.NonVue"]);

/** The creatures a rush to this cell would touch (preview on hover). */
export function dashPreview(activity, destination) {
  const token = usageTokenOf(activity);
  const rule = lineDashOf(activity);
  if ( !token || !rule ) return [];
  return dashTargets(token, { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 }, rule);
}

/**
 * "Straight-line rush" intent ("Wind Strike"), the chosen arrival cell (an aiming click, ui/pointer.mjs; a cell given by a
 * scenario): the activity is used WITHOUT a template, with the creatures near the path as targets; the
 * movement happens after the use (`onDashUsed`: legality may have suspended it and then relaunched it).
 * NB: the core's planning (`Token#planMovement`) is not suitable here — it is only validated by DRAGGING the token
 * (client/canvas/placeables/token.mjs:5093, `_prepareDragLeftDropUpdates`), not by a click on the cell.
 * @param {Activity} activity
 * @param {[object, object, object]} usage   Use, dialog and message configurations received.
 * @param {{x: number, y: number}} destination  Arrival cell (top-left corner).
 * @returns {Promise<boolean>}  true if the activity was launched.
 */
export async function dashStrike(activity, [config, dialog, message]=[], destination, { forced=false }={}) {
  const rule = lineDashOf(activity);
  const token = usageTokenOf(activity);
  if ( !rule || !token || !destination ) return false;
  const refusal = dashRefusal(activity, destination);
  // §412: forced (the window was already seen, ui/pointer-mouse.mjs), a rush refused for a rule goes ahead anyway.
  if ( refusal && !(forced && refusal.forceable) ) throw new Error(refusal.text);
  const to = { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 };
  const targets = dashTargets(token, to, rule);
  log(`${token.name}: ${activity.item.name} to (${to.x}, ${to.y}) — ${targets.map(t => t.name).join(", ") || "nobody"} near the path`);
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), dash: { token: token.uuid, x: to.x, y: to.y, elevation: to.elevation, ...(refusal?.occupied ? { occupied: true } : {}) } } };
  const card = foundry.utils.mergeObject(message ?? {}, { data: {
    system: { targets: targets.map(describeTarget) },
    flags: { [MODULE_ID]: { dash: { x: to.x, y: to.y } } }
  } }, { inplace: false });
  const results = await relaunchUse(activity, use, { ...(dialog ?? {}), configure: false }, card);
  return !!results;
}

/** The use done (legality included), the creature rushes: `blink`, no Opportunity Attack, no walls, no budget. */
export async function onDashUsed(activity, usageConfig, results) {
  const dash = usageConfig?.[MODULE_ID]?.dash;
  if ( !dash || !results ) return;
  const token = fromUuidSync(dash.token, { strict: false });
  if ( !token?.isOwner ) return;
  await token.move([{ x: dash.x, y: dash.y, elevation: dash.elevation ?? token._source.elevation ?? 0, action: "blink", snapped: true }],
    { ...(dash.occupied ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { cleared: true } });
}

/** The "Place the area" button on a rush's card: nothing to place, the targets are already on the card. */
export function onDashTemplate(activity) {
  if ( !lineDashOf(activity) ) return;
  ui.notifications.info(loc("Ruee.PasDeZone", { item: activity.item.name }));
  return false;
}

/**
 * §38.2: "swap places with the illusion" intent ("Trickster's Swap"), from the illusion or its caster: two crossed teleportations
 * (`blink`: no Opportunity Attack, no billed command — runtime/pilot.mjs ignores a teleportation), which pass the engine's
 * movement checks (`cleared`); the swap's turn is noted on the illusion (once per turn).
 * @param {TokenDocument} token
 * @returns {Promise<boolean>}  true if the swap took place.
 */
export async function transpose(token) {
  const pair = transposeOf(token);
  if ( !pair ) { ui.notifications.warn(loc("Troc.Impossible")); return false; }
  const { caster, illusion } = pair;
  const at = t => { const s = t._source; return { x: s.x, y: s.y, elevation: s.elevation ?? 0, level: s.level ?? null }; };
  const from = at(caster);
  const to = at(illusion);
  const options = { constrainOptions: { ignoreWalls: true, ignoreTokens: true }, [MODULE_ID]: { cleared: true } };
  await illusion.move([{ ...from, snapped: true, action: "blink" }], options);
  await caster.move([{ ...to, snapped: true, action: "blink" }], options);
  if ( pair.turnKey ) await illusion.setFlag(MODULE_ID, "transposedTurn", pair.turnKey);
  notice(caster, loc("Troc.Fait", { name: caster.name }), "gain");
  return true;
}
