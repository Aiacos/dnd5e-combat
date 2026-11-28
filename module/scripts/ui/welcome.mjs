/**
 * The suite's welcome screen (SPEC §177): opened for the active GM on the engine's first launch in a world (setting
 * `welcomeSeen`), and afterwards by the "Welcome and diagnostic" button of the module settings. This setting keeps the version
 * seen: when it changes, the update message opens instead (§439, ui/release-notes.mjs). Logo, welcome word, the three
 * automation levels (§117) as large cards, the world diagnostic, the links. Look: that of the website (anthracite,
 * fuchsia, logo gradient).
 *
 * Changing level reloads the world (setting `requiresReload`, runtime/levels.mjs): the GM confirms it, all clients
 * reload (`game.socket.emit("reload")`, then this client).
 */
import { MODULE_ID } from "../constants.mjs";
import { LEVELS } from "../core/levels.mjs";
import { LEVEL_SETTING } from "../runtime/levels.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { LOGO } from "../runtime/diagnostic/backup.mjs";
import { openDiagnostic } from "./diagnostic.mjs";
import { ddbItemsAtRisk } from "../runtime/diagnostic/checks.mjs";
import { SEEN_SETTING, announceUpdate, markSeen, openReleaseNotes } from "./release-notes.mjs";

const DDB_SETTING = "ddbNotice";
const ROTATION_SETTING = "autoRotateNotice";
const LINKS = Object.freeze({
  site: "https://darshyne.github.io", discord: "https://discord.gg/PDSq8dYdTP", github: "https://github.com/Darshyne/dnd5e-combat"
});
const ICONS = Object.freeze({ essentials: "fa-solid fa-person-walking", assisted: "fa-solid fa-dice-d20", full: "fa-solid fa-wand-sparkles" });

/** The window class, created on first use (the module also loads outside Foundry: tests/load.test.mjs). */
let WelcomeClass = null;
export const WelcomeApp = () => WelcomeClass ??= class WelcomeApp extends foundry.applications.api.ApplicationV2 {
  /** B6: a single instance — the settings menu creates the window with `new`: it receives the one that is already open. */
  constructor(options={}) {
    const existing = foundry.applications.instances.get("das-welcome");
    if ( existing instanceof WelcomeApp ) return existing;
    super(options);
  }

  static DEFAULT_OPTIONS = {
    id: "das-welcome",
    classes: ["das-screen", "das-welcome"],
    window: { title: "DND5ECOMBAT.Accueil.Titre", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 860, height: "auto" }
  };

  /** The level in force, or null if the engine is idle (setting not declared). */
  #level() {
    try { return game.settings.get(MODULE_ID, LEVEL_SETTING); }
    catch { return null; }
  }

  async _renderHTML() {
    const api = game.modules.get(MODULE_ID).api;
    const level = this.#level();
    const standby = api?.reason ? loc(`Accueil.Veille.${api.reason}`) : null;
    const cards = LEVELS.map(l => {
      const current = (l === level);
      return `<article class="das-card${current ? " current" : ""}">
        <i class="das-card__icon ${ICONS[l]}"></i>
        <h3>${esc(loc(`Accueil.Niveau.${l}.Nom`))}</h3>
        <p>${esc(loc(`Accueil.Niveau.${l}.Texte`))}</p>
        <button type="button" class="das-button${current ? " ghost" : ""}" data-level="${l}" ${(current || standby) ? "disabled" : ""}>
          ${esc(loc(current ? "Accueil.NiveauActuel" : "Accueil.Choisir"))}</button>
      </article>`;
    }).join("");
    const version = game.modules.get(MODULE_ID)?.version ?? "";
    const root = document.createElement("div");
    root.className = "das-welcome__body";
    root.innerHTML = `
      <header class="das-hero">
        <img src="${LOGO}" alt="DAS" class="das-hero__logo">
        <div>
          <h1>${esc(loc("Accueil.Nom"))}</h1>
          <p class="das-muted">${esc(loc("Accueil.Version", { version }))}
            <button type="button" class="das-link" data-action="news"><i class="fa-solid fa-bullhorn"></i> ${esc(loc("Accueil.Nouveautes"))}</button></p>
        </div>
      </header>
      <p class="das-lead">${esc(loc("Accueil.Bienvenue"))}</p>
      <h2>${esc(loc("Accueil.NiveauxTitre"))}</h2>
      ${standby ? `<p class="das-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(standby)}</p>` : ""}
      <div class="das-cards">${cards}</div>
      <p class="das-muted">${esc(loc("Accueil.NiveauxAide"))}</p>
      <section class="das-diag">
        <div>
          <h2><i class="fa-solid fa-stethoscope"></i> ${esc(loc("Diagnostic.Titre"))}</h2>
          <p>${esc(loc("Accueil.DiagnosticTexte"))}</p>
        </div>
        <button type="button" class="das-button" data-action="diagnostic"><i class="fa-solid fa-magnifying-glass"></i> ${esc(loc("Accueil.DiagnosticBouton"))}</button>
      </section>
      <footer class="das-links">
        <a href="${LINKS.site}" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i> ${esc(loc("Accueil.Site"))}</a>
        <a href="${LINKS.discord}" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> Discord</a>
        <a href="${LINKS.github}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> GitHub</a>
        <button type="button" class="das-button ghost" data-action="close">${esc(loc("Accueil.Fermer"))}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    const el = this.element;
    for ( const button of el.querySelectorAll("[data-level]") ) {
      button.addEventListener("click", () => this.#choose(button.dataset.level));
    }
    el.querySelector("[data-action=diagnostic]")?.addEventListener("click", () => openDiagnostic());
    el.querySelector("[data-action=news]")?.addEventListener("click", () => openReleaseNotes());
    el.querySelector("[data-action=close]")?.addEventListener("click", () => this.close());
  }

  /** Changer de niveau : le MJ confirme, puis tout le monde recharge. */
  async #choose(level) {
    if ( !LEVELS.includes(level) ) return;
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc(`Accueil.Niveau.${level}.Nom`) },
      content: `<p>${esc(loc("Accueil.ConfirmerNiveau", { level: loc(`Accueil.Niveau.${level}.Nom`) }))}</p>`,
      rejectClose: false
    });
    if ( !yes ) return;
    await markSeen();
    await game.settings.set(MODULE_ID, LEVEL_SETTING, level);
    game.socket.emit("reload");
    foundry.utils.debouncedReload();
  }

  async _onClose(options) {
    await markSeen();
    return super._onClose?.(options);
  }
};

/** Pour l'API : ouvrir l'accueil. */
export const openWelcome = () => new (WelcomeApp())().render({ force: true });

/**
 * Declared even when idle (Midi-QOL active: the diagnostic is precisely for cleaning up its traces). The `welcomeSeen`
 * setting keeps the engine version seen by the GM; empty = never seen: the welcome opens at the first `ready` for the active
 * GM; a version other than the module's: the update message (§439).
 */
export function registerWelcome({ menu=false }={}) {
  game.settings.register(MODULE_ID, SEEN_SETTING, { scope: "world", config: false, type: String, default: "" });
  // Engine active: the welcome opens from the settings window (ui/settings.mjs). When idle, the window does not exist: the button
  // stays in Foundry's list, so the diagnostic cleans up Midi-QOL's traces.
  if ( menu && game.settings.registerMenu ) game.settings.registerMenu(MODULE_ID, "welcome", {
    name: "DND5ECOMBAT.Accueil.Menu.Nom", label: "DND5ECOMBAT.Accueil.Menu.Bouton", hint: "DND5ECOMBAT.Accueil.Menu.Aide",
    icon: "fa-solid fa-dragon", type: WelcomeApp(), restricted: true
  });
  game.settings.register(MODULE_ID, DDB_SETTING, { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, ROTATION_SETTING, { scope: "world", config: false, type: Boolean, default: false });
  route("ready", () => {
    if ( !game.users.activeGM?.isSelf ) return;
    // A new world never had the old orientation setting: nothing to tell it (§246).
    if ( !game.settings.get(MODULE_ID, SEEN_SETTING) ) return game.settings.set(MODULE_ID, ROTATION_SETTING, true).then(openWelcome);
    announceUpdate().catch(err => console.error(`${MODULE_ID} | release notes`, err));
    noticeDdb().catch(err => console.error(`${MODULE_ID} | DDB notice`, err));
    noticeRotation().catch(err => console.error(`${MODULE_ID} | auto-rotation notice`, err));
  }, { label: "welcome screen" });
}

/**
 * §245: a single notification to the active GM when items imported from D&D Beyond risk not being automated (the list is
 * in the diagnostic, "ddb" check). The reported count is kept: nothing more until it increases (a new import).
 */
async function noticeDdb() {
  const count = (await ddbItemsAtRisk()).length;
  const told = game.settings.get(MODULE_ID, DDB_SETTING);
  if ( count !== told ) await game.settings.set(MODULE_ID, DDB_SETTING, count);
  if ( count > told ) ui.notifications.warn(loc("Diagnostic.DdbAvis", { count }));
}

/**
 * §246 (issue #20): the engine setting "Orient tokens in the direction of movement" (`faceMovement`, on by default) was
 * removed in favour of the core's "Token Auto-Rotation" (`core.tokenAutoRotate`). Once only, for the active GM: if
 * the old setting had not been turned off (its value kept by the world, read as is — it is no longer declared) and the core's
 * is turned off, the GM chooses whether to turn on the core's. Otherwise nothing: the tokens rotated and still rotate.
 */
async function noticeRotation() {
  if ( game.settings.get(MODULE_ID, ROTATION_SETTING) ) return;
  await game.settings.set(MODULE_ID, ROTATION_SETTING, true);
  const stored = game.settings.storage.get("world")?.getSetting(`${MODULE_ID}.faceMovement`)?._source?.value;
  if ( (stored === "false") || (game.settings.get("core", "tokenAutoRotate") === true) ) return;
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Accueil.Rotation.Titre") },
    content: `<p>${esc(loc("Accueil.Rotation.Texte"))}</p>`,
    rejectClose: false
  });
  if ( yes ) await game.settings.set("core", "tokenAutoRotate", true);
}
