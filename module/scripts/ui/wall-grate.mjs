/**
 * §468: the "DAS · Grate" section of a wall's configuration (GM only). A grate (bars, portcullis, grating) stops
 * movement, but not a spell's path (placing a zone, §200); an attack through it gives greater Cover, not Total Cover.
 * §476 (Fanarie's feedback): a three-position choice — "according to the world setting" (setting `grateWalls`: any wall that
 * does not block sight is a grate), "grate", "solid wall" —, written to `flags.dnd5e-combat.grateMode` with the rest of the form. A
 * wall ticked "grate" before §476 (`flags.dnd5e-combat.grate`) opens on "grate". The help says what "according to the setting"
 * is worth for that wall.
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
  // Before the "DAS · Lock" section (§244) if it is there, otherwise before the form's footer.
  const anchor = root.querySelector(".dnd5e-combat-door-lock") ?? root.querySelector(".form-footer");
  if ( anchor ) anchor.before(fieldset);
  else root.append(fieldset);
  app.setPosition?.({ height: "auto" });
}

export function registerWallGrateUi() {
  route("renderWallConfig", onRenderWallConfig, { label: "wall grate: wall configuration section" });
}
