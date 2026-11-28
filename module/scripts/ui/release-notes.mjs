/**
 * §439: the update message. Opened for the active GM the first time a world is opened after an engine version change
 * (world setting `welcomeSeen`: the last version seen, ui/welcome.mjs), and afterwards from the welcome screen or the settings.
 * Four parts: the news of the versions released since the last one seen, the suite modules to update, the gaps
 * between Foundry, dnd5e and the books and the tested versions (and the risks written for those versions), the recommended
 * checks of the world Diagnostic. The notes are data (content/releases.mjs), the rules are pure
 * (core/release-notes.mjs); here, only the reading of the world and the display. Look: that of the welcome screen (`das-screen`).
 */
import { MODULE_ID } from "../constants.mjs";
import { RELEASES } from "../content/releases.mjs";
import { compareVersions, hasNews, releaseReport } from "../core/release-notes.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { LOGO } from "../runtime/diagnostic/backup.mjs";
import { openDiagnostic } from "./diagnostic.mjs";

export const SEEN_SETTING = "welcomeSeen";
const RELEASES_URL = "https://github.com/Darshyne/dnd5e-combat/releases";
const LEVEL_ICON = Object.freeze({ info: "fa-solid fa-circle-info", warn: "fa-solid fa-triangle-exclamation" });

const currentVersion = () => game.modules.get(MODULE_ID)?.version ?? "";

/** This world: Foundry, the system, the modules with their version. */
function installed() {
  return {
    foundry: game.version,
    system: game.system.version,
    modules: Array.from(game.modules).map(m => ({ id: m.id, title: m.title, version: m.version, active: !!m.active }))
  };
}

/** The GM has seen this version: the welcome screen and the update message no longer open by themselves. */
export async function markSeen() {
  const version = currentVersion() || "1";
  if ( game.user.isGM && (game.settings.get(MODULE_ID, SEEN_SETTING) !== version) ) await game.settings.set(MODULE_ID, SEEN_SETTING, version);
}

/** The window class, created on first use (the module also loads outside Foundry: tests/load.test.mjs). */
let ReleaseNotesClass = null;
export const ReleaseNotesApp = () => ReleaseNotesClass ??= class ReleaseNotesApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    super(options);
    this.since = options.since ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "das-release-notes",
    classes: ["das-screen", "das-welcome", "das-news"],
    window: { title: "DND5ECOMBAT.Nouveautes.Titre", icon: "fa-solid fa-bullhorn", resizable: true },
    position: { width: 760, height: "auto" }
  };

  async _renderHTML() {
    const report = releaseReport(RELEASES, { seen: this.since, current: currentVersion(), installed: installed() });
    const root = document.createElement("div");
    root.className = "das-welcome__body das-news__body";
    root.innerHTML = [hero(report), news(report), modules(report), compat(report), diagnostic(report), footer()].join("");
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    const el = this.element;
    for ( const button of el.querySelectorAll("[data-check]") ) {
      button.addEventListener("click", () => openDiagnostic({ check: button.dataset.check || null }));
    }
    el.querySelector("[data-action=close]")?.addEventListener("click", () => this.close());
  }

  async _onClose(options) {
    await markSeen();
    return super._onClose?.(options);
  }
};

function hero(report) {
  const from = report.seen && (report.seen !== report.current);
  return `<header class="das-hero">
    <img src="${LOGO}" alt="DAS" class="das-hero__logo">
    <div>
      <h1>${esc(loc("Nouveautes.Titre"))}</h1>
      <p class="das-muted">${esc(from ? loc("Nouveautes.DeVers", { from: report.seen, to: report.current }) : loc("Accueil.Version", { version: report.current }))}</p>
    </div>
  </header>`;
}

function news(report) {
  const blocks = report.notes.map(n => `<article class="das-news__version">
      <h3>${esc(n.version)}</h3>
      <ul>${n.highlights.map(id => `<li>${esc(loc(`Nouveautes.Point.${id}`))}</li>`).join("")}</ul>
    </article>`).join("");
  return `<h2><i class="fa-solid fa-star"></i> ${esc(loc("Nouveautes.NouveautesTitre"))}</h2>
    ${blocks || `<p class="das-muted">${esc(loc("Nouveautes.SansNote"))}</p>`}`;
}

function modules(report) {
  const title = `<h2><i class="fa-solid fa-cubes"></i> ${esc(loc("Nouveautes.ModulesTitre"))}</h2>`;
  if ( !report.late.length ) return `${title}<p class="das-news__ok"><i class="fa-solid fa-circle-check"></i> ${esc(loc("Nouveautes.ModulesOk"))}</p>`;
  return `${title}
    <p>${esc(loc("Nouveautes.ModulesTexte", { version: report.current }))}</p>
    <ul class="das-news__list">${report.late.map(m => `<li class="warn"><i class="${LEVEL_ICON.warn}"></i>
      <span>${esc(loc("Nouveautes.ModuleRetard", { title: m.title, version: m.version, tested: m.tested }))}</span></li>`).join("")}</ul>
    <p class="das-muted">${esc(loc("Nouveautes.ModulesAide"))}</p>`;
}

function compat(report) {
  const t = report.tested;
  const title = `<h2><i class="fa-solid fa-plug-circle-check"></i> ${esc(loc("Nouveautes.CompatTitre"))}</h2>`;
  const tested = t ? `<p class="das-muted">${esc(loc("Nouveautes.Teste", { version: report.current, foundry: t.foundry, system: t.system }))}</p>` : "";
  const gaps = report.compatibility.map(g => `<li class="${g.level}"><i class="${LEVEL_ICON[g.level]}"></i>
      <span>${esc(loc(`Nouveautes.Ecart.${g.way}`, { title: g.title, version: g.version, tested: g.tested }))}</span></li>`).join("");
  const risks = report.risks.map(r => `<li class="warn"><i class="${LEVEL_ICON.warn}"></i>
      <span><strong>${esc(loc(`Nouveautes.Risque.${r.id}.Titre`))}</strong> ${esc(loc(`Nouveautes.Risque.${r.id}.Texte`))}</span></li>`).join("");
  const body = (gaps || risks) ? `<ul class="das-news__list">${gaps}${risks}</ul>`
    : `<p class="das-news__ok"><i class="fa-solid fa-circle-check"></i> ${esc(loc("Nouveautes.CompatOk"))}</p>`;
  return `${title}${tested}${body}`;
}

function diagnostic(report) {
  const checks = report.checks.map(c => `<li><button type="button" class="das-link" data-check="${esc(c.id)}">
      <i class="fa-solid fa-magnifying-glass"></i> ${esc(loc(`Diagnostic.Verif.${c.id}.Nom`))}</button></li>`).join("");
  return `<section class="das-diag">
    <div>
      <h2><i class="fa-solid fa-stethoscope"></i> ${esc(loc("Diagnostic.Titre"))}</h2>
      <p>${esc(loc(checks ? "Nouveautes.DiagnosticConseille" : "Nouveautes.DiagnosticTexte"))}</p>
      ${checks ? `<ul class="das-news__checks">${checks}</ul>` : ""}
    </div>
    <button type="button" class="das-button" data-check=""><i class="fa-solid fa-magnifying-glass"></i> ${esc(loc("Accueil.DiagnosticBouton"))}</button>
  </section>`;
}

function footer() {
  return `<footer class="das-links">
    <a href="${RELEASES_URL}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> ${esc(loc("Nouveautes.ToutesLesVersions"))}</a>
    <span class="das-muted">${esc(loc("Nouveautes.Retrouver"))}</span>
    <button type="button" class="das-button ghost" data-action="close">${esc(loc("Nouveautes.Fermer"))}</button>
  </footer>`;
}

/**
 * For the API, the welcome screen and the settings: open the update message. `since`: the last version seen (the notes of the
 * versions released since); without it, the latest notes.
 */
export async function openReleaseNotes({ since=null }={}) {
  const existing = foundry.applications.instances.get("das-release-notes");
  if ( existing && (existing.since !== since) ) await existing.close();
  return new (ReleaseNotesApp())({ since }).render({ force: true });
}

/**
 * On `ready`, for the active GM, when the world has already seen an engine version and it is no longer this one: the message
 * opens if it has something to say, and the version is recorded as seen when it is closed. A version older than the one seen
 * (rollback), or nothing to say: the version is recorded, without a window. Returns true when the window opened.
 */
export async function announceUpdate() {
  const seen = game.settings.get(MODULE_ID, SEEN_SETTING);
  const current = currentVersion();
  if ( !seen || !current || (seen === current) ) return false;
  if ( compareVersions(current, seen) > 0 ) {
    const report = releaseReport(RELEASES, { seen, current, installed: installed() });
    if ( hasNews(report) ) { await openReleaseNotes({ since: seen }); return true; }
  }
  await markSeen();
  return false;
}
