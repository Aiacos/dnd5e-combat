/**
 * §395: "Cast without DAS" — a use goes through dnd5e alone, and everything that follows from it until its end (decision of
 * the user, 2026-11-07: lasting area, Concentration, effects, cards, rolls). GM and players, through the right-click menu
 * of an item on the sheet (ui/item-menu.mjs) or a cell of the bar of a neighboring interface (`api.vanilla.use`).
 *
 * The router skips every non-`always` registration of a hook whose arguments come from such an action
 * (adapter/vanilla-state.mjs, `concernsVanilla`). This file sets the marker where dnd5e keeps no link to the card:
 *  - the use configuration carries `{ "dnd5e-combat": { vanilla: true } }` (set by `useWithoutDas`); at
 *    `dnd5e.preUseActivity`, the use card receives the flag (`messageConfig.data.flags`)
 *    and the activity is noted on this client;
 *  - the Concentration effect (`dnd5e.preBeginConcentrating`, actor.mjs:1104: the effect data), the placed area
 *    (`preCreateRegion` / `preCreateMeasuredTemplate`: `flags.dnd5e.activity`, `origin`, `item`) and the summoned creature
 *    (`dnd5e.preSummonToken`, summon.mjs:178: the token data) receive the flag as long as the activity is noted.
 * These registrations are `always` (they mark even when the rest of the hook stays silent) and `marks` (the following ones
 * re-read the state).
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { markPending, clearPending, isPending, isVanilla } from "../adapter/vanilla-state.mjs";

const FLAG = `flags.${MODULE_ID}.vanilla`;

/**
 * Uses an item or an activity through dnd5e alone (§395). An item with several activities opens dnd5e's choice.
 * @param {Item|object} subject  Item5e or activity.
 * @param {object} [options]
 * @param {Event} [options.event]  The originating event (Alt / Ctrl read by dnd5e: Advantage / Disadvantage).
 */
export async function useWithoutDas(subject, { event=null }={}) {
  if ( !subject?.use ) return null;
  log(`${subject.name ?? subject.item?.name}: used without DAS (dnd5e alone)`);
  return subject.use({ event, [MODULE_ID]: { vanilla: true } }, {}, { data: { flags: { [MODULE_ID]: { vanilla: true } } } });
}

function onPreUse(activity, usageConfig, _dialogConfig, messageConfig) {
  const uuids = [activity?.uuid, activity?.item?.uuid];
  if ( !usageConfig?.[MODULE_ID]?.vanilla ) { clearPending(uuids); return; }
  markPending(uuids);
  if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.${FLAG}`, true);
}

function onPreConcentrate(_actor, _item, effectData, activity) {
  if ( effectData && isPending(activity?.uuid) ) foundry.utils.setProperty(effectData, FLAG, true);
}

/** An area or template created by this client for an activity cast without DAS. */
function onPreCreatePlaced(doc, _data, _options, userId) {
  if ( userId !== game.user.id ) return;
  const f = doc.flags?.dnd5e ?? {};
  if ( [f.activity, f.origin, f.item].some(u => isPending(u)) ) doc.updateSource({ [FLAG]: true });
}

function onPreSummonToken(activity, _profile, tokenData) {
  if ( tokenData && isPending(activity?.uuid) ) foundry.utils.setProperty(tokenData, FLAG, true);
}

export const vanillaApi = Object.freeze({ use: useWithoutDas, is: isVanilla });

export function registerVanilla() {
  const opts = label => ({ always: true, marks: true, label: `without DAS: ${label}` });
  route("dnd5e.preUseActivity", onPreUse, opts("usage not marked"));
  route("dnd5e.preBeginConcentrating", onPreConcentrate, opts("concentration not marked"));
  route("preCreateRegion", onPreCreatePlaced, opts("region not marked"));
  route("preCreateMeasuredTemplate", onPreCreatePlaced, opts("template not marked"));
  route("dnd5e.preSummonToken", onPreSummonToken, opts("summon not marked"));
}
