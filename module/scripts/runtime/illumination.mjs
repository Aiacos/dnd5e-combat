/**
 * Niveau de lumière (SPEC §16.48, §16.52) : le réglage du monde que lit adapter/illumination.mjs.
 *  - `twilightDarkness` : crépuscule — au-delà de ce seuil d'obscurité, une lumière globale **vive** compte comme **faible**
 *    (aube et crépuscule en Lumière faible). 1 : jamais. Avec Simple Timekeeping (qui ne fait varier que l'obscurité, 0 à midi,
 *    0,25 à l'aube, 0,75 au coucher, interpolation linéaire — simple-timekeeping 2.0.3, SimpleTimekeeping.js:1131-1151),
 *    0,6 donne, avec l'aube et le coucher par défaut (0,23 et 0,77 de la journée), environ 1 h 20 de lumière faible avant le
 *    coucher (17 h 11 → 18 h 29) et une demi-heure avant l'aube (4 h 58 → 5 h 31) ; au-delà de la plage de la lumière
 *    globale (0,75 par défaut), ce sont les ténèbres.
 * L'image de Foundry, elle, reste vive : seul le jugement du moteur (Chercher, Perception passive, indicateur) change.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { clearHearingRanges } from "../adapter/hearing.mjs";

export function registerIllumination() {
  game.settings.register(MODULE_ID, "twilightDarkness", {
    name: "DND5ECOMBAT.Reglage.twilightDarkness.Nom", hint: "DND5ECOMBAT.Reglage.twilightDarkness.Aide",
    scope: "world", config: true, type: Number, default: 0.6, range: { min: 0, max: 1, step: 0.05 }
  });
  // Inconscient « de ce qui l'entoure » (PHB 2024) : avec ce réglage, ni vue ni ouïe (adapter/vision.mjs `isSenseless`). Éteint par défaut.
  game.settings.register(MODULE_ID, "unconsciousSenses", {
    name: "DND5ECOMBAT.Reglage.unconsciousSenses.Nom", hint: "DND5ECOMBAT.Reglage.unconsciousSenses.Aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => {
      if ( !canvas?.ready ) return;
      canvas.perception.update({ refreshVision: true });
      for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshVisibility: true });
    }
  });
  // Portée d'ouïe : une règle maison (les règles n'en donnent aucune). Vide par défaut : sans portée. Une formule en pieds, avec
  // les données de jet de l'acteur — `15 + 2.5 * (@skills.prc.passive - 10)` est celle d'un autre module de vision.
  game.settings.register(MODULE_ID, "hearingRange", {
    name: "DND5ECOMBAT.Reglage.hearingRange.Nom", hint: "DND5ECOMBAT.Reglage.hearingRange.Aide",
    scope: "world", config: true, type: String, default: "",
    onChange: () => {
      clearHearingRanges();
      if ( canvas?.ready ) canvas.perception.update({ refreshVision: true });
    }
  });
  // Une créature entendue ou localisée sans être vue : avec ce réglage, un marqueur anonyme à la place de son image, de son nom, de
  // ses barres et de ses états (ui/perception.mjs). Éteint par défaut : elle garde son image, avec le contour.
  game.settings.register(MODULE_ID, "anonymousLocated", {
    name: "DND5ECOMBAT.Reglage.anonymousLocated.Nom", hint: "DND5ECOMBAT.Reglage.anonymousLocated.Aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => {
      if ( !canvas?.ready ) return;
      for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true });
    }
  });
  // La fiche, ses effets ou ses objets changent : la portée d'ouïe se relit (la Perception passive entre dans la formule).
  const stale = { label: "hearing: ranges to read again" };
  for ( const hook of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem",
    "deleteItem"] ) route(hook, () => clearHearingRanges(), stale);
}
