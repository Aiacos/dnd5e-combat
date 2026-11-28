import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { askChoice } from "./choices.mjs";

/**
 * §281: what a grappler's items add to grappling — `grappleSize` (`bonus` sizes larger for Grapple and Shove,
 * `dragFree`: dragging a victim up to this many sizes larger at no extra cost), `inescapable` (Disadvantage against its hold),
 * `grappleCover` (Cover against others while it grapples).
 */
export function grappleRulesOf(actor) {
  const out = { bonus: 0, dragFree: null, inescapable: false, cover: null };
  for ( const item of actor?.items ?? [] ) {
    const entry = contentOf(item).entry;
    if ( !entry ) continue;
    if ( entry.grappleSize ) {
      out.bonus = Math.max(out.bonus, entry.grappleSize.bonus ?? 0);
      if ( Number.isInteger(entry.grappleSize.dragFree) ) out.dragFree = Math.max(out.dragFree ?? -Infinity, entry.grappleSize.dragFree);
    }
    if ( entry.inescapable === true ) out.inescapable = true;
    else if ( entry.inescapable && (out.inescapable !== true) ) out.inescapable = { item, activity: entry.inescapable.activity };
    if ( entry.grappleCover ) out.cover = entry.grappleCover;
  }
  return out;
}

/** §374: the item an "itemUses" consumption targets (id, or identifier dnd5e did not reduce to an id: DDB Importer), else the item. */
function usesItemOf(activity, target) {
  if ( !target ) return activity.item;
  return activity.actor?.items.get(target) ?? activity.actor?.items.find(i => identifierOf(i).id === target) ?? null;
}

/** §374: what the activity costs — `[{ item, n }]` of item uses, or null if one is missing. */
function costOf(activity) {
  const out = [];
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    const item = usesItemOf(activity, t.target);
    const n = Number(t.value) || 1;
    const uses = item?.system?.uses ?? {};
    const left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
    if ( !item || (left < n) ) return null;
    out.push({ item, n });
  }
  return out;
}

/**
 * §281, §374: the Disadvantage of Inescapable against this save or escape check — automatic (`true`), or, if paid, if
 * the grappler (its player, otherwise the GM) wants it and can pay; the expense made. With no answer: no.
 * @param {Actor5e|null} grappler
 * @param {string} name  the creature making the roll
 * @returns {Promise<boolean>}
 */
export async function inescapableFor(grappler, name) {
  const rule = grappleRulesOf(grappler).inescapable;
  if ( rule === true ) return true;
  const activity = rule ? rule.item.system.activities?.get(rule.activity) : null;
  const cost = activity ? costOf(activity) : null;
  if ( !cost ) return false;
  const label = activity.name || rule.item.name;
  const answer = await askChoice(grappler, { actor: grappler.uuid, item: label,
    prompt: game.i18n.format("DND5ECOMBAT.Inexorable.Question", { name, item: label }),
    options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.Inexorable.Non") }, { id: "yes", label: game.i18n.localize("DND5ECOMBAT.Inexorable.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  for ( const { item, n } of cost ) {
    await item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + n })
      .catch(err => console.warn(`${MODULE_ID} | ${item.name}: use not spent`, err));
  }
  return true;
}
