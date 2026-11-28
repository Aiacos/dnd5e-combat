/**
 * What the engine publishes for an external interface (SPEC §40.1): `game.modules.get("dnd5e-combat").api.ui`. Read-only,
 * on any client; no rule here — the same reads as the tracker (ui/budget.mjs), the legality check (runtime/turn.mjs `useIssues`)
 * and the movement cap (runtime/actions.mjs `movementCap`). The engine knows no interface: an interface that copied these
 * computations (the combatant's `turn` flag, the token's history) reads them here.
 */

import { reactionAvailable, movementAllowance } from "../core/turn.mjs";
import { combatantFor, currentTurnKey, isOwnTurn, readBudget, movementOf, historyCosts, costFor } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { multiattackLeft } from "../adapter/multiattack.mjs";
import { movementCap } from "../runtime/actions.mjs";
import { useIssues } from "../runtime/turn.mjs";
import { refusal } from "../runtime/forced.mjs";
import { lightState, globalLightState } from "./illumination.mjs";
import { menuEntriesFor, doorMenuFor, groundMenuFor, pendingTargeting } from "./pointer.mjs";
import { poolsOf } from "../adapter/absorb.mjs";
import { movableZoneOf } from "../runtime/zones.mjs";
import { carriedLightsOf, carriedLightState } from "../adapter/lights.mjs";
import { spellWeapons } from "../adapter/traces.mjs";
import { toggleCarriedLight } from "../runtime/lights.mjs";
import { ritualModeOf } from "../adapter/grimoire.mjs";
import { potionOptions } from "../runtime/potion-choice.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { startTimer } from "./timers.mjs";
import { awaitingState } from "./awaiting.mjs";
import { climbingOf } from "../adapter/climb.mjs";
import { coverPreviewOf } from "../adapter/cover-preview.mjs";

/**
 * The budget of a combatant's turn, as the engine judges it: an action stays available as long as the Attack action has
 * attacks left to give; the Reaction follows "not two in the same turn" (§19.6). null outside a started combat.
 * Who may see it is the interface's business (the engine's tracker: ui/budget.mjs `budgetVisible`).
 * @param {Combatant} combatant
 * @returns {{action: boolean, bonus: boolean, reaction: boolean, attacks: {used: number, granted: number, left: number},
 *            dashed: boolean, disengaged: boolean, dodging: boolean, ownTurn: boolean}|null}
 */
function budget(combatant) {
  if ( !combatant?.actor || !combatant.combat?.started ) return null;
  const b = readBudget(combatant);
  const left = Math.max(0, b.attacks.granted - b.attacks.used);
  return {
    action: (b.action > 0) || (left > 0), bonus: b.bonus > 0, reaction: reactionAvailable(b, currentTurnKey()),
    attacks: { used: b.attacks.used, granted: b.attacks.granted, left },
    dashed: !!b.dashed, disengaged: !!b.disengaged, dodging: !!b.dodging, ownTurn: isOwnTurn(combatant)
  };
}

/**
 * The movement of a token's turn in combat, in the grid's unit: spent (stairs and survey included,
 * teleports excluded), allowed (speed, Dash, movement opened by an effect), and what **really** remains — the
 * cap the engine applies to walking (dragged victim, turn ended by an order). null outside combat or without speed.
 * @param {Token|TokenDocument} token
 * §196: plus `mode` (the token's movement action: `walk`, `climb`, `fly`…) and `multiplier` (what one foot costs in this mode:
 * 2 when climbing with no climb speed, dnd5e's cost; 1 otherwise) — so an interface's ring follows the climber.
 * @returns {{spent: number, allowance: number, left: number, speed: number, units: string, dashed: boolean, mode: string|null,
 *            multiplier: number}|null}
 */
function movement(token) {
  const doc = token?.document ?? token;
  const combatant = doc?.actor ? combatantFor(doc.actor) : null;
  const m = combatant ? movementOf(combatant, readUnitFactors()) : null;
  if ( !m ) return null;
  const b = readBudget(combatant);
  const allowance = movementAllowance(b, m.speed);
  // The cap is compared with the core's history, teleports included (runtime/actions.mjs `movementCap`).
  const history = historyCosts(doc);
  const cap = movementCap(doc);
  const left = b.stopped ? 0 : Math.max(0, Number.isFinite(cap) ? cap - history.spent - history.excluded : allowance - m.spent);
  const mode = doc._source?.movementAction ?? null;
  const multiplier = (mode === "climb") ? (climbingOf(doc).multiplier ?? 1) : 1;
  return { spent: m.spent, allowance, left, speed: m.speed, units: m.units, dashed: !!b.dashed, mode, multiplier };
}

/**
 * What is wrong if this activity were used now, before knowing who it targets (budget and turn, slot already
 * cast this turn, Silence, usage limits, conditions that prevent acting, Rage): the reasons, translated; empty = nothing.
 * @param {Activity} activity
 * @param {{cost?: string|null, attackMode?: string|null, recast?: boolean}} [options]
 * @returns {string[]}
 */
function issues(activity, options={}) {
  if ( !activity?.actor ) return [];
  options = { ...potionCost(activity), ...options };
  // §111: a movable area already placed (Moonbeam) — using it moves it, with no slot; costing nothing if its
  // rule says so (`movable.cost: "none"`).
  const zone = movableZoneOf(activity);
  if ( !zone ) return useIssues(activity, options).lines;
  return useIssues(activity, { ...options, recast: true, ...(zone.rule.cost === "none" ? { cost: "free" } : {}) }).lines;
}

/**
 * Issue #31: a healing potion that the house rule has drunk using the action (the Bonus Action already taken) — its cost is the
 * action, not the data's: an interface does not gray it out for lack of a Bonus Action.
 */
function potionCost(activity) {
  try { const p = potionOptions(activity); return (p && !p.ask && (p.mode === "action")) ? { cost: "action" } : {}; } catch { return {}; }
}

/**
 * §137: what this activity would cost the turn's budget, as the engine will judge it — "action", "bonus", "reaction",
 * something else or null. Differs from the data's activation when a rule changes it (Observant: Search as a Bonus Action,
 * while it is free).
 * @param {Activity} activity
 * @returns {string|null}
 */
function cost(activity) {
  if ( !activity?.actor ) return null;
  // A movable area already placed that its rule moves at no cost (`movable.cost: "none"`).
  if ( movableZoneOf(activity)?.rule.cost === "none" ) return null;
  // §145: the cost after the turn rules (Martial Arts: the unarmed strike as a Bonus Action once the action is taken), otherwise
  // that of the data and the fixed rules (Observant).
  try { return useIssues(activity, potionCost(activity)).request?.cost ?? costFor(activity) ?? null; } catch { return null; }
}

/**
 * §205: the reasons (`issues`) and the cost (`cost`) of an interface cell in a single computation. Both go through `useIssues`: a
 * bar that asked for them separately did it twice per cell (28 cells: ~14 ms each, measured on 2026-10-18 in darsh-dnd-ui).
 * Same values as `issues(activity)` and `cost(activity)`: a movable area already placed (Moonbeam) keeps its "on relaunch" reasons
 * and its data cost, computed separately as before.
 * @param {Activity} activity
 * @returns {{ issues: string[], cost: string|null }}
 */
function cell(activity) {
  if ( !activity?.actor ) return { issues: [], cost: null };
  const zone = movableZoneOf(activity);
  if ( zone ) return { issues: issues(activity), cost: cost(activity) };
  let result;
  try { result = useIssues(activity, potionCost(activity)); } catch { return { issues: issues(activity), cost: null }; }
  // §410: `resources` — the engine also judges slots, uses, quantity and preparation (an interface no longer has to judge them);
  // `forceable` — all these reasons open in the "Use anyway" window (§408). Issue #46: false when this client cannot
  // override (the "Impossible action" setting in strict refusal, on a player) — an interface can show a padlock.
  return { issues: result.lines, cost: result.request?.cost ?? costFor(activity) ?? null, resources: true,
    forceable: refusal().proceed !== false };
}

/**
 * §111: does the activity have a movable area already placed (Moonbeam)? Using it then moves it (ui/pointer.mjs, §16.14):
 * nothing is cast, no slot is spent — an interface must neither gray it out for lack of a slot nor ask for a level.
 * @param {Activity} activity
 * @returns {boolean}
 */
function movableZone(activity) {
  return !!movableZoneOf(activity);
}

/**
 * §18.19: what remains of the Multiattack opened this turn by this actor — uuids of the items still playable (`left`),
 * of those of the plan that have nothing left (`spent`), names of the first ones. null with no open plan.
 * @param {Actor5e} actor
 * @returns {{left: string[], spent: string[], names: string[]}|null}
 */
function multiattack(actor) {
  const combatant = actor ? combatantFor(actor) : null;
  const multi = combatant ? readBudget(combatant).multi : null;
  const status = multi ? multiattackLeft(actor, multi) : null;
  return status ? { left: [...status.left], spent: [...status.spent], names: [...status.names] } : null;
}

/**
 * §108: the pools that absorb this actor's damage, active (Arcane Ward created since the last Long Rest):
 * remaining points and maximum (the item's uses, adapter/absorb.mjs). Empty with no active pool.
 * @param {Actor5e} actor
 * @returns {Array<{name: string, img: string, identifier: string, value: number, max: number}>}
 */
function wards(actor) {
  return poolsOf(actor).map(({ item, pool }) => ({ name: item.name, img: item.img, identifier: identifierOf(item).id ?? "",
    value: pool, max: Number(item.system.uses?.max) || pool }));
}

/**
 * §139: how this spell would be cast now — "ritual": as a ritual outright (no slot, even unprepared with Ritual Adept);
 * "ask": the player will choose ritual or slot; "none": as usual. An interface does not gray out a
 * "ritual" spell for lack of preparation or of a slot.
 * @param {Activity} activity
 * @returns {"none"|"ritual"|"ask"}
 */
function ritual(activity) {
  try { return ritualModeOf(activity); } catch { return "none"; }
}

/** A document by itself or by its uuid; a Token (canvas object) by its document. */
const docOf = x => (typeof x === "string") ? fromUuidSync(x, { strict: false }) : (x?.document ?? x);

/**
 * #33: the Cover `target` would have against an attack by `attacker` with `activity`, as THIS client can show it — the computation
 * of the verdict, but a player counts only the creatures they see (the Invisible does not give itself away); "none" is a result.
 * @param {TokenDocument|Token|string} attacker
 * @param {TokenDocument|Token|string} target
 * @param {Activity|string} activity     An attack activity.
 * @param {object} [options]             `posA`: the attacker's position at the end of an approach; `attackMode`.
 * @returns {{degree: string, bonus: number|null, sources: string[], zone: string|null, manual: boolean,
 *            ignored: {degree: string, by: string}|null}|null}  null: not an attack, or the scene is not displayed here.
 */
function cover(attacker, target, activity, options={}) {
  try { return coverPreviewOf(docOf(attacker), docOf(target), docOf(activity), options); } catch { return null; }
}

export const uiApi = {
  /**
   * §272: `timer({ token, seconds, label?, icon?, id? })` — a timer above the token, on every client that sees it
   * (turning gear, gauge with the DAS gradient); returns `{ id, done, stop() }` (`stop`: gesture interrupted, everywhere).
   */
  timer: startTimer,
  /**
   * §381 (issue #35): `awaiting()` — whom the table is waiting for:
   * `[{ id, userId, userName, token, actor, kind, gm, player, since, seconds, refreshed, shown }]` (uuids; `kind`: "reaction",
   * "choice" or "roll"; `seconds`: the window's delay, null with no delay; `shown`: what THIS client shows of it, "token", "banner"
   * or "none"). Never what the window asks. Its changes are published through the hook `dnd5e-combat.awaiting` (the list, without
   * `shown`), on every client.
   */
  awaiting: awaitingState,
  budget, wards, movableZone, movement, issues, cost, cell, ritual, multiattackLeft: multiattack, light: lightState, globalLight: globalLightState,
  /**
   * Issue #31: `potion(activity)` — the house rule for healing potions (setting `potionHealing`): null if it does not apply
   * (setting off, something other than a healing potion as a Bonus Action); otherwise
   * `{ ask, mode, available: { bonus, action }, formula, max }` — `ask`: offer the choice (otherwise the engine takes `mode`).
   * The interface passes the choice to the use:
   * `activity.use({ "dnd5e-combat": { potionMode: "bonus" | "action" } })` — action: maximum healing (`max`), cost of an action.
   */
  potion: activity => { try { return potionOptions(activity); } catch { return null; } },
  /** §41.4: `tokenMenu(token)` — the entries of this token's context menu for the token in hand (ui/pointer.mjs). */
  tokenMenu: menuEntriesFor,
  /** `doorMenu(wall)`, `groundMenu({ x, y })` — the menu of a door, of a cell, for the token in hand (ui/pointer-menu.mjs). */
  doorMenu: doorMenuFor,
  groundMenu: groundMenuFor,
  /**
   * §118: `targeting()` — the aiming this client awaits (`{ token, activity, identifier }`, uuids), or null. As long as it is
   * open, the left click belongs to the engine; its changes are published through the hook `dnd5e-combat.targeting`
   * (ui/pointer.mjs). §119: plus `kind`, `item`, `prompt` (translated instruction) and `picked` / `total` (multiple aiming);
   * the hook also fires at each creature picked or removed.
   */
  /** #33: `cover(attacker, target, activity, { posA?, attackMode? })` — the Cover preview for this client (see above). */
  cover,
  targeting: pendingTargeting,
  /**
   * §121: `carriedLights(actor)` — the actor's carried light sources: `{ uuid, name, img, lit, left, full, fuel }` (`left`,
   * `full` in seconds or null; `fuel`: `{ identifier, name, quantity }` or null). `toggleLight(item, on?)` — turn on or off
   * (item or uuid; `on` absent: the opposite), on the bearer's client; returns `{ changed, lit?, left?, refilled?, reason? }`.
   */
  carriedLights: actor => carriedLightsOf(actor).map(carriedLightState),
  /**
   * §554: the actor's active spell weapons (a spell that puts an attack in hand while it lasts: Flame Blade, Produce Flame) —
   * `[{ uuid, item, itemId, activityId, effect, name, img, level, favorite }]`, `uuid` the attack activity. Hook
   * `dnd5e-combat.spellWeapon` when one appears or goes.
   */
  spellWeapons: actor => spellWeapons(actor),
  /**
   * The state of a carried light source (item or uuid): `{ uuid, name, img, lit, left, full, fuel }`, or null if the item is not
   * one.
   */
  carriedLight: item => carriedLightState(typeof item === "string" ? fromUuidSync(item, { strict: false }) : item),
  /**
   * §121: turns a carried source on or off (item or uuid; `on` absent: the opposite), on the bearer's client →
   * `{ changed, lit?, left?, refilled?, reason? }`.
   */
  toggleLight: (item, on=null) => toggleCarriedLight(typeof item === "string" ? fromUuidSync(item, { strict: false }) : item, on) };
