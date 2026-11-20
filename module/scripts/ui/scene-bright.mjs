/**
 * Retour Discord (Fanarie, 2026-11-18) : la case « Lumière vive » de l'illumination globale, dans l'onglet Visibilité de la configuration
 * de la scène (MJ). Le champ existe dans le cœur (`environment.globalLight.bright`, BooleanField, faux par défaut,
 * common/documents/scene.mjs:122) et décide si l'illumination globale vaut plein jour ou lumière faible pour la règle de vision
 * (`adapter/illumination.mjs`, `globalLightLevel`) ; mais Foundry V14 ne l'affiche plus (templates/scene/config/visibility.hbs : seulement
 * `enabled` et `darkness.max`), si bien qu'il restait décoché partout. Le champ est rendu par le cœur (`DataField#toFormGroup`) et
 * enregistré avec le reste du formulaire ; aucune donnée nouvelle.
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
