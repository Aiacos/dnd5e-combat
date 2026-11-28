/**
 * dnd5e's activity choice, answered when there is nothing to choose (SPEC §41.1, §42.1). `Item5e#use` opens
 * `ActivityChoiceDialog` for any item with several activities (documents/item.mjs:759 — no hook before it). When the
 * window renders, if the rule in core/activity-choice.mjs designates an activity, we click its button for the player
 * (templates/activity/activity-choices.hbs, `data-action="choose"`) and the window, made invisible, closes at once.
 * No patch: the application's render hook and its own button. Shift + click (dnd5e: the first activity, without a
 * window) and the sheet's list of activities remain to reach the others.
 *
 * On the client of whoever uses the item.
 */

import { activityToUse } from "../core/activity-choice.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, isWounded } from "../adapter/facts.mjs";
import { swallowOf } from "../adapter/swallow.mjs";
import { slotLeft } from "../adapter/grimoire.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/**
 * Is the spell already running for its caster? They concentrate on it, or an Active Effect from this item is in place — on
 * them (the flame of "Flammes", Armor of Agathys) or on a creature of the displayed scene (Hex, Hunter's Mark).
 */
function isRunning(item) {
  const actor = item.actor;
  if ( !actor ) return false;
  if ( actor.concentration?.items?.has?.(item) ) return true;
  const mine = effect => !effect.disabled && (originItemOf(effect) === item);
  if ( actor.effects.some(mine) ) return true;
  return (canvas?.scene?.tokens?.contents ?? []).some(t => t.actor && (t.actor !== actor) && t.actor.effects.some(mine));
}

/**
 * A free casting that remains: an activity that casts the spell without a slot on limited uses — its own,
 * or the item's for the "forward" activity that dnd5e creates (SpellConfigurationData#applySpellChanges; ForwardActivity#use
 * recasts without a slot).
 */
function freeCast(item, a) {
  if ( (a.consumption?.spellSlot !== false) && (a.type !== "forward") ) return false;
  // §230: a "forward" to an activity that asks for a higher spell level than the spell's (the flying mount of Find
  // Steed, level 4) is not a free casting: it casts at the base level.
  const minLevel = contentOf(item).entry?.summon?.minLevels?.[a.activity?.id ?? a.id];
  if ( Number.isFinite(minLevel) && ((item.system?.level ?? 0) < minLevel) ) return false;
  const left = u => (u?.max > 0) && (u.value > 0);
  const onItem = (a.consumption?.targets ?? []).some(t => (t.type === "itemUses") && !t.target);
  return onItem ? left(item.system.uses) : left(a.uses);
}

/** Casting times that cost something on the turn (§46) — not "special", "start / end of turn", nor none. */
const COSTS = new Set(["action", "bonus", "reaction", "legendary", "mythic", "lair"]);

function onRenderActivityChoice(app, element) {
  const item = app?.item;
  if ( !item ) return;
  const entry = contentOf(item).entry;
  const buttons = [...element.querySelectorAll('[data-action="choose"][data-activity-id]')];
  const activities = buttons.map(b => item.system.activities?.get(b.dataset.activityId)).filter(Boolean)
    .map(a => ({ id: a.id, timed: !!a.activation?.type, slot: (a.consumption?.spellSlot !== false) && (a.type !== "forward"), type: a.type,
      cost: COSTS.has(a.activation?.type ?? ""), free: freeCast(item, a) }));
  if ( activities.length < 2 ) return;
  const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
  const wanted = activityToUse({
    activities, level: (item.type === "spell") ? (item.system.level ?? 0) : 0,
    known: !!entry && (Object.keys(entry).length > 0), running: isRunning(item),
    byWounds: entry?.byWounds ?? null, wounded: (targets.length > 0) && targets.every(isWounded),
    // §45: Swallow / Engulf — the activity that swallows; the others (damage each turn, exit from the corpse) are the engine's.
    entry: swallowOf(item)?.entry?.id ?? null,
    slotLeft: slotLeft(item)
  });
  const button = wanted ? buttons.find(b => b.dataset.activityId === wanted) : null;
  if ( !button ) return;
  log(`${item.name}: activity choice answered (${item.system.activities.get(wanted)?.name ?? wanted})`);
  element.style.visibility = "hidden";   // the window closes on click: so it does not flicker
  button.click();
}

export function registerActivityChoice() {
  route("renderActivityChoiceDialog", onRenderActivityChoice, { label: "activity choice answered" });
}
