/**
 * Light level (SPEC §16.48, §16.52): the world setting that adapter/illumination.mjs reads.
 *  - `twilightDarkness`: twilight — beyond this darkness threshold, a global **bright** light counts as **dim**
 *    (dawn and dusk in Dim Light). 1: never. With Simple Timekeeping (which only varies darkness, 0 at noon,
 *    0.25 at dawn, 0.75 at sunset, linear interpolation — simple-timekeeping 2.0.3, SimpleTimekeeping.js:1131-1151),
 *    0.6 gives, with the default dawn and sunset (0.23 and 0.77 of the day), about 1 h 20 of Dim Light before
 *    sunset (17 h 11 → 18 h 29) and half an hour before dawn (4 h 58 → 5 h 31); beyond the range of the global
 *    light (0.75 by default), it is Darkness.
 * Foundry's image, for its part, stays bright: only the engine's judgment (Search, passive Perception, indicator) changes.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { clearHearingRanges } from "../adapter/hearing.mjs";

export function registerIllumination() {
  game.settings.register(MODULE_ID, "twilightDarkness", {
    name: "DND5ECOMBAT.Reglage.twilightDarkness.Nom", hint: "DND5ECOMBAT.Reglage.twilightDarkness.Aide",
    scope: "world", config: true, type: Number, default: 0.6, range: { min: 0, max: 1, step: 0.05 }
  });
  // Unconscious "of what surrounds it" (PHB 2024): with this setting, neither sight nor hearing (adapter/vision.mjs
  // `isSenseless`). Off by default.
  game.settings.register(MODULE_ID, "unconsciousSenses", {
    name: "DND5ECOMBAT.Reglage.unconsciousSenses.Nom", hint: "DND5ECOMBAT.Reglage.unconsciousSenses.Aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => {
      if ( !canvas?.ready ) return;
      canvas.perception.update({ refreshVision: true });
      for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshVisibility: true });
    }
  });
  // Hearing range: a house rule (the rules give none). Empty by default: no range. A formula in feet, with the actor's roll
  // data — `15 + 2.5 * (@skills.prc.passive - 10)` is that of another vision module.
  game.settings.register(MODULE_ID, "hearingRange", {
    name: "DND5ECOMBAT.Reglage.hearingRange.Nom", hint: "DND5ECOMBAT.Reglage.hearingRange.Aide",
    scope: "world", config: true, type: String, default: "",
    onChange: () => {
      clearHearingRanges();
      if ( canvas?.ready ) canvas.perception.update({ refreshVision: true });
    }
  });
  // A creature heard or located without being seen: with this setting, an anonymous marker instead of its image, its name, its
  // bars and its conditions (ui/perception.mjs). Off by default: it keeps its image, with the outline.
  game.settings.register(MODULE_ID, "anonymousLocated", {
    name: "DND5ECOMBAT.Reglage.anonymousLocated.Nom", hint: "DND5ECOMBAT.Reglage.anonymousLocated.Aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => {
      if ( !canvas?.ready ) return;
      for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true });
    }
  });
  // The sheet, its effects or its items change: the hearing range is read again (passive Perception enters the formula).
  const stale = { label: "hearing: ranges to read again" };
  for ( const hook of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem",
    "deleteItem"] ) route(hook, () => clearHearingRanges(), stale);
}
