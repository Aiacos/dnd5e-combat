/**
 * The trigger registry (SPEC §13, S3): ONE mechanism for everything that "hooks onto a
 * moment" — reactions, lasting areas, bonus damage, and tomorrow the turn triggers.
 *
 * A DECLARATION comes from an item (content shipped with the module, or item flag):
 *   { on: moment | moment[], if?: condition, do: step[] }
 *
 * A MOMENT is a name (see MOMENTS). The runtime publishes it as `Hooks.callAll("dnd5e-combat.<moment>")`
 * for passive consumers, and asks the core which declarations hook onto it.
 *
 * A CONDITION is a structure, not an expression: no eval, nothing to parse, and an
 * unknown key makes the condition false (never a happy silence). The FACTS are supplied by
 * the adapter: a value (compared strictly) or a function (called with the argument).
 *   { "activity.isAttack": true }                      fact = value
 *   { "target.hasEffectFrom": "hex" }                  fact = function, called with "hex"
 *   { "activity.type": ["attack", "save"] }            value in a list
 *   { "target.hasStatus": ["prone", "restrained"] }    fact = function that accepts a list: one of these conditions
 *   { all: [...] } · { any: [...] } · { not: ... }     combinations; an object with several keys = all
 *
 * Pure functions, no dependency on Foundry.
 */

import { factionRelation } from "./factions.mjs";

/**
 * Issue #40: the damage an effect deals to its bearer at a turn moment (Ensnaring Strike: "at the start of each of its
 * turns") no longer applies to a dead creature. A creature at 0 HP making death saving throws is not dead: it takes the
 * damage (a failed death saving throw). Healing carried by the same path (Heroism) is not discarded here.
 * @param {{dead: boolean, heals: boolean}} state
 */
export const spareBearer = ({ dead, heals }) => !!dead && !heals;

/** The known moments. A reaction moment opens a window; the others act by themselves. */
export const MOMENTS = Object.freeze({
  isHit: "an attack just hit the creature (Shield: before damage; riposte, B9: on application)",
  isDamaged: "the creature just took damage (Hellish Rebuke; via an effect: Sleep ending, Dominate replaying its save)",
  leavesReach: "a hostile creature leaves reach (Opportunity Attack)",
  // §133: a hostile creature has just taken the Disengage action (Sentinel: Opportunity Attack). Facts: the reactor in
  // `self`, the one disengaging in `source`. Window with no waiting, like "wounded".
  enemyDisengages: "a hostile creature just took the Disengage action (Sentinel: reaction window; it is the source)",
  enter: "a creature enters the area, or the area moves onto it",
  turnStart: "the creature starts its turn in the area",
  turnEnd: "the creature ends its turn in the area",
  moves: "the creature moves within the area (per square traveled: Spike Growth; not on placement)",
  preDamageRoll: "the actor is about to roll an activity's damage (bonus damage: Hex)",
  // Outcomes of a resolution (SPEC §16, brick "forced movement", "applied condition"): at application,
  // on each target reached. `hit`: an attack from the item hit it; `failedSave`: it failed
  // the item's save (or the one that a hitting attack imposes).
  hit: "an attack from the item just hit the target (on application: push, condition)",
  failedSave: "the target just failed the item's saving throw (on application: push, condition)",
  // K1 (§334): a success on the item's save (temporary immunity mark: "immune to this … for 24 hours").
  savedSave: "the target just succeeded on the item's saving throw (on application: temporary immunity mark)",
  // The turn of the creature itself, wherever it is (brick "repeated save"): a declaration
  // `via: "effect"` hooks onto it for any creature carrying an effect of the item (Hold Person).
  startOfTurn: "the creature starts its turn (declaration carried by an effect)",
  endOfTurn: "the creature ends its turn (declaration carried by an effect)",
  // §334: the creature that applied the effect starts its turn (Whelm, Whirlwind: "at the start of each of the elemental's turns").
  originTurnStart: "the creature that placed the effect starts its turn (declaration carried by the effect: its bearer takes damage)",
  // "Conditional Advantage" brick (§16, B6): on the attacker's client, before the roll, for each target.
  // Consulted: the attacker's items, and the effects carried by the attacker AND by the target (`via: "effect"`).
  preAttackRoll: "the actor is about to make an attack roll against the target (advantage, disadvantage)",
  // Gates (§16, B5 bis): a use is suspended before it takes place.
  castsSpell: "a hostile creature casts a spell within range and in sight (Counterspell: reaction window)",
  // §19.6: windows with no waiting, like "wounded".
  isMissed: "an attack just missed the creature (Riposte, Disarming Attack: reaction window)",
  enemyTurnEnd: "a hostile creature ends its turn (reaction window; it is the source)",
  // §157: before a use WITHOUT an attack roll that targets it (each Magic Missile dart is a use) — the
  // targeted creature can react (Shield). Facts: the reactor in `target` and `actor`, the user in `source`.
  isTargeted: "a hostile creature is about to use an activity without attack roll that targets the creature (Shield against Magic Missile: reaction window)",
  isAttacked: "a creature is about to attack the bearer (Sanctuary: the attacker's saving throw, via an effect; §34: the target's reaction window, before the roll — Shadowy Dodge)",
  // §34: a creature hostile to the reactor is about to make an attack roll, against it or an ally: reaction window before the
  // roll ("Protective Flash"). The facts see the reactor in `self`, the attacker in `source`, the targeted creature in `target`.
  enemyAttacks: "a hostile creature is about to make an attack roll (Warding Flare: reaction window, before the roll)",
  // The counterpart: a creature allied to the reactor (other than itself) is about to attack a creature hostile to it (Cosmic
  // Omen, Fortune: a die added to the roll). Same facts: the reactor in `self`, the attacker in `source`, the target in `target`.
  allyAttacks: "an allied creature is about to make an attack roll against an enemy (Cosmic Omen, Weal: reaction window, before the roll)",
  // §19.8: window with no waiting, like "wounded"; the fact `condition.gained` says which condition.
  gainsCondition: "the creature just gained a condition (reflexive shape-change: reaction window)",
  // Grave Domain: ANOTHER creature than the one reacting has just been hit, before damage. The facts see
  // the reactor in `self`, the hit creature in `target`, the attacker in `source`.
  allyIsHit: "another creature was just hit (Sentinel at Death's Door: reaction window, before damage)",
  // §38: ANOTHER creature than the reactor is about to take damage, amount known, before it is applied (Projected Ward: the
  // wizard's reserve absorbs it). Same facts as `allyIsHit`: the reactor in `self`, the creature in `target`, the author in
  // `source`.
  allyIsDamaged: "another creature is about to take damage (Projected Ward: reaction window, before application)",
  // §236: a creature hostile to the reactor has just made an attack roll, hit or miss, against anyone (Soul of Vengeance).
  // The facts see the reactor in `target`, the attacker in `source`. Window with no waiting, like "missed".
  enemyAttacked: "a hostile creature just made an attack roll, hit or miss, against anyone (Soul of Vengeance: reaction window; it is the source)",
  // §301: the creature is about to take fall damage (dnd5e fall card, before it is applied) — Slow Fall: the reactor
  // is the falling creature (`self` = `target`). `allyFalls`: ANOTHER non-hostile creature falls (Feather Fall) — the reactor in
  // `self`, the falling one in `target`.
  falls: "the creature is about to take falling damage (Slow Fall: reaction window, before application)",
  allyFalls: "another creature is about to take falling damage (Feather Fall: reaction window, before application)",
  // §487: the creature has just SUCCEEDED on the save imposed by the activity of a creature hostile to it ("Mage's Reprisal":
  // "against a spell" is filtered by `activity.isSpell`). The facts see the reactor in `target`, the author in `source`. Window
  // with no waiting, like "missed"; a Legendary Resistance counts as a success. Not to be confused with `savedSave` (outcome of
  // the item's own save, at application, without a reaction).
  savesAgainst: "the creature just succeeded on a saving throw against a hostile creature's activity (Mage's Retaliation: reaction window; it is the source)",
  // §493 (B13): the creature, caught in the area of an activity of ANOTHER creature (Cone, Line…: `activity.areaShape`), is about
  // to take its damage, amount known, before it is applied. The facts see the reactor in `target` and `self`, the author in
  // `source`. A reaction can then cancel it for itself alone (`cancelForSelf`), if needed only if the author fails the save it
  // imposes.
  inArea: "the creature, caught in another creature's area activity, is about to take its damage (Insect Shield: reaction window, before application; the author is the source)"
});

/** The moments whose declarations are carried by the EFFECTS of the creature concerned (`via: "effect"`). */
/** §34: the reaction windows before an attack roll (Disadvantage, die removed). */
export const PRE_ATTACK_WINDOWS = Object.freeze(["isAttacked", "enemyAttacks", "allyAttacks"]);

export const BEARER_MOMENTS = Object.freeze(["startOfTurn", "endOfTurn", "isAttacked", "isDamaged", "isHit", "originTurnStart"]);

/** §334: the moments when an effect's bearer takes its damage (`to: "bearer"`) — its turn, or that of the effect's origin. */
export const BEARER_DAMAGE_MOMENTS = Object.freeze(["startOfTurn", "endOfTurn", "originTurnStart"]);

/** The moments published only when a resolution is applied, per target reached. */
export const OUTCOME_MOMENTS = Object.freeze(["hit", "failedSave", "savedSave"]);

/** The moments of the creature's own turn, without an area. */
export const TURN_MOMENTS = Object.freeze(["startOfTurn", "endOfTurn"]);

/** The moments when a creature replays the save of an effect it carries (§16, B4): its turn, or damage taken. */
export const RESAVE_MOMENTS = Object.freeze([...TURN_MOMENTS, "isDamaged"]);

/**
 * A declaration in canonical form: `on` always a list, `if` and `do` always present,
 * `via`: null (the actor's items) or "effect" (the effects the item applied to the creature).
 */
/**
 * The `via: "effect"` declarations that can be restricted by the source of the damage (`by`): §65 `originSide`, the caster or its
 * allies (Suggestion); §294 `otherActivity`, not the activity that applied the effect ("Calcination": "this damage does not end
 * the dismissal").
 */
export const DAMAGED_BY = Object.freeze(["originSide", "otherActivity"]);

/**
 * §294: do two activity references designate the same one? Full UUIDs, or a UUID and a bare id (an effect's
 * `system.origin.activity` can be either). Unknown on one side: no.
 */
export function sameActivity(a, b) {
  if ( !a || !b ) return false;
  return String(a).split(".").at(-1) === String(b).split(".").at(-1);
}

/**
 * §65: does damage come from the effect's caster or one of its allies? Same actor, or tokens of the same disposition
 * (friendly or hostile; a neutral creature is nobody's ally). Unknown author: no.
 * @param {{damager: string|null, origin: string|null, damagerDisposition?: number|null, originDisposition?: number|null}} who
 */
export function damagedByOriginSide({ damager, origin, damagerDisposition=null, originDisposition=null, damagerSide=null, originSide=null }) {
  if ( !damager || !origin ) return false;
  if ( damager === origin ) return true;
  // §181 : quand les factions disent quelque chose de ce couple, elles l'emportent sur les dispositions.
  const relation = (damagerSide && originSide) ? factionRelation(damagerSide, originSide) : null;
  if ( relation ) return relation === "allied";
  return (damagerDisposition !== null) && (damagerDisposition === originDisposition) && [1, -1].includes(damagerDisposition);
}

export function normalize(declaration, extra={}) {
  const on = Array.isArray(declaration.on) ? declaration.on : [declaration.on];
  return { ...extra, ...declaration, on: on.filter(Boolean), if: declaration.if ?? null, do: declaration.do ?? [], via: declaration.via ?? null };
}

/** Does the condition hold, given the facts? */
export function holds(condition, facts={}) {
  if ( (condition === null) || (condition === undefined) || (condition === true) ) return true;
  if ( condition === false ) return false;
  if ( Array.isArray(condition) ) return condition.every(c => holds(c, facts));
  if ( typeof condition !== "object" ) return false;
  return Object.entries(condition).every(([key, arg]) => {
    if ( key === "all" ) return (arg ?? []).every(c => holds(c, facts));
    if ( key === "any" ) return (arg ?? []).some(c => holds(c, facts));
    if ( key === "not" ) return !holds(arg, facts);
    if ( !(key in facts) ) return false;
    const fact = facts[key];
    if ( typeof fact === "function" ) return fact(arg) === true;
    return Array.isArray(arg) ? arg.includes(fact) : fact === arg;
  });
}

/** The fact keys that a condition uses and that the facts do not supply (to validate content). */
export function unknownFacts(condition, facts={}) {
  const out = new Set();
  const walk = c => {
    if ( !c || (typeof c !== "object") ) return;
    if ( Array.isArray(c) ) return c.forEach(walk);
    for ( const [key, arg] of Object.entries(c) ) {
      // `all` / `any` without a list: the condition is malformed, the key is reported rather than raising an exception.
      if ( ["all", "any"].includes(key) ) {
        if ( Array.isArray(arg) ) arg.forEach(walk);
        else if ( (arg !== null) && (arg !== undefined) ) out.add(key);
      }
      else if ( key === "not" ) walk(arg);
      else if ( !(key in facts) ) out.add(key);
    }
  };
  walk(condition);
  return Array.from(out);
}

/** The (canonical) declarations that hook onto this moment and whose condition holds. */
export function select(declarations, moment, facts={}) {
  return declarations.filter(d => d.on.includes(moment) && holds(d.if, facts));
}

/** The steps of a given type of a declaration. */
export function stepsOf(declaration, type) {
  return declaration.do.filter(s => s.type === type);
}
