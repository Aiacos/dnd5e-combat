/**
 * The world's automation level (SPEC §117, core/levels.mjs): Essential, Assisted, Full.
 *
 * A world setting, registered FIRST — the core's settings window lists a module's settings in their order of
 * registration (client/applications/settings/config.mjs:71), so it reads at the top. It is read once, at load: changing it
 * reloads the world (`requiresReload`), because it decides what is registered on the hooks.
 */
import { MODULE_ID } from "../constants.mjs";
import { LEVELS, DEFAULT_LEVEL, atLeast, featureLevel } from "../core/levels.mjs";
import { setContentEnabled } from "../adapter/content.mjs";
import { withoutRoutes } from "./router.mjs";
import { log } from "./shared.mjs";

export const LEVEL_SETTING = "automationLevel";

let current = DEFAULT_LEVEL;

/** Le niveau en vigueur sur ce client. */
export function automationLevel() {
  return current;
}

/** Does the current level include what requires `min`? */
export function levelAtLeast(min) {
  return atLeast(current, min);
}

/** To call first of all, during `init`: declares the setting, reads the level, opens or closes the content. */
export function registerLevel() {
  game.settings.register(MODULE_ID, LEVEL_SETTING, {
    name: "DND5ECOMBAT.Niveau.Nom", hint: "DND5ECOMBAT.Niveau.Aide",
    scope: "world", config: true, type: String, default: DEFAULT_LEVEL, requiresReload: true,
    choices: Object.fromEntries(LEVELS.map(l => [l, `DND5ECOMBAT.Niveau.${l}`]))
  });
  const stored = game.settings.get(MODULE_ID, LEVEL_SETTING);
  current = LEVELS.includes(stored) ? stored : DEFAULT_LEVEL;
  setContentEnabled(atLeast(current, "full"));
  log(`automation level: ${current}`);
}

/**
 * Registers an entry-point function according to the level: at its level or above, normally; below, without its listeners
 * (its settings and queries stay declared, for whoever reads them).
 */
export function gated(register) {
  return levelAtLeast(featureLevel(register.name)) ? register() : withoutRoutes(register.name, register);
}
