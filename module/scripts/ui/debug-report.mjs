/**
 * §380 (issue #36): the "DAS Bug Report" window — the errors recorded on this client (and, on the active GM, those the
 * players sent to them), a description, the environment, the trail of the latest actions; a full, editable preview; three
 * outputs, each on one click: copy the Markdown, save a file (.md or .json), open GitHub's "New issue" page
 * pre-filled. Nothing leaves without that click. Opened from the General tab of the DAS window (GM and players) or the context menu
 * of a token (the GM on any creature, a player on their own: that token's context is attached; world setting `debugMenu`
 * to remove this entry); `api.debug.open()`.
 * Visual feedback: a badge with the error count on the "DAS Settings" button of the sidebar, and a notice at the first
 * DAS error of the session (client setting `debugNotify`).
 */

import { MODULE_ID } from "../constants.mjs";
import { issueUrl, reportJson } from "../core/debug.mjs";
import { buildDebugReport, debugApi, reportRepos, roles } from "../runtime/debug.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-debug-report";
export const DEBUG_NOTIFY_SETTING = "debugNotify";
export const DEBUG_MENU_SETTING = "debugMenu";
let notified = false;

/** The Markdown headings: in English (the language of issues), whatever the interface language. */
const LABELS = {};

let ReportClass = null;
const ReportApp = () => ReportClass ??= class DebugReport extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-debug-report"],
    window: { icon: "fa-solid fa-bug", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      copy: DebugReport.#copy, saveMd: DebugReport.#saveMd, saveJson: DebugReport.#saveJson, github: DebugReport.#github,
      refresh: DebugReport.#refresh, verbose: DebugReport.#verbose, clear: DebugReport.#clear, all: DebugReport.#all
    }
  };

  /** What the person chose: kept between two renders. */
  choices = { description: "", selected: null, includeNames: false, includeFlagged: false, includeLogs: false, repo: null };
  token = null;
  built = null;
  edited = false;

  constructor(options={}) {
    super(options);
    this.token = options.token ?? null;
  }

  get title() {
    return loc("Debogueur.Titre");
  }

  #build() {
    this.built = buildDebugReport({ ...this.choices, selected: this.choices.selected ?? undefined, token: this.token, labels: LABELS });
    this.edited = false;
    return this.built;
  }

  async _renderHTML() {
    const { report, markdown } = this.#build();
    const r = roles({ gm: loc("Debogueur.RoleMJ"), player: loc("Debogueur.RoleJoueur") });
    const who = id => (id ? (r.get(id) ?? "?") : "?");
    // The suite's errors first; those of other modules (kept by "all modules") after, unchecked by default.
    const groups = debugApi.errors().sort((a, b) => Number(!!a.thirdParty) - Number(!!b.thirdParty));
    const selected = this.choices.selected ? new Set(this.choices.selected) : null;
    const badge = (on, key) => (on ? `<span class="das-debug__badge">${esc(loc(key))}</span>` : "");
    const list = groups.length ? `<ul class="das-debug__errors">${groups.map(g => `<li${g.thirdParty ? ` class="das-debug__other"` : ""}>
        <label><input type="checkbox" data-sig="${esc(g.sig)}" ${(selected ? selected.has(g.sig) : !g.thirdParty) ? "checked" : ""}>
        <span class="das-debug__count">×${g.count}</span>
        <span class="das-debug__module">${esc(g.module ?? "?")}</span>
        ${badge(g.thirdParty, "Debogueur.HorsSuite")}${badge(g.deprecation, "Debogueur.Depreciation")}
        <span class="das-debug__message" data-tooltip="${esc(g.stack.slice(0, 4).join("\n"))}">${esc(g.label ? `${g.label} — ` : "")}${esc(g.message)}</span>
        <small class="das-muted">${esc(g.clients.map(who).join(", "))}</small></label></li>`).join("")}</ul>`
      : `<p class="das-muted">${esc(loc("Debogueur.AucuneErreur"))}</p>`;
    const repos = reportRepos(report);
    const repo = this.choices.repo ?? repos[0]?.repo ?? "";
    const repoOptions = repos.map(x => `<option value="${esc(x.repo)}" ${x.repo === repo ? "selected" : ""}>${esc(x.repo)}</option>`).join("");
    const box = (key, on, text) => `<label class="das-debug__option"><input type="checkbox" data-option="${key}" ${on ? "checked" : ""}> ${esc(text)}</label>`;
    let flaggedCount = 0;
    try { flaggedCount = Object.keys(itemReports()).length; } catch { /* setting unreadable */ }
    const verbose = debugApi.verbose();
    return `
      <p class="das-debug__intro">${esc(loc("Debogueur.Intro"))}</p>
      ${this.token ? `<p class="das-muted"><i class="fa-solid fa-location-dot"></i> ${esc(loc("Debogueur.AvecToken"))}</p>` : ""}
      <section><h3>${esc(loc("Debogueur.Erreurs", { count: groups.length }))}
        ${groups.length > 1 ? `<button type="button" class="das-button ghost" data-action="all">${esc(loc("Debogueur.ToutCocher"))}</button>` : ""}</h3>
        ${list}</section>
      <section><h3>${esc(loc("Debogueur.Description"))}</h3>
        <textarea data-field="description" rows="3" placeholder="${esc(loc("Debogueur.DescriptionAide"))}">${esc(this.choices.description)}</textarea></section>
      <section class="das-debug__options">
        ${box("includeNames", this.choices.includeNames, loc("Debogueur.InclureNoms"))}
        ${flaggedCount ? box("includeFlagged", this.choices.includeFlagged, loc("Debogueur.InclureSignalements", { count: flaggedCount })) : ""}
        ${debugApi.logs().length ? box("includeLogs", this.choices.includeLogs, loc("Debogueur.InclureJournal", { count: debugApi.logs().length })) : ""}
      </section>
      <section><h3>${esc(loc("Debogueur.Apercu"))} <small class="das-muted">${esc(loc("Debogueur.ApercuAide"))}</small></h3>
        <textarea class="das-debug__preview" data-field="preview" spellcheck="false">${esc(markdown)}</textarea></section>
      <footer class="das-debug__actions">
        <button type="button" class="das-button" data-action="copy"><i class="fa-solid fa-copy"></i> ${esc(loc("Debogueur.Copier"))}</button>
        <button type="button" class="das-button ghost" data-action="saveMd"><i class="fa-solid fa-file-lines"></i> .md</button>
        <button type="button" class="das-button ghost" data-action="saveJson"><i class="fa-solid fa-file-code"></i> .json</button>
        ${repos.length ? `<span class="das-debug__github"><select data-field="repo">${repoOptions}</select>
          <button type="button" class="das-button ghost" data-action="github"><i class="fa-brands fa-github"></i> ${esc(loc("Debogueur.GitHub"))}</button></span>` : ""}
      </footer>
      <footer class="das-debug__tools">
        <button type="button" class="das-button ghost" data-action="refresh"><i class="fa-solid fa-rotate"></i> ${esc(loc("Debogueur.Actualiser"))}</button>
        <button type="button" class="das-button ghost${verbose ? " on" : ""}" data-action="verbose" data-tooltip="${esc(loc(game.user.isGM ? "Debogueur.DetailAideMJ" : "Debogueur.DetailAide"))}">
          <i class="fa-solid fa-magnifying-glass-plus"></i> ${esc(loc(verbose ? "Debogueur.DetailCouper" : "Debogueur.DetailActiver"))}</button>
        <button type="button" class="das-button ghost" data-action="clear"><i class="fa-solid fa-broom"></i> ${esc(loc("Debogueur.Effacer"))}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    const root = this.element;
    // Choices are read without redrawing everything: only the preview changes (and typing in the preview is not
    // overwritten without reason).
    root.querySelector('[data-field="description"]')?.addEventListener("input", event => {
      this.choices.description = event.target.value;
      this.#updatePreview();
    });
    root.querySelector('[data-field="preview"]')?.addEventListener("input", () => { this.edited = true; });
    root.querySelector('[data-field="repo"]')?.addEventListener("change", event => { this.choices.repo = event.target.value; });
    for ( const input of root.querySelectorAll("input[data-option]") ) {
      input.addEventListener("change", () => {
        this.choices[input.dataset.option] = input.checked;
        this.#updatePreview();
      });
    }
    for ( const input of root.querySelectorAll("input[data-sig]") ) {
      input.addEventListener("change", () => {
        this.choices.selected = Array.from(root.querySelectorAll("input[data-sig]:checked"), i => i.dataset.sig);
        this.#updatePreview();
      });
    }
  }

  #updatePreview() {
    const area = this.element?.querySelector('[data-field="preview"]');
    const { markdown } = this.#build();
    if ( area ) area.value = markdown;
  }

  /** The text that goes out: the preview as the person left it. */
  #text() {
    return this.element?.querySelector('[data-field="preview"]')?.value ?? this.built?.markdown ?? "";
  }

  #fileName(ext) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `das-bug-report-${stamp}.${ext}`;
  }

  static async #copy() {
    await game.clipboard.copyPlainText(this.#text());
    ui.notifications.info(loc("Debogueur.Copie"));
  }

  static #saveMd() {
    foundry.utils.saveDataToFile(this.#text(), "text/markdown", this.#fileName("md"));
    ui.notifications.info(loc("Debogueur.Enregistre"));
  }

  static #saveJson() {
    if ( this.edited ) ui.notifications.warn(loc("Debogueur.JsonSansRetouche"));
    foundry.utils.saveDataToFile(reportJson(this.built.report), "application/json", this.#fileName("json"));
    ui.notifications.info(loc("Debogueur.Enregistre"));
  }

  static #github() {
    const repo = this.element?.querySelector('[data-field="repo"]')?.value;
    const first = this.built.report.errors[0];
    const title = this.choices.description.trim().split("\n")[0].slice(0, 80)
      || (first ? `[${first.module ?? "?"}] ${first.message}`.slice(0, 80) : "Bug report");
    const url = issueUrl({ repo, title, body: this.#text(), note: loc("Debogueur.NoteTronque") });
    if ( !url ) return;
    window.open(url, "_blank", "noopener");
    ui.notifications.info(loc("Debogueur.GitHubOuvert"));
  }

  static #refresh() {
    this.render();
  }

  static async #verbose() {
    const on = !debugApi.verbose();
    if ( game.user.isGM ) {
      const n = await debugApi.verboseEverywhere(on);
      ui.notifications.info(loc(on ? "Debogueur.DetailPartout" : "Debogueur.DetailPartoutCoupe", { count: n }));
    } else {
      debugApi.verbose(on);
    }
    this.render();
  }

  static #clear() {
    debugApi.clear();
    this.choices.selected = null;
    updateBadge();
    this.render();
  }

  static #all() {
    this.choices.selected = null;
    this.render();
  }
};

/** Opens the window (or brings it to the front). `token`: the attached context, from the context menu. */
export function openDebugReport({ token=null }={}) {
  const open = foundry.applications.instances.get(WINDOW_ID);
  if ( open ) {
    if ( token ) open.token = token;
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new (ReportApp())({ token });
  app.render({ force: true });
  return app;
}

/** The context menu entry: the GM on any creature, a player on their own; absent if the GM removed it (`debugMenu`). */
export function debugMenuEntry(target) {
  const doc = target?.document ?? target;
  if ( !doc?.actor || !(game.user.isGM || doc.isOwner) ) return null;
  let shown = true;
  try { shown = game.settings.get(MODULE_ID, DEBUG_MENU_SETTING); } catch { /* setting not yet declared */ }
  if ( !shown ) return null;
  return { icon: "fa-solid fa-bug", label: loc("Debogueur.Menu"), run: () => openDebugReport({ token: doc }) };
}

/* -------------------------------------------- */
/*  Retour visuel                               */
/* -------------------------------------------- */

/**
 * The badge of the "DAS Settings" button: the number of DAS errors recorded (repeats included), in red. Non-DAS errors
 * (kept by "all modules") do not raise it: with no DAS error, a discreet grey badge counts them separately.
 * Hidden at zero.
 */
export function updateBadge() {
  const button = document.querySelector(".das-sidebar-settings");
  if ( !button ) return;
  const suite = debugApi.total("suite");
  const others = debugApi.total("others");
  let badge = button.querySelector(".das-debug-badge");
  if ( !suite && !others ) { badge?.remove(); return; }
  if ( !badge ) {
    badge = document.createElement("span");
    badge.className = "das-debug-badge";
    button.append(badge);
  }
  const count = suite || others;
  badge.classList.toggle("das-debug-badge--others", !suite);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.dataset.tooltip = suite ? loc("Debogueur.Pastille", { count }) : loc("Debogueur.PastilleHorsSuite", { count });
}

function onError(group, isNew) {
  updateBadge();   // the open window is not redrawn: the edited preview would be lost ("Refresh" does it)
  if ( group?.thirdParty ) return;   // a non-DAS error raises no alarm: no notice, only the grey badge
  if ( !isNew || notified || !globalThis.ui?.notifications ) return;
  let on = true;
  try { on = game.settings.get(MODULE_ID, DEBUG_NOTIFY_SETTING); } catch { /* setting not yet declared */ }
  if ( !on ) return;
  notified = true;
  ui.notifications.warn(loc("Debogueur.Avis"));
}

export function registerDebugReport() {
  game.settings.register(MODULE_ID, DEBUG_NOTIFY_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugNotify.Nom", hint: "DND5ECOMBAT.Reglage.debugNotify.Aide",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, DEBUG_MENU_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugMenu.Nom", hint: "DND5ECOMBAT.Reglage.debugMenu.Aide",
    scope: "world", config: true, type: Boolean, default: true
  });
  debugApi.onError((group, isNew) => {
    // An error thrown before `ready` waits: no notice or window until the interface is there.
    if ( game.ready ) onError(group, isNew);
  });
  route("ready", () => {
    updateBadge();
    if ( debugApi.total("suite") ) onError(null, true);
  }, { always: true, label: "debug report: errors raised during loading not shown" });
  route("renderSettings", () => updateBadge(), { always: true, label: "debug report: sidebar badge not updated" });
}
