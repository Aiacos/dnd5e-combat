/**
 * §448: relaunch a use suspended by the engine (aiming, legality window, choice of a form, a ritual…). A use
 * already forced in an antimagic field (`antimagicForced`, runtime/antimagic.mjs) keeps the field lowered for its relaunch:
 * dnd5e checks `canUse` from the start of `use()` and would refuse otherwise, with no card, after the GM was warned of the
 * forcing (seen on the bench on 2026-11-14: Wand of Magic Missiles, aiming of the three projectiles, nothing leaves). Every
 * relaunch of a received configuration goes through here (the "relance-forcee" rule of tests/das-tests.json).
 */

import { MODULE_ID } from "../constants.mjs";
import { withAntimagicLifted } from "./antimagic.mjs";

/** `activity.use(usage, dialog, message)`, the antimagic field lowered for the duration of the call if the use was forced. */
export function relaunchUse(activity, usage, dialog, message) {
  if ( !usage?.[MODULE_ID]?.antimagicForced ) return activity.use(usage, dialog, message);
  return withAntimagicLifted(activity.actor, activity.item, () => activity.use(usage, dialog, message));
}
