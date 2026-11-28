/**
 * §220: "Theater of the Mind" — a button in the GM toolbar (token controls) that switches off all the engine's automations,
 * for a scene played without a combat map: no more click-to-move, menus, turn budget, resolved rolls,
 * reactions, areas, simulated vision… dnd5e and the core take over again, as without the engine.
 *
 *  - World setting `theaterOfMind` (shared: all clients follow), toggled by the GM's button; each client is notified.
 *  - The router no longer passes any hook (runtime/router.mjs, `paused`), except startup (init, setup, ready) and this button; the
 *    listeners placed outside the router (mouse and keyboard, detection modes, periodic tasks) read the same state.
 *  - Neighbors follow it through the `dnd5e-combat.theater` hook (`active`) and `api.theater.active()`.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { theaterActive, setTheaterState } from "./theater-state.mjs";
import { log, loc } from "./shared.mjs";

export const THEATER_SETTING = "theaterOfMind";
/**
 * §220: on each client, when the GM turns Theater of the Mind on or off (world setting `theaterOfMind`): `(active)`, boolean —
 * on, the engine no longer automates anything. Read-only.
 */
export const THEATER_HOOK = `${MODULE_ID}.theater`;

function applied(on, { announce=true }={}) {
  setTheaterState(on);
  log(`theatre of the mind ${on ? "on: every automation off" : "off: automations back"}`);
  Hooks.callAll(THEATER_HOOK, !!on);
  ui.controls?.render?.({ reset: true });
  if ( announce ) ui.notifications?.info(loc(on ? "Theatre.Actif" : "Theatre.Inactif"));
}

/** Toggles Theater of the Mind (GM). */
export async function setTheater(on) {
  if ( !game.user.isGM ) return false;
  await game.settings.set(MODULE_ID, THEATER_SETTING, !!on);
  return true;
}

export const theaterApi = Object.freeze({ active: theaterActive, set: setTheater });

export function registerTheater() {
  game.settings.register(MODULE_ID, THEATER_SETTING, {
    name: `DND5ECOMBAT.Reglage.${THEATER_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${THEATER_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: value => applied(value)
  });
  // The world's state, read as soon as the settings are (before `ready`: the `ready` listeners will read it).
  route("setup", () => setTheaterState(game.settings.get(MODULE_ID, THEATER_SETTING)), { always: true, label: "theatre of the mind: state not read" });
  route("ready", () => { if ( theaterActive() && game.user.isGM ) ui.notifications.info(loc("Theatre.Rappel")); },
    { always: true, label: "theatre of the mind: reminder" });
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-theater"] = {
      name: "das-theater", order: last + 1, icon: "fa-solid fa-masks-theater", title: "DND5ECOMBAT.Theatre.Bouton",
      toggle: true, active: theaterActive(), visible: true,
      onChange: (event, active) => { setTheater(active).catch(err => console.error(`${MODULE_ID} | theatre of the mind`, err)); }
    };
  }, { always: true, label: "theatre of the mind: tool" });
}
