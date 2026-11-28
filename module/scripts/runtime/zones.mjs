/**
 * Movable area (SPEC §16.14, B18): Moonbeam — "a Magic action on your later turns to move the
 * Cylinder by 18 m at most". Relaunching the spell when its area is already there moves it (ui/pointer.mjs: aiming at a
 * cell); here, the intent (on the client of whoever acts: distance, turn, budget) and its execution by the active GM
 * (request: a player cannot modify a region). The creatures the area now covers make their
 * saving throw: it is the area that "comes onto them" (runtime/areas.mjs, `onUpdateRegion`).
 */

import { MODULE_ID } from "../constants.mjs";
import { canMoveArea, turnKeyOf } from "../core/area.mjs";
import { checkUse, spendUse, zoneMoveCost } from "../core/turn.mjs";
import { activeZoneOf, zoneCenter, moveZoneTo, readAreaState } from "../adapter/areas.mjs";
import { combatantFor, isOwnTurn, readBudget, writeBudget } from "../adapter/turn.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askAnyway } from "./turn.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { log, loc, viaActiveGM } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";

export const MOVE_ZONE_QUERY = `${MODULE_ID}.moveZone`;

/** What an activity can move: `{ region, rule, cost }` if its item declares `movable` and its area is there, otherwise null. */
export function movableZoneOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.movable : null;
  if ( !rule ) return null;
  const region = activeZoneOf(activity.item);
  return region ? { region, rule, cost: zoneMoveCost(rule, activity.activation?.type) } : null;
}

/** The distance the area may move, in the grid's unit. */
export function maxMoveOf(rule) {
  return lengthIn(rule.distance, rule.units, canvas.grid.units);
}

/** Is this point too far from the area's current center? */
export function tooFarForZone(zone, point) {
  const center = zoneCenter(zone.region);
  return !!center && (canvas.grid.measurePath([center, point]).distance > maxMoveOf(zone.rule) + 1e-6);
}

const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/**
 * Intent "move the area to this point". Returns `true` when settled (moved, or abandonment chosen); `false`
 * when the point was too far and the player gave up (§411: they can also force) — another one can be chosen.
 * @param {Activity} activity
 * @param {{x: number, y: number}} point
 */
export async function moveZone(activity, point) {
  const zone = movableZoneOf(activity);
  if ( !zone ) return true;
  const { region, rule, cost } = zone;
  // Flexible mode (§6): the placement turn, the budget — we say what is wrong, the player decides.
  // §411: distance too (before: flat refusal).
  const lines = [];
  const far = tooFarForZone(zone, point);
  if ( far ) lines.push(loc("Zone.TropLoin", { item: activity.item.name, max: rule.distance, units: rule.units }));
  // `cost: "none"`: the area follows the caster's movement — from the placement turn, but only on their turn.
  const free = rule.cost === "none";
  const sameTurn = !free && !canMoveArea(readAreaState(region), currentTurnKey());
  if ( sameTurn ) lines.push(loc("Zone.MemeTour", { item: activity.item.name }));
  const combatant = combatantFor(activity.actor);
  if ( free && combatant && !isOwnTurn(combatant) ) lines.push(loc("Souci.notYourTurn"));
  if ( combatant && cost ) {
    for ( const issue of checkUse(readBudget(combatant), { cost, weaponAttack: false, usesSpellSlot: false }, { isOwnTurn: isOwnTurn(combatant) }) ) {
      lines.push(loc(`Souci.${issue}`));
    }
  }
  if ( lines.length && !(await askAnyway(`${activity.item.name} — ${activity.actor?.name ?? ""}`, lines,
    { actor: activity.actor, item: activity.item })) ) return !far;   // gave up: too far, another point is chosen
  const payload = { region: region.uuid, point: { x: point.x, y: point.y }, actor: activity.actor?.uuid ?? null, cost, activity: activity.uuid };
  await viaActiveGM(MOVE_ZONE_QUERY, handleMoveZone, payload, { noGm: "Zone.SansMJ", label: "area move" });
  return true;
}

/** Active GM side: the region moves, the action is counted, the chat says so. */
export async function handleMoveZone(payload, { user=null }={}) {
  let { region: regionUuid, point, actor: actorUuid, cost } = payload ?? {};
  // §472: from a player, only the area of their activity (not a GM region), at the activity's cost. Safety refusal: not forceable.
  if ( needsCheck(user) ) {
    const activity = await fromUuid(payload?.activity ?? "");
    const zone = activity ? movableZoneOf(activity) : null;
    if ( !zone || (zone.region.uuid !== regionUuid) || !actsFor(user, activity.actor)
      || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) ) {
      console.warn(`${MODULE_ID} | moveZone query from ${user.name} refused: ${regionUuid} is not a zone of their activity`);
      return false;
    }
    actorUuid = activity.actor?.uuid ?? null;
    cost = zone.cost;
    point = { x: point.x, y: point.y };
  }
  const region = await fromUuid(regionUuid);
  if ( !region ) return false;
  await moveZoneTo(region, point);
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  const combatant = actor ? combatantFor(actor) : null;
  if ( combatant && cost ) {
    await writeBudget(combatant, spendUse(readBudget(combatant), { cost, weaponAttack: false, usesSpellSlot: false },
      { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  }
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("Zone.Deplacee", { name: actor?.name ?? "", item: region.name })}</p>`,
    flags: { [MODULE_ID]: { zoneMoved: { region: region.uuid, actor: actorUuid, cost } } }
  });
  log(`${region.name}: moved by ${actor?.name ?? "?"} (${cost ?? "no cost"})`);
  return true;
}

export function registerZones() {
  CONFIG.queries[MOVE_ZONE_QUERY] = handleMoveZone;
}
