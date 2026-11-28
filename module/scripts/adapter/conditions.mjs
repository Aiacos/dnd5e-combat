/**
 * Creature conditions and attack situation, read from Foundry for the core (core/conditions.mjs).
 *
 * Verified in dnd5e 6.0.3:
 *  - before a roll, `roll.options.advantage` / `.disadvantage` are booleans that the system
 *    combines itself: both at once = normal roll (dice/d20-roll.mjs:95-99, 252-255). The
 *    engine only adds its sources to the system's (Poisoned, effects, keys).
 *  - the system's conditions are built at `i18nInit` from `CONFIG.DND5E.statusEffects`
 *    (dnd5e.mjs:447-467, 545): adding an entry at `init` is enough to create a token condition.
 */

import { armorHampers } from "./armor-training.mjs";
import { rangeIssue } from "../core/range.mjs";
import { verbalSpellBlocked, hampersRangedAttack, forbiddenAgainstCharmer, requiresSight, INCAPACITATING } from "../core/conditions.mjs";
import { distanceBetween, rangeOf } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { visionFacts, isVisionAvailable, canSee, tokenOnViewedScene } from "./vision.mjs";
import { originItemOf, revealedInvisible, seesInvisible, swornEnemyOf } from "./facts.mjs";
import { grappledElsewhere } from "./grapple.mjs";
import { helpedAgainst } from "./help.mjs";
import { flankingAlly } from "./flanking.mjs";
import { spellCommandOf } from "./pilot.mjs";
import { declaredAttackModifiers } from "./triggers.mjs";
import { isDeadActor } from "./death.mjs";
import { contentOf } from "./content.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { pendingMetamagic } from "./metamagic.mjs";
import { rangedFeatsFor, coverLeft, coverIgnoreOf, CROSSBOWS } from "../core/feats.mjs";
import { forcedCover } from "../core/cover.mjs";
import { coverFor } from "./cover.mjs";
import { areEnemies } from "./factions.mjs";

/**
 * Frightened "as long as the source of the fear is in sight" (P1): the sources are the actors from which
 * the attacker's Frightened effects come. false if no known source is in sight;
 * null if the attacker is not frightened, if a source is unknown, or if vision is out of service.
 */
export function frightenedSourceSeen(origin) {
  if ( !isVisionAvailable() || !origin?.actor?.statuses?.has("frightened") ) return null;
  let known = 0;
  for ( const effect of origin.actor.effects ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("frightened") ) continue;
    const source = tokenOnViewedScene(originItemOf(effect)?.actor);
    if ( !source ) return null;   // unknown source: the condition applies
    known++;
    if ( canSee(origin, source) !== false ) return true;
  }
  return known ? false : null;
}

/** §17.3: the source tokens of this actor's Frightened effects (known and on `token`'s scene). */
export function fearSources(token) {
  const out = [];
  for ( const effect of token?.actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("frightened") ) continue;
    const source = tokenOnViewedScene(originItemOf(effect)?.actor);
    if ( source && (source.parent === token.parent) && (source !== token) ) out.push(source);
  }
  return out;
}

/**
 * §402: the leashes carried by this token's effects (`leash` in the origin item's content: Compelled Duel — "it cannot
 * willingly move more than 9 m away from you"): `{ source, distance, units, item }` for each caster present on the scene.
 */
export function leashesOf(token) {
  const out = [];
  for ( const effect of token?.actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    const leash = item ? contentOf(item).entry?.leash : null;
    if ( !leash ) continue;
    const source = tokenOnViewedScene(item.actor);
    if ( source && (source.parent === token.parent) && (source !== token) ) out.push({ source, ...leash, item });
  }
  return out;
}

/** §17.3: the uuids of the actors that charmed this actor (origin of Charmed effects). */
export function charmersOf(actor) {
  const out = new Set();
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("charmed") ) continue;
    const source = originItemOf(effect)?.actor;
    if ( source && (source !== actor) ) out.add(source.uuid);
  }
  return out;
}

/** §17.3: is the use forbidden against whoever charmed us? Attack, damage, or magical effect (a spell). */
export function hostileToCharmer(activity) {
  return forbiddenAgainstCharmer({
    attack: activity?.type === "attack",
    damage: (activity?.damage?.parts?.length ?? 0) > 0,
    magical: isSpellCast(activity?.item)   // §48 : un parchemin lance le sort
  });
}

/**
 * §17.3: does the activity target "a creature you can see"? From the item's description, for an activity
 * that targets creatures without a template (an area is placed on a point: its target need not be seen).
 */
export function sightRequired(activity) {
  if ( activity?.target?.template?.type ) return false;
  return requiresSight(activity?.item?.system?.description?.value);
}

/** Turn conditions held by the engine, visible on the token. `dodging` is a native condition of the system. */
export const TURN_STATUSES = Object.freeze({
  reactionUsed: { id: "reactionUsed", name: "DND5ECOMBAT.Etat.reactionUsed", img: "icons/svg/lightning.svg" },
  dashing: { id: "dashing", name: "DND5ECOMBAT.Etat.dashing", img: "icons/svg/wingfoot.svg" },
  disengaged: { id: "disengaged", name: "DND5ECOMBAT.Etat.disengaged", img: "icons/svg/door-exit.svg" },
  readied: { id: "readied", name: "DND5ECOMBAT.Etat.readied", img: "icons/svg/clockwork.svg" }
});

/**
 * §192: mode conditions held by the engine (from `movementAction`, not the budget): climbing. The effect carries the immunity to
 * falling (`system.traits.ci.value` + `falling`): dnd5e re-evaluates "Falling" at each related update of the actor or its effects
 * (`TokenDocument5e#_onRelatedUpdate` → `updateFalling()`, without movement) and then knows nothing of climbing — a climber at
 * 10 ft ended up "Falling" as soon as an effect changed (seen on the player side on 2026-10-17); `_isFalling` yields to this
 * immunity (documents/token.mjs). The immunity leaves with the status, before the engine makes the climber fall.
 */
export const MODE_STATUSES = Object.freeze({
  climbing: { id: "climbing", name: "DND5ECOMBAT.Etat.climbing", img: "icons/svg/up.svg",
    changes: [{ key: "system.traits.ci.value", mode: 2, value: "falling" }] },
  // §192 batch 2: on the ceiling (in place of "Climbing"), same immunity to "Falling".
  ceiling: { id: "ceiling", name: "DND5ECOMBAT.Etat.ceiling", img: "icons/svg/down.svg",
    changes: [{ key: "system.traits.ci.value", mode: 2, value: "falling" }] }
});

/** To call at `init`, before the system freezes its list of conditions. */
export function registerTurnStatuses() {
  for ( const status of [...Object.values(TURN_STATUSES), ...Object.values(MODE_STATUSES)] ) {
    CONFIG.DND5E.statusEffects[status.id] ??= { name: status.name, img: status.img, order: 90, ...(status.changes ? { changes: status.changes } : {}) };
  }
}

export function statusesOf(token, observer=null) {
  const statuses = Array.from(token?.actor?.statuses ?? []);
  // §16.36: "cannot benefit from the Invisible condition" (Stardust, Faerie Fire); §161: the other party of the
  // attack sees the Invisible (See Invisibility).
  const visible = revealedInvisible(token?.actor, observer?.actor) || seesInvisible(observer?.actor) || truesees(observer, token);
  return visible ? statuses.filter(s => s !== "invisible") : statuses;
}

/**
 * §302 (pass C7): Truesight sees Invisible creatures within its range ("Supreme Vision", monster senses) — the observer
 * has `senses.ranges.truesight` and the creature is at that distance or less (the engine's 3D distance, units converted).
 */
function truesees(observer, token) {
  const senses = observer?.actor?.system?.attributes?.senses;
  const range = Number(senses?.ranges?.truesight ?? 0);
  if ( !(range > 0) || !token?.parent || (observer.parent !== token.parent) ) return false;
  const units = token.parent.grid?.units ?? "ft";
  const reach = lengthIn(range, senses.units ?? "ft", units);
  const d = distanceBetween(observer, token)?.value;
  return Number.isFinite(d) && (d <= reach + 1e-6);
}

/** Are two tokens within 5 ft of each other? */
export function areAdjacent(a, b, factors, positions={}) {
  return rangeIssue(distanceBetween(a, b, positions), { value: 5, units: "ft" }, factors) === null;
}

/** Is the attack ranged? A thrown melee weapon counts as one. */
export function isRangedAttack(activity, attackMode) {
  return (activity.attack?.type?.value === "ranged") || (attackMode?.startsWith("thrown") === true);
}

/**
 * Does an enemy that sees this token and is not Incapacitated stand within 5 ft? (PHB 2024 "Ranged Attacks in Close Combat",
 * core/conditions.mjs `hampersRangedAttack`.) A dead creature does not count; sight is that of the attacker's current position.
 */
export function hasHostileAdjacent(token, factors, posA=undefined) {
  // Sight last: it is the only costly check.
  return token.parent.tokens.some(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && areEnemies(token, other) && areAdjacent(token, other, factors, { posA })
    && hampersRangedAttack({
      hostile: areEnemies(token, other),
      statuses: Array.from(other.actor.statuses),
      dead: isDeadActor(other.actor),
      seesAttacker: isVisionAvailable() ? canSee(other, token) : null
    }));
}

/** Does one of the actor's items carry this content rule (`true`) while not Incapacitated? (§20: Evasion, Elusive.) */
function activeRule(actor, key) {
  if ( !actor || INCAPACITATING.some(s => actor.statuses?.has?.(s)) ) return false;
  return Array.from(actor.items ?? []).some(i => contentOf(i).entry?.[key] === true);
}

/** §20: Evasion — "you cannot use this feature if you have the Incapacitated condition". */
export const evades = actor => activeRule(actor, "evasion");

/** §334: Evasion (Displacer Beast) — the Evasion effect for any save for half damage, not only Dexterity. */
export const avoids = actor => activeRule(actor, "avoidance");

/** §20: Elusive — "no attack roll can have Advantage against you while you are not Incapacitated". */
export const isElusive = token => activeRule(token?.actor, "elusive");

/**
 * §131: what the attacker's shooting feats grant to this attack (Sharpshooter, Crossbow Expert, Spell Sniper).
 * @returns {{cover: boolean, closeCombat: boolean, longRange: boolean, offhandModifier: boolean, spellRange: object|null}}
 */
export function rangedFeatsOf(actor, activity, attackMode=null) {
  const rules = Array.from(actor?.items ?? []).map(i => contentOf(i).entry?.rangedFeat).filter(Boolean);
  const none = { cover: false, closeCombat: false, longRange: false, offhandModifier: false, loading: false, spellRange: null };
  if ( !rules.length || (activity?.type !== "attack") ) return none;
  return rangedFeatsFor(rules, rangedAttackShape(activity, attackMode));
}

/** The shape of an attack read by the shooting-feat rules (`rangedFeatsFor`). */
function rangedAttackShape(activity, attackMode) {
  const item = activity.item;
  return {
    weapon: item?.type === "weapon",
    ranged: isRangedAttack(activity, attackMode),
    crossbow: (item?.type === "weapon") && CROSSBOWS.includes(item.system?.type?.baseItem),
    spell: isSpellCast(item)
  };
}

/**
 * #33: the name of what makes this attack ignore half or three-quarters cover (Sharpshooter, Spell Sniper,
 * the Oathbow's weapon against its sworn enemy), or null — the same judgment as `coverAgainst`, named for the preview.
 */
export function coverIgnoredBy(origin, target, activity, attackMode=null, degree=null) {
  if ( activity?.type !== "attack" ) return null;
  const shape = rangedAttackShape(activity, attackMode);
  const feat = Array.from(origin?.actor?.items ?? []).find(i => {
    const rule = contentOf(i).entry?.rangedFeat;
    const ignores = rule ? rangedFeatsFor([rule], shape).cover : false;
    // An item that ignores only half cover is not named against three-quarters cover.
    return (ignores === "half") ? (degree !== "threeQuarters") : ignores;
  });
  if ( feat ) return feat.name;
  // The item itself (`attackIgnoresCover`), with the same caveat: `"half"` is not named against three-quarters cover.
  const own = itemIgnoresCover(activity);
  if ( own && ((own !== "half") || (degree !== "threeQuarters")) ) return activity.item.name;
  return swornEnemyOf(activity, target, attackMode) ?? null;
}

/** `attackIgnoresCover` of this attack's item: `true`, `"half"` or `false`. */
function itemIgnoresCover(activity) {
  const own = (activity?.type === "attack") ? contentOf(activity.item).entry?.attackIgnoresCover : null;
  return ((own === true) || (own === "half")) ? own : false;
}

/**
 * §131: the target's cover against this attack — a shooting feat can ignore half or three-quarters cover.
 * §518: `options.forced` — the attack went past a refusal: Total Cover counts as three-quarters there
 * (core/cover.mjs, `forcedCover`).
 */
export function coverAgainst(origin, target, activity, attackMode, { forced=false, ...options }={}) {
  const found = coverFor(origin, target, { ...options, activity, attackMode });
  const cover = forced ? forcedCover(found) : found;
  if ( forced && cover?.forced ) console.log(`dnd5e-combat | cover: ${target.name} — total cover, attack forced: three-quarters instead`);
  // §353: the Oathbow's sworn enemy gets no benefit from half or three-quarters cover.
  return coverLeft(cover, activity ? coverIgnoreOf(rangedFeatsOf(origin?.actor, activity, attackMode).cover,
    !!swornEnemyOf(activity, target, attackMode), itemIgnoresCover(activity)) : false);
}

/** Does one of the attacker's items remove the Disadvantage of firing in close combat with an enemy? */
const ignoresCloseCombat = token => Array.from(token?.actor?.items ?? []).some(i => contentOf(i).entry?.ignoresCloseCombat === true);

/**
 * O5a (§339): "Disadvantage on attack rolls with a Heavy weapon if it is a melee weapon and your Strength score is not at least 13,
 * or a ranged weapon and your Dexterity score" (PHB 2024, Heavy property). The weapon, not the attack mode:
 * a thrown melee weapon remains a melee weapon.
 */
export function heavyTooWeak(actor, activity) {
  const item = activity?.item;
  if ( (item?.type !== "weapon") || !item.system?.properties?.has?.("hvy") || (activity?.type !== "attack") ) return false;
  const ability = String(item.system.type?.value ?? "").endsWith("R") ? "dex" : "str";
  const score = Number(actor?.system?.abilities?.[ability]?.value);
  return Number.isFinite(score) && (score < 13);
}

/**
 * Attack context expected by attackModifiers(), for a target. `posA`: hypothetical position
 * of the attacker (at the end of an approach, for the chance to hit on hover); sight stays
 * that of its current position.
 */
export function attackContext(origin, target, activity, attackMode, factors, { posA }={}) {
  const ranged = isRangedAttack(activity, attackMode);
  const feats = rangedFeatsOf(origin?.actor, activity, attackMode);   // §131
  return {
    attacker: statusesOf(origin, target),
    target: statusesOf(target, origin),
    adjacent: areAdjacent(origin, target, factors, { posA }),
    ranged,
    longRange: ranged && !feats.longRange && !swornEnemyOf(activity, target, attackMode) && (rangeIssue(distanceBetween(origin, target, { posA }), rangeOf(activity, attackMode), factors) === "longRange"),
    // §19: no Disadvantage on ranged attacks despite an enemy in close combat
    // (content `ignoresCloseCombat`: declared by a third-party creature module).
    closeCombat: ranged && !feats.closeCombat && hasHostileAdjacent(origin, factors, posA) && !ignoresCloseCombat(origin),
    // P1: who sees whom. null if vision is not in service — conditions then keep their flat effect.
    vision: isVisionAvailable() ? visionFacts(origin, target) : null,
    frightenedSourceSeen: frightenedSourceSeen(origin),
    // Grappled (2024): Disadvantage against any target other than the grappler (adapter/grapple.mjs).
    grappledElsewhere: grappledElsewhere(origin, target),
    // Help (2024): an ally of the attacker has distracted the target (adapter/help.mjs).
    helped: helpedAgainst(origin, target),
    // §369: flanking (optional rule, `flanking` setting, off by default) — the name of the ally on the other side.
    flankedWith: flankingAlly(origin, target, { ranged, factors, posA }),
    // What the content declares (§16, B6): Faerie Fire, Pack Tactics, Protection from Evil and Good.
    declared: declaredAttackModifiers(origin, target, activity),
    // §20 : Insaisissable — aucun Avantage contre la cible.
    elusive: isElusive(target),
    // §214: armor without training, Strength or Dexterity attack.
    untrainedArmor: !!armorHampers(origin?.actor, activity?.ability),
    // O5a (§339): Heavy property — Disadvantage below 13 Strength (melee weapon) or Dexterity (ranged weapon).
    heavyTooWeak: heavyTooWeak(origin?.actor, activity)
  };
}

/**
 * The condition that prevents using this activity because it casts a verbal spell (Silence), or null.
 * dnd5e 6.0.3 does nothing with the "silenced" condition (pseudo-condition, config.mjs:3755-3759): the engine
 * must hold it. A spell cast from an item arrives here as a spell item whose ignored components
 * have already been removed (documents/activity/cast.mjs:171-174).
 */
export function verbalBlockOf(activity) {
  const item = activity?.item;
  if ( spellCommandOf(activity) ) return null;   // commanding the lights of an already cast spell is not casting a spell (§16.17)
  return verbalSpellBlocked(Array.from(activity?.actor?.statuses ?? []), {
    spell: isSpellCast(item),   // §48: reading a scroll is casting the spell
    // §409: Subtle Spell — "without verbal, somatic or material components" (Metamagic held until the next spell).
    verbal: !!item?.system?.properties?.has?.("vocal") && !((item?.type === "spell") && pendingMetamagic(activity.actor).includes("subtle"))
  });
}

/** Applies or removes a condition on an actor, doing nothing if it is already in the desired state. */
export async function setStatus(actor, id, active) {
  if ( !actor || (actor.statuses.has(id) === active) ) return;
  await actor.toggleStatusEffect(id, { active });
}
