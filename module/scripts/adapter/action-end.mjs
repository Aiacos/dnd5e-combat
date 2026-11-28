/**
 * An action ends an effect (SPEC §43.2): the effects carried by an actor that the content of their origin item
 * declares (`actionEnds`) — by the bearer itself (Otto's Irresistible Dance: replay the save; Gaseous Form: end
 * it) or by another creature in contact (shaking a sleeper). The check of a `roll: "check"` is the one that
 * the item writes in its text, as for a restraint (§16.54, adapter/escape.mjs).
 */

import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";
import { escapeCheckOf, dcOf } from "./escape.mjs";

/** §288: the check set by a "check" activity of the item (`{ ability, skill, dc }`), or null. */
export function activityCheckOf(item) {
  const activity = item?.system?.activities?.find?.(a => (a.type === "check") && a.check);
  if ( !activity ) return null;
  const skills = Object.keys(CONFIG.DND5E?.skills ?? {});
  const skill = Array.from(activity.check.associated ?? []).find(s => skills.includes(s)) ?? null;
  const ability = activity.check.ability || null;
  const dc = Number(activity.check.dc?.value ?? activity.check.dc?.formula);
  if ( !Number.isFinite(dc) || (!skill && !ability) ) return null;
  return { ability: ability || null, skill, dc };
}

/**
 * The effects of an actor that an action by `by` ends.
 * @param {Actor5e} actor                    The bearer.
 * @param {"bearer"|"other"} by              Who would take the action.
 * @returns {Array<{effect: ActiveEffect, item: Item5e, rule: object,
 *            check: {ability: string|null, skill: string|null, dc: number}|null}>}
 */
export function actionEndingsOf(actor, by) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // The caster's Concentration effect comes from the same item: it does not carry the target's rule (§16, B4).
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    const rules = item ? contentOf(item).entry?.actionEnds : null;
    if ( !rules ) continue;
    // §158: `status:<id>` — a condition set by a `status` step of the item (Web: Restrained).
    const key = Object.keys(rules).find(id => id.startsWith("status:") ? effect.statuses?.has?.(id.slice(7)) : comesFromItemEffect(effect, id));
    const rule = key ? rules[key] : null;
    if ( !rule || (rule.by !== by) ) continue;
    let check = null;
    if ( rule.roll === "check" ) {
      const written = escapeCheckOf(item);
      const dc = written ? dcOf(written, item) : null;
      // §288: failing a check readable in the text, the one from the item's "check" activity
      // (Maze: Intelligence (Investigation) DC 20).
      check = (dc !== null) ? { ability: written.ability, skill: written.skill, dc } : activityCheckOf(item);
      if ( !check ) continue;   // no readable check: nothing to offer
    }
    out.push({ effect, item, rule, check });
  }
  return out;
}
