/**
 * The diagnostic window (SPEC §177): "Analysis" tab (analyze, check, repair after backup) and "Backups" tab
 * (restore a repair). All the action is in runtime/diagnostic/; here, the display and the confirmations.
 */
import { MODULE_ID } from "../constants.mjs";
import { allChecks, listBackups, repairTasks, restore, scanWorld } from "../runtime/diagnostic/index.mjs";
import { uniqueRoots } from "../core/backup.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { replaceKeepingScroll } from "./scroll.mjs";

/** The window's class, created on first use (the module also loads outside Foundry: tests/load.test.mjs). */
let DiagnosticClass = null;
export const DiagnosticApp = () => DiagnosticClass ??= class DiagnosticApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "das-diagnostic",
    classes: ["das-screen", "das-diagnostic"],
    window: { title: "DND5ECOMBAT.Diagnostic.Titre", icon: "fa-solid fa-stethoscope", resizable: true },
    position: { width: 820, height: 680 }
  };

  /**
   * Open on a single check ("GM Tools" macros). B6: a single instance — the settings menu creates the window
   * with `new`: it receives the one already open (`openDiagnostic` first closes the one of another check).
   */
  constructor({ check=null, ...options }={}) {
    const existing = foundry.applications.instances.get("das-diagnostic");
    if ( existing instanceof DiagnosticApp ) return existing;
    super(options);
    this.#only = check;
  }

  /** The single check the window is open on, or null (all). */
  get only() { return this.#only; }

  #only = null;
  #tab = "scan";
  #scan = null;          // { [checkId]: tasks }
  #checked = new Set();  // ids of the checked tasks
  #options = {};         // { [checkId]: { [optionId]: valeur } } choisies par le MJ
  #result = null;        // { backup, results }
  #backups = null;
  #working = false;
  #scroll = {};          // scroll position kept from one render to the next (ui/scroll.mjs)

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "das-diagnostic__body";
    const tab = (id, icon) => `<button type="button" class="das-tab${this.#tab === id ? " active" : ""}" data-tab="${id}">
      <i class="${icon}"></i> ${esc(loc(`Diagnostic.Onglet.${id}`))}</button>`;
    root.innerHTML = `<nav class="das-tabs">${tab("scan", "fa-solid fa-magnifying-glass")}${tab("backups", "fa-solid fa-box-archive")}</nav>
      <div class="das-pane">${this.#tab === "scan" ? this.#scanHTML() : await this.#backupsHTML()}</div>`;
    return root;
  }

  #scanHTML() {
    const intro = `<p class="das-lead">${esc(loc("Diagnostic.Intro"))}</p>`;
    if ( this.#working ) return `${intro}<p class="das-working"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(loc("Diagnostic.EnCours"))}</p>`;
    if ( this.#result ) return this.#resultHTML();
    if ( !this.#scan ) {
      return `${intro}<div class="das-center"><button type="button" class="das-button big" data-action="scan">
        <i class="fa-solid fa-magnifying-glass"></i> ${esc(loc("Diagnostic.Analyser"))}</button></div>`;
    }
    const section = check => {
      const tasks = this.#scan[check.id];
      const fixable = tasks.filter(t => t.apply).length;
      const options = fixable ? (check.options ?? []).map(o => `<label class="das-option">
          <input type="checkbox" data-option="${check.id}.${o.id}" ${this.#option(check.id, o) ? "checked" : ""}>
          <span>${esc(loc(`Diagnostic.Verif.${check.id}.Option.${o.id}`))}</span></label>`).join("") : "";
      const rows = tasks.map(t => `<label class="das-task${t.apply ? "" : " info"}">
          <input type="checkbox" data-task="${t.id}" ${t.apply ? "" : "disabled"} ${this.#checked.has(t.id) ? "checked" : ""}>
          <span class="das-task__where">${t.where}</span><span class="das-task__text">${t.text}</span></label>`).join("");
      return `<details class="das-check" ${tasks.length ? "open" : ""}>
        <summary><i class="${check.icon}"></i> <strong>${esc(check.name ?? loc(`Diagnostic.Verif.${check.id}.Nom`))}</strong>
          <span class="das-count${tasks.length ? "" : " zero"}">${tasks.length ? esc(loc("Diagnostic.Trouves", { count: tasks.length, fixable })) : esc(loc("Diagnostic.RienATrouver"))}</span></summary>
        <p class="das-muted">${esc(check.hint ?? loc(`Diagnostic.Verif.${check.id}.Aide`))}</p>
        ${fixable ? `<div class="das-row"><button type="button" class="das-link" data-all="${check.id}">${esc(loc("Diagnostic.ToutCocher"))}</button>
          <button type="button" class="das-link" data-none="${check.id}">${esc(loc("Diagnostic.ToutDecocher"))}</button></div>` : ""}
        ${options}${rows}</details>`;
    };
    // A group's checks (`check.group`, such as "ddb": content imported from D&D Beyond) form a separate section,
    // after the others, under their title.
    const shown = allChecks().filter(c => this.#scan[c.id]);
    const groups = [...new Set(shown.map(c => c.group).filter(Boolean))].map(group => `<section class="das-group">
        <h3><i class="${shown.find(c => c.group === group).icon}"></i> ${esc(loc(`Diagnostic.Groupe.${group}.Nom`))}</h3>
        <p class="das-muted">${esc(loc(`Diagnostic.Groupe.${group}.Aide`))}</p>
        ${shown.filter(c => c.group === group).map(section).join("")}</section>`).join("");
    const sections = shown.filter(c => !c.group).map(section).join("") + groups;
    const count = this.#selected().length;
    return `${intro}<div class="das-checks">${sections}</div>
      <footer class="das-actions">
        <button type="button" class="das-button ghost" data-action="scan"><i class="fa-solid fa-rotate"></i> ${esc(loc("Diagnostic.Reanalyser"))}</button>
        <button type="button" class="das-button ghost" data-action="uncheckAll" ${count ? "" : "disabled"}>
          <i class="fa-regular fa-square"></i> ${esc(loc("Diagnostic.ToutDeselectionner"))}</button>
        <button type="button" class="das-button" data-action="repair" ${count ? "" : "disabled"}>
          <i class="fa-solid fa-screwdriver-wrench"></i> ${esc(loc("Diagnostic.Reparer", { count }))}</button>
      </footer>`;
  }

  #resultHTML() {
    const { backup, results } = this.#result;
    const ok = results.filter(r => r.ok).length;
    const rows = results.map(r => `<li class="${r.ok ? "ok" : "ko"}"><i class="fa-solid ${r.ok ? "fa-check" : "fa-xmark"}"></i>
      <span class="das-task__where">${r.task.where}</span> <span>${r.line}</span></li>`).join("");
    return `<h2>${esc(loc("Diagnostic.Termine", { ok, total: results.length }))}</h2>
      ${backup ? `<p class="das-saved"><i class="fa-solid fa-box-archive"></i> ${esc(loc("Diagnostic.SauvegardeFaite", { name: backup.name }))}</p>` : ""}
      <ul class="das-results">${rows}</ul>
      <footer class="das-actions">
        <button type="button" class="das-button ghost" data-action="backupsTab">${esc(loc("Diagnostic.Onglet.backups"))}</button>
        <button type="button" class="das-button" data-action="scan"><i class="fa-solid fa-rotate"></i> ${esc(loc("Diagnostic.Reanalyser"))}</button>
      </footer>`;
  }

  async #backupsHTML() {
    this.#backups ??= await listBackups();
    if ( this.#working ) return `<p class="das-working"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(loc("Diagnostic.EnCours"))}</p>`;
    const intro = `<p class="das-lead">${esc(loc("Diagnostic.SauvegardesIntro"))}</p>`;
    if ( !this.#backups.length ) return `${intro}<p class="das-muted">${esc(loc("Diagnostic.AucuneSauvegarde"))}</p>`;
    const rows = this.#backups.map(b => `<li class="das-backup">
        <div><strong>${esc(b.name)}</strong><br><span class="das-muted">${esc(b.roots.map(r => r.name).join(", "))}</span></div>
        <button type="button" class="das-button ghost" data-restore="${esc(b.uuid)}"><i class="fa-solid fa-clock-rotate-left"></i> ${esc(loc("Diagnostic.Restaurer"))}</button>
      </li>`).join("");
    return `${intro}<ul class="das-backups">${rows}</ul>`;
  }

  /** Scrolling is kept within the same tab: checking, "Uncheck all" or an option no longer returns to the top. */
  _replaceHTML(result, content) {
    replaceKeepingScroll(content, result, [".das-pane"], this.#scroll, this.#tab);
  }

  /** The value of a check's option: the chosen one, otherwise its default. */
  #option(checkId, option) {
    return this.#options[checkId]?.[option.id] ?? option.default;
  }

  /** Each check's options, defaults included, for the repair. */
  #allOptions() {
    return Object.fromEntries(allChecks().filter(c => c.options?.length)
      .map(c => [c.id, Object.fromEntries(c.options.map(o => [o.id, this.#option(c.id, o)]))]));
  }

  /** The checked tasks (only those that can be repaired). */
  #selected() {
    return Object.values(this.#scan ?? {}).flat().filter(t => t.apply && this.#checked.has(t.id));
  }

  _onRender() {
    const el = this.element;
    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { this.#tab = b.dataset.tab; this.#backups = null; this.render(); }));
    el.querySelector("[data-action=scan]")?.addEventListener("click", () => this.#runScan());
    el.querySelector("[data-action=repair]")?.addEventListener("click", () => this.#runRepair());
    el.querySelector("[data-action=backupsTab]")?.addEventListener("click", () => { this.#tab = "backups"; this.#backups = null; this.render(); });
    el.querySelectorAll("[data-task]").forEach(box => box.addEventListener("change", () => {
      if ( box.checked ) this.#checked.add(box.dataset.task); else this.#checked.delete(box.dataset.task);
      const count = this.#selected().length;
      const repair = el.querySelector("[data-action=repair]");
      if ( repair ) { repair.disabled = !count; repair.lastChild.textContent = ` ${loc("Diagnostic.Reparer", { count })}`; }
      const uncheck = el.querySelector("[data-action=uncheckAll]");
      if ( uncheck ) uncheck.disabled = !count;
    }));
    // Deselect everything, all checks combined (the per-section buttons remain for a single check).
    el.querySelector("[data-action=uncheckAll]")?.addEventListener("click", () => { this.#checked.clear(); this.render(); });
    el.querySelectorAll("[data-option]").forEach(box => box.addEventListener("change", () => {
      const [checkId, optionId] = box.dataset.option.split(".");
      (this.#options[checkId] ??= {})[optionId] = box.checked;
    }));
    const pick = (id, on) => {
      for ( const t of this.#scan?.[id] ?? [] ) if ( t.apply ) { if ( on ) this.#checked.add(t.id); else this.#checked.delete(t.id); }
      this.render();
    };
    el.querySelectorAll("[data-all]").forEach(b => b.addEventListener("click", () => pick(b.dataset.all, true)));
    el.querySelectorAll("[data-none]").forEach(b => b.addEventListener("click", () => pick(b.dataset.none, false)));
    el.querySelectorAll("[data-restore]").forEach(b => b.addEventListener("click", () => this.#runRestore(b.dataset.restore)));
  }

  async #runScan() {
    this.#working = true; this.#result = null; this.render();
    try {
      this.#scan = await scanWorld(this.#only ? [this.#only] : null);
      this.#checked = new Set(Object.values(this.#scan).flat().filter(t => t.apply && t.preselect).map(t => t.id));
    } catch(err) {
      ui.notifications.error(err.message);
    } finally {
      this.#working = false; this.render();
    }
  }

  async #runRepair() {
    const tasks = this.#selected();
    if ( !tasks.length ) return;
    const roots = uniqueRoots(tasks);
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("Diagnostic.Titre"), icon: "fa-solid fa-screwdriver-wrench" },
      content: `<p>${esc(loc("Diagnostic.Confirmer", { count: tasks.length, docs: roots.length }))}</p>
        <p>${esc(loc("Diagnostic.ConfirmerSauvegarde"))}</p>`,
      rejectClose: false
    });
    if ( !yes ) return;
    this.#working = true; this.render();
    try {
      this.#result = await repairTasks(tasks, this.#allOptions());
      this.#scan = null;
      this.#checked.clear();
    } catch(err) {
      // The backup failed: nothing was modified.
      ui.notifications.error(loc("Diagnostic.SauvegardeEchec", { error: err.message }), { permanent: true });
      console.error(`${MODULE_ID} | diagnostic`, err);
    } finally {
      this.#working = false; this.render();
    }
  }

  async #runRestore(uuid) {
    const backup = this.#backups?.find(b => b.uuid === uuid);
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("Diagnostic.Restaurer"), icon: "fa-solid fa-clock-rotate-left" },
      content: `<p>${esc(loc("Diagnostic.ConfirmerRestauration", { name: backup?.name ?? uuid, count: backup?.roots.length ?? 0 }))}</p>`,
      rejectClose: false
    });
    if ( !yes ) return;
    this.#working = true; this.render();
    try {
      const { lines, before } = await restore(uuid);
      ui.notifications.info(loc("Diagnostic.RestaurationFaite", { count: lines.length }));
      await ChatMessage.create({ content: `<h3>${esc(loc("Diagnostic.Restaurer"))} — ${esc(backup?.name ?? "")}</h3>`
        + `${before ? `<p>${esc(loc("Diagnostic.SauvegardeFaite", { name: before.name }))}</p>` : ""}<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`,
        whisper: [game.user.id], speaker: { alias: loc("Diagnostic.Titre") } });
    } catch(err) {
      ui.notifications.error(err.message, { permanent: true });
    } finally {
      this.#working = false; this.#backups = null; this.render();
    }
  }
};

/** For the API and macros: open the diagnostic, optionally on a single check. */
export async function openDiagnostic({ check=null }={}) {
  const existing = foundry.applications.instances.get("das-diagnostic");
  if ( existing && (existing.only !== check) ) await existing.close();
  return new (DiagnosticApp())({ check }).render({ force: true });
}
