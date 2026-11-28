/**
 * Action economy of a combatant (SPEC §6): what it has left to spend this turn, what
 * an activity costs, and what is wrong if it tries it anyway. The mode is flexible: the
 * engine flags, the player confirms, nothing is ever blocked. Pure functions.
 */

import { fitMultiattack, attackCount } from "./multiattack.mjs";

/** Budget reset at the start of the combatant's turn (the Reaction is recovered at that moment). */
/**
 * Initiative of a summoned creature that "shares your Initiative and acts right after you" (§16.13): just below that
 * of the summoner, and above anyone who acts after it — half the gap to the next one, 0.01 at most.
 * @param {number} summoner      Summoner's Initiative.
 * @param {number[]} others      Initiatives of the other combatants.
 * @returns {number}
 */
export function initiativeAfter(summoner, others) {
  const below = (others ?? []).filter(n => Number.isFinite(n) && (n < summoner));
  const next = below.length ? Math.max(...below) : -Infinity;
  const gap = Number.isFinite(next) ? (summoner - next) / 2 : 0.01;
  return Math.round((summoner - Math.min(0.01, gap)) * 10000) / 10000;
}

/**
 * Has the combat just gone back ("previous turn", "previous round")? `combatTurnChange` fires in both directions: going
 * back, `prior` is the turn being left and `current` the one being returned to — no turn ends or starts, the GM
 * corrects a pass made too early. At combat start (`prior` without a round), nothing went back.
 * @param {{round: number|null, turn: number|null}|null} prior
 * @param {{round: number|null, turn: number|null}|null} current
 * @returns {boolean}
 */
export function turnWentBack(prior, current) {
  if ( !Number.isFinite(prior?.round) || !Number.isFinite(current?.round) ) return false;
  if ( current.round !== prior.round ) return current.round < prior.round;
  return Number.isFinite(prior.turn) && Number.isFinite(current.turn) && (current.turn < prior.turn);
}

/**
 * @param {{reactions?: number}} [options]  §19.6: reactions per round ("up to three reactions per round, but no more than one
 *                                          per turn"); beyond one, only one per game turn (`reactedAt`).
 */
export function freshBudget({ reactions=1 }={}) {
  return {
    action: 1, bonus: 1, reaction: reactions, attacks: { granted: 0, used: 0 },
    perTurnReaction: reactions > 1,   // several reactions per round: not two in the same game turn
    reactedAt: null,                  // the game turn (combat.round.turn) of the last reaction
    onlyCantrips: null,   // §503 (B23): after an `afterUse.onlyCantrips` feature — { castTime, item }: no more spells this turn, except a cantrip
    dashed: false, dashes: 0, disengaged: false, dodging: false, slotCast: false,   // §402: `dashes`, the turn's Dashes
    lightAttack: false,
    loadedFired: false,   // O5a (§339): a Loading weapon has fired in the current Attack action ("only one piece of ammunition per action")   // §15.2: a Light weapon attack made in the Attack action opens the off-hand attack
    nickUsed: false,      // Nick: the off-hand attack, without a Bonus Action, once per turn
    offhandUsed: false,   // §532: the Light property's extra attack (off-hand) was made this turn, with Nick or with the Bonus Action
    readied: false,       // Intention (Ready): a prepared action, played later by the Reaction
    multi: null,  // M1 (§18.6): Multiattack opened this turn — { plan, used: [keys of each use] }
    climbed: 0,  // P2: height climbed by a staircase or a ladder, in grid units (the core does not keep it: "displace")
    stood: 0,    // §17.2: movement spent to stand up (half the speed), in grid units
    jumped: 0,   // §208: movement given back by a fixed jump (Jump spell, Boots: 9 m for 3 m), in grid units
    fixedJump: false,   // §208: this turn's fixed jump is taken ("once on each of its turns")
    jumpDouble: false,  // §208: jump distance doubled for the turn (Step of the Wind)
    flurry: 0,      // §24: free unarmed strikes opened by Flurry of Blows
    flurryAny: false,   // §27: … weapon attacks included (War Priest)
    bonusMove: 0,   // §20: movement opened in addition this turn ("Rogue's Retreat": half the Speed), in grid units
    limited: 0,     // §157: limited action (Haste) — a single weapon attack, Dash, Disengage or Hide, when the action is taken
    stopped: false   // §16.59: turn ended by a command (Command) — no more movement
  };
}

/** Is a reaction available in this game turn? (Several per round: not two in the same turn.) */
export function reactionAvailable(budget, turnKey=null) {
  if ( !budget ) return true;
  if ( budget.reaction < 1 ) return false;
  return !(budget.perTurnReaction && turnKey && (budget.reactedAt === turnKey));
}

/** What a dnd5e activation type costs. Everything else (minute, legendary, special…) is outside the budget. */
export function costOf(activationType) {
  return ["action", "bonus", "reaction"].includes(activationType) ? activationType : null;
}

/**
 * What moving a movable area (`movable`, §16.14) costs: the activation of the spell's activity (Moonbeam: a Magic
 * action), or nothing when the rule makes it follow the caster's movement (`cost: "none"`, Conjure Celestial: "when
 * you move on your turn, you can also move the Cylinder").
 * @param {{cost?: "none"}|null} rule  the `movable` declaration
 * @param {string} activationType      the activity's activation
 * @returns {"action"|"bonus"|"reaction"|null}
 */
export function zoneMoveCost(rule, activationType) {
  return (rule?.cost === "none") ? null : costOf(activationType);
}

/**
 * @typedef {object} UseRequest
 * @property {"action"|"bonus"|"reaction"|"free"|null} cost   `free`: a gesture the intention declares free (§16.27).
 * @property {boolean} weaponAttack   Weapon or unarmed attack: part of the Attack action (Multiattack).
 * @property {boolean} usesSpellSlot  Spends a spell slot (2024 rule: only one per turn).
 * @property {number} [attackCost]    §298: attacks of the Attack action that the use takes (default 1; Improved War Magic: 2).
 * @property {boolean} [lightWeapon]  Weapon with the Light property.
 * @property {boolean} [offhand]      Off-hand attack (dnd5e `offhand` mode): costs the Bonus Action.
 * @property {boolean} [nick]         The combatant has the Nick mastery property for this weapon.
 * @property {object} [multiattack]    M1: the monster's Multiattack plan (core/multiattack.mjs), if it can be read.
 * @property {string[]} [keys]         M1: keys of this use (id, English name, activity, source spell).
 * @property {boolean} [opensMultiattack]  M1: it is the Multiattack item itself.
 * @property {string|null} [basic]     §157: the basic action this use takes (`dash`, `hide`…).
 * @property {boolean} [utilize]       B10 (§157): the Utilize action (a nonmagical object), which Haste's limited action allows.
 */

/**
 * What this use really costs, given the turn: the off-hand attack
 * with Nick is made within the Attack action (free), once per turn; otherwise the Bonus Action.
 */
export function effectiveCost(budget, request) {
  // §532: Nick moves the single Light extra attack into the Attack action; once made (either way), any further one costs the Bonus Action.
  if ( request.offhand ) return (request.nick && !budget.nickUsed && !budget.offhandUsed) ? null : "bonus";
  // §236: Fleet Step — Step of the Wind offered by a Bonus Action taken earlier this turn.
  if ( (request.fleetStep === "free") && budget.fleetStep ) return null;
  return request.cost;
}

/**
 * §157: what Haste's limited action allows — "one attack (one only), Dash, Disengage, Hide, Utilize". The
 * basic actions by name; the attack is read from `weaponAttack`, Utilize (a nonmagical object) from `utilize`.
 */
export const LIMITED_ACTION_KINDS = Object.freeze(["dash", "disengage", "hide"]);

/** §157: does the limited action (Haste) cover this use, the turn's action being taken? */
function coveredByLimitedAction(budget, request) {
  if ( !((budget.limited ?? 0) >= 1) || (budget.action >= 1) || (request.cost !== "action") ) return false;
  return request.weaponAttack || (request.utilize === true) || LIMITED_ACTION_KINDS.includes(request.basic);
}

/** Is this weapon attack covered by an Attack action that is already paid for? */
function coveredByAttackAction(budget, request) {
  // §298: `attackCost` — a spell cast in place of two attacks (Improved War Magic) takes two.
  return request.weaponAttack && (request.cost === "action") && (budget.attacks.used + (request.attackCost ?? 1) <= budget.attacks.granted);
}

/**
 * M1: does this use fit in a Multiattack that is already open? Returns the number of attacks counted.
 * @returns {{attacks: number}|null}
 */
function coveredByMultiattack(budget, request) {
  if ( !budget.multi || !request.keys || (request.cost !== "action") ) return null;
  return fitMultiattack(budget.multi.plan, [...budget.multi.used, request.keys]);
}

/**
 * What is wrong if the combatant attempts this use. Empty list = all is well.
 * @param {object} budget
 * @param {UseRequest} request
 * @param {{isOwnTurn: boolean}} context
 * @returns {Array<"notYourTurn"|"noAction"|"noBonus"|"noReaction"|"slotAlreadyCast"|"noLightAttack"|"lightExtraUsed"|"loading">}
 */
export function checkUse(budget, request, { isOwnTurn, turnKey=null }) {
  const issues = [];
  // 2024 rule (Light property): you must have attacked with a Light weapon in the Attack action this turn.
  if ( request.offhand && !budget.lightAttack ) issues.push("noLightAttack");
  // §532 (SRD 5.2, Light and Nick): one extra attack per turn — Nick only moves it into the Attack action, it does not add one.
  // Forceable like every budget issue (a feature granting a separate Bonus Action attack, e.g. Dual Wielder, is not modelled).
  if ( request.offhand && (budget.offhandUsed || budget.nickUsed) ) issues.push("lightExtraUsed");
  // O5a (§339): Loading — "only one piece of ammunition when you use an action […] to fire, regardless of the number of attacks".
  if ( request.loading && budget.loadedFired && coveredByAttackAction(budget, request) ) issues.push("loading");
  // A gesture the intention declares free (§16.27: a chained ray, a rebound) asks for nothing — no action, no turn, no slot.
  if ( request.cost === "free" ) return issues;
  const cost = effectiveCost(budget, request);
  if ( !cost ) return (request.offhand && !isOwnTurn) ? ["notYourTurn", ...issues] : issues;
  if ( (cost !== "reaction") && !isOwnTurn ) issues.push("notYourTurn");
  if ( (cost === "action") && (budget.action < 1) && !coveredByAttackAction(budget, request) && !coveredByMultiattack(budget, request)
    && !coveredByLimitedAction(budget, request) ) issues.push("noAction");
  if ( (cost === "bonus") && (budget.bonus < 1) ) issues.push("noBonus");
  if ( (cost === "reaction") && !reactionAvailable(budget, turnKey) ) issues.push("noReaction");
  if ( request.usesSpellSlot && isOwnTurn && budget.slotCast ) issues.push("slotAlreadyCast");
  // §503 (B23): "no other spell this turn, except a cantrip that takes an action" (after a feature that says so).
  const only = (isOwnTurn && budget.onlyCantrips) ? onlyCantripsIssue(budget.onlyCantrips, request.spell, cost) : null;
  if ( only ) issues.push(only);
  return issues;
}

/**
 * §503 (B23): the refusal of a spell after a feature that leaves only cantrips (`afterUse.onlyCantrips`), or null. `spell`:
 * `{ level }` of the spell used (null: not a spell); `cost`: its casting time (action, bonus, reaction), after Metamagic.
 * @param {{castTime?: "action"|"bonus"|null}} rule
 * @returns {"onlyCantrips"|"onlyCantripsAction"|"onlyCantripsBonus"|null}
 */
export function onlyCantripsIssue(rule, spell, cost) {
  if ( !rule || !spell ) return null;
  const key = rule.castTime ? `onlyCantrips${rule.castTime[0].toUpperCase()}${rule.castTime.slice(1)}` : "onlyCantrips";
  if ( (Number(spell.level) || 0) > 0 ) return key;
  if ( rule.castTime && (cost !== rule.castTime) ) return key;
  return null;
}

/**
 * Debits a use. Spending beyond the budget (confirmed by the player) does not go below
 * zero: the budget says what is left, not what was owed.
 * @param {object} budget
 * @param {UseRequest} request
 * @param {{isOwnTurn: boolean, attacksPerAction: number}} context
 */
export function spendUse(budget, request, { isOwnTurn, attacksPerAction, turnKey=null }) {
  if ( request.offhand ) {
    const cost = effectiveCost(budget, request);
    return cost ? { ...budget, bonus: Math.max(0, budget.bonus - 1), offhandUsed: true } : { ...budget, nickUsed: true, offhandUsed: true };
  }
  if ( !request.cost ) return budget;
  if ( (request.fleetStep === "free") && budget.fleetStep ) return { ...budget, fleetStep: false };
  const next = { ...budget, attacks: { ...budget.attacks } };
  if ( request.lightWeapon && request.weaponAttack && (request.cost === "action") ) next.lightAttack = true;
  // M1: Multiattack. Opened by their item (the action paid, nothing used) or by the first use that
  // fits in the plan; the following ones go through without an action as long as they fit.
  const plan = request.multiattack ?? null;
  const covered = coveredByMultiattack(budget, request);
  const opening = !covered && plan && (request.cost === "action") && (budget.action >= 1)
    && (request.opensMultiattack ? { attacks: 0 } : (request.keys ? fitMultiattack(plan, [request.keys]) : null));
  if ( covered ) {
    next.multi = { ...budget.multi, used: [...budget.multi.used, request.keys] };
    next.attacks = { granted: budget.attacks.granted, used: covered.attacks };
  }
  else if ( opening ) {
    next.action = budget.action - 1;
    next.multi = { plan, used: request.opensMultiattack ? [] : [request.keys] };
    next.attacks = { granted: attackCount(plan), used: opening.attacks };
  }
  else if ( coveredByAttackAction(budget, request) ) {
    next.attacks.used += (request.attackCost ?? 1);
    if ( request.loading ) next.loadedFired = true;
  }
  // §157: Haste's limited action — a single attack, even with Extra Attack.
  else if ( coveredByLimitedAction(budget, request) ) {
    next.limited = 0;
    if ( request.weaponAttack ) next.attacks = { granted: 1, used: 1 };
  }
  else {
    next[request.cost] = Math.max(0, budget[request.cost] - 1);
    if ( request.cost === "reaction" ) next.reactedAt = turnKey;
    // Beyond an open Multiattack (confirmed anyway), their counter stays that of the plan.
    if ( request.cost === "action" ) next.loadedFired = !!(request.loading && request.weaponAttack);
    if ( request.weaponAttack && (request.cost === "action") && !budget.multi ) {
      next.attacks = { granted: Math.max(1, attacksPerAction), used: Math.min(Math.max(1, attacksPerAction), request.attackCost ?? 1) };
    }
  }
  if ( request.usesSpellSlot && isOwnTurn ) next.slotCast = true;
  // §236: Fleet Step — a Bonus Action (not Step of the Wind itself) opens a free Step of the Wind for this turn.
  if ( (request.fleetStep === "opens") && (request.cost === "bonus") ) next.fleetStep = true;
  return next;
}

/**
 * Gives back a use cancelled before any roll (§15.1): the GAP between the budget before and
 * after the spending is given back, applied to the current budget — what was spent since stays spent.
 * @param {object} current  Budget of the moment.
 * @param {object} before   Budget just before the spending.
 * @param {object} after    Budget just after.
 */
export function refundUse(current, before, after) {
  const next = { ...current, attacks: { ...current.attacks } };
  for ( const key of ["action", "bonus", "reaction", "limited"] ) {
    next[key] = Math.max(0, (current[key] ?? 0) + ((before[key] ?? 0) - (after[key] ?? 0)));
  }
  // §19.6: the returned reaction no longer counts for its game turn — unless another has been taken since (it set its mark).
  const reactionBack = (before.reaction ?? 0) > (after.reaction ?? 0);
  if ( reactionBack && (current.reactedAt === after.reactedAt) ) next.reactedAt = before.reactedAt ?? null;
  const usedDelta = (after.attacks?.used ?? 0) - (before.attacks?.used ?? 0);
  next.attacks.used = Math.max(0, next.attacks.used - usedDelta);
  // The first attack had opened the Attack action: if none of it is used any more, it is closed again.
  if ( (after.attacks?.granted !== before.attacks?.granted) && (next.attacks.used === 0) ) next.attacks.granted = before.attacks?.granted ?? 0;
  for ( const flag of ["slotCast", "nickUsed", "offhandUsed", "lightAttack", "fleetStep"] ) if ( !before[flag] && after[flag] ) next[flag] = false;
  if ( before.fleetStep && !after.fleetStep ) next.fleetStep = true;   // §236: the offered Step of the Wind is returned
  // M1: the returned use leaves the Multiattack; if it had opened it and nothing is left of it, it is closed again.
  if ( after.multi && (JSON.stringify(after.multi) !== JSON.stringify(before.multi)) && current.multi ) {
    const added = after.multi.used.at(-1);
    const used = [...current.multi.used];
    const at = (after.multi.used.length > (before.multi?.used.length ?? 0)) ? used.findIndex(u => JSON.stringify(u) === JSON.stringify(added)) : -1;
    if ( at >= 0 ) used.splice(at, 1);
    next.multi = (!before.multi && !used.length) ? null : { ...current.multi, used };
    if ( !next.multi ) next.attacks = { ...(before.attacks ?? { granted: 0, used: 0 }) };
    else next.attacks.used = fitMultiattack(next.multi.plan, used)?.attacks ?? used.length;
  }
  return next;
}

/** The turn state that each basic action that sets one sets. */
export const BASIC_ACTION_FLAGS = Object.freeze({ dash: "dashed", disengage: "disengaged", dodge: "dodging", ready: "readied" });

/**
 * A basic action taken through its item (§15.2: Dash, Disengage, Dodge): the action is
 * spent and the turn state set. Unlike the tracker's buttons, a use confirmed
 * despite an exhausted budget (flexible mode) sets the state anyway: the player chose.
 * @param {"dash"|"disengage"|"dodge"} kind
 */
export function basicAction(budget, kind) {
  const flag = BASIC_ACTION_FLAGS[kind];
  if ( !flag ) return budget;
  const mark = b => (kind === "dash") ? addDash(b) : { ...b, [flag]: true };
  // §157: the action taken, Haste's limited action pays for Dash or Disengage.
  if ( (budget.action < 1) && ((budget.limited ?? 0) >= 1) && LIMITED_ACTION_KINDS.includes(kind) ) return mark({ ...budget, limited: 0 });
  return mark({ ...budget, action: Math.max(0, budget.action - 1) });
}

/** §402: how many times the turn has taken Dash (a budget from before this count only has the `dashed` flag). */
export function dashCount(budget) {
  return (Number(budget?.dashes) > 0) ? Number(budget.dashes) : (budget?.dashed ? 1 : 0);
}

/**
 * §402: one more Dash — each adds the Speed to the turn's movement (PHB 2024: "gain additional movement
 * equal to your Speed"; "Swift Retreat" as a Bonus Action then Dash with the action: three times the Speed).
 */
export function addDash(budget) {
  return { ...budget, dashed: true, dashes: dashCount(budget) + 1 };
}

/** Dash: an action against doubled movement. With no action available, nothing changes. */
export function dash(budget) {
  if ( budget.dashed || (budget.action < 1) ) return budget;
  return addDash({ ...budget, action: budget.action - 1 });
}

/** Disengage: an action, and the turn's movement no longer provokes an Opportunity Attack. */
export function disengage(budget) {
  if ( budget.disengaged || (budget.action < 1) ) return budget;
  return { ...budget, action: budget.action - 1, disengaged: true };
}

/** Dodge: an action; the system's native "Dodge" condition holds until the start of the next turn. */
export function dodge(budget) {
  if ( budget.dodging || (budget.action < 1) ) return budget;
  return { ...budget, action: budget.action - 1, dodging: true };
}

/** Manual correction (click on a pip): spent ↔ available. */
export function toggleResource(budget, key) {
  if ( !["action", "bonus", "reaction"].includes(key) ) return budget;
  return { ...budget, [key]: budget[key] > 0 ? 0 : 1 };
}

/**
 * Standing up (PHB 2024, Prone: "spend an amount of movement equal to half your Speed to stand up").
 * @param {{speed: number, remaining: number}} state  Speed and movement remaining this turn (Infinity outside combat).
 * @returns {{cost: number, issue: "noSpeed"|"noMovement"|null}}
 */
export function standUpCost({ speed, remaining, fixed=null }) {
  if ( !(speed > 0) ) return { cost: 0, issue: "noSpeed" };
  // §134: Athlete, Leap — "you can stand up using only 1.5 m of movement" (`fixed`, in the unit of the speed).
  const cost = Number.isFinite(fixed) ? Math.min(speed / 2, fixed) : speed / 2;
  return { cost, issue: remaining + 1e-6 < cost ? "noMovement" : null };
}

/** Movement allowed this turn, in the unit of the speed: doubled by Dash, plus what an effect opens (Retreat, §20). */
export function movementAllowance(budget, speed) {
  return speed * (1 + dashCount(budget)) + (Number(budget.bonusMove) || 0);
}
