/**
 * §468 : la section « DAS · Grille » de la configuration d'un mur (MJ seulement). Une grille (barreaux, herse, grillage) arrête le
 * déplacement, mais pas le chemin d'un sort (pose d'une zone, §200) ; une attaque à travers elle donne un abri supérieur, pas total.
 * §476 (retour de Fanarie) : un choix à trois positions — « selon le réglage du monde » (réglage `grateWalls` : tout mur qui ne bloque
 * pas la vue est une grille), « grille », « mur plein » —, écrit dans `flags.dnd5e-combat.grateMode` avec le reste du formulaire. Un
 * mur coché « grille » avant la §476 (`flags.dnd5e-combat.grate`) s'ouvre sur « grille ». L'aide dit ce que vaut « selon le réglage »
 * pour ce mur-là.
 */

import { MODULE_ID } from "../constants.mjs";
import { GRATE_MODES } from "../core/cover.mjs";
import { GRATE_MODE_FLAG, grateModeOf, grateWallsAuto, isGrate } from "../adapter/cover.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const CLASS = "dnd5e-combat-wall-grate";

function onRenderWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  const doc = app.document;
  if ( !root || !doc || root.querySelector(`.${CLASS}`) ) return;
  const mode = grateModeOf(doc);
  const auto = grateWallsAuto();
  const autoIs = isGrate(doc, { auto, mode: "auto" }) ? "Grille" : "Plein";
  const options = GRATE_MODES.map(m => `<option value="${m}" ${(m === mode) ? "selected" : ""}>${esc(loc(`Grille.Config.Choix.${m}`))}</option>`).join("");
  const fieldset = document.createElement("fieldset");
  fieldset.className = CLASS;
  fieldset.innerHTML = `
    <legend>${esc(loc("Grille.Config.Titre"))}</legend>
    <div class="form-group">
      <label>${esc(loc("Grille.Config.Case"))}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.${GRATE_MODE_FLAG}">${options}</select></div>
      <p class="hint">${esc(loc("Grille.Config.Aide"))} ${esc(loc(`Grille.Config.Auto.${auto ? "On" : "Off"}`, { verdict: loc(`Grille.Config.Verdict.${autoIs}`) }))}</p>
    </div>`;
  // Avant la section « DAS · Serrure » (§244) si elle est là, sinon avant le pied du formulaire.
  const anchor = root.querySelector(".dnd5e-combat-door-lock") ?? root.querySelector(".form-footer");
  if ( anchor ) anchor.before(fieldset);
  else root.append(fieldset);
  app.setPosition?.({ height: "auto" });
}

export function registerWallGrateUi() {
  route("renderWallConfig", onRenderWallConfig, { label: "wall grate: wall configuration section" });
}
