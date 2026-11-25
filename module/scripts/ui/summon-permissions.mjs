/**
 * §542 (issue #43): at world load, the active GM is told when the players cannot summon (core/summon-permissions.mjs): a small
 * window lists what is missing, with a button for each fix — Foundry's permission configuration (`PermissionConfig`, Foundry 14
 * client/applications/apps/permission-config.mjs, exported at apps/_module.mjs:11) and the dnd5e setting "Allow Summoning", turned on
 * only when the GM clicks. "Don't show again" keeps the signature of what was reported (hidden world setting `summonPermissionsSeen`):
 * the window comes back only when a new kind of gap appears. "Later" shows it again at the next load.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { esc, loc, log } from "../runtime/shared.mjs";
import { summonFacts } from "../adapter/summon-permissions.mjs";
import { gapSignature, hasNewGap, summonGaps } from "../core/summon-permissions.mjs";

export const SUMMON_SEEN_SETTING = "summonPermissionsSeen";
export const SUMMON_WINDOW_ID = "das-summon-permissions";

/** The gaps of this world right now. */
export const currentGaps = () => summonGaps(summonFacts());

function contentOf(gaps) {
  const lines = gaps.map(g => `<li><strong>${esc(loc(`Invocation.Droits.Alerte.${g.key}.Nom`))}</strong> — `
    + `${esc(loc(`Invocation.Droits.Alerte.${g.key}.Texte`, { players: (g.players ?? []).join(", ") }))}</li>`).join("");
  return `<p>${esc(loc("Invocation.Droits.Alerte.Intro"))}</p><ul class="das-summon-gaps">${lines}</ul>`
    + `<p class="hint">${esc(loc("Invocation.Droits.Alerte.Aide"))}</p>`;
}

/**
 * Opens the window for these gaps (the current ones by default). Returns the window, or null when there is nothing to report.
 * @param {{ gaps?: object[] }} [options]
 */
export async function openSummonAlert({ gaps=currentGaps() }={}) {
  if ( !gaps.length || !game.user.isGM ) return null;
  foundry.applications.instances.get(SUMMON_WINDOW_ID)?.close();
  const keys = new Set(gaps.map(g => g.key));
  const buttons = [];
  if ( keys.has("tokenCreate") || keys.has("actorCreate") ) buttons.push({ action: "permissions", icon: "fa-solid fa-shield-keyhole",
    label: "DND5ECOMBAT.Invocation.Droits.Alerte.Permissions", default: true,
    callback: () => new foundry.applications.apps.PermissionConfig().render({ force: true }) });
  if ( keys.has("allowSummoning") ) buttons.push({ action: "allow", icon: "fa-solid fa-paw",
    label: "DND5ECOMBAT.Invocation.Droits.Alerte.Autoriser", default: !buttons.length,
    callback: async () => {
      await game.settings.set("dnd5e", "allowSummoning", true);
      ui.notifications.info(loc("Invocation.Droits.Alerte.Autorise"));
    } });
  buttons.push({ action: "never", icon: "fa-solid fa-bell-slash", label: "DND5ECOMBAT.Invocation.Droits.Alerte.NePlusAfficher",
    callback: () => game.settings.set(MODULE_ID, SUMMON_SEEN_SETTING, gapSignature(gaps)) });
  buttons.push({ action: "later", icon: "fa-solid fa-clock", label: "DND5ECOMBAT.Invocation.Droits.Alerte.PlusTard" });
  const dialog = new foundry.applications.api.DialogV2({
    id: SUMMON_WINDOW_ID,
    classes: ["das-summon-permissions"],
    window: { title: "DND5ECOMBAT.Invocation.Droits.Alerte.Titre", icon: "fa-solid fa-triangle-exclamation" },
    position: { width: 520 },
    content: contentOf(gaps),
    buttons
  });
  await dialog.render({ force: true });
  return dialog;
}

/**
 * The load-time decision, on the active GM: the window when there is a gap the GM has not dismissed. Also called by the bench
 * (`api.mcp.summonAlert`). Returns `{ gaps, opened }`.
 */
export async function checkSummonPermissions() {
  const gaps = currentGaps();
  if ( !game.users.activeGM?.isSelf ) return { gaps, opened: false };
  if ( !gaps.length || !hasNewGap(gaps, game.settings.get(MODULE_ID, SUMMON_SEEN_SETTING)) ) return { gaps, opened: false };
  log(`players cannot summon: ${gaps.map(g => g.key).join(", ")}`);
  return { gaps, opened: !!(await openSummonAlert({ gaps })) };
}

export function registerSummonPermissionsUi() {
  game.settings.register(MODULE_ID, SUMMON_SEEN_SETTING, { scope: "world", config: false, type: String, default: "" });
  route("ready", () => checkSummonPermissions().catch(err => console.error(`${MODULE_ID} | summon permissions`, err)), { label: "summon permissions: GM alert" });
}
