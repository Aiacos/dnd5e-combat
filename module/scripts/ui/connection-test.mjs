/**
 * §388: a player's connection test — the "Test connection (DAS)" entry of the right-click menu of the player list (GM
 * only, connected player, not oneself; removed with the bug report entry, world setting `debugMenu`), and its window:
 * the diagnosis, from most to least serious, the expandable measurements, "Copy" (Markdown, for Discord or an issue), "Redo".
 */

import { MODULE_ID } from "../constants.mjs";
import { connectionMarkdown, worstLevel } from "../core/connection.mjs";
import { CONSENT_MS, connectionTestEnabled, setConsentPrompt, testConnection } from "../runtime/connection.mjs";
import { roles } from "../runtime/debug.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { DEBUG_MENU_SETTING } from "./debug-report.mjs";

const ICON = {
  ok: "fa-solid fa-circle-check", info: "fa-solid fa-circle-info", warn: "fa-solid fa-triangle-exclamation", bad: "fa-solid fa-circle-xmark"
};
const t = (key, data) => loc(`Connexion.${key}`, data);

let TestClass = null;
const TestApp = () => TestClass ??= class ConnectionTest extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-connection-test"],
    window: { icon: "fa-solid fa-tower-broadcast", resizable: true },
    position: { width: 520, height: "auto" },
    actions: { copy: ConnectionTest.#copy, retry: ConnectionTest.#retry }
  };

  userId = null;
  result = null;
  step = null;
  running = false;

  constructor(options={}) {
    super({ ...options, id: `das-connection-test-${options.userId}` });
    this.userId = options.userId;
  }

  get title() {
    return t("Titre");
  }

  /** The player's role on the GM's screen: their name (the window does not leave the table; the copied text says "Player 1"). */
  get who() {
    return game.users.get(this.userId)?.name ?? "?";
  }

  async run() {
    if ( this.running ) return;
    this.running = true;
    this.result = null;
    this.step = t("EnCours");
    this.render({ force: true });
    try {
      this.result = await testConnection(this.userId, {
        progress: (kind, i, n) => {
          this.step = (kind === "consent") ? t("Accord") : (kind === "ping") ? t("Ping", { i, n }) : t("Sonde");
          const el = this.element?.querySelector(".das-connection__step");
          if ( el ) el.textContent = this.step;
        }
      });
    } catch(err) {
      this.result = { error: err?.message ?? String(err) };
    }
    this.running = false;
    this.render();
  }

  async _renderHTML() {
    const head = `<p class="das-connection__who"><i class="fa-solid fa-user"></i> ${esc(this.who)}</p>`;
    if ( this.running || !this.result ) {
      return `${head}<p class="das-connection__step"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(this.step ?? "")}</p>
        <p class="das-muted">${esc(t("Attente"))}</p>`;
    }
    if ( this.result.error ) {
      return `${head}<p class="das-connection__finding bad"><i class="${ICON.bad}"></i> ${esc(t("Erreur", { error: this.result.error }))}</p>
        <footer class="das-connection__actions"><button type="button" class="das-button" data-action="retry"><i class="fa-solid fa-rotate"></i> ${esc(t("Refaire"))}</button></footer>`;
    }
    const { findings, probe, pings } = this.result;
    const worst = worstLevel(findings);
    const list = findings.map(f => `<li class="das-connection__finding ${f.level}"><i class="${ICON[f.level]}"></i>
      <span>${esc(t(`Constat.${f.id}`, f.data))}</span>${this.#advice(f)}</li>`).join("");
    const rows = probe ? [
      ["Foundry", probe.foundry], [t("Champ.systeme"), probe.system], [t("Champ.langue"), probe.language],
      [t("Champ.navigateur"), probe.client], [t("Champ.os"), probe.os], [t("Champ.gpu"), probe.gpu],
      [t("Champ.texture"), probe.maxTextureSize], [t("Champ.performance"), probe.performanceMode], [t("Champ.fps"), probe.fps],
      [t("Champ.ecran"), probe.screen], [t("Champ.fenetre"), probe.viewport], [t("Champ.memoire"), probe.memory], [t("Champ.coeurs"), probe.cores],
      [t("Champ.ping"), pings?.median !== null ? `${pings.min} / ${pings.median} / ${pings.worst} ms` : "—"],
      [t("Champ.horloge"), Number.isFinite(pings?.offset) ? `${pings.offset} ms` : "—"],
      [t("Champ.modules"), (probe.modules ?? []).map(m => `${m.id} ${m.version ?? "?"}`).join(", ")]
    ].filter(([, v]) => (v !== null) && (v !== undefined) && (v !== "")) : [];
    return `${head}
      <p class="das-connection__summary ${worst}"><i class="${ICON[worst]}"></i> ${esc(t(`Resume.${worst}`))}</p>
      <ul class="das-connection__findings">${list}</ul>
      ${rows.length ? `<details class="das-connection__details"><summary>${esc(t("Details"))}</summary>
        <table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join("")}</table></details>` : ""}
      <footer class="das-connection__actions">
        <button type="button" class="das-button" data-action="copy"><i class="fa-solid fa-copy"></i> ${esc(t("Copier"))}</button>
        <button type="button" class="das-button ghost" data-action="retry"><i class="fa-solid fa-rotate"></i> ${esc(t("Refaire"))}</button>
      </footer>`;
  }

  /** A finding's advice, if it has one (key `Connexion.Conseil.<id>`). */
  #advice(finding) {
    const key = `DND5ECOMBAT.Connexion.Conseil.${finding.id}`;
    if ( (finding.level === "ok") || !game.i18n.has(key) ) return "";
    return `<small class="das-muted">${esc(game.i18n.localize(key))}</small>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #copy() {
    if ( !this.result?.findings ) return;
    const role = roles({ gm: "GM", player: "Player" }).get(this.userId) ?? this.result.role;
    await game.clipboard.copyPlainText(connectionMarkdown({ ...this.result, role }, (key, data) => t(key, data)));
    ui.notifications.info(t("Copie"));
  }

  static #retry() {
    this.run();
  }
};

/** Opens the test window for a player and starts it (or brings the one already open to the front). */
export function openConnectionTest(userId) {
  const open = foundry.applications.instances.get(`das-connection-test-${userId}`);
  if ( open ) {
    open.bringToFront?.();
    if ( !open.running ) open.run();
    return open;
  }
  const app = new (TestApp())({ userId });
  app.run();
  return app;
}

function menuShown() {
  try { return game.settings.get(MODULE_ID, DEBUG_MENU_SETTING); } catch { return true; }
}

/** The player list menu entry. */
function onUserContext(app, options) {
  options.push({
    label: "DND5ECOMBAT.Connexion.Menu",
    icon: "fa-solid fa-tower-broadcast",
    visible: li => {
      const user = game.users.get(li?.dataset?.userId);
      return !!user && game.user.isGM && user.active && !user.isSelf && menuShown() && connectionTestEnabled();
    },
    onClick: (event, li) => openConnectionTest(li.dataset.userId)
  });
}

/**
 * On the player's side: the consent window. "Allow" or "Refuse"; closed or unanswered within `CONSENT_MS`, it is a no.
 * The name of the requesting GM is displayed (the request comes from their table).
 */
async function consentPrompt({ gm=null }={}) {
  let dialog = null;
  let timer = null;
  const content = `<p>${esc(t("Consentement.Texte", { gm: gm ?? t("Consentement.LeMJ") }))}</p>
    <ul class="das-connection__consent">${["Connexion", "Versions", "Machine", "Jeu"].map(k => `<li>${esc(t(`Consentement.${k}`))}</li>`).join("")}</ul>
    <p class="das-muted">${esc(t("Consentement.Rien"))}</p>`;
  const answer = await Promise.race([
    foundry.applications.api.DialogV2.wait({
      window: { title: t("Consentement.Titre"), icon: "fa-solid fa-tower-broadcast" },
      classes: ["das-connection-consent"],
      content,
      buttons: [
        { action: "allowed", label: t("Consentement.Autoriser"), icon: "fa-solid fa-check", default: true },
        { action: "refused", label: t("Consentement.Refuser"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false,
      render: (event, d) => { dialog = d ?? event?.target ?? null; }
    }).then(a => a ?? "refused"),
    new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), CONSENT_MS); })
  ]);
  clearTimeout(timer);
  if ( answer === "timeout" ) dialog?.close?.();
  return answer;
}

export function registerConnectionTest() {
  setConsentPrompt(consentPrompt);
  route("getUserContextOptions", onUserContext, { always: true, label: "connection test: player list menu entry missing" });
}
