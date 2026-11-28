import { MODULE_ID } from "../constants.mjs";

/**
 * An engine setting, or `fallback` if it is not (yet) registered: a rule read before `init`, or in a test outside
 * Foundry, does not break.
 */
export function settingOr(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); }
  catch { return fallback; }
}
