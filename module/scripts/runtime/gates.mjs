/**
 * Gates (SPEC §16, B5 bis): a use is SUSPENDED before it takes place, someone answers, then it
 * resumes or falls. Same mechanism as legality (runtime/turn.mjs): `dnd5e.preUseActivity` is synchronous,
 * we cancel, we wait, we relaunch the same use marked `gated`. On the client of the one who acts.
 *
 *  - `isAttacked` (Sanctuary): the target bears an effect whose item declares `{ type: "ward" }` — the attacker
 *    must succeed on the saving throw of the sibling activity (Wisdom, caster's DC) or loses their attack / harmful
 *    spell. They choose another target or give up: the use is cancelled, they start again if they want.
 *  - `castsSpell` (Counterspell): each hostile creature, within range of its Reaction and that sees the caster, is
 *    consulted (reaction window, adapter/reactions.mjs); its Reaction targets the caster and runs its course
 *    (Constitution saving throw resolved by the engine); on a failure, the spell dissipates — nothing is cast, nothing
 *    is spent (2024 rule: the spell slot is not lost, the action is — not counted here, limit).
 *    §66: a Reaction that declares `counter` (2014-style counterspell) asks for no saving throw: the spell, at the level
 *    where it is about to be cast, fails automatically up to the level of the counterspell, otherwise on a check by the one
 *    countering (DC 10 + level), made on their side (adapter/reactions.mjs); the gate reads its answer.
 *  - §283: `spellFailure` (Slow) — even before Counterspell, a spell cast by the bearer of an effect that hampers it (somatic
 *    component) fails on a d100 ≤ the chance: nothing is cast or spent, like a countered spell (same limit: the action is not
 *    counted). The roll is shown in chat, awaited (Dice So Nice), the failure seen and heard by the whole table.
 */

import { MODULE_ID } from "../constants.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { rangeIssue } from "../core/range.mjs";
import { usageTokenOf as usageToken, distanceBetween, rangeOf, currentTurnKey } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { reactionOptions, askReaction, setReactionSpellGate } from "../adapter/reactions.mjs";
import { spellCommandOf } from "../adapter/pilot.mjs";
import { matching } from "./triggers.mjs";
import { attackReactors, askAttackReactions, rememberAttackMods } from "./reactions.mjs";
import { keepPendingAttack } from "./actions.mjs";
import { seersOf, foretellFor } from "../adapter/portent.mjs";
import { route } from "./router.mjs";
import { log, loc, say, locEsc, notice, waitForDice } from "./shared.mjs";
import { isSpellCast, scrollReadingFor, scrollActivityOf } from "../adapter/scrolls.mjs";
import { castLevelFor } from "../adapter/counter.mjs";
import { absorbPlan } from "../core/counter.mjs";
import { wasteUse } from "./turn.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { settledResolution } from "../adapter/messages.mjs";
import { suspendUse } from "./suspended-uses.mjs";
import { identifierOf, contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { failureFor, spellFailed } from "../core/spell-failure.mjs";
import { attractorOf } from "../core/defenses.mjs";
import { rangedDefensesOf } from "../adapter/defenses.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { relaunchUse } from "./relaunch.mjs";


/** A chat card that says what the gate decided (read by the scenarios: flag `gate`); `details`: extra lines. */
function tell(actor, key, data, gate, details=[]) {
  return say({ actor }, [locEsc(key, data), ...details], { gate });
}

/** A spell that "harms": an attack, or an activity that deals damage. */
const isHarmful = activity => (activity.type === "attack") || ((activity.damage?.parts?.length ?? 0) > 0);

/* -------------------------------------------- */
/*  Sanctuaire : sauvegarde de l'attaquant       */
/* -------------------------------------------- */

/** The wards (`ward`) that the designated targets set against this use. */
function wardsAgainst(activity, origin, targets) {
  if ( !isHarmful(activity) ) return [];
  const out = [];
  for ( const token of targets ) {
    const target = token.actor;
    if ( !target ) continue;
    for ( const d of matching("isAttacked", { actor: target, target, source: origin.actor, activity, sourceToken: origin, targetToken: token }) ) {
      for ( const step of stepsOf(d, "ward") ) out.push({ declaration: d, step, token });
    }
  }
  return out;
}

/** The attacker makes the saving throw of each ward; false as soon as they fail one. */
async function passWards(activity, origin, wards) {
  for ( const { declaration, step, token } of wards ) {
    // §298 (pass C3): Sanctuary — "the creature must choose a new target or lose the attack or spell". Failed against this
    // target, a new attempt against it in the same turn is lost automatically (the action with it), without a new saving throw.
    // In combat only: out of combat, there is no turn to reset the mark.
    const mark = game.combat?.started ? `${token.uuid}|${currentTurnKey()}` : null;
    if ( mark && (origin.actor.getFlag(MODULE_ID, "wardFailed") === mark) ) {
      await tell(origin.actor, "PorteAttaquePerdue", { name: origin.name, target: token.name, item: declaration.name },
        { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, passed: false, again: true });
      await wasteUse(activity);
      return false;
    }
    const item = await fromUuid(declaration.item ?? "");
    const save = (step.activity ? item?.system.activities?.get(step.activity) : null)
      ?? item?.system.activities?.find(a => a.type === "save") ?? null;
    const ability = save?.save?.ability?.first?.() ?? Array.from(save?.save?.ability ?? [])[0];
    const dc = save?.save?.dc?.value;
    if ( !save || !ability || !Number.isFinite(dc) ) { log(`${declaration.name}: ward without a readable saving throw, ignored`); continue; }
    const rolls = await origin.actor.rollSavingThrow({ ability, target: dc }, { configure: false });
    const total = rolls?.[0]?.total ?? null;
    const success = (total !== null) && (total >= dc);
    log(`${declaration.name}: ${origin.name} attacks ${token.name}, ${ability} saving throw ${total} vs DC ${dc}: ${success ? "succeeded" : "failed"}`);
    if ( !success ) {
      if ( mark ) await origin.actor.setFlag(MODULE_ID, "wardFailed", mark);
      await tell(origin.actor, "PorteAttaquePerdue", { name: origin.name, target: token.name, item: declaration.name },
        { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, total, dc, passed: false });
      return false;
    }
    await tell(origin.actor, "PorteAttaqueTenue", { name: origin.name, target: token.name, item: declaration.name },
      { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, total, dc, passed: true });
  }
  return true;
}

/* -------------------------------------------- */
/*  Counterspell: reaction window of the hostiles */
/* -------------------------------------------- */

/**
 * §157: the creatures targeted by a use with no attack roll, hostile to the user, that have an `isTargeted` Reaction
 * for it (Shield against Magic Missile), with their options.
 */
function targetedCandidates(activity, origin, targets, { isSpell=false, castLevel=null }={}) {
  const out = [];
  for ( const token of targets ) {
    if ( !token.actor || !areEnemies(token, origin) ) continue;
    if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    const actor = token.actor;
    const options = reactionOptions(actor, "isTargeted",
      matching("isTargeted", { actor, target: actor, source: origin.actor, activity, sourceToken: origin, targetToken: token, castLevel }))
      .flatMap(o => o.cancel ? absorbOption(o, activity, targets, { isSpell, castLevel: castLevel ?? 0 }) : (activity.type === "attack") ? [] : [o]);
    if ( options.length ) out.push({ token, actor, options });
  }
  return out;
}

/**
 * §344: a Reaction that cancels the spell (Rod of Absorption, "Staff of the Thaumaturge") — only against a spell of level 1 or
 * higher that targets only the bearer, with no area; its activity is played at the spell's level (the Rod spends that many
 * levels, the Staff gains that many charges).
 */
function absorbOption(option, activity, targets, { isSpell, castLevel }) {
  if ( !isSpell ) return [];
  const reaction = fromUuidSync(option.activity ?? "", { strict: false });
  // "While you hold": the Staff is a weapon, which the "carried" guard (adapter/triggers.mjs) lets through — held and attuned.
  const item = reaction?.item;
  if ( !item || (item.system?.equipped === false) || ((item.system?.attunement === "required") && (item.system?.attuned !== true)) ) return [];
  const use = reaction?.consumption?.targets?.find(t => t.type === "itemUses");
  const costs = Number(use?.value) > 0;
  const plan = absorbPlan({ castLevel, targets: targets.length, area: !!activity.target?.template?.type, costs,
    usesLeft: reaction?.item?.system?.uses?.value ?? null });
  return plan ? [{ ...option, usage: { ...(option.usage ?? {}), scaling: plan.scaling } }] : [];
}

/**
 * §157: each targeted creature reacts, one after the other; the Reaction is resolved before the use (its effect already counts).
 * §344: false if a Reaction cancelled the spell (absorbed).
 */
async function passTargeted(activity, origin, candidates, { auto }) {
  for ( const { token, actor, options } of candidates ) {
    log(`${origin.name} uses ${activity.item.name} on ${token.name}: ${token.name} can react (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid, options, target: origin.uuid, auto,
      prompt: { key: "ReactionCible", data: { caster: origin.name, spell: activity.item.name } }
    });
    if ( answer?.message ) await settledResolution(answer.message);
    if ( answer?.cancel ) {
      log(`${token.name} absorbs ${origin.name}'s ${activity.item.name} (${answer.name}): the spell is canceled`);
      notice(token, { key: "Retour.SortAbsorbe", data: { spell: activity.item.name, item: answer.name ?? "" } }, "refused",
        { all: true, action: "spellAbsorbed", outcome: "failure" });
      return false;
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  §283: spell failure (Slow)                   */
/* -------------------------------------------- */

/** The failure rule that the caster's effects set against this spell, or null. */
function failureAgainst(activity, actor) {
  const rules = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.spellFailure : null;
    if ( rule ) rules.push({ ...rule, name: item.name });
  }
  return rules.length ? failureFor(rules, activity.item.system?.properties) : null;
}

/** The failure d100, shown and awaited; true if the spell goes through. */
async function passFailure(activity, origin, rule) {
  const roll = await new Roll("1d100").evaluate();
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: origin }),
    flavor: loc("PorteEchecJet", { item: rule.name, chance: rule.chance, spell: activity.item.name })
  });
  await waitForDice(message);
  const failed = spellFailed(rule.chance, roll.total);
  log(`${origin.name} casts ${activity.item.name} under ${rule.name}: d100 ${roll.total} vs ${rule.chance}% -> ${failed ? "the spell fails" : "the spell goes through"}`);
  await tell(origin.actor, failed ? "PorteSortRate" : "PorteSortPasse", { name: origin.name, spell: activity.item.name, item: rule.name, roll: roll.total, chance: rule.chance },
    { kind: "spellFailure", spell: identifierOf(activity.item).id, caster: origin.uuid, roll: roll.total, chance: rule.chance, failed });
  if ( failed ) notice(origin, { key: "Retour.SortRate", data: { spell: activity.item.name } }, "refused", { all: true, action: "spellFails", outcome: "failure" });
  return !failed;
}

/** Who can react to the casting of this spell, and with what. `castLevel`: its casting level (facts `spell.castLevel…`, §481). */
function counterCandidates(activity, origin, castLevel=null) {
  const out = [];
  const factors = readUnitFactors();
  for ( const token of origin.parent?.tokens ?? [] ) {
    if ( (token === origin) || !token.actor || token.hidden || !areEnemies(token, origin) ) continue;
    if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    const actor = token.actor;
    const options = reactionOptions(actor, "castsSpell",
      matching("castsSpell", { actor, target: actor, source: origin.actor, activity, sourceToken: origin, targetToken: token, castLevel }));
    // Within range of THEIR Reaction (60 ft for Counterspell), measured in 3D.
    const inRange = options.filter(o => {
      const reaction = fromUuidSync(o.activity, { strict: false });
      return !reaction || (rangeIssue(distanceBetween(token, origin), rangeOf(reaction), factors) === null);
    });
    if ( inRange.length ) out.push({ token, actor, options: inRange });
  }
  return out;
}

/**
 * The candidates are consulted one after the other; true if the spell goes through, false if it is dispelled.
 * `castLevel`: the level at which the spell is about to be cast (§66, 2014-style counterspell).
 */
async function passCounters(activity, origin, candidates, { auto, castLevel }) {
  for ( const { token, actor, options } of candidates ) {
    log(`${origin.name} casts ${activity.item.name}: ${token.name} can react (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid, options, target: origin.uuid, auto, castLevel,
      prompt: { key: "ReactionSort", data: { caster: origin.name, spell: activity.item.name } }
    });
    if ( !answer?.message ) continue;
    // §66: 2014-style counterspell — no saving throw to wait for, the one countering decided on their side.
    if ( answer.counter ) {
      const c = answer.counter;
      const failed = c.dissipated === true;
      log(`${token.name} reacts (${answer.name}): ${activity.item.name} at level ${c.castLevel}, countered at level ${c.level} — `
        + `${c.auto ? "no roll" : `check ${c.total ?? "?"} vs DC ${c.dc}`} -> ${failed ? "spell countered" : "the spell goes through"}`);
      const details = [c.auto
        ? loc("PorteContreAuto", { spell: activity.item.name, castLevel: c.castLevel, item: answer.name, level: c.level })
        : loc("PorteContreTest", { reactor: token.name, total: c.total ?? "—", dc: c.dc, spell: activity.item.name, castLevel: c.castLevel })];
      await tell(origin.actor, failed ? "PorteSortDissipe" : "PorteSortTenu", { name: origin.name, spell: activity.item.name, reactor: token.name, item: answer.name },
        { kind: "counterspell", spell: identifierOf(activity.item).id, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed,
          counter: { castLevel: c.castLevel, level: c.level, auto: c.auto, dc: c.dc, total: c.total ?? null } }, details);
      if ( failed ) return false;
      continue;
    }
    const resolution = await settledResolution(answer.message);
    const target = resolution?.targets.find(t => t.token === origin.uuid) ?? resolution?.targets[0] ?? null;
    const failed = target?.save?.success === false;
    log(`${token.name} reacts (${answer.name}): saving throw ${target?.save?.total ?? "?"} -> ${failed ? "spell countered" : "the spell goes through"}`);
    await tell(origin.actor, failed ? "PorteSortDissipe" : "PorteSortTenu", { name: origin.name, spell: activity.item.name, reactor: token.name, item: answer.name },
      { kind: "counterspell", spell: identifierOf(activity.item).id, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed });
    if ( failed ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/* -------------------------------------------- */
/*  O8g (§350) : lire un parchemin de sort       */
/* -------------------------------------------- */

/**
 * A scroll of a level the reader cannot cast yet: the check (DC 10 + level) of their spellcasting ability, or of Intelligence
 * (Arcana) via Use Magic Device; on a failure, the spell vanishes from the scroll — the action is lost, the scroll too.
 * Returns true if the spell goes off.
 */
async function passScrollCheck(activity, origin, reading) {
  const actor = origin.actor;
  const rolls = reading.skill
    ? await actor.rollSkill({ skill: reading.skill, ability: reading.ability, target: reading.dc }, { configure: false })
    : await actor.rollAbilityCheck({ ability: reading.ability, target: reading.dc }, { configure: false });
  const total = rolls?.[0]?.total ?? null;
  // The verdict waits for the Dice So Nice animation (DAS rule): the check's message is the last of this reader bearing this total.
  const card = (total === null) ? null : game.messages.contents.findLast(m => (m.speaker?.actor === actor.id) && (m.rolls?.[0]?.total === total));
  if ( card ) await waitForDice(card);
  const ok = (total !== null) && (total >= reading.dc);
  log(`${origin.name} reads ${scrollActivityOf(activity)?.item?.name ?? activity.item.name} (level ${reading.level}): check ${total ?? "—"} vs DC ${reading.dc} -> ${ok ? "the spell goes through" : "the spell vanishes from the scroll"}`);
  if ( ok ) return true;
  const item = scrollActivityOf(activity)?.item ?? activity.item;
  notice(origin, { key: "Retour.ParcheminPerdu", data: { item: item.name } }, "refused", { all: true, action: "scrollLost", outcome: "failure" });
  await wasteUse(activity);
  const quantity = Number(item.system?.quantity) || 1;
  if ( quantity > 1 ) await item.update({ "system.quantity": quantity - 1 });
  else await item.delete();
  return false;
}

/* -------------------------------------------- */
/*  O8d (§347) : Bouclier d'attraction          */
/* -------------------------------------------- */

/**
 * "When a ranged weapon attack targets a creature within 3 m of you, the curse makes you the target": for each target, the
 * nearest bearer (alive, neither the attacker nor already targeted) takes its place. Returns the replacements { from, to }.
 */
function attractions(activity, origin, targets, attackMode) {
  if ( !isRangedWeaponAttack(activity, attackMode) || !targets.length ) return [];
  const factors = readUnitFactors();
  const bearers = (origin.parent?.tokens ?? []).filter(t => t.actor && !t.hidden && !isObjectToken(t) && (t !== origin)
    && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && rangedDefensesOf(t.actor).some(r => r.attract));
  const out = [];
  for ( const target of targets ) {
    const taken = new Set([...targets.map(t => t.id), ...out.map(o => o.to)]);
    const id = attractorOf(bearers.filter(b => !taken.has(b.id)).map(b => {
      const distance = distanceBetween(b, target);
      const max = Math.max(...rangedDefensesOf(b.actor).map(r => Number(r.attract) || 0));
      return { id: b.id, distance: distance.value, within: rangeIssue(distance, { value: max, units: "ft" }, factors) === null };
    }));
    if ( id ) out.push({ from: target.id, to: id });
  }
  return out;
}

/** Remplace des cibles de l'utilisateur (Token#setTarget, comme la porte) ; rend la nouvelle liste d'ids. */
function swapTargets(ids, swaps) {
  const next = ids.map(id => swaps.find(s => s.from === id)?.to ?? id).filter((id, i, all) => all.indexOf(id) === i);
  next.forEach((id, i) => canvas.tokens.get(id)?.setTarget(true, { releaseOthers: i === 0 }));
  return next;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  if ( usageConfig[MODULE_ID]?.gated || !activity?.item || !canvas?.ready ) return true;
  const origin = usageToken(activity);
  if ( !origin?.actor ) return true;
  // O8g (§350): a scroll outside the reader's spell list is unintelligible; too high for them, a check first.
  const reading = scrollReadingFor(activity, origin.actor);
  if ( reading?.access === "refused" ) {
    log(`${origin.name}: ${scrollActivityOf(activity)?.item?.name ?? activity.item.name} is unintelligible (${reading.identifier} is not on their spell lists)`);
    notice(origin, { key: "Retour.ParcheminIllisible", data: { item: scrollActivityOf(activity)?.item?.name ?? activity.item.name } }, "refused");
    return false;
  }
  const scrollCheck = (reading?.access === "check") ? reading : null;
  let targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  // O8d (§347): the bearer of the Shield of Missile Attraction becomes the target, before any other window.
  const attracted = (activity.type === "attack") ? attractions(activity, origin, targets, usageConfig[MODULE_ID]?.attackMode ?? null) : [];
  if ( attracted.length ) {
    swapTargets(Array.from(game.user.targets).map(t => t.id), attracted);
    for ( const { from, to } of attracted ) {
      const bearer = origin.parent.tokens.get(to);
      log(`${origin.name}'s ${activity.item.name}: the Shield of Missile Attraction pulls the attack from ${origin.parent.tokens.get(from)?.name} to ${bearer?.name}`);
      if ( bearer ) notice(bearer, { key: "Retour.CibleAttiree", data: { item: activity.item.name } }, "refused", { all: true, action: "attackAttracted" });
    }
    targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  }
  const wards = wardsAgainst(activity, origin, targets);
  // A spell cast as a Reaction (Counterspell itself, Shield) does not go through this gate: §403, its own gate before it goes off
  // (`passReactionSpell`, called by the reaction window), which allows the counter-Counterspell.
  // Commanding the objects of an already cast spell ("Move Lights", §16.17) is not casting a spell: nothing to counter.
  // §119: a chained projectile (Magic Missile, Scorching Ray) or a bounce (Chromatic Orb) is not a new spell:
  // Counterspell is played at casting, once (it used to be offered again at each chained projectile).
  const ours = usageConfig[MODULE_ID] ?? {};
  const isSpell = isSpellCast(activity.item) && (activity.activation?.type !== "reaction") && !spellCommandOf(activity)
    && !ours.projectileOf && !ours.leap;
  const auto = usageConfig[MODULE_ID]?.autoReact ?? false;
  // §32: Subtle Spell — "without verbal, somatic or material components": nobody sees the spell being cast, no Counterspell.
  const subtle = (usageConfig[MODULE_ID]?.metamagic ?? []).includes("subtle");
  if ( isSpell && subtle ) log(`${origin.name} casts ${activity.item.name} with Subtle Spell: no Counterspell possible`);
  // §481: the casting level, from the usage configuration — known to the reaction conditions (`spell.castLevelAtMost`).
  const castLevel = isSpell ? castLevelFor(activity, usageConfig) : null;
  let candidates = (isSpell && !subtle) ? counterCandidates(activity, origin, castLevel) : [];
  const failure = isSpell ? failureAgainst(activity, origin.actor) : null;
  // `autoReact: "none"` (scenarios): nobody reacts — and the use is not suspended at all, otherwise
  // the caller (connector) loses control before the relaunch (area never placed, message never followed).
  if ( (auto === "none") && candidates.length ) {
    log(`${origin.name} casts ${activity.item.name}: ${candidates.map(c => c.token.name).join(", ")} — reaction declined automatically (scenario)`);
    candidates = [];
  }
  // §34: the reaction window before the attack roll ("Shadow Dodge", Warding Flare). Not for an attack made as a
  // Reaction (Opportunity Attack: `flags.reaction` of its card) — suspending it would break the window that launched it.
  const preAttack = (activity.type === "attack") && (activity.activation?.type !== "reaction") && (auto !== "none") && !messageConfig?.data?.flags?.[MODULE_ID]?.reaction;
  const reactors = preAttack ? attackReactors(activity, origin, targets) : [];
  // §36: Portent — a diviner who sees the attacker (or the attacker themself) can replace the roll's d20; "before the roll". Only
  // when the targets are designated: aim mode relaunches the use, the question would be asked twice.
  const seers = (preAttack && targets.length) ? seersOf(origin) : [];
  // §157: a use with no attack roll that targets creatures (a Magic Missile projectile) — their `isTargeted` window.
  // §344: also a spell with an attack roll, for the reactions alone that cancel it (Rod of Absorption).
  const targeted = (((activity.type !== "attack") || isSpell) && (auto !== "none") && targets.length)
    ? targetedCandidates(activity, origin, targets, { isSpell, castLevel }) : [];
  if ( !scrollCheck && !failure && !wards.length && !candidates.length && !reactors.length && !seers.length && !targeted.length ) return true;

  // The caster's targets, to restore before the relaunch: a Reaction played on this same client (the GM who controls
  // both) replaced them with its own (seen on 2026-09-24: the Ray relaunched with no target, or on the caster).
  const chosen = Array.from(game.user.targets).map(t => t.id);
  // The relaunch is registered: whoever chains uses (a spell's projectiles) waits for it instead of believing the refusal.
  suspendUse(activity.uuid, (async () => {
    if ( scrollCheck && !(await passScrollCheck(activity, origin, scrollCheck)) ) return;
    // §298: the failed (Slow) or countered spell does not go off, but its action is lost.
    if ( failure && !(await passFailure(activity, origin, failure)) ) return wasteUse(activity);
    if ( wards.length && !(await passWards(activity, origin, wards)) ) return;
    if ( candidates.length && !(await passCounters(activity, origin, candidates, { auto, castLevel })) ) return wasteUse(activity);
    // §344: the absorbed spell dissipates; the committed resources are lost.
    if ( targeted.length && !(await passTargeted(activity, origin, targeted, { auto })) ) return wasteUse(activity);
    let mods = reactors.length ? await askAttackReactions(activity, origin, reactors, { auto }) : null;
    const foretold = seers.length ? await foretellFor(origin, { kind: "attack", item: activity.item.name, auto }) : null;
    if ( foretold ) {
      mods = { disadvantage: false, penalty: 0, bonus: 0, names: [], ...(mods ?? {}), foretold: foretold.value };
      log(`${foretold.seer}: Portent, the d20 of ${origin.name}'s attack will be ${foretold.value}`);
    }
    if ( preAttack ) rememberAttackMods(activity.uuid, mods);
    // O8d (§347): a reactor that became the target ("Anti-missile Shield") replaces the original target.
    if ( mods?.intercepts?.length ) {
      chosen.splice(0, chosen.length, ...swapTargets(chosen, mods.intercepts));
      for ( const { to } of mods.intercepts ) {
        const catcher = origin.parent.tokens.get(to);
        if ( catcher ) notice(catcher, { key: "Retour.CibleInterceptee", data: { item: activity.item.name } }, "gain", { all: true, action: "attackIntercepted" });
      }
    }
    const now = Array.from(game.user.targets).map(t => t.id);
    if ( chosen.length && ((now.length !== chosen.length) || now.some(id => !chosen.includes(id))) ) {
      // Token#setTarget, like the Reaction itself (adapter/reactions.mjs): the V14 core no longer has User#updateTokenTargets.
      chosen.forEach((id, i) => canvas.tokens.get(id)?.setTarget(true, { releaseOthers: i === 0 }));
    }
    // An attack requested without a dialog (quick click, connector) chains its roll without a dialog too:
    // dnd5e relaunches `rollAttack` with its own (attack.mjs, _triggerSubsequentActions), turn.mjs reads the intent.
    if ( activity.type === "attack" ) {
      keepPendingAttack(activity, {
        mode: usageConfig[MODULE_ID]?.attackMode ?? null,
        fast: dialogConfig?.configure === false,
        confirmed: usageConfig[MODULE_ID]?.confirmed === true   // the range accepted at use holds for the roll
      });
    }
    // `subsequentActions: false` is the setting of a caller that meant to chain the roll itself (connector,
    // use-activity): the cancellation took control away from it, the relaunch lets dnd5e chain (without a dialog, above).
    const { subsequentActions, ...rest } = usageConfig;
    return relaunchUse(activity, { ...rest, [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}), confirmed: true, gated: true } }, dialogConfig, messageConfig);
  })().catch(err => { console.error(`${MODULE_ID} | gate interrupted`, err); return null; }));
  return false;
}

/**
 * §403: counter-Counterspell — "a spell cast as a Reaction can be countered". An actor's Reaction spell (Counterspell, Shield)
 * is subject to the same Counterspells as the others, before it goes off; countered, its Reaction is lost (`wasteUse`) and it does
 * not go off. The original caster, who already cast this turn, usually has only one Reaction: the chain stops by itself.
 */
async function passReactionSpell(activity, actor) {
  const origin = usageToken(activity) ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !origin?.parent || !canvas?.ready ) return true;
  // §481: the level of the Reaction spell (the item's, or that of the feature that casts it), known to the
  // `spell.castLevel…` conditions.
  const castLevel = castLevelFor(activity);
  const candidates = counterCandidates(activity, origin, castLevel);
  if ( !candidates.length ) return true;
  const passed = await passCounters(activity, origin, candidates, { auto: false, castLevel });
  if ( !passed ) await wasteUse(activity);
  return passed;
}

export function registerGates() {
  setReactionSpellGate(passReactionSpell);
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "gates: Sanctuary, Counterspell, pre-attack reactions, Portent" });
}
