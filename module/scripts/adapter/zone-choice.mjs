/**
 * §401: "each creature of your choice in the area" ("Radiant Word", Sleep, Slow, Spirit Guardians…) — the question put
 * to the caster when the area is placed: the list of those it can affect, ticked in advance as the engine would do alone
 * (its enemies, at most `zoneMax`). Same circuit as the other questions (adapter/choices.mjs): the connected player who
 * owns the caster, otherwise the active GM; with no answer within the delay, the default choice.
 */

import { MODULE_ID } from "../constants.mjs";
import { ZONE_CHOICE_MODES } from "../core/area.mjs";
import { contentOf } from "./content.mjs";
import { timedWait } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { rollerFor } from "./concentration.mjs";

export const ZONE_CHOICE_QUERY = `${MODULE_ID}.zoneChoice`;
export const ZONE_CHOICE_SETTING = "zoneChoice";

/** Beyond that, the GM answers in the player's place (the window's delay, plus the network margin). */
const ZONE_CHOICE_TIMEOUT = 30000;

export function registerZoneChoiceSetting() {
  game.settings.register(MODULE_ID, ZONE_CHOICE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(ZONE_CHOICE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.${m}`])), default: "mixed"
  });
}

export function zoneChoiceMode() {
  try { const m = game.settings.get(MODULE_ID, ZONE_CHOICE_SETTING); return ZONE_CHOICE_MODES.includes(m) ? m : "mixed"; } catch { return "mixed"; }
}

/**
 * Is this activity's area "at the caster's choice"? The data says so (`target.affects.choice`), or the content, which declares
 * whom it affects when the data is silent (`zoneAffects`, §86) — not an "each enemy" area of the data (`affects.type`).
 */
export function isChoiceZone(activity) {
  if ( !activity?.item ) return false;
  if ( contentOf(activity.item).entry?.zoneAffects ) return true;
  return activity.target?.affects?.choice === true;
}

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Caster side: one checkbox per creature, ticked in advance like the engine. Returns the ticked UUIDs; at the end of the
 * delay, the default choice; closed without confirming, null (the GM is not consulted: the default choice stands).
 * @param {{actor: string, item: string, max: number|null, candidates: Array<{token: string, name: string, img: string,
 * checked: boolean, enemy: boolean}>}} payload
 * @returns {Promise<{tokens: string[]}|null>}
 */
export async function handleZoneChoiceQuery({ actor: actorUuid, item, max=null, candidates=[] }) {
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  const t = (key, data) => game.i18n.format(`DND5ECOMBAT.ZoneChoix.${key}`, data ?? {});
  const rows = candidates.map((c, i) => `
    <label class="dnd5e-combat-pick-row">
      <input type="checkbox" name="pick${i}" value="${i}" data-pick ${c.checked ? "checked" : ""}>
      <img src="${esc(c.img)}" alt="">
      <span class="name">${esc(c.name)}</span>
      <span class="distance">${esc(t(c.enemy ? "Ennemi" : "Allie"))}</span>
    </label>`).join("");
  const limit = Number.isInteger(max) ? `<p class="hint">${esc(t("Max", { max }))}</p>` : "";
  const fallback = { tokens: candidates.filter(c => c.checked).map(c => c.token) };
  const answer = await timedWait({
    window: { title: t("Titre", { item, name: actor?.name ?? "" }), icon: "fa-solid fa-bullseye" },
    classes: ["dnd5e-combat-pick"],
    position: { width: 380 },
    content: `<p class="hint">${esc(t("Aide"))}</p>${limit}<div class="dnd5e-combat-pick-list">${rows}</div>`,
    buttons: [{ action: "ok", label: t("Valider"), icon: "fa-solid fa-check", default: true,
      callback: (event, button) => {
        const picked = Array.from(button.form.querySelectorAll('input[data-pick]:checked'))
          .map(i => candidates[Number(i.value)]?.token).filter(Boolean);
        return { tokens: Number.isInteger(max) ? picked.slice(0, max) : picked };
      } }]
  }, { fallback, awaiting: { actor, kind: "choice" } });
  return (answer && Array.isArray(answer.tokens)) ? answer : null;
}

/**
 * On the active GM: asks the caster (its player, otherwise the GM themselves). Returns the retained UUIDs, or null
 * (the default choice stands).
 * @param {Actor} actor
 * @param {object} payload  See handleZoneChoiceQuery.
 */
export async function askZoneChoice(actor, payload) {
  payload = { ...payload, actor: actor?.uuid ?? null };
  const userId = actor ? rollerFor(actor) : null;
  try {
    if ( userId && (userId !== game.user.id) ) return await queryPlayer(game.users.get(userId), ZONE_CHOICE_QUERY, payload,
      { timeout: ZONE_CHOICE_TIMEOUT, actor, label: waitLabel("Choix", { item: payload.item ?? "" }) });
    return await handleZoneChoiceQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | zone choice for ${actor?.name}: no answer`, err);
    return null;
  }
}
