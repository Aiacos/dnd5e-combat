/**
 * §224: the climbing and falling system switch — a button in the GM toolbar (token controls), modelled on Theater of the Mind
 * (§220), which turns off or on everything the engine does with height:
 *  - off: no more aligning movement to the ground (no "Too high", no "In the void!", no climb refused to the player, no level
 *    following elevation: runtime/altitude.mjs), the A* keeps the token's elevation (adapter/path-world.mjs), no more
 *    climbing (menus, `api.climb`, "house" rolls, climber falls: runtime/climb.mjs), no more engine falls (automatic fall,
 *    fall before moving, after a jump, at the end of an elevation spell: runtime/falls.mjs, `fallLikeDnd5e`) — and dnd5e's
 *    "Falling" condition is no longer placed (dnd5e places it after every move of an airborne token without flight:
 *    documents/token.mjs:432-444);
 *  - when turning it off, as when turning it on, no token moves: each keeps its elevation, its mode, its statuses; it is its
 *    next move, with the system back on, that will be aligned (or will fall).
 *
 *  - World setting `climbSystem` (enabled by default), toggled by the button; world setting `climbSystemButton`: the button
 *    shown or not (the setting stays in the "DAS · Core" window). Every client is notified.
 *  - Neighbours follow it through the hook `dnd5e-combat.climbSystem` (`enabled`) and
 *    `api.climb.enabled()` / `api.climb.setEnabled(on)`.
 *  - The "Movement modes and elevation" setting (`altitude`) stays: on, the switch lets it decide; off, it overrides it.
 */

import { MODULE_ID } from "../constants.mjs";
import { climbSystemOn, setClimbSystemState } from "../core/climb-system.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const CLIMB_SYSTEM_SETTING = "climbSystem";
export const CLIMB_BUTTON_SETTING = "climbSystemButton";
/**
 * §224: on each client, when the GM toggles the climbing and falling switch (world setting `climbSystem`): `(enabled)`,
 * boolean. Read-only.
 */
export const CLIMB_SYSTEM_HOOK = `${MODULE_ID}.climbSystem`;

function applied(on, { announce=true }={}) {
  setClimbSystemState(on);
  log(`climbing and falling ${on ? "on" : "off: free elevation, every token keeps its own"}`);
  Hooks.callAll(CLIMB_SYSTEM_HOOK, !!on);
  ui.controls?.render?.({ reset: true });
  if ( announce ) ui.notifications?.info(loc(on ? "EscaladeSysteme.Actif" : "EscaladeSysteme.Inactif"));
}

/** Turns the climbing and falling system on or off (GM). */
export async function setClimbSystem(on) {
  if ( !game.user.isGM ) return false;
  await game.settings.set(MODULE_ID, CLIMB_SYSTEM_SETTING, !!on);
  return true;
}

const buttonShown = () => {
  try { return game.settings.get(MODULE_ID, CLIMB_BUTTON_SETTING) !== false; } catch { return true; }
};

/** Does the created effect carry dnd5e's "Falling" condition? */
const isFallingEffect = (effect, data) => {
  const statuses = data?.statuses ?? effect?.statuses ?? [];
  return Array.from(statuses).includes("falling");
};

export function registerClimbSystem() {
  game.settings.register(MODULE_ID, CLIMB_SYSTEM_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_SYSTEM_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_SYSTEM_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: value => applied(value)
  });
  game.settings.register(MODULE_ID, CLIMB_BUTTON_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_BUTTON_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_BUTTON_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render?.({ reset: true })
  });
  // The world's state, read as soon as the settings are (before `ready`).
  route("setup", () => setClimbSystemState(game.settings.get(MODULE_ID, CLIMB_SYSTEM_SETTING)), { always: true, label: "climbing switch: state not read" });
  // System off: dnd5e no longer places "Falling" (after a move in the air, or by hand) — on the client that creates it.
  route("preCreateActiveEffect", (effect, data) => {
    if ( !isFallingEffect(effect, data) ) return true;
    // §225: in the Ethereal, no gravity — dnd5e would place "Falling" on an airborne token without flight.
    const ethereal = effect.parent?.statuses?.has?.("ethereal") === true;
    if ( climbSystemOn() && !ethereal ) return true;
    log(`${effect.parent?.name ?? "?"}: Falling not applied (${ethereal ? "Ethereal Plane" : "climbing and falling off"})`);
    return false;
  }, { cancellable: true, label: "climbing switch: Falling status" });
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM || !buttonShown() ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-climb"] = {
      name: "das-climb", order: last + 1, icon: "fa-solid fa-person-falling", title: "DND5ECOMBAT.EscaladeSysteme.Bouton",
      toggle: true, active: climbSystemOn(), visible: true,
      onChange: (event, active) => { setClimbSystem(active).catch(err => console.error(`${MODULE_ID} | climbing switch`, err)); }
    };
  }, { always: true, label: "climbing switch: tool" });
}
