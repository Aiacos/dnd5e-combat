/**
 * Grappling read in Foundry (SPEC §15.2, 2024 rules): the Grappled condition is an effect (that of the
 * Grapple, content/actions.mjs, or that of the Barbarian's, Monk's, or a monster's item); its grappler is
 * read from the origin dnd5e writes when applying it (`system.origin.activity`,
 * applications/components/effect-application.mjs:252-259). A Grappled placed by hand has no
 * known grappler: no targeted disadvantage, no automatic end, no escape DC — the GM decides.
 */

import { MODULE_ID } from "../constants.mjs";
import { rangeIssue } from "../core/range.mjs";
import { distanceBetween } from "./turn.mjs";
import { unarmedAttackOf } from "./basics.mjs";
import { pilotOfActor, summonTokenFor } from "./pilot.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** §502: the `grapples` rule of the item a Grappled effect comes from, or null. */
export const grapplesRuleOf = item => (item ? (contentOf(item).entry?.grapples ?? null) : null);

/** The Active Effects that make this actor Grappled. */
export function grappleEffectsOf(actor) {
  return (actor?.effects ?? []).filter(e => !e.disabled && e.statuses?.has("grappled"));
}

/**
 * The grappling actor, from the effect's origin; null if unknown. If the item that was used no longer
 * exists (Unarmed Strike removed), the actor is still read at the start of the activity's UUID
 * (`Actor.<id>.Item.…`, `Scene.<id>.Token.<id>.Actor.<id>.Item.…`): the grapple remains judgeable.
 */
export function grapplerOf(effect) {
  // A condition placed by the engine (step `status`, "Grasping Hand" §16.15) keeps its origin in the core's `origin`
  // field: dnd5e's `condition` effect model has no `system.origin` (adapter/saves.mjs, applyStatusToToken).
  const activityUuid = effect?.system?.origin?.activity ?? (effect?.origin?.includes?.(".Activity.") ? effect.origin : null);
  if ( !activityUuid ) return null;
  try {
    const actor = fromUuidSync(activityUuid)?.actor;
    if ( actor ) return actor;
    const actorUuid = activityUuid.split(".Item.")[0];
    return (actorUuid && (actorUuid !== activityUuid)) ? (fromUuidSync(actorUuid) ?? null) : null;
  }
  catch { return null; }
}

/**
 * Does the attacker, grappled, target a creature other than its grappler? (disadvantage, 2024 rule)
 * @returns {boolean|null}  null: not grappled, or grappler unknown.
 */
export function grappledElsewhere(attackerToken, targetToken) {
  const effects = grappleEffectsOf(attackerToken?.actor);
  if ( !effects.length ) return null;
  const grapplers = effects.map(grapplerOf).filter(Boolean);
  if ( !grapplers.length ) return null;
  const target = targetToken?.actor;
  return !grapplers.some(a => (a === target) || (a.uuid === target?.uuid));
}

/**
 * The scene where the grapple took place: that of the Grapple card (`system.origin.message`, its
 * `speaker.scene`). null if unknown. A LINKED actor carries its effects on all its tokens, in all
 * scenes: the grapple is only judged where it was made (seen on 2026-09-23: the Paladin and the Wizard also
 * have tokens on another scene, 20 ft from each other, and the grapple was "broken" there).
 */
export function grappleSceneOf(effect) {
  // §504: a condition placed by the engine (step `status`) has no origin message; its scene is noted on the effect.
  const noted = effect?.getFlag?.(MODULE_ID, "scene");
  if ( noted ) return noted;
  const messageUuid = effect?.system?.origin?.message;
  if ( !messageUuid ) return null;
  try { return fromUuidSync(messageUuid)?.speaker?.scene ?? null; }
  catch { return null; }
}

/**
 * K4 (§325): the escape DC the feature writes — the Monster Manual's "Escape Check" activity (`check`), a number (14) or a
 * formula ("@skills.ath.passive"), on the item that placed the grapple. null if there is none.
 */
function declaredEscapeDc(effect) {
  // §504 (B24): a DC written on the effect by the rule that placed it (grapple instead of damage).
  const own = Number(effect?.getFlag?.(MODULE_ID, "escapeDc"));
  if ( Number.isFinite(own) && (own > 0) ) return own;
  const item = originItemOf(effect);
  const check = Array.from(item?.system?.activities ?? []).find(a => (a.type === "check") && /escape|évasion|evasion/i.test(a.name ?? ""))
    ?? Array.from(item?.system?.activities ?? []).find(a => a.type === "check");
  if ( !check ) return null;
  const value = Number(check.check?.dc?.value);
  if ( Number.isFinite(value) && (value > 0) ) return value;
  const formula = check.check?.dc?.formula;
  if ( !formula ) return null;
  try {
    const n = Number(Roll.safeEval(Roll.replaceFormulaData(String(formula), item.getRollData?.() ?? {})));
    return Number.isFinite(n) && (n > 0) ? n : null;
  } catch { return null; }
}

/** DC to escape a grapple: the one the feature writes (K4), otherwise 8 + Strength + the grappler's proficiency (`abilities.str.dc`). null if unknown. */
export function escapeDcOf(effect) {
  const declared = declaredEscapeDc(effect);
  if ( declared ) return declared;
  const grappler = grapplerOf(effect);
  // "Grasping Hand" (§16.15): "escape DC equal to your spell save DC" — that of the hand's caster.
  const summoner = grappler ? pilotOfActor(grappler)?.summoner : null;
  if ( summoner ) {
    const spellDc = summoner.system?.attributes?.spell?.dc;
    if ( Number.isFinite(spellDc) ) return spellDc;
  }
  const dc = grappler?.system?.abilities?.str?.dc;
  return Number.isFinite(dc) ? dc : null;
}

/**
 * Reach of a grapple: the reach of the grappler's Unarmed Strike, 5 ft by default — K4 (§325): or that of the feature
 * that placed the grapple, if longer (Chuul's Pincer, "Strangling Vine": 10 ft; Shoggoth's Pseudopod: 15 ft).
 */
function grappleReachOf(grappler, effect=null) {
  const range = unarmedAttackOf(grappler)?.item?.system?.range;
  const own = { value: range?.reach ?? 5, units: range?.units ?? "ft" };
  const item = effect ? originItemOf(effect) : null;
  const reaches = [item?.system?.range?.reach, ...Array.from(item?.system?.activities ?? []).map(a => a.range?.reach)].map(Number).filter(n => Number.isFinite(n) && (n > 0));
  const longest = reaches.length ? Math.max(...reaches) : null;
  if ( !longest || (((item?.system?.range?.units ?? "ft") === own.units) && (longest <= own.value)) ) return own;
  return { value: longest, units: item?.system?.range?.units ?? "ft" };
}

/**
 * A token of an actor in a given scene — not the one this client displays (`getActiveTokens` only sees the
 * displayed scene: a GM on another scene did not find the grappler, seen on 2026-09-23).
 */
function tokenIn(scene, actor) {
  if ( actor.isToken ) return (actor.token?.parent === scene) ? actor.token : null;
  return scene.tokens.find(t => t.actorLink && (t.actorId === actor.id)) ?? null;
}

/**
 * Facts of a grapple for the core (`grappleHolds`): the grappler's conditions and the distance.
 * null if the grappler is unknown or has no token on the grappled creature's scene.
 */
export function grappleFacts(effect, grappledToken, factors) {
  const grappler = grapplerOf(effect);
  // §502 (B22): `grapples.by: "summon"` — the grapple is held by the grappler's summon (the vine): it holds as long as
  // that one is on the scene and not incapacitated, at any distance from the grappler.
  const item = originItemOf(effect);
  if ( grappler && (grapplesRuleOf(item)?.by === "summon") ) {
    const anchor = summonTokenFor(grappler, item, grappledToken.parent, grappledToken);
    if ( !anchor ) return { grapplerStatuses: [], withinReach: false, grappler, grapplerToken: grappledToken, distance: null, reach: null, by: "summon" };
    return { grapplerStatuses: Array.from(anchor.actor?.statuses ?? []), withinReach: true, grappler, grapplerToken: anchor, distance: null, reach: null, by: "summon" };
  }
  const grapplerToken = grappler ? tokenIn(grappledToken.parent, grappler) : null;
  if ( !grapplerToken ) return null;
  const distance = distanceBetween(grapplerToken, grappledToken);
  const reach = grappleReachOf(grappler, effect);
  const within = rangeIssue(distance, reach, factors) === null;
  return { grapplerStatuses: Array.from(grappler.statuses ?? []), withinReach: within, grappler, grapplerToken, distance, reach };
}

/* -------------------------------------------- */
/*  L'agrippeur : sa marque, ses victimes       */
/* -------------------------------------------- */

/** The "Grapples: …" marks of a grappler actor (one per victim). */
export function grapplingMarksOf(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "grappling"));
}

/** Data of the mark placed on the grappler: an always-visible icon, linked to the victim's Grappled effect. */
export function grapplingMarkData(name, victimToken, grappleEffect) {
  return {
    name, img: "systems/dnd5e/icons/svg/statuses/grappled.svg", transfer: false, disabled: false, statuses: [], changes: [],
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { grappling: { target: victimToken.uuid, effect: grappleEffect.uuid } } }
  };
}

/**
 * The actor that carries an effect. V14 trap, seen on 2026-09-23: for an UNLINKED token, the effect lives in the
 * token's delta (`ActorDelta`), and the `createActiveEffect` hook receives it with that delta as parent
 * (client/data/client-backend.mjs:164) — not the synthetic actor.
 */
export function actorOfEffect(effect) {
  const parent = effect?.parent;
  if ( parent?.documentName === "ActorDelta" ) return parent.parent?.actor ?? parent.syntheticActor ?? null;
  return (parent?.documentName === "Actor") ? parent : null;
}

/** The token of a grappled actor, in the grapple's scene (or that of its first token). */
export function grappledTokenOf(effect) {
  if ( effect?.parent?.documentName === "ActorDelta" ) return effect.parent.parent ?? null;   // the delta's token
  const actor = actorOfEffect(effect);
  if ( !actor ) return null;
  if ( actor.isToken ) return actor.token;
  const sceneId = grappleSceneOf(effect);
  // §504: otherwise, the scene of the grappler's token — a linked actor has tokens on several scenes (the first is not the right
  // one).
  const grappler = sceneId ? null : grapplerOf(effect);
  const scene = (sceneId && game.scenes.get(sceneId)) || (grappler?.isToken ? grappler.token?.parent : null)
    || (grappler ? (game.scenes.find(s => s.tokens.some(t => t.actorLink && (t.actorId === grappler.id) && s.tokens.some(v => v.actorLink && (v.actorId === actor.id)))) ?? null) : null);
  if ( scene ) return tokenIn(scene, actor);
  return actor.getDependentTokens?.({ concreteOnly: true })[0] ?? null;
}

/** Numeric size rank of an actor (dnd5e: `CONFIG.DND5E.actorSizes[...].numerical`, M = 2). */
export function sizeRankOf(actor) {
  return CONFIG.DND5E.actorSizes?.[actor?.system?.traits?.size]?.numerical ?? 2;
}

/** The victims a grappler token drags while walking (tokens), from its marks. */
export function victimsOf(grapplerToken) {
  return grapplingMarksOf(grapplerToken?.actor)
    .map(mark => fromUuidSync(mark.getFlag(MODULE_ID, "grappling").target))
    .filter(t => t && (t.parent === grapplerToken.parent));
}
