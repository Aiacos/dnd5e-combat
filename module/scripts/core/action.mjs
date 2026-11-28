/**
 * The action machine (SPEC §13, S2): ONE resolution per action, whatever the activity.
 *
 *     advance(resolution, event) → { resolution, commands }
 *
 * The resolution is serializable data, carried by a single message (the "carrier": the
 * use message, or the attack message when the roll was made off the card). The core
 * does nothing itself: it returns COMMANDS that the runtime executes (ask for a reaction,
 * have saves rolled, apply), and receives EVENTS in return. The state is written
 * before any wait: a GM F5 during a reaction window no longer loses the action.
 *
 * The PLAN says what the activity asks for; a missing step is skipped:
 *   attack   an attack roll decides who is hit
 *   damage   "author": the author rolls the damage on the signal (step = awaitingRolls)
 *            "system": dnd5e rolls it by itself on use (damage and heal activities)
 *   save     { ability, dc, onSave, activity, chained } — `chained`: save imposed by a
 *            hitting attack; it does not reduce the attack's damage
 *   effects  [{ id, activity, when: "always" | "failedSave" | "saved", margin? }] — `saved`: only on a successful
 *            save (content `savedEffects`: Ray of Enfeeblement); `margin: { min?, max? }`: only if the target failed
 *            by `min` or more (and by `max` at most) — "if it fails the roll by 5 or more" (§19.6, content `failMargins`)
 *   choice   { prompt, options: [{ id, label }] } — EXCLUSIVE effects: among `options` (the ids
 *            of `effects`), the author picks one before application (Hex); the other
 *            effects in the plan are not concerned
 *   darts    number of projectiles that hit automatically, to split among the targets (Magic Missile, §16.27):
 *            a target hit by N projectiles takes N times the roll's damage; alone, it takes them all;
 *            several: the author splits them (step "allocate")
 *   steps    [{ when: "always" | "failedSave", if?, type, … }] — outcome steps declared by the
 *            content (core/content.mjs: `move`, `status`, `damage`), executed on application on each
 *            target reached; a `damage` step with `onSave` gets `saved` (did the target succeed?) for its share —
 *            target reached, like effects; `if` (in JSON: a flag would split its dotted keys) is
 *            judged by the adapter at the moment of applying
 *
 * Pure functions, no dependency on Foundry.
 */

import { resolveAttack, beatsAcBy } from "./attack.mjs";
import { nearMissTargets } from "./success-at-cost.mjs";
import { criticalSplit } from "./critical-dice.mjs";
import { SIZES, sizeAtLeast } from "./content/enums.mjs";

/** Version of the schema written in the flags. A resolution of another version is ignored. */
export const RESOLUTION_VERSION = 2;

export const STEPS = Object.freeze({
  AWAITING_ATTACK: "awaitingAttack",
  AWAITING_REACTION: "awaitingReaction",
  AWAITING_ROLLS: "awaitingRolls",
  DONE: "done",
  MISSED: "missed",
  UNDONE: "undone"
});

/**
 * Is the action truly settled: finished or missed? Not a cancelled action — its card may be reused (the GM rolls again),
 * so it keeps what a settled card no longer has to show (ui/chat.mjs, row-based card).
 */
export function settled(step) {
  return (step === STEPS.DONE) || (step === STEPS.MISSED);
}

/** Share of the damage taken on a successful save, according to the activity's `damage.onSave`. */
const ON_SAVE_MULTIPLIER = Object.freeze({ half: 0.5, none: 0, full: 1 });

const same = resolution => ({ resolution, commands: [] });

/* -------------------------------------------- */
/*  Lecture                                     */
/* -------------------------------------------- */

/** A resolution of this schema, or null. */
export function current(resolution) {
  return resolution?.v === RESOLUTION_VERSION ? resolution : null;
}

/**
 * §402: the reason for an automatic success that comes from the creature itself — its type (`types`), or its size
 * (`sizeAtLeast`: "Falling Net", "automatically succeeds if it is Huge or larger"). An unknown size gives nothing.
 * @param {{types?: string[], sizeAtLeast?: string}|null} rule  `saveAutoSuccess` of the entry.
 * @param {{type?: string, size?: string}} creature
 * @returns {string|null}  "type:<type>", "size:<size>", or null.
 */
export function creatureAutoSuccess(rule, { type, size }={}) {
  if ( rule?.types?.includes(type) ) return `type:${type}`;
  if ( rule?.sizeAtLeast && SIZES.includes(size) && sizeAtLeast(size, rule.sizeAtLeast) ) return `size:${size}`;
  return null;
}

/** Those the action reaches: the targets hit if there is an attack roll, all otherwise — except those it cannot affect. */
export function affectedTargets(resolution) {
  const reachable = resolution.targets.filter(t => !t.unaffected);
  // §28: Potent Cantrip — a target missed by the cantrip still takes half the damage. A hit taken by a
  // duplicate (§16.25) or stopped by Total Cover is not a missed roll: nothing for this target.
  const missed = t => (t.hit === false) && (t.reason !== "duplicate") && (t.reason !== "cover");
  return resolution.plan.attack ? reachable.filter(t => (t.hit === true) || (resolution.plan.potent && missed(t))) : reachable;
}

/** Les cibles atteintes dont on attend encore la sauvegarde. */
export function pendingSaves(resolution) {
  if ( !resolution.plan.save ) return [];
  return affectedTargets(resolution).filter(t => t.save === null);
}

/** Must the author of the action roll their damage now? (read on their client, on the flag's signal) */
export function wantsDamageRoll(resolution) {
  return (resolution.step === STEPS.AWAITING_ROLLS) && (resolution.plan.damage === "author") && !resolution.damageRoll;
}

/** A Critical Hit to carry over to the damage roll. */
export function isCriticalHit(resolution) {
  return resolution.targets.some(t => t.hit && t.critical);
}

/**
 * #269 (§545): the hit targets that are Critical Hits, when not all of them are — the damage is then rolled normally and the
 * critical dice apart, for these tokens only. [] when the critical (or its absence) is the same for every hit target.
 * @returns {string[]}  Token uuids.
 */
export function mixedCriticalTokens(resolution) {
  if ( criticalSplit(resolution.targets) !== "mixed" ) return [];
  return resolution.targets.filter(t => t.hit && t.critical).map(t => t.token);
}

/**
 * #269 (§545): the damage one target takes from the resolution's roll — the normal damage, plus the extra critical dice
 * rolled apart (`damageRoll.critical`) when this target is a Critical Hit. Serialized damages in, serialized damages out.
 */
export function damageFor(resolution, token) {
  const roll = resolution.damageRoll;
  if ( !roll ) return [];
  const target = resolution.targets.find(t => t.token === token);
  const critical = (roll.critical?.length && target?.hit && target.critical) ? roll.critical : [];
  return [...(roll.damages ?? []), ...critical];
}

/** Must the author still split their projectiles (Magic Missile, several targets)? */
export function pendingAllocation(resolution) {
  return (resolution.plan.darts > 0) && !resolution.allocated && (resolution.step === STEPS.AWAITING_ROLLS)
    && (affectedTargets(resolution).length > 1);
}

/**
 * A valid split: `count` projectiles, a positive integer per target, the exact sum; otherwise, as best as possible: one each
 * in order, the rest to the first.
 */
export function allocateDarts(count, tokens, wanted={}) {
  const counts = Object.fromEntries(tokens.map(t => [t, Math.max(0, Math.floor(Number(wanted[t]) || 0))]));
  if ( Object.values(counts).reduce((a, b) => a + b, 0) === count ) return counts;
  const out = Object.fromEntries(tokens.map(t => [t, 0]));
  tokens.forEach((t, i) => { if ( i < count ) out[t] = 1; });
  if ( tokens.length ) out[tokens[0]] += Math.max(0, count - tokens.length);
  return out;
}

/** §504 (B24): the two outcomes of an `outcome` choice — the damage, or a grapple in its place. */
export const OUTCOME_DAMAGE = "outcome.damage";
export const OUTCOME_GRAPPLE = "outcome.grapple";

/** Must the author still choose the effect to apply? */
export function pendingChoice(resolution) {
  return !!resolution.plan.choice && (resolution.choice === null) && (resolution.step === STEPS.AWAITING_ROLLS)
    && (affectedTargets(resolution).length > 0);   // an attack that misses everyone has nothing to apply
}

function readyToApply(resolution) {
  return (resolution.step === STEPS.AWAITING_ROLLS) && !resolution.applying
    && !pendingSaves(resolution).length
    && !pendingChoice(resolution)
    && !pendingAllocation(resolution)
    && (!resolution.plan.damage || !!resolution.damageRoll);
}

/** Does an effect or an outcome step apply to this target? "saved": only on a success. */
/** Evasion (§20): a Dexterity save only (not at choice), not chained to an attack, for half damage. */
// §334: `evasion: "any"` (Displacer Beast's Evasion) — any save for half damage, not only Dexterity.
const evasionApplies = (plan, kind) => !!plan.damage && !!plan.save && !plan.save.chained
  && ((kind === "any") || ((plan.save.ability === "dex") && ((plan.save.abilities ?? ["dex"]).every(a => a === "dex"))))
  && ((plan.save.onSave ?? "half") === "half");

const passes = (when, saved) => (when === "always") || ((when === "saved") ? saved : !saved);

/** By how much the target failed the save (DC − total), or null if it succeeded or made none. */
function failMargin(target, plan) {
  if ( !target.save || (target.save.success === true) ) return null;
  if ( target.save.auto ) return Infinity;   // automatic failure (Paralyzed against Dexterity): missed "by everything"
  if ( !Number.isFinite(plan.save?.dc) || !Number.isFinite(target.save.total) ) return null;
  return plan.save.dc - target.save.total;
}

/** Is the requested margin (`margin`) met? With no margin requested, yes. */
const withinMargin = (margin, failed) => !margin || ((failed !== null) && (failed >= (margin.min ?? 0)) && (failed <= (margin.max ?? Infinity)));

/**
 * What each target reached must receive.
 * @returns {Array<{token: string, actor: string, multiplier: number, effects: Array<{id: string, activity: string, if?: string}>,
 *   steps: object[]}>}
 */
export function applicationPlan(resolution) {
  const { plan } = resolution;
  const exclusive = new Set((plan.choice?.options ?? []).map(o => o.id));   // parmi eux, seul l'effet choisi passe
  // §401: one choice per target (`perTarget`) — `resolution.choice` is then { token: id }.
  const chosenFor = token => ((resolution.choice && (typeof resolution.choice === "object")) ? resolution.choice[token] : resolution.choice);
  return affectedTargets(resolution).map(t => {
    const saved = t.save?.success === true;
    const failed = failMargin(t, plan);
    let multiplier = plan.damage ? 1 : 0;
    if ( plan.damage && plan.save && !plan.save.chained && saved ) multiplier = ON_SAVE_MULTIPLIER[plan.save.onSave] ?? 0.5;
    // §28: Potent Cantrip — missed or saved, the target of a cantrip takes half the damage, "but no additional
    // effect". Sculpt Spells: the spared creature succeeds automatically and takes nothing.
    const missed = plan.attack && (t.hit === false);
    const spared = (missed || (plan.save && saved)) && plan.potent;
    if ( plan.damage && spared ) multiplier = 0.5;
    if ( t.sculpted ) multiplier = 0;
    // §20: Evasion — a Dexterity save "to take only half damage": nothing on a success, half
    // on a failure.
    if ( t.evasion && evasionApplies(plan, t.evasion) ) multiplier = saved ? 0 : 0.5;
    if ( saved && (t.save?.interposed === true) && plan.damage ) multiplier = 0;   // §133 : Interposer le bouclier
    if ( t.halved ) multiplier *= 0.5;   // Uncanny Dodge (§16.11): half the attack's damage, rounded by dnd5e
    multiplier *= (t.times ?? 1);         // Magic Missile (§16.27): as many times the damage as projectiles received
    // §504 (B24): the grapple chosen in place of the damage — no damage, the Grappled condition (escape DC declared).
    const grapples = !!plan.choice?.outcome && (chosenFor(t.token) === OUTCOME_GRAPPLE);
    if ( grapples ) multiplier = 0;
    const grappleStep = grapples ? [{ type: "status", status: "grappled", ...(plan.choice.outcome.escapeDc ? { escapeDc: plan.choice.outcome.escapeDc } : {}) }] : [];
    return {
      token: t.token,
      actor: t.actor,
      multiplier,
      ...(t.reduced ? { reduction: t.reduced } : {}),
      effects: spared ? [] : plan.effects
        .filter(e => passes(e.when, saved) && withinMargin(e.margin, failed))
        .filter(e => !exclusive.has(e.id) || (e.id === chosenFor(t.token)))
        // A condition on the target (M3: size gate) travels with the effect; the application judges it.
        .map(({ id, activity, if: condition }) => (condition ? { id, activity, if: condition } : { id, activity })),
      steps: spared ? [] : [...(plan.steps ?? []).filter(s => passes(s.when, saved) && withinMargin(s.margin, failed)).map(({ when, ...step }) => (("onSave" in step) ? { ...step, saved } : step)), ...grappleStep]
    };
  });
}

/* -------------------------------------------- */
/*  Ouverture                                   */
/* -------------------------------------------- */

/**
 * @typedef {object} TargetInput
 * @property {string} token
 * @property {string} actor
 * @property {string} name
 * @property {number|null} [ac]          AC; null = Total Cover.
 * @property {boolean} [defenceless]     Paralyzed or Unconscious within 5 ft: a hit is a Critical Hit.
 * @property {boolean} [canReact]        Has a reaction to offer if hit.
 * @property {number} [duplicates]       Duplicates that can take the hit in its place (Mirror Image, §16.25); 0 if
 *                                       the attacker is not sensitive to them (Blinded, Blindsight, Truesight).
 * @property {string|null} [autoFail]    Condition that makes the plan's save fail automatically.
 * @property {{reason: "type"|"content"|"immune", detail?: string}|null} [unaffected]
 *           The action cannot affect it (§16.8: creature type, content rule, Immunity to all its effects):
 *           it stays in the resolution so that it can be read, but no save, no damage, no effect.
 */

function blankTarget({ token, actor, name, ac=null, defenceless=false, canReact=false, autoFail=null, autoSucceed=null, cover=null, unaffected=null, duplicates=0, times=1, evasion=false, sculpted=false, noCrit=false }) {
  return { token, actor, name, ac, defenceless, canReact, autoFail, autoSucceed, cover, unaffected, duplicates, times, evasion, sculpted, noCrit, halved: false,
    hit: null, critical: false, reason: null, reaction: null, duplicate: null, save: null, damage: null, effects: [] };
}

/**
 * Opens the resolution of an action.
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.carrier           Id of the message that carries the resolution.
 * @param {string|null} data.origin       Id of the use message, if it exists.
 * @param {string} data.activity          UUID of the activity.
 * @param {string|null} data.source       UUID of the actor that acts.
 * @param {object} data.plan              See the header.
 * @param {TargetInput[]} data.targets
 * @param {object} [data.attack]          Attack roll already made (carrier = attack message):
 *                                        `{ roll, messageId, targets }`, like the `attackRolled` event.
 * @param {string|null} [data.choice]     Exclusive effect already chosen by the author ("Grapple" entry of the menu,
 *                                        §15.2): the question will not be asked. Ignored if it is not an option.
 */
export function open({ id, carrier, origin=null, activity, source=null, plan, targets, attack=null, choice=null, allocation=null }) {
  const resolution = {
    v: RESOLUTION_VERSION, id, kind: "action", carrier, origin, activity, source,
    plan: { attack: false, damage: null, save: null, heal: false, choice: null, darts: 0, ...plan, effects: plan.effects ?? [], steps: plan.steps ?? [] },
    step: STEPS.AWAITING_ATTACK,
    attack: null,
    damageRoll: null,
    choice: (choice && plan.choice?.options?.some(o => o.id === choice)) ? choice : null,
    applying: false,
    targets: targets.map(blankTarget),
    allocated: false,
    pending: [],
    log: []
  };
  // Split already made (multiple aiming, §16.27): carried as is, put back in order if needed.
  if ( (resolution.plan.darts > 0) && allocation ) {
    const fixed = allocateDarts(resolution.plan.darts, resolution.targets.map(t => t.token), allocation);
    resolution.targets = resolution.targets.map(t => ({ ...t, times: fixed[t.token] ?? 0 }));
    resolution.allocated = true;
  }
  // A single target: it receives all the projectiles, no question.
  else if ( (resolution.plan.darts > 0) && (resolution.targets.length === 1) ) {
    resolution.targets = [{ ...resolution.targets[0], times: resolution.plan.darts }];
    resolution.allocated = true;
  }
  if ( !resolution.plan.attack ) return afterVerdict(resolution);
  return attack ? judge(resolution, attack) : same(resolution);
}

/* -------------------------------------------- */
/*  Transitions                                 */
/* -------------------------------------------- */

/** The attack roll is known: verdict per target, then a reaction window for those who have one. */
function judge(resolution, { roll, messageId, targets, critMargin=0, atCost=0 }) {
  // The targets of an attack are those designated at the moment of the roll, not at use.
  const judged = resolveAttack(roll, targets.map(blankTarget)).map(t => {
    const auto = t.hit && !t.critical && t.defenceless;
    if ( auto ) return plainHit({ ...t, critical: true, reason: "autoCritical" });
    // §207: "AC + 10" (house rule, `critMargin` setting read at the roll).
    return plainHit(beatsAcBy(t, roll, critMargin) ? { ...t, critical: true, reason: "beatsAc" } : t);
  });
  const pending = judged.filter(t => t.hit && t.canReact).map(t => ({ kind: "reaction", window: "isHit", token: t.token }));
  // Issue #32: `atCost` — the margin of the "success at a cost" for this roll (0: off), judged after reactions (afterReactions).
  const next = { ...resolution, attack: { roll, messageId, ...(critMargin > 0 ? { critMargin } : {}), ...(atCost > 0 ? { atCost } : {}) }, targets: judged, pending };
  if ( !pending.length ) return afterReactions(next);
  return {
    resolution: { ...next, step: STEPS.AWAITING_REACTION },
    commands: [{ type: "askReactions", window: "isHit", tokens: pending.map(p => p.token) }]
  };
}

/**
 * A consulted target has answered: rejudged against its new AC if it reacted. `halve`: its reaction halves the attack's
 * damage (Uncanny Dodge, §16.11) — it stays hit.
 */
function reactionResolved(resolution, { token, used=null, ac, halve=false, uncrit=false, duplicates=null, reduce=0, miss=false, roll=null }) {
  if ( resolution.step !== STEPS.AWAITING_REACTION ) return same(resolution);
  if ( !resolution.pending.some(p => (p.kind === "reaction") && (p.token === token)) ) return same(resolution);
  const targets = resolution.targets.map(t => {
    if ( (t.token !== token) || !used ) return t;
    // §28: Illusory Self — the attack is turned into a miss, with no other roll.
    // §489: a monster's Parry — the attacker rerolled (`roll`): this hit is rejudged with the new roll, for this target only.
    const attackRoll = roll ?? resolution.attack.roll;
    const [judged] = miss ? [{ ...t, hit: false, critical: false, reason: "reaction" }] : resolveAttack(attackRoll, [{ ...t, ac }]);
    // The automatic critical (Paralyzed within 5 ft) survives the rejudging, as at the first verdict (judge).
    const auto = (judged.hit && !judged.critical && t.defenceless) ? { ...judged, critical: true, reason: "autoCritical" } : judged;
    // §207: the margin over AC is rejudged against the new AC (a Shield can drop it below 10).
    const again = beatsAcBy(auto, attackRoll, resolution.attack.critMargin) ? { ...auto, critical: true, reason: "beatsAc" } : auto;
    // §19: a reaction can create duplicates for this hit ("Spectral Shades") — their number is reread after it.
    const count = Number.isInteger(duplicates) ? { duplicates } : {};
    // §19.9: a Critical Hit loses its critical effects (Sentinel at Death's Door).
    const plain = (uncrit && again.critical) ? { critical: false, uncritted: true } : {};
    // §24: Parry — an amount subtracted from the attack's damage.
    const reduced = ((reduce > 0) && (again.hit === true)) ? { reduced: reduce } : {};
    const rerolled = roll ? { rerolled: roll } : {};
    return plainHit({ ...again, ...count, ...plain, ...reduced, ...rerolled, reaction: used, halved: !!halve && again.hit === true });
  });
  const next = { ...resolution, targets, pending: resolution.pending.filter(p => (p.kind !== "reaction") || (p.token !== token)) };
  return next.pending.length ? same(next) : afterReactions(next);
}

/** O9a (§354): a target that takes no Critical Hit (Adamantine Armor) — the critical becomes a normal hit. */
function plainHit(t) {
  return (t.noCrit && t.critical) ? { ...t, critical: false, uncritted: true } : t;
}

/** Duplicates (Mirror Image, §16.25): one d6 per remaining duplicate; a 3 or more, and a duplicate is the one hit. */
export function duplicateTakesHit(dice) {
  return dice.some(d => d >= 3);
}

/**
 * The reactions are settled (Shield first: a hit it makes miss does not reach the duplicates). A target still hit
 * that has duplicates has them play — the runtime rolls the dice and destroys the duplicate that was hit.
 */
function afterReactions(resolution) {
  // Issue #32: success at a cost — on the final AC (Shield included), the targets missed by 1 or 2; the question to the GM, once.
  const near = (resolution.atCost === undefined) ? nearMissTargets(resolution.attack?.roll, resolution.targets, resolution.attack?.atCost ?? 0) : [];
  if ( near.length ) {
    return {
      resolution: { ...resolution, step: STEPS.AWAITING_REACTION, atCost: { asked: near.map(t => t.token) }, pending: [{ kind: "atCost" }] },
      commands: [{ type: "atCostPause", targets: near, total: resolution.attack.roll.total }]
    };
  }
  const waiting = resolution.targets.filter(t => (t.hit === true) && (t.duplicates > 0) && (t.duplicate === null) && !t.unaffected);
  if ( !waiting.length ) return afterVerdict(resolution);
  return {
    resolution: { ...resolution, step: STEPS.AWAITING_REACTION, pending: waiting.map(t => ({ kind: "duplicates", token: t.token })) },
    commands: [{ type: "rollDuplicates", tokens: waiting.map(t => t.token) }]
  };
}

/**
 * Issue #32: the GM offered the success at a cost and the player answered. Accepted: the proposed targets are hit (never by a
 * Critical Hit), the cost noted; otherwise the miss stands. Then the ordinary sequel (duplicates, saves, damage) — only once.
 */
function atCostDecided(resolution, { accepted=false, cost=null }) {
  if ( (resolution.step !== STEPS.AWAITING_REACTION) || !resolution.pending.some(p => p.kind === "atCost") ) return same(resolution);
  const asked = new Set(resolution.atCost?.asked ?? []);
  const targets = accepted ? resolution.targets.map(t => (asked.has(t.token) && (t.hit === false))
    ? plainHit({ ...t, hit: true, critical: false, reason: "atCost" }) : t) : resolution.targets;
  const next = { ...resolution, targets, atCost: { ...resolution.atCost, accepted: !!accepted, cost: accepted ? (cost ?? null) : null },
    pending: resolution.pending.filter(p => p.kind !== "atCost") };
  return next.pending.length ? same(next) : afterReactions(next);
}

/** The dice of a target's duplicates are rolled: a deflected hit becomes a miss, with no damage or effect. */
function duplicatesRolled(resolution, { token, dice=[], messageId=null }) {
  if ( resolution.step !== STEPS.AWAITING_REACTION ) return same(resolution);
  if ( !resolution.pending.some(p => (p.kind === "duplicates") && (p.token === token)) ) return same(resolution);
  const taken = duplicateTakesHit(dice);
  const targets = resolution.targets.map(t => (t.token !== token) ? t : {
    ...t, duplicate: { dice, taken, messageId },
    ...(taken ? { hit: false, critical: false, halved: false, reason: "duplicate" } : {})
  });
  const next = { ...resolution, targets, pending: resolution.pending.filter(p => (p.kind !== "duplicates") || (p.token !== token)) };
  return next.pending.length ? same(next) : afterVerdict(next);
}

/** The verdict is in (or there was no attack roll): saves, damage, application. */
function afterVerdict(resolution) {
  const commands = [];
  if ( resolution.plan.attack ) commands.push({ type: "echo", on: "attack" });
  if ( !affectedTargets(resolution).length ) {
    return { resolution: { ...resolution, step: resolution.plan.attack ? STEPS.MISSED : STEPS.DONE }, commands };
  }
  // Automatic failures (paralyzed, stunned… on Strength or Dexterity): recorded at once, no roll requested.
  let next = { ...resolution, step: STEPS.AWAITING_ROLLS };
  if ( next.plan.save ) {
    const affected = new Set(affectedTargets(next).map(t => t.token));
    // §28 (before the automatic failures): Sculpt Spells — the spared creatures "automatically succeed on their saving throw".
    next = { ...next, targets: next.targets.map(t => (affected.has(t.token) && t.sculpted && (t.save === null))
      ? { ...t, save: { total: null, success: true, messageId: null, auto: "sculpted" } } : t) };
    // §402: an automatic success by creature type (`saveAutoSuccess`: Flesh to Stone — "a Construct automatically succeeds");
    // the effect on a success stays applied, the damage follows the save's rule.
    next = { ...next, targets: next.targets.map(t => (affected.has(t.token) && t.autoSucceed && (t.save === null))
      ? { ...t, save: { total: null, success: true, messageId: null, auto: t.autoSucceed } } : t) };
    next = { ...next, targets: next.targets.map(t => (affected.has(t.token) && t.autoFail && (t.save === null))
      ? { ...t, save: { total: null, success: false, messageId: null, auto: t.autoFail } } : t) };
    const waiting = pendingSaves(next);
    if ( waiting.length ) commands.push({ type: "requestSaves", targets: waiting.map(({ token, actor, name }) => ({ token, actor, name })) });
  }
  // Projectiles to split (Magic Missile): the question is put to the author, like an effect choice.
  if ( pendingAllocation(next) ) {
    next = { ...next, pending: [...next.pending, { kind: "allocate" }] };
    commands.push({ type: "askAllocation", count: next.plan.darts, targets: affectedTargets(next).map(({ token, name }) => ({ token, name })) });
  }
  // Exclusive effects: the question is put to the author, the "pending" state is written beforehand (resumed after an F5).
  next = askChoiceWhenDue(next, commands);
  return settle(next, commands);
}

/**
 * The effect-choice question, when its time has come. §401: a choice per target (`perTarget`) waits for the end of the saves —
 * the question names only the targets that failed (those that succeed receive nothing), and does not open at the same time as the
 * save windows; if none failed, there is nothing to ask.
 */
function askChoiceWhenDue(next, commands) {
  if ( !pendingChoice(next) || next.pending.some(p => p.kind === "choice") ) return next;
  const choice = next.plan.choice;
  if ( choice.perTarget ) {
    if ( pendingSaves(next).length ) return next;
    const failed = affectedTargets(next).filter(t => !next.plan.save || (t.save?.success !== true));
    if ( !failed.length ) return { ...next, choice: {} };
    commands.push({ type: "askChoice", prompt: choice.prompt ?? null, options: choice.options, perTarget: failed.map(({ token, name }) => ({ token, name })) });
    return { ...next, pending: [...next.pending, { kind: "choice" }] };
  }
  commands.push({ type: "askChoice", prompt: choice.prompt ?? null, options: choice.options, ...(choice.roll ? { roll: true } : {}) });
  return { ...next, pending: [...next.pending, { kind: "choice" }] };
}

/** The author has split their projectiles: the split is put back in order (exact sum), then carried by each target. */
function allocated(resolution, { counts={} }) {
  if ( !pendingAllocation(resolution) ) return same(resolution);
  const tokens = affectedTargets(resolution).map(t => t.token);
  const fixed = allocateDarts(resolution.plan.darts, tokens, counts);
  const targets = resolution.targets.map(t => (t.token in fixed) ? { ...t, times: fixed[t.token] } : t);
  return settle({ ...resolution, targets, allocated: true, pending: resolution.pending.filter(p => p.kind !== "allocate") });
}

/** The author has chosen the effect: an id outside the options, or an answer that is not expected, changes nothing. */
function choiceMade(resolution, { id, choices=null }) {
  if ( !pendingChoice(resolution) ) return same(resolution);
  const known = x => resolution.plan.choice.options.some(o => o.id === x);
  // §401: one choice per target — a target with no answer receives the first option.
  if ( resolution.plan.choice.perTarget && choices && (typeof choices === "object") ) {
    const first = resolution.plan.choice.options[0]?.id ?? null;
    const map = Object.fromEntries(affectedTargets(resolution).map(t => [t.token, known(choices[t.token]) ? choices[t.token] : first]));
    return settle({ ...resolution, choice: map, pending: resolution.pending.filter(p => p.kind !== "choice") });
  }
  if ( !known(id) ) return same(resolution);
  return settle({ ...resolution, choice: id, pending: resolution.pending.filter(p => p.kind !== "choice") });
}

/** Is everything in? Then apply — only once. */
function settle(resolution, commands=[]) {
  if ( !readyToApply(resolution) ) return { resolution, commands };
  return {
    resolution: { ...resolution, applying: true },
    commands: [...commands, { type: "apply", entries: applicationPlan(resolution) }]
  };
}

/** The first roll stands: a second roll by the same actor is ignored, it is up to the GM to cancel and correct. */
function saveRolled(resolution, { actor, total, messageId, mode=null, resisted=false, interposed=false, atCost=null }) {
  if ( (resolution.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.save ) return same(resolution);
  const waiting = pendingSaves(resolution).find(t => t.actor === actor);
  if ( !waiting ) return same(resolution);
  // §18.9: a Legendary Resistance turns the failure into a success (the total stays that of the roll).
  // §133: `interposed` — Interpose Shield, reaction taken on a success: no damage.
  // §231: `mode` — the d20 rolled with Advantage or Disadvantage, for the visual feedback.
  // Issue #32: `atCost` — the success at an accepted cost (`{ cost }`) turns the failure into a success, total unchanged.
  const save = { total, success: resisted || !!atCost || (total >= resolution.plan.save.dc), messageId, ...(mode ? { mode } : {}), ...(resisted ? { resisted: true } : {}),
    ...(interposed ? { interposed: true } : {}), ...(atCost ? { atCost: { cost: atCost.cost ?? null } } : {}) };
  // §487: a success opens the "succeeds on a save against" window ("Mage's Retaliation"), with no wait.
  const commands = save.success ? [{ type: "window", window: "savesAgainst", tokens: [waiting.token] }] : [];
  // §401: once the last save has arrived, the per-target choice can be requested.
  const next = askChoiceWhenDue({ ...resolution, targets: resolution.targets.map(t => t === waiting ? { ...t, save } : t) }, commands);
  return settle(next, commands);
}

/**
 * `critical` (#269, §545): the extra critical dice, rolled apart when only some hit targets are Critical Hits — added at
 * application to those targets only (`damageFor`).
 */
function damageRolled(resolution, { messageId, damages, critical=null }) {
  if ( (resolution.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.damage || resolution.damageRoll ) return same(resolution);
  return settle({ ...resolution, damageRoll: { messageId, damages, ...(critical?.length ? { critical } : {}) } });
}

/**
 * What was applied. `before` / `after`: HP read by the adapter (null if no damage);
 * `effects`: UUIDs of the effects created. This log is what makes cancelling possible.
 * `extra`: damage taken outside the targets, because of the action (retort, §16.9: the attacker hits a creature under
 * Fire Shield) — `{ token, actor, before, after, name }`, logged to be cancelled along with it.
 */
function applied(resolution, { entries, extra=[] }) {
  if ( !resolution.applying || (resolution.step !== STEPS.AWAITING_ROLLS) ) return same(resolution);
  const byToken = new Map(entries.map(e => [e.token, e]));
  const log = [...resolution.log];
  const targets = resolution.targets.map(t => {
    const entry = byToken.get(t.token);
    if ( !entry ) return t;
    let damage = null;
    if ( entry.before && entry.after ) {
      damage = { applied: (entry.before.value + entry.before.temp) - (entry.after.value + entry.after.temp) };
      log.push({ at: "applyDamage", token: t.token, actor: entry.actor, before: entry.before, after: entry.after });
    }
    for ( const effect of entry.effects ?? [] ) log.push({ at: "applyEffect", token: t.token, actor: entry.actor, effect });
    return { ...t, damage, effects: entry.effects ?? [] };
  });
  for ( const e of extra ) {
    if ( e.before && e.after ) log.push({ at: "applyDamage", token: e.token, actor: e.actor, before: e.before, after: e.after, kind: "retaliation", name: e.name ?? null });
  }
  const commands = [];
  if ( resolution.damageRoll ) commands.push({ type: "echo", on: "damage" });
  const hurt = targets.filter(t => t.damage?.applied > 0).map(t => t.token);
  if ( hurt.length ) commands.push({ type: "window", window: "isDamaged", tokens: hurt });
  commands.push({ type: "cleanup" });
  return { resolution: { ...resolution, step: STEPS.DONE, applying: false, targets, log }, commands };
}

/**
 * What must be undone to cancel, from the most recent to the oldest.
 * @returns {{hp: Array<{actor: string, restore: object}>, effects: string[]}}
 */
export function undoPlan(resolution) {
  const log = [...resolution.log].reverse();
  return {
    hp: log.filter(l => l.at === "applyDamage").map(l => ({ actor: l.actor, restore: l.before })),
    effects: log.filter(l => l.at === "applyEffect").map(l => l.effect)
  };
}

function undone(resolution) {
  if ( resolution.step !== STEPS.DONE ) return same(resolution);
  const commands = resolution.damageRoll ? [{ type: "echo", on: "damage" }] : [];
  return { resolution: { ...resolution, step: STEPS.UNDONE }, commands };
}

const TRANSITIONS = Object.freeze({
  attackRolled: (resolution, event) => (resolution.step === STEPS.AWAITING_ATTACK) ? judge(resolution, event) : same(resolution),
  reactionResolved, duplicatesRolled, atCostDecided, saveRolled, damageRolled, choiceMade, allocated, applied, undone
});

/**
 * @param {object} resolution
 * @param {{type: string}} event
 * @returns {{resolution: object, commands: object[]}}  `resolution` is the SAME object if the event changes nothing.
 */
export function advance(resolution, event) {
  // Only the table's own keys are transitions: `constructor`, `toString`… would be read there by inheritance.
  if ( !Object.hasOwn(TRANSITIONS, event?.type) ) return same(resolution);
  return TRANSITIONS[event.type](resolution, event);
}
