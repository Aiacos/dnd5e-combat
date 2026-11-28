/**
 * Discord feedback (Fanarie, 2026-11-18): the "Bright Light" checkbox of global illumination, in the Visibility tab of the scene
 * configuration (GM). The field exists in the core (`environment.globalLight.bright`, BooleanField, false by default,
 * common/documents/scene.mjs:122) and decides whether global illumination counts as full daylight or Dim Light for the vision rule
 * (`adapter/illumination.mjs`, `globalLightLevel`); but Foundry V14 no longer shows it (templates/scene/config/visibility.hbs: only
 * `enabled` and `darkness.max`), so it stayed unchecked everywhere. The field is rendered by the core (`DataField#toFormGroup`) and
 * saved with the rest of the form; no new data.
 */

import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

const CLASS = "dnd5e-combat-scene-bright";
const PATH = "environment.globalLight.bright";

function onRenderSceneConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  const doc = app.document;
  if ( !root || !doc || root.querySelector(`.${CLASS}`) || root.querySelector(`[name="${PATH}"]`) ) return;
  const enabled = root.querySelector('[name="environment.globalLight.enabled"]')?.closest(".form-group");
  const field = doc.schema.getField(PATH);
  if ( !enabled || !field ) return;
  const group = field.toFormGroup({ label: loc("LumiereVive.Case"), hint: loc("LumiereVive.Aide"), classes: [CLASS] },
    { value: !!doc._source.environment?.globalLight?.bright });
  enabled.after(group);
}

export function registerSceneBrightUi() {
  route("renderSceneConfig", onRenderSceneConfig, { label: "scene configuration: global illumination bright light" });
}
