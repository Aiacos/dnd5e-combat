/**
 * Light indicator (SPEC §16.50, §40.2): what light a token stands in, as others see it
 * (core/illumination.mjs, `lightIndicator`), what that changes (seen, Disadvantage to see it, can hide) and how
 * it sees there itself. The engine draws nothing: it publishes the calculation (`api.light`, `api.ui.light`) and the
 * tooltip, which an interface displays where it wants (the indicator of the Darsh UI DnD5 Bar). The client setting
 * "Light indicator" is returned in `enabled`: up to the interface to respect it.
 */

import { MODULE_ID } from "../constants.mjs";
import { LIGHT, lightIndicator, perceivedLight } from "../core/illumination.mjs";
import { lightOnToken, sensesToward, tokenPoint, globalLight } from "../adapter/illumination.mjs";
import { loc } from "../runtime/shared.mjs";

const SETTING = "lightIndicator";
const ICONS = { bright: "fa-sun", dim: "fa-circle-half-stroke", dark: "fa-moon", magical: "fa-moon" };

function tooltip({ key, own }) {
  const lines = [`<strong>${loc(`Lumiere.${key}.Nom`)}</strong>`, loc(`Lumiere.${key}.Texte`)];
  if ( own ) lines.push(`<em>${loc("Lumiere.Vous", { level: loc(`Lumiere.${own}.Bas`) })}</em>`);
  return lines.join("<br>");
}

/**
 * The light a token stands in, for an interface (`api.light`, requested by Darsh UI DnD5 on 2026-09-27).
 * @param {Token|TokenDocument} token
 * @returns {{key: "bright"|"dim"|"dark"|"magical", icon: string, name: string, tooltip: string, enabled: boolean}|null}
 *   `enabled`: the client setting "Light indicator"; null without a canvas or without a token on a scene.
 */
export function lightState(token) {
  const doc = token?.document ?? token;
  if ( !doc?.parent || !canvas?.ready ) return null;
  const light = lightOnToken(doc);
  if ( !light ) return null;
  const own = perceivedLight(light, sensesToward(doc, tokenPoint(doc)));
  const state = lightIndicator(light, own);
  return { key: state.key, icon: ICONS[state.key], name: loc(`Lumiere.${state.key}.Nom`), tooltip: tooltip(state),
    enabled: game.settings.get(MODULE_ID, SETTING) };
}

/**
 * What the displayed scene's global light gives, per the engine's rules (§16.52: darkness range, "bright",
 * twilight) — for a display module that wants the same "full daylight" as the rules (`api.ui.globalLight`, §40.2).
 * @returns {"bright"|"dim"|null}  null: no global light at this darkness, or no canvas.
 */
export function globalLightState() {
  const level = globalLight();
  return (level === LIGHT.BRIGHT) ? "bright" : (level === LIGHT.DIM) ? "dim" : null;
}

export function registerLightIndicator() {
  game.settings.register(MODULE_ID, SETTING, { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.lightIndicator.Nom", hint: "DND5ECOMBAT.Reglage.lightIndicator.Aide" });
}
