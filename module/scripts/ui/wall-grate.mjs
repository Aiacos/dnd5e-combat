/**
 * §468 : la section « DAS · Grille » de la configuration d'un mur (MJ seulement). Une case : le mur est une grille (barreaux, herse,
 * grillage) — il arrête le déplacement, mais pas le chemin d'un sort (pose d'une zone, §200) ; une attaque à travers lui donne un
 * abri supérieur, pas total. Le champ s'écrit dans le drapeau `flags.dnd5e-combat.grate` du mur, avec le reste du formulaire.
 */

import { MODULE_ID } from "../constants.mjs";
import { GRATE_FLAG, isGrate } from "../adapter/cover.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const CLASS = "dnd5e-combat-wall-grate";

function onRenderWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  const doc = app.document;
  if ( !root || !doc || root.querySelector(`.${CLASS}`) ) return;
  const fieldset = document.createElement("fieldset");
  fieldset.className = CLASS;
  fieldset.innerHTML = `
    <legend>${esc(loc("Grille.Config.Titre"))}</legend>
    <div class="form-group">
      <label>${esc(loc("Grille.Config.Case"))}</label>
      <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.${GRATE_FLAG}" ${isGrate(doc) ? "checked" : ""}></div>
      <p class="hint">${esc(loc("Grille.Config.Aide"))}</p>
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
