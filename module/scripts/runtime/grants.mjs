/**
 * C12-d: activities granted to another creature (`grants`, core/content.mjs). Dragon's Breath: "you touch a willing creature
 * and grant it the ability to exhale […]; until the spell ends, the creature can take a Magic action to exhale" — it is the
 * creature that breathes, with its own action, at the caster's spell save DC and at the casting level.
 *
 * On the active GM, on the use message of activity `from`: each target receives a copy of the item reduced to the granted activity
 * ("at will" method, DC set to the caster's, dice of the cast level), marked `flags.dnd5e-combat.granted`. The copy leaves when the
 * caster's Concentration on this spell drops (or, without Concentration, when the caster removes it). Nothing is written on the
 * original item.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { concentrationOn } from "../adapter/summons.mjs";

/** The copy of the item granted to the target: the single granted activity, at the caster's DC and level. */
function grantedData(item, rule, { dc, scaling }) {
  const data = item.toObject();
  delete data._id;
  const activity = foundry.utils.deepClone(data.system.activities?.[rule.activity]);
  if ( !activity ) return null;
  if ( activity.save ) activity.save.dc = { calculation: "", formula: String(dc) };
  // The dice of the cast level: "+1d6 per slot level above 2nd" — the scaling of the part, hardcoded.
  for ( const part of activity.damage?.parts ?? [] ) {
    const step = Number(part.scaling?.number) || 0;
    if ( scaling && step && Number.isFinite(part.number) ) part.number += step * scaling;
    part.scaling = { mode: "", number: null, formula: "" };
  }
  data.system.activities = { [rule.activity]: activity };
  data.system.method = "atwill";
  data.system.properties = (data.system.properties ?? []).filter(p => p !== "concentration");
  data.effects = [];
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { granted: { item: item.uuid, caster: item.actor?.uuid ?? null } } };
  return data;
}

/** Active GM: the granting activity was used — each target of the message receives its copy. */
async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.grants : null;
  if ( !rule || (rule.from !== activity.id) ) return;
  const caster = item.actor;
  const dc = Number(caster?.system?.attributes?.spell?.dc) || 10;
  // §406: the upcast is on the use message (`system.scaling`), not in its flags (which dnd5e 6 no longer writes).
  const scaling = Math.max(0, (Number(message.system?.scaling) || 0));
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token ?? t.actor ?? "", { strict: false });
    const actor = target?.actor ?? target;
    if ( !actor || (actor === caster) ) continue;
    const old = actor.items.filter(i => i.getFlag(MODULE_ID, "granted")?.item === item.uuid).map(i => i.id);
    if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
    const data = grantedData(item, rule, { dc, scaling });
    if ( !data ) continue;
    await actor.createEmbeddedDocuments("Item", [data]);
    log(`${item.name}: ${actor.name} can now use "${data.system.activities[rule.activity].name || item.name}" (DC ${dc})`);
  }
}

/** Active GM: the caster's Concentration on a granting spell drops — the copies leave. */
async function onConcentrationEnds(effect) {
  if ( !effect.statuses?.has?.("concentrating") ) return;
  const caster = effect.parent;
  const data = effect.getFlag("dnd5e", "item") ?? {};
  const itemId = data.id ?? data.data?._id;
  if ( !caster || !itemId ) return;
  const uuidEnd = `Item.${itemId}`;
  const actors = new Set([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].filter(Boolean));
  for ( const actor of actors ) {
    const ids = actor.items.filter(i => {
      const g = i.getFlag(MODULE_ID, "granted");
      return g?.item?.endsWith(uuidEnd) && ((g.caster === caster.uuid) || (g.caster === caster.actor?.uuid) || !g.caster);
    }).map(i => i.id);
    if ( !ids.length ) continue;
    await actor.deleteEmbeddedDocuments("Item", ids);
    log(`${actor.name}: the granted activity ends with ${caster.name}'s concentration`);
  }
}

/**
 * C12-g: Mislead — "you become Invisible at the moment an illusory double appears": dnd5e places the effects of a summon
 * activity on the summoned creature (documents/activity/summon.mjs); `summonEffectsOnCaster` puts them back on the caster,
 * tied to their Concentration. On the client that summons.
 */
async function onPostSummon(activity, profile, tokens) {
  const item = activity?.item;
  const caster = item?.actor;
  if ( !caster || (contentOf(item).entry?.summonEffectsOnCaster !== true) ) return;
  const ids = (activity.effects ?? []).map(e => e._id).filter(Boolean);
  if ( !ids.length ) return;
  for ( const token of tokens ?? [] ) {
    const actor = token.actor ?? token.document?.actor;
    const copies = (actor?.effects ?? []).filter(e => ids.some(id => String(e._stats?.compendiumSource ?? e._stats?.duplicateSource ?? e.origin ?? "").includes(id) || (e.name === item.effects.get(id)?.name)));
    if ( copies.length && actor.isOwner ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
  }
  const concentration = concentrationOn(item);
  for ( const id of ids ) {
    const placed = await placeItemEffect(item, id, caster);
    if ( placed && concentration?.addDependent ) await concentration.addDependent(placed);
    log(`${item.name}: "${item.effects.get(id)?.name ?? id}" on ${caster.name}, not on the summoned creature`);
  }
}

export function registerGrants() {
  route("dnd5e.postSummon", (activity, profile, tokens) => { onPostSummon(activity, profile, tokens).catch(err => console.error(`${MODULE_ID} | summon effects`, err)); },
    { label: "summon effects not moved to the caster" });
  route("createChatMessage", message => enqueue(`grants:${message.id}`, () => onUsage(message)), { executor: true, label: "granted activity not given" });
  route("deleteActiveEffect", effect => enqueue(`grants-end:${effect.id}`, () => onConcentrationEnds(effect)), { executor: true, label: "granted activity not removed" });
}
