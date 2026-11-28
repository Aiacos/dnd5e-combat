/**
 * §293: the list "creatures of your choice within 9 m" (Turn Undead), on the client of whoever uses it — the creatures it
 * sees in range, its enemies ticked in advance; and, if it has Sear Undead, a checkbox to use it instead.
 * Returns `{ tokens, upgrade }`, or null (window closed, or nothing ticked).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { pickCandidates, upgradeOf } from "../adapter/pick-targets.mjs";
import { chainedPickOf } from "../core/pick-after.mjs";
import { castOnPicked } from "../runtime/pick-targets.mjs";
import { tokenArt } from "../adapter/token-art.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export async function askPickTargets(activity, { centers=null, rule=null }={}) {
  const { creatures, radius, units, max } = pickCandidates(activity, { seen: t => t.object?.visible !== false, centers, rule });
  const upgrade = upgradeOf(activity);
  const rows = creatures.map(({ token, distance }, i) => `
    <label class="dnd5e-combat-pick-row">
      <input type="checkbox" name="pick" value="${i}" ${creatures[i].checked ? "checked" : ""}>
      <img src="${esc(tokenArt(token))}" alt="">
      <span class="name">${esc(token.name)}</span>
      <span class="distance">${esc(`${Math.round(distance * 10) / 10} ${units}`)}</span>
    </label>`).join("");
  const extra = upgrade ? `
    <label class="dnd5e-combat-pick-upgrade">
      <input type="checkbox" name="upgrade" checked>
      <span>${esc(loc("Choisir.Ajouter", { item: upgrade.item.name }))}</span>
    </label>` : "";
  const limit = Number.isInteger(max) ? `<p class="hint">${esc(loc("Choisir.Max", { max }))}</p>` : "";
  const content = `<p class="hint">${esc(loc("Choisir.Aide", { radius: Math.round(radius * 10) / 10, units }))}</p>${limit}
    <div class="dnd5e-combat-pick-list">${rows || `<p>${esc(loc("Choisir.Personne"))}</p>`}</div>${extra}`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item?.name ?? activity.name, icon: "fa-solid fa-sun" },
    classes: ["dnd5e-combat-pick"],
    position: { width: 380 },
    content,
    buttons: [
      { action: "ok", label: loc("Choisir.Valider"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => {
          const form = button.form;
          // §296: beyond `max`, only the nearest ones ticked.
          const picked = Array.from(form.querySelectorAll('input[name="pick"]:checked')).map(i => creatures[Number(i.value)]?.token).filter(Boolean)
            .slice(0, Number.isInteger(max) ? max : undefined);
          return { tokens: picked, upgrade: form.querySelector('input[name="upgrade"]')?.checked ? upgrade : null };
        } },
      { action: "cancel", label: loc("Choisir.Annuler"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  }).catch(() => null);
  if ( !answer ) return null;
  if ( !answer.tokens.length ) {
    ui.notifications.info(loc("Choisir.Aucune"));
    return null;
  }
  return answer;
}

/**
 * §438: after a utility manifestation (`pickTargets.after`: Wrath of the Sea 3.0.0, on oneself or on another creature), the list
 * of the following activity opens at once, around the caster or the targeted creatures, and the activity goes off at no extra
 * action ("when you manifest the Emanation…", under the same Bonus Action). On the client of whoever used the activity.
 */
export async function offerChainedPick(activity, results) {
  if ( !results || !activity?.item || !activity.actor?.isOwner ) return;
  const rule = contentOf(activity.item).entry?.pickTargets;
  const next = chainedPickOf(rule, activity.id, activity.type);
  const follow = next ? activity.item.system.activities?.get(next.activity) : null;
  if ( !follow ) return;
  let centers = null;
  if ( next.around === "targets" ) {
    const fromMessage = (results.message?.system?.targets ?? []).map(t => t.token ? fromUuidSync(t.token, { strict: false }) : null).filter(Boolean);
    centers = fromMessage.length ? fromMessage : Array.from(game.user.targets).map(t => t.document);
    if ( !centers.length ) return;
  } else {
    const own = activity.getUsageToken?.() ?? activity.actor.getActiveTokens?.()[0]?.document ?? null;
    if ( !own ) return;
    centers = [own];
  }
  const choice = await askPickTargets(follow, { centers, rule });
  if ( !choice ) return;
  await castOnPicked(follow, [{ [MODULE_ID]: { confirmed: true, cost: "free" } }, { configure: false }, {}], { tokens: choice.tokens, upgrade: null });
}
