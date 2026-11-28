/**
 * §400: the "Floating Text Theme" window (GM), a tool of the "Floating texts" tab of the DAS settings. The theme is set in
 * the "Floating Text Workshop" (a page outside Foundry) and imported here as JSON (`das-float-theme`): pasted or chosen as a
 * file, checked field by field (core/float-text.mjs, `floatThemeFrom`), saved for the table (world setting `floatTheme`, and the
 * pace settings it carries). Also there: the export, the return to the original look, and the trial of each kind on the
 * selected token. `api.floats` does the same without a window.
 */

import { MODULE_ID } from "../constants.mjs";
import { FLOAT_KINDS, floatThemeFrom, floatThemeExport, floatStyleOf } from "../core/float-text.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { playFloat, floatFonts, floatsActive, FLOAT_SYSTEM } from "./feedback.mjs";

const windowId = "das-float-theme";
const THEME_SETTING = "floatTheme";
let ThemeClass = null;

/** The pace an export carries: the world settings of the tab. */
function currentGlobal() {
  const keys = ["floatDuration", "floatSpacing", "floatDistance", "floatScale", "floatDirection", "floatDice", "floatIcons", "floatAdvantage"];
  return Object.fromEntries(keys.map(k => { try { return [k, game.settings.get(MODULE_ID, k)]; } catch { return null; } }).filter(Boolean));
}

/** The world's theme, as export JSON. */
export function exportTheme() {
  let theme = {};
  try { theme = game.settings.get(MODULE_ID, THEME_SETTING) ?? {}; } catch {}
  return floatThemeExport(theme, currentGlobal());
}

/**
 * Imports a theme (JSON text or object) for the table: looks and pace. GM only.
 * @returns {Promise<{kinds: number, problems: string[]}>}
 */
export async function importTheme(json) {
  if ( !game.user.isGM ) throw new Error(loc("ThemeFlottant.MJSeul"));
  const { theme, global, problems } = floatThemeFrom(json, { fonts: floatFonts() });
  await game.settings.set(MODULE_ID, THEME_SETTING, theme);
  for ( const [key, value] of Object.entries(global) ) {
    try { await game.settings.set(MODULE_ID, key, value); } catch { problems.push(key); }
  }
  return { kinds: Object.keys(theme).length, problems };
}

/** Returns to the original look (the empty theme). */
export async function resetTheme() {
  if ( !game.user.isGM ) throw new Error(loc("ThemeFlottant.MJSeul"));
  await game.settings.set(MODULE_ID, THEME_SETTING, {});
}

/** A kind's name; a damage type takes the name dnd5e gives it (`CONFIG.DND5E.damageTypes`). */
function kindLabel(kind) {
  if ( kind.startsWith("dmg-") ) return loc("ThemeFlottant.Degats", { type: CONFIG.DND5E?.damageTypes?.[kind.slice(4)]?.label ?? kind.slice(4) });
  return loc(`ThemeFlottant.Sorte.${kind}`);
}

/** One example per kind, for the trial: text, and roll for those that carry one. */
function sample(kind) {
  const rolled = { critical: 20, miss: 8, hit: 17, saveSuccess: 15, saveFail: 6, check: 14, checkSuccess: 18, checkFail: 9, initiative: 17, save: 12 };
  const texts = {
    critical: loc("Retour.Critique"), miss: loc("Retour.Rate"), cover: loc("Retour.AbriTotal"), reaction: loc("ThemeFlottant.Exemple.Reaction"),
    saveSuccess: loc("Retour.SauvegardeReussie"), saveFail: loc("Retour.SauvegardeRatee"), duplicate: loc("Retour.Replique"),
    unaffected: loc("Retour.NonAffecte"), prompt: loc("Retour.Rebond"), refused: loc("Retour.TropLoin"), forced: loc("Retour.Force"),
    ended: loc("Retour.Desarme", { item: loc("ThemeFlottant.Exemple.Ressource") }), gain: loc("Retour.Utilisation", { sign: "+", n: 1, item: loc("ThemeFlottant.Exemple.Ressource") }),
    spend: loc("Retour.Emplacement", { sign: "−", n: 1, level: 2 }), strike: loc("Retour.AttaqueSournoise", { n: 3, faces: 6 }),
    heroic: loc("ThemeFlottant.Exemple.Heroique"), atCost: loc("ThemeFlottant.Exemple.Prix"), check: loc("ThemeFlottant.Exemple.Test"),
    checkSuccess: loc("Retour.TestReussi"), checkFail: loc("Retour.TestRate"), initiative: loc("Retour.Initiative"), save: loc("Retour.Sauvegarde"), damage: "-12", healing: "+8", temp: "+5",
    effectOn: `+(${loc("ThemeFlottant.Exemple.Effet")})`, effectOff: (floatStyleOf(game.settings.get(MODULE_ID, THEME_SETTING) ?? {}, "effectOff").strike ? loc("ThemeFlottant.Exemple.Effet") : `−(${loc("ThemeFlottant.Exemple.Effet")})`)
  };
  if ( kind.startsWith("dmg-") ) return { text: "-7", extra: { factor: 1.2 } };
  return { text: texts[kind] ?? kind, extra: (kind in rolled) ? { roll: rolled[kind], mode: (kind === "saveFail") ? "advantage" : null } : {} };
}

/** Tries a kind on the selected token (or nothing, with a notice). */
export function tryKind(kind) {
  const token = canvas?.tokens?.controlled?.[0];
  if ( !token ) { ui.notifications.warn(loc("ThemeFlottant.SansToken")); return false; }
  const { text, extra } = sample(kind);
  return playFloat(token, kind, text, extra);
}

const ThemeApp = () => ThemeClass ??= class FloatThemeApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    super({ ...options, id: windowId });
    this.report = null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-float-theme"],
    window: { icon: "fa-solid fa-palette", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      importText: FloatThemeApp.#importText,
      exportCopy: FloatThemeApp.#exportCopy,
      exportFile: FloatThemeApp.#exportFile,
      reset: FloatThemeApp.#reset,
      tryKind: FloatThemeApp.#try
    }
  };

  get title() {
    return loc("ThemeFlottant.Titre");
  }

  async _renderHTML() {
    let theme = {};
    try { theme = game.settings.get(MODULE_ID, THEME_SETTING) ?? {}; } catch {}
    const custom = Object.keys(theme).length;
    const kinds = FLOAT_KINDS.map(kind => {
      const look = floatStyleOf(theme, kind);
      return `<button type="button" class="das-float-theme__kind${look.show === false ? " off" : ""}" data-action="tryKind" data-kind="${kind}"
        data-tooltip="${esc(loc("ThemeFlottant.Essayer"))}"><span class="sw" style="background:${esc(look.color)}"></span>${esc(kindLabel(kind))}</button>`;
    }).join("");
    const report = this.report ? `<p class="das-float-theme__report ${this.report.ok ? "ok" : "bad"}">${esc(this.report.text)}</p>` : "";
    return `<div class="das-float-theme__body">
      <p class="das-muted">${esc(loc("ThemeFlottant.Aide"))}</p>
      <p class="das-float-theme__state"><i class="fa-solid ${floatsActive() ? "fa-circle-check" : "fa-circle-xmark"}"></i>
        ${esc(loc(floatsActive() ? "ThemeFlottant.Actifs" : "ThemeFlottant.Coupes", { setting: loc(`Reglage.${FLOAT_SYSTEM}.Nom`) }))}
        · ${esc(custom ? loc("ThemeFlottant.Personnalise", { n: custom }) : loc("ThemeFlottant.OrigineEtat"))}</p>
      <fieldset>
        <legend>${esc(loc("ThemeFlottant.Importer"))}</legend>
        <textarea name="json" rows="6" spellcheck="false" placeholder="${esc(loc("ThemeFlottant.Coller"))}"></textarea>
        <div class="das-float-theme__row">
          <input type="file" name="file" accept=".json,application/json">
          <button type="button" class="das-button" data-action="importText"><i class="fa-solid fa-file-import"></i> ${esc(loc("ThemeFlottant.Importer"))}</button>
        </div>
        ${report}
      </fieldset>
      <fieldset>
        <legend>${esc(loc("ThemeFlottant.EssaiTitre"))}</legend>
        <p class="das-muted">${esc(loc("ThemeFlottant.EssaiAide"))}</p>
        <div class="das-float-theme__kinds">${kinds}</div>
      </fieldset>
      <div class="das-float-theme__row">
        <button type="button" class="das-button" data-action="exportCopy"><i class="fa-solid fa-copy"></i> ${esc(loc("ThemeFlottant.Copier"))}</button>
        <button type="button" class="das-button" data-action="exportFile"><i class="fa-solid fa-download"></i> ${esc(loc("ThemeFlottant.Telecharger"))}</button>
        <button type="button" class="das-button" data-action="reset"><i class="fa-solid fa-rotate-left"></i> ${esc(loc("ThemeFlottant.Origine.Bouton"))}</button>
      </div>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #importText() {
    const root = this.element;
    const file = root.querySelector('input[name="file"]')?.files?.[0];
    const text = file ? await file.text() : root.querySelector('textarea[name="json"]')?.value?.trim();
    if ( !text ) { this.report = { ok: false, text: loc("ThemeFlottant.Vide") }; return this.render(); }
    try {
      const { kinds, problems } = await importTheme(text);
      this.report = { ok: !problems.length, text: loc("ThemeFlottant.Importe", { n: kinds })
        + (problems.length ? ` ${loc("ThemeFlottant.Refuses", { list: problems.slice(0, 12).join(", ") + (problems.length > 12 ? "…" : "") })}` : "") };
    } catch (err) {
      this.report = { ok: false, text: loc("ThemeFlottant.Illisible", { error: err.message }) };
    }
    this.render();
  }

  static async #exportCopy() {
    const text = JSON.stringify(exportTheme(), null, 2);
    try { await navigator.clipboard.writeText(text); ui.notifications.info(loc("ThemeFlottant.Copie")); }
    catch {
      const area = this.element.querySelector('textarea[name="json"]');
      if ( area ) { area.value = text; area.select(); }
    }
  }

  static #exportFile() {
    foundry.utils.saveDataToFile(JSON.stringify(exportTheme(), null, 2), "application/json", "das-float-theme.json");
  }

  static async #reset() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: loc("ThemeFlottant.Titre") },
      content: `<p>${esc(loc("ThemeFlottant.Origine.Confirmer"))}</p>`, rejectClose: false });
    if ( !ok ) return;
    await resetTheme();
    this.report = { ok: true, text: loc("ThemeFlottant.Origine.Fait") };
    this.render();
  }

  static #try(event, target) {
    tryKind(target.dataset.kind);
  }
};

/** Opens the window (GM). */
export function openFloatTheme() {
  if ( !game.user.isGM ) return null;
  const app = foundry.applications.instances.get(windowId) ?? new (ThemeApp())();
  app.render({ force: true });
  return app;
}
