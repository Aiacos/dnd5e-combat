/**
 * Projectiles (SPEC §16.27, key `projectiles`): how many a casting creates, from the content's formula evaluated on the
 * scaled activity's data (slot level: `@item.level`; character level: `@details.level`),
 * and the distribution question put to the author.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { rollerFor } from "./concentration.mjs";
import { combatWindowSeconds, expireLater, inLine } from "./dialogs.mjs";
import { whileAwaiting } from "./awaiting.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";

export const ALLOCATION_QUERY = `${MODULE_ID}.allocation`;
const ALLOCATION_TIMEOUT = 45000;

/** An item's projectile rule, or null. */
export function projectilesOf(item) {
  return item ? (contentOf(item).entry?.projectiles ?? null) : null;
}

/** A content formula evaluated on the scaled activity's data; `fallback` if it fails. */
export function evalRuleFormula(formula, activity, fallback=0) {
  try { return Math.floor(Roll.safeEval(Roll.replaceFormulaData(formula, activity?.getRollData?.() ?? {}, { missing: 0 }))); }
  catch { return fallback; }
}

/** An item's bounce rule (Chromatic Orb), or null. */
export function leapOf(item) {
  return item ? (contentOf(item).entry?.leap ?? null) : null;
}

/** A double among the dice of the first part of a damage message (the orb's d8)? */
export function rolledDouble(damageMessage) {
  const faces = (damageMessage?.rolls?.[0]?.dice?.[0]?.results ?? []).filter(r => r.active !== false).map(r => r.result);
  return new Set(faces).size < faces.length;
}

/**
 * The number of projectiles of this casting (at least 1). `level`: the chosen slot level, when the activity is not
 * scaled yet (multiple targeting, before the casting); otherwise the item's.
 */
export function projectileCount(activity, { level=null }={}) {
  const rule = projectilesOf(activity?.item);
  if ( !rule ) return 1;
  try {
    const data = activity.getRollData?.() ?? {};
    if ( level !== null ) data.item = { ...(data.item ?? {}), level };
    const formula = Roll.replaceFormulaData(rule.count, data, { missing: 0 });
    return Math.max(1, Math.floor(Roll.safeEval(formula)));
  } catch { return 1; }
}

/**
 * The number of creatures an activity targets (§16.33: Bless "2 + @item.level", Prayer of Healing "5", Hold Person
 * "@item.level - 1"), at slot level `level` if given. dnd5e evaluates the formula at
 * preparation, at the item's base level (data/shared/target-field.mjs:131-136): for an upcast spell, the original formula is
 * read again (the activity's if it replaces the item's target, otherwise the item's). At least 1.
 */
export function targetCount(activity, { level=null }={}) {
  const prepared = Number(activity?.target?.affects?.count) || 1;
  const formula = activity?.target?.override ? activity?._source?.target?.affects?.count
    : activity?.item?._source?.system?.target?.affects?.count;
  if ( (level === null) || !formula || !/@/.test(String(formula)) ) return Math.max(1, prepared);
  try {
    const data = activity.getRollData?.() ?? {};
    data.item = { ...(data.item ?? {}), level };
    return Math.max(1, Math.floor(Roll.safeEval(Roll.replaceFormulaData(String(formula), data, { missing: 0 }))));
  } catch { return Math.max(1, prepared); }
}

/**
 * On the author's side: a window, one field per target, the sum to reach. With no answer within the timeout (twice the combat
 * windows' timeout: there are numbers to enter): one each, the rest to the first (the core sets it right).
 * @param {{item: string, count: number, targets: Array<{token: string, name: string}>}} payload
 * @returns {Promise<{counts: Object<string, number>}|null>}
 */
export async function handleAllocationQuery({ item, count, targets, actor: actorUuid=null, defaults=null, text=null, title=null }) {
  // §381: the table sees that the author is awaited (the question names them since this version; before, no hourglass).
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  return inLine(() => whileAwaiting(actor, "choice", () => allocate({ item, count, targets, defaults, text, title })));
}

/** §401: `defaults` (token → number) prefills the window (an HP pool); `text` replaces the projectiles sentence. */
async function allocate({ item, count, targets, defaults=null, text=null, title=null }) {
  const start = (t, i) => (defaults && (t.token in defaults)) ? defaults[t.token] : (i === 0 ? count - targets.length + 1 : 1);
  const rows = targets.map((t, i) => `<div class="form-group"><label>${foundry.utils.escapeHTML(t.name)}</label>
    <input type="number" name="t${i}" min="0" max="${count}" step="1" value="${start(t, i)}"></div>`).join("");
  let disarm = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: title ?? game.i18n.format("DND5ECOMBAT.Repartition.Titre", { item }) },
    content: `<p>${foundry.utils.escapeHTML(text ?? game.i18n.format("DND5ECOMBAT.Repartition.Texte", { count }))}</p>${rows}`,
    rejectClose: false,
    buttons: [{ action: "ok", label: game.i18n.localize("DND5ECOMBAT.Repartition.Valider"), default: true,
      callback: (event, button) => Object.fromEntries(targets.map((t, i) => [t.token, Number(button.form.elements[`t${i}`]?.value) || 0])) }],
    // §290: with no timeout, the GM closes it by forcing, as at the end of the timeout.
    render: (event, dialog) => { disarm ??= expireLater(() => dialog.close(), combatWindowSeconds() * 2000); },
    close: () => { disarm?.(); return null; }
  });
  disarm?.();
  return (result && typeof result === "object") ? { counts: result } : null;
}

/** On the active GM: asks the author (their player, otherwise the GM themselves). Never throws. */
export async function askAllocation(actor, payload) {
  const userId = rollerFor(actor);
  try {
    payload = { ...payload, actor: actor?.uuid ?? null };
    if ( userId && (userId !== game.user.id) ) return await queryPlayer(game.users.get(userId), ALLOCATION_QUERY, payload, { timeout: ALLOCATION_TIMEOUT, actor,
      label: waitLabel("Repartition", { item: payload.item ?? "" }) });
    return await handleAllocationQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | projectile distribution for ${actor?.name}: no answer`, err);
    return null;
  }
}
