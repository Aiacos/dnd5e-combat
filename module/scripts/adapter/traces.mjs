/**
 * Trace d'une utilisation (SPEC §16.9) : un sort qui ne pose aucun effet (Armure d'Agathys : des PV temporaires et une
 * riposte) ne laisse rien sur son lanceur, et le moteur ne peut pas savoir qu'il est actif — se fier aux seuls PV
 * temporaires ferait riposter un occultiste Fiélon dont la Bénédiction du Ténébreux vient d'en donner. Le contenu
 * déclare `trace: true` : à l'utilisation, le moteur pose sur le lanceur un effet au nom et à l'image de l'item, pour
 * la durée de l'item, dont l'origine est l'activité — ses déclarations `via: "effect"` s'y accrochent comme à tout
 * effet d'item (adapter/triggers.mjs, `declarationsOfEffects`). Le niveau de lancement est gardé comme le fait le
 * plateau d'effets de dnd5e (`flags.dnd5e.scaling`, `spellLevel` : effect-application.mjs, `_prepareEffectData`).
 * Relancé, le sort remplace sa trace.
 * §16.41 : `trace: { activity, show, attack }` — la trace d'une activité précise, montrée sur le token, qui offre une attaque au
 * menu du clic droit ; celle d'un sort à concentration tombe avec elle.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { concentrationOn } from "./summons.mjs";
import { favoriteIdOf, favoritePlan, favoriteRemoval } from "../core/spell-weapons.mjs";

/** La règle de trace d'un item, normalisée : `{ activity, show, attack }`, ou null. */
export function traceRuleOf(item) {
  const t = item ? contentOf(item).entry?.trace : null;
  if ( t === true ) return { activity: null, show: false, attack: null };
  return (t && (typeof t === "object")) ? { activity: t.activity ?? null, show: t.show === true, attack: t.attack ?? null } : null;
}

/** La trace active de cet item sur l'acteur, ou null. */
export function traceOn(actor, item) {
  // §554: an expired trace (the core marks it `duration.expired`, it does not delete it) no longer counts.
  return (actor?.effects ?? []).find(e => (e.getFlag(MODULE_ID, "trace") === item.uuid) && !e.disabled && !e.duration?.expired) ?? null;
}

/**
 * §554: the spell weapon a trace effect stands for — `{ actor, item, activity }` when the effect is a trace whose rule offers an
 * attack (Flame Blade, Produce Flame), else null. Works on a deleted effect too (its parent and flags are still readable).
 */
export function spellWeaponOfEffect(effect) {
  const uuid = effect?.getFlag?.(MODULE_ID, "trace");
  const actor = effect?.parent;
  if ( !uuid || (actor?.documentName !== "Actor") ) return null;
  const item = actor.items.find(i => i.uuid === uuid);
  const rule = traceRuleOf(item);
  const activity = rule?.attack ? item.system.activities?.get(rule.attack) : null;
  return activity ? { actor, item, activity } : null;
}

/**
 * §554: the active spell weapons of an actor, in a public shape for neighbours (`api.ui.spellWeapons`): `{ uuid, item, itemId,
 * activityId, effect, name, img, level, favorite }` — `uuid` the attack activity, `item` and `effect` uuids, `level` the cast level,
 * `favorite` the attack's favorite id on the sheet.
 */
export function spellWeapons(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = traceRuleOf(item);
    const effect = rule?.attack ? traceOn(actor, item) : null;
    const activity = effect ? item.system.activities?.get(rule.attack) : null;
    if ( !activity ) continue;
    out.push({ uuid: activity.uuid, item: item.uuid, itemId: item.id, activityId: activity.id, effect: effect.uuid, name: item.name,
      img: item.img, level: effect.getFlag("dnd5e", "spellLevel") ?? item.system.level ?? null, favorite: favoriteIdOf(item.id, activity.id) });
  }
  return out;
}

/**
 * §16.41 : les attaques offertes par une trace active (Lame de feu : l'attaque de la lame tant qu'elle est invoquée), pour le
 * menu du clic droit.
 */
export function traceAttacks(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = traceRuleOf(item);
    if ( !rule?.attack || !traceOn(actor, item) ) continue;
    const activity = item.system.activities?.get(rule.attack);
    if ( activity ) out.push(activity);
  }
  return out;
}

/**
 * §554: favorite writes of an actor, one after the other. Cast again, the old trace's end (removal) and the new trace's placement
 * (addition) race: dnd5e ends the old concentration before the new usage message, and the two hooks run their writes concurrently.
 * Queued, each step reads the favorites the previous one left.
 */
const favoriteQueue = new Map();

function queueFavorite(actor, fn) {
  const key = actor.uuid;
  const run = () => fn().catch(() => null);
  const step = (favoriteQueue.get(key) ?? Promise.resolve()).then(run, run);
  favoriteQueue.set(key, step);
  step.then(() => { if ( favoriteQueue.get(key) === step ) favoriteQueue.delete(key); });
  return step;
}

/** The favorite ids of an actor, or null when it has none (dnd5e: characters only). */
const favoriteIds = actor => ("favorites" in (actor?.system ?? {})) ? (actor.system.favorites ?? []).map(f => f.id) : null;

/** §554: at placement, the attack joins the favorites, marked on the trace as DAS's (`traceFavorite`) — unless the player's own. */
async function holdFavorite(actor, effect, id, inherited) {
  return queueFavorite(actor, async () => {
    const favorites = favoriteIds(actor);
    const plan = favoritePlan({ supported: !!favorites, favorites: favorites ?? [], id, inherited });
    if ( plan.mark && actor.effects.has(effect.id) ) await effect.setFlag(MODULE_ID, "traceFavorite", id);
    if ( plan.add ) await actor.system.addFavorite({ type: "activity", id });
  });
}

/**
 * §554: a trace has ended — the favorite DAS had added goes, unless another trace of the same spell now stands (cast again: the new
 * one takes the mark over). Active GM. Resolves to true when the favorite was removed.
 * @param {ActiveEffect} effect   The deleted trace.
 * @param {object} [options]      The deletion options (`{ "dnd5e-combat": { replaced } }`).
 */
export function releaseFavorite(effect, options={}) {
  const marked = effect?.getFlag?.(MODULE_ID, "traceFavorite") ?? null;
  const actor = effect?.parent;
  if ( !marked || (actor?.documentName !== "Actor") || !favoriteIds(actor) ) return Promise.resolve(false);
  return queueFavorite(actor, async () => {
    const favorites = favoriteIds(actor) ?? [];
    if ( !favoriteRemoval({ marked, favorites, replaced: !!options?.[MODULE_ID]?.replaced }) ) return false;
    const uuid = effect.getFlag(MODULE_ID, "trace");
    const other = actor.effects.find(e => (e.id !== effect.id) && (e.getFlag(MODULE_ID, "trace") === uuid) && !e.disabled && !e.duration?.expired);
    if ( other ) {
      if ( !other.getFlag(MODULE_ID, "traceFavorite") ) await other.setFlag(MODULE_ID, "traceFavorite", marked);
      return false;
    }
    await actor.system.removeFavorite(marked);
    return true;
  }).then(r => r === true);
}

/**
 * §554: is this effect expired and about to be deleted by dnd5e itself? Out of combat, the active GM's dnd5e deletes an effect as soon
 * as it expires (ActiveEffect5e#_onUpdate: `data.duration?.expired`, no `dependentOn`, the actor in no combat); deleting it too would
 * fail on the second delete.
 */
export function expiresByItself(effect) {
  if ( !effect?.duration?.expired || effect.getFlag?.("dnd5e", "dependentOn") ) return false;
  const combat = effect.start?.combat ?? game.combat;
  return !combat?.getCombatantsByActor?.(effect.parent)?.length;
}

/** Secondes par unité de durée de dnd5e (`CONFIG.DND5E.scalarTimePeriods`). */
const SECONDS = Object.freeze({ turn: 6, round: 6, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 });

/** La durée de l'item en secondes, ou null (instantané, permanent, spécial). */
function durationOf(item) {
  const { value, units } = item.system?.duration ?? {};
  const n = Number(value);
  return (SECONDS[units] && Number.isFinite(n) && (n > 0)) ? n * SECONDS[units] : null;
}

/**
 * Pose la trace d'une utilisation, si le contenu de l'item la demande. MJ actif uniquement.
 * @param {ChatMessage} message  Le message d'utilisation (`type: "usage"`).
 * @returns {Promise<ActiveEffect|null>}
 */
export async function leaveTrace(message) {
  const item = message.getAssociatedItem?.();
  const rule = traceRuleOf(item);
  if ( !rule ) return null;
  const actor = message.getAssociatedActor?.();
  const activity = message.getAssociatedActivity?.();
  if ( !actor || !activity ) return null;
  if ( rule.activity && (activity.id !== rule.activity) ) return null;   // Lame de feu : pas à chaque attaque
  // §16.41 : un sort à concentration — la trace tombe avec elle (runtime/concentration.mjs).
  const concentration = concentrationOn(item);
  // A trace held by a concentration that has just ended (cast again: dnd5e ends the old concentration first) is removed by
  // runtime/concentration.mjs — deleting it here too would fail on the second delete.
  const previousEffects = actor.effects.filter(e => (e.getFlag(MODULE_ID, "trace") === item.uuid)
    && !(e.getFlag(MODULE_ID, "traceConcentration") && !fromUuidSync(e.getFlag(MODULE_ID, "traceConcentration"), { strict: false })));
  const previous = previousEffects.map(e => e.id);
  const inherited = previousEffects.some(e => !!e.getFlag(MODULE_ID, "traceFavorite"));
  if ( previous.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", previous, { [MODULE_ID]: { replaced: true } });
  const seconds = durationOf(item);
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: activity.uuid,
    system: { origin: { activity: activity.uuid, message: message.uuid } },
    duration: seconds ? { value: seconds, units: "seconds" } : {},
    ...(rule.show ? { showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS } : {}),
    flags: {
      [MODULE_ID]: { trace: item.uuid, ...(concentration ? { traceConcentration: concentration.uuid } : {}) },
      dnd5e: { scaling: message.system?.scaling ?? 0, spellLevel: message.system?.level ?? item.system?.level ?? null }
    }
  }]);
  // §554: the attack goes into the sheet's favorites (characters only), unless the player already put it there.
  const attack = rule.attack ? item.system.activities?.get(rule.attack) : null;
  if ( effect && attack ) await holdFavorite(actor, effect, favoriteIdOf(item.id, attack.id), inherited);
  return effect ?? null;
}
