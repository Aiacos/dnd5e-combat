/**
 * The registry of running triggers: publish a moment, find what hooks into it, and
 * execute here the steps nobody else executes (bonus damage). Reactions
 * (runtime/reactions.mjs) and areas (runtime/areas.mjs) consult the same registry.
 */

import { MODULE_ID } from "../constants.mjs";
import { select, stepsOf, BEARER_MOMENTS, damagedByOriginSide, sameActivity, spareBearer } from "../core/triggers.mjs";
import { declarationsOf, declarationsOfEffects, factsFor, tokenOf, consumedMarks, bonusTurnKey, bonusSpent, bonusKeyOf, declaredRollDisadvantage, declaredRollAdvantage } from "../adapter/triggers.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { comesFromItemEffect, originItemOf } from "../adapter/facts.mjs";
import { usageTokenOf, speakerTokenOf, turnKeyAt } from "../adapter/turn.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { seesBetween } from "../adapter/vision.mjs";
import { tallySettled } from "../core/tally.mjs";
import { turnWentBack } from "../core/turn.mjs";
import { leaveTrace } from "../adapter/traces.mjs";
import { foreignDamageShare, disarmForeignDamageShare } from "../adapter/interop.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { isDeadActor } from "../adapter/death.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, say, locEsc, notice } from "./shared.mjs";
import { takenParts, returnedDamage } from "../core/damage-return.mjs";
import { sideOf } from "../adapter/factions.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { shownActivityOf, usesHolderOf } from "../adapter/uses.mjs";
import { tidyDice } from "../core/formula-tidy.mjs";

/**
 * The save activity to replay: the one the effect comes from, or, for an effect placed by an attack whose save is
 * chained (sibling save, onHit.save, §19.6), its item's save.
 */
export function saveActivityOf(activity) {
  if ( !activity || (activity.type === "save") ) return activity;
  return activity.item?.system?.activities?.find?.(a => a.type === "save") ?? activity;
}

/**
 * C12-e: the save that a `resave` step declares itself (`ability`) — at the activity caster's spell DC.
 * @returns {{ability: string, dc: number}|null}
 */
function declaredSave(activity, ability) {
  const dc = Number(activity?.item?.actor?.system?.attributes?.spell?.dc);
  return Number.isFinite(dc) ? { ability, dc } : null;
}

/** Makes a moment known to the passive consumers (SPEC §5.6). */
export function announce(moment, context) {
  Hooks.callAll(`${MODULE_ID}.${moment}`, context);
}

/**
 * The declarations of `context.actor` that hook into this moment, without publishing anything: those of its
 * items, and, at the "bearer's" moments (its turn, being attacked), those carried by the effects placed on it
 * (`via: "effect"`).
 */
export function matching(moment, context) {
  if ( !context.actor ) return [];
  // §225: nothing hooks across planes (reaction, bonus damage, protecting an ally) — the Ethereal touches only the Ethereal.
  const others = [context.source ?? context.sourceToken, context.target ?? context.targetToken].filter(Boolean);
  if ( others.some(other => !samePlane(context.actor, other)) ) return [];
  // O9h (§363): an effect carried by the author also adds its bonus damage ("Potion of Pugilists":
  // the potion drunk no longer exists).
  const declarations = (BEARER_MOMENTS.includes(moment) || (moment === "preDamageRoll"))
    ? [...declarationsOf(context.actor), ...declarationsOfEffects(context.actor)]
    : declarationsOf(context.actor);
  return select(declarations, moment, factsFor(context));
}

/** Publishes the moment, and returns what hooks into it. */
export function fire(moment, context) {
  announce(moment, context);
  return matching(moment, context);
}

/* -------------------------------------------- */
/*  Bonus damage (preDamageRoll)                */
/* -------------------------------------------- */

const partKey = s => `${s.name}|${s.formula}|${s.damageType}`;

/**
 * On the author's client, before the damage roll dialog: the declarations of their items
 * that hook into `preDamageRoll` add their part to the roll (Hex). A roll applies to all
 * its targets: a part is added only if each target justifies it; otherwise this is said.
 */
function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const source = activity?.actor;
  if ( !activity || !source || !canvas?.ready || !config.rolls ) return true;
  const origin = usageTokenOf(activity);
  // §373: the targets of the hit itself (damage roll card, like maximizeOnHit) first — the user's selection may have been
  // released between the attack and this roll (a grapple after the hit resolved in the meantime); otherwise the selection.
  const carded = (foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [])
    .map(t => fromUuidSync(t.token ?? "", { strict: false })).filter(Boolean);
  const targets = (carded.length ? carded : Array.from(game.user.targets).map(t => t.document)).filter(t => (t !== origin) && t.actor);
  if ( !targets.length ) return true;

  // `damageType: "weapon"`: the weapon's type (first damage part of the activity, otherwise of the item).
  const weaponType = activity.damage?.parts?.[0]?.types?.first?.() ?? Array.from(activity.damage?.parts?.[0]?.types ?? [])[0]
    ?? Array.from(activity.item?.system?.damage?.base?.types ?? [])[0] ?? null;
  const typeOf = s => (s.damageType === "weapon") ? weaponType : s.damageType;
  const perTarget = targets.map(target => fire("preDamageRoll", { actor: source, source, target: target.actor, activity, sourceToken: origin, targetToken: target })
    .flatMap(d => stepsOf(d, "damage").filter(s => typeOf(s)).map(s => ({ name: d.name, formula: s.formula, damageType: typeOf(s),
      once: (d.oncePerTurn === true) ? bonusKeyOf(d) : null, spends: s.spends ?? null, identifier: d.identifier ?? null,
      key: bonusKeyOf(d), ask: d.ask ?? null, item: d.item ?? null }))));
  const candidates = new Map(perTarget.flat().map(s => [partKey(s), s]));
  if ( !candidates.size ) return true;
  // §223 (#12): an optional part (`ask`, Dreadful Strike) is added only if the author accepted it before the roll
  // (adapter/messages.mjs, `rollDamageForAttack`); a roll made outside the engine has none.
  const accepted = config[MODULE_ID]?.acceptedBonuses ?? [];
  for ( const s of Array.from(candidates.values()).filter(x => x.ask && !accepted.includes(x.key)) ) {
    candidates.delete(partKey(s));
    log(`bonus damage: ${s.name} not chosen`);
  }
  if ( !candidates.size ) return true;
  // §19.9: "once per turn" ("Death's Attraction") — any turn, in combat; marked on the author's actor.
  const turn = bonusTurnKey();
  const spent = s => bonusSpent(source, s.once);
  const agreed = Array.from(candidates.values()).filter(s => !spent(s) && perTarget.every(list => list.some(o => partKey(o) === partKey(s))));
  for ( const s of agreed ) {
    if ( s.once && turn ) source.setFlag(MODULE_ID, `oncePerTurn.${s.once}`, turn).catch(err => console.warn(`${MODULE_ID} | ${s.name}: turn not marked`, err));
  }
  for ( const s of Array.from(candidates.values()).filter(spent) ) log(`bonus damage: ${s.name} already used this turn`);
  const dropped = Array.from(candidates.values()).filter(s => !agreed.includes(s) && !spent(s));
  if ( dropped.length ) ui.notifications.warn(loc("DegatsBonusDivergents", { names: dropped.map(s => s.name).join(", ") }));

  // §74: a part that spends an effect of its item carried by the author (Zephyr Strike) — it ends, this damage is the last.
  for ( const s of agreed.filter(x => x.spends) ) {
    const spent = (source.appliedEffects ?? source.effects ?? []).filter(e => comesFromItemEffect(e, s.spends)
      && (!s.identifier || (identifierOf(originItemOf(e) ?? {}).id === s.identifier)));
    for ( const e of spent ) e.delete().then(() => log(`${s.name}: "${e.name}" spent`), err => console.warn(`${MODULE_ID} | ${e.name}: not removed`, err));
  }
  // §223: an optional part spends a use of the activity that keeps count (Dreadful Strike: Wisdom per Long Rest).
  for ( const s of agreed.filter(x => x.ask?.uses) ) {
    const uses = usesHolderOf(shownActivityOf(fromUuidSync(s.item ?? "", { strict: false }), s.ask.uses));
    if ( uses ) uses.spend()
      .then(() => log(`${s.name}: one use spent`), err => console.warn(`${MODULE_ID} | ${s.name}: use not spent`, err));
  }
  const data = activity.getRollData();
  // §438: the formula written with the actor's data and its computed dice groups (`2d(6 + 2 * min(1, floor(5 / 11)))` → `2d6`),
  // for the roll and for what the card shows of it.
  for ( const s of agreed ) {
    try { s.formula = tidyDice(Roll.replaceFormulaData(s.formula, data, { missing: "0" })); } catch {}
  }
  for ( const s of agreed ) {
    // Same shape as a system part (data/activity/base-activity.mjs:933-939); the Critical Hit
    // applies to all the parts of the roll, bonus dice included (2024 rule).
    // §161: a list of types — dnd5e offers the choice at the roll (Conjure Minor Elementals: acid, cold, fire, lightning).
    const types = [s.damageType].flat();
    config.rolls.push({ data, parts: [s.formula], options: { type: types[0], types, properties: [] } });
    log(`bonus damage: ${s.name} +${s.formula} ${types.join("/")}`);
  }
  if ( agreed.length ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.bonuses`, agreed);
  return true;
}

/* -------------------------------------------- */
/*  Creature's turn (startOfTurn, endOfTurn)      */
/* -------------------------------------------- */

/**
 * A turn declaration, apart from the others: a step that fails (effect already removed, roll refused) is logged under the name of
 * the declaration, and the creature's other effects still play their turn.
 */
async function apart(d, token, moment, play) {
  try { await play(); }
  catch(err) { console.error(`${MODULE_ID} | ${d.name}: turn trigger failed on ${token.name} (${moment})`, err); }
}

/**
 * A creature's turn starts or ends, wherever it is: the declarations carried by its effects
 * (Hold Person: "repeats the save at the end of each of its turns") replay the save
 * of the origin activity (adapter/areas.mjs, resaveAgainst). §19: they also deal it damage
 * (`damage`, `to: "bearer"`: Melf's Acid Arrow, "Inflict Nightmares"), then the effect may drop (`remove`).
 * Active GM only; one queue per creature.
 */
function turnMoment(moment, combatant, turnKey=null) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  return enqueue(`turn:${token.uuid}`, async () => {
    // §484: the creature is also `self` — a trait that looks at the creature itself (`self.inSunlight`).
    const declarations = fire(moment, { actor, target: actor, source: null, targetToken: token, self: actor, selfToken: token });
    for ( const d of declarations ) await apart(d, token, moment, async () => {
      // §484: a creature trait (no placed effect) deals it damage on its turn (Sunlight Hypersensitivity).
      if ( d.via === null ) return selfDamage(d, token, moment);
      // §42.2: "at the end of its NEXT turn" — an effect the engine removes itself (`remove`) and that was placed
      // during this turn waits for the next (`placedOn`, noted when placed: runtime/cantrips.mjs).
      if ( turnKey && stepsOf(d, "remove").length && ((await fromUuid(d.effect ?? ""))?.getFlag?.(MODULE_ID, "placedOn") === turnKey) ) return;
      // Repeated save and the bearer's damage together: the damage counts only if the save fails (Thorn of
      // For example: a save at each start of turn, 1d6 damage if it fails; §19.6) — they
      // travel with the save card, which the resolution applies (runtime/engine.mjs, `resave.onFail`).
      const bearerDamage = stepsOf(d, "damage").filter(s => s.to === "bearer");
      const resaves = stepsOf(d, "resave");
      for ( const step of resaves ) {
        const effect = await fromUuid(d.effect ?? "");
        // An effect placed by an HP tier (`hpTiers`) may not name its activity: the item's.
        const origin = (await fromUuid(d.activity ?? "")) ?? (step.ability ? (await fromUuid(d.item ?? ""))?.system?.activities?.contents?.[0] : null);
        const activity = saveActivityOf(origin);
        // C12-e: `ability` — the save the data lacks (Power Word Stun), at the caster's spell DC.
        const declared = step.ability ? declaredSave(activity, step.ability) : null;
        if ( !effect || ((activity?.type !== "save") && !declared) ) { log(`${d.name}: repeated saving throw impossible (effect or save activity not found)`); continue; }
        // §43.1: the counter's failure threshold is reached — no more saves.
        if ( step.tally && tallySettled(effect.getFlag(MODULE_ID, "tally")) ) continue;
        // §403: Compulsion — the save is replayed only after the walk imposed by the caster (runtime/compulsion.mjs).
        if ( step.ifCompelled ) {
          if ( !effect.getFlag(MODULE_ID, "compelled")?.moved ) { log(`${d.name}: ${token.name} was not directed this turn, no saving throw`); continue; }
          await effect.unsetFlag(MODULE_ID, "compelled");
        }
        // §42.2: Fear — the save is replayed only if the creature ends its turn without seeing the caster.
        if ( step.unlessSeesOrigin && (seesBetween(actor, activity.item?.actor ?? null) !== false) ) {
          log(`${d.name}: ${token.name} still sees the caster, no saving throw (${moment})`);
          continue;
        }
        log(`${d.name}: ${token.name} repeats the saving throw (${moment})`);
        const onFail = bearerDamage.length
          ? { item: d.item, identifier: d.identifier, name: d.name, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0,
            steps: bearerDamage.map(({ formula, damageType, activity: id }) => ({ formula, damageType, activity: id })) }
          : null;
        // §37: `keep` (succeeded, the effect stays) and `onFail: "dodge"` (failed, the Dodge action)
        // — Bestow Curse, "Cursed Actions".
        await resaveAgainst(effect, activity, token, moment, { onFail, keep: step.keep === true, dodge: step.onFail === "dodge", tally: step.tally ?? null, save: declared,
          // §495 (block B15): the condition ladder — its rungs are effects of the item carrying the rule.
          stages: step.stages ? { item: d.item ?? null, stages: step.stages, onSuccess: step.onSuccess ?? "down", critEnds: step.critEnds === true } : null });
      }
      if ( resaves.length && bearerDamage.length ) return;
      for ( const step of bearerDamage ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( !effect ) continue;
        const item = await fromUuid(d.item ?? "");
        // §157: a healing activity (Heroism: Temporary Hit Points at the start of each turn) goes through the same path —
        // its dice have the type "temphp" or "healing", which dnd5e applies as healing.
        const heals = (item?.system?.activities?.get?.(step.activity ?? "")?.type === "heal") || ["healing", "temphp"].includes(step.damageType);
        // Issue #40: a dead creature no longer takes the damage of its turn.
        if ( spareBearer({ dead: isDeadActor(actor), heals }) ) { log(`${d.name}: ${token.name} is dead, no damage (${moment})`); continue; }
        await inflict({
          step, item, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0, targetUuid: token.uuid,
          speaker: ChatMessage.implementation.getSpeaker({ token }),
          flavor: loc(heals ? "SoinsPorteur" : "DegatsPorteur", { item: d.name, name: token.name }),
          flags: { bearerDamage: { item: d.identifier, effect: d.effect, moment } }
        });
        log(`${d.name}: ${token.name} takes its damage (${moment})`);
      }
      if ( stepsOf(d, "remove").length ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( effect ) { await effect.delete(); log(`${d.name}: the effect ends on ${token.name} (${moment})`); }
      }
    });
  });
}

/**
 * §484: the damage a trait deals its bearer on its turn (`to: "self"`, no placed effect) —
 * "at the start of its turn in sunlight, it takes 20 radiant damage"; the condition (`if`) was already met by `fire`.
 * A dead creature no longer takes it (issue #40).
 */
async function selfDamage(d, token, moment) {
  const actor = token.actor;
  const steps = stepsOf(d, "damage").filter(s => s.to === "self");
  if ( !steps.length ) return;
  const item = await fromUuid(d.item ?? "");
  for ( const step of steps ) {
    const heals = (item?.system?.activities?.get?.(step.activity ?? "")?.type === "heal") || ["healing", "temphp"].includes(step.damageType);
    if ( spareBearer({ dead: isDeadActor(actor), heals }) ) { log(`${d.name}: ${token.name} is dead, no damage (${moment})`); continue; }
    await inflict({
      step, item, targetUuid: token.uuid,
      speaker: ChatMessage.implementation.getSpeaker({ token }),
      flavor: loc(heals ? "SoinsPorteur" : "DegatsPorteur", { item: d.name, name: token.name }),
      flags: { selfDamage: { item: d.identifier, moment } }
    });
    log(`${d.name}: ${token.name} takes its own trait's damage (${moment})`);
  }
}

/**
 * §334: at the start of a creature's turn, the effects it placed on others (`originTurnStart`, carried by the effect)
 * — their bearer takes its damage ("Submersion", "Whirlwind", "Chewing": "at the start of each of the …'s turns").
 */
function originTurnMoment(combatant) {
  const origin = combatant?.actor;
  const scene = combatant?.token?.parent;
  if ( !origin || !scene ) return;
  const tasks = [];
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( !actor || (actor === origin) || !actor.effects?.size ) continue;
    tasks.push(enqueue(`turn:${token.uuid}`, async () => {
      const declarations = fire("originTurnStart", { actor, target: actor, source: origin, targetToken: token });
      for ( const d of declarations ) await apart(d, token, "originTurnStart", async () => {
        const item = await fromUuid(d.item ?? "");
        if ( !item?.actor || (item.actor.uuid !== origin.uuid) ) return;
        const effect = await fromUuid(d.effect ?? "");
        if ( !effect ) return;
        for ( const step of stepsOf(d, "damage").filter(s => s.to === "bearer") ) {
          // Issue #40: nor those of the turn of the creature that placed the effect.
          if ( spareBearer({ dead: isDeadActor(actor), heals: false }) ) { log(`${d.name}: ${token.name} is dead, no damage (start of ${origin.name}'s turn)`); continue; }
          await inflict({
            step, item, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0, targetUuid: token.uuid,
            speaker: ChatMessage.implementation.getSpeaker({ token }),
            flavor: loc("DegatsPorteur", { item: d.name, name: token.name }),
            flags: { bearerDamage: { item: d.identifier, effect: d.effect, moment: "originTurnStart" } }
          });
          log(`${d.name}: ${token.name} takes its damage (start of ${origin.name}'s turn)`);
        }
      });
    }));
  }
  return Promise.all(tasks);
}

function onTurnChange(combat, prior, current) {
  // "Previous turn": the turn left does not end, the one returned to does not restart — no damage or save replayed.
  if ( turnWentBack(prior, current) ) return;
  // Tasks go back to the router: a queue that fails is logged under the registration's label, instead of being lost.
  return Promise.all([
    turnMoment("endOfTurn", combat.combatants.get(prior?.combatantId), turnKeyAt(combat, prior)),
    turnMoment("startOfTurn", combat.combatants.get(current?.combatantId)),
    originTurnMoment(combat.combatants.get(current?.combatantId))
  ]);
}

/* -------------------------------------------- */
/*  Marks consumed at the attack roll (B10)     */
/* -------------------------------------------- */

/**
 * An attack roll has just been made (`attack` message, hit or miss): the marks it concerns drop — "Tracing
 * Ray" ("the next attack against it"), Vicious Mockery ("its next attack"). They gave their
 * Advantage or Disadvantage to the roll (B6, adapter/triggers.mjs, `declaredAttackModifiers`). Active GM only.
 * The attack that PLACES the mark ("Tracing Ray") places it after its own roll: it does not consume it.
 */
async function onAttackRolled(message) {
  const sourceToken = speakerTokenOf(message);
  if ( !sourceToken ) return;
  const activity = message.getAssociatedActivity?.() ?? null;
  const removed = new Set();
  for ( const t of message.system?.targets ?? [] ) {
    const targetToken = fromUuidSync(t.token, { strict: false });
    for ( const mark of consumedMarks(sourceToken, targetToken, activity) ) {
      if ( removed.has(mark.effect) ) continue;
      removed.add(mark.effect);
      const effect = await fromUuid(mark.effect);
      if ( !effect ) continue;
      await effect.delete();
      log(`${mark.name}: ${mark.bearer}'s mark consumed by ${sourceToken.name}'s attack`);
    }
  }
}

/* -------------------------------------------- */
/*  Damage taken by an effect's bearer (isDamaged)      */
/* -------------------------------------------- */

/**
 * The creature has just lost HP or Temporary Hit Points, wherever the damage comes from (engine
 * resolution, system tray, token bar): `dnd5e.damageActor`, emitted on all clients by
 * `onUpdateHP` (data/actor/templates/attributes.mjs) when the total HP + Temporary Hit Points drops. The effects
 * it carries react (`via: "effect"`): B8 `remove` — the effect ends (Sleep, Hypnotic Pattern);
 * B4 `resave` — it replays the save ("Domination", Hideous Laughter). Active GM only.
 * Limit: at 0 HP with no Temporary Hit Points, HP no longer drop and the hook does not fire.
 */
/** Delay after which the noted author of the last damage no longer counts (HP written by hand afterwards have none). */
const DAMAGER_FRESH_MS = 10000;

/**
 * §65: `dnd5e.preApplyDamage`, on the applying client: the damage's author (the damage message's actor — engine card
 * in `origin`, dnd5e button in `originatingMessage`) goes out in the same write as the HP; unknown (token bar,
 * typed damage), it is cleared. Read by `onDamaged` for the `by: "originSide"` declarations.
 */
function recordDamager(actor, amount, updates, options) {
  if ( !(amount > 0) || !actor ) return;
  const message = [options?.origin, options?.originatingMessage].find(m => m instanceof ChatMessage) ?? null;
  const damager = message?.getAssociatedActor?.() ?? null;
  // §294: the activity the damage comes from, for `by: "otherActivity"`.
  const activity = message?.getAssociatedActivity?.()?.uuid ?? null;
  // §499: the parts taken (type, amount, multiplier), noted when computing that same damage (same `options` object).
  const parts = options ? (CALCULATED.get(options) ?? null) : null;
  updates[`flags.${MODULE_ID}.damagedBy`] = { uuid: damager?.uuid ?? null, activity, at: Date.now(), parts };
}

/** §499: the parts dnd5e computed for an application in progress, by its `options` object (computation then application, same call). */
const CALCULATED = new WeakMap();

/** §499: `dnd5e.calculateDamage` (actor.mjs, after Resistances) — the parts, kept for `recordDamager`. A preview is not applied. */
function noteCalculated(actor, damages, options) {
  if ( options && (typeof options === "object") ) CALCULATED.set(options, takenParts(damages));
}

/** §499: the noted author of the last damage, if fresh: `{ uuid, activity, parts }`, or null. */
function freshDamager(actor) {
  const noted = actor?.getFlag?.(MODULE_ID, "damagedBy");
  return (noted && ((Date.now() - (noted.at ?? 0)) <= DAMAGER_FRESH_MS)) ? noted : null;
}

/**
 * §499 (B19): the same-amount riposte (`damage { to: "source", same }`) — the author of the damage the bearer has just taken
 * takes it in turn (their own Resistances count), card and notice for the whole table.
 */
async function returnDamage(actor, d, step, noted) {
  const attacker = noted?.uuid ? fromUuidSync(noted.uuid, { strict: false }) : null;
  if ( !attacker || (attacker === actor) || (attacker.uuid === actor.uuid) || !((attacker.system?.attributes?.hp?.value ?? 0) > 0) ) {
    log(`${d.name}: no attacker to return the damage to`);
    return;
  }
  const damages = returnedDamage(noted.parts ?? [], { same: step.same, damageType: step.damageType ?? null });
  if ( !damages.length ) { log(`${d.name}: nothing to return (${noted.parts ? "no part kept" : "damage parts unknown"})`); return; }
  const n = damages.reduce((sum, p) => sum + p.value, 0);
  await attacker.applyDamage(damages.map(p => ({ value: p.value, type: p.type })));
  const types = damages.map(p => CONFIG.DND5E.damageTypes?.[p.type]?.label ?? p.type).join(", ");
  log(`${d.name}: ${attacker.name} takes ${n} damage back (${damages.map(p => `${p.value} ${p.type}`).join(", ")})`);
  const attackerToken = tokenOf(attacker);
  await say({ actor }, locEsc("RenvoiDegats.Carte", { item: d.name, name: attacker.name, n, types }),
    { returned: { item: d.identifier, from: actor.uuid, to: attacker.uuid, amount: n, damages } });
  if ( attackerToken ) notice(attackerToken, { key: "RenvoiDegats.Avis", data: { n } }, "info", { all: true, action: "damageReturned", outcome: "success" });
}

/** The disposition of an actor's token on the displayed scene, or null. */
function dispositionOf(actor) {
  const token = actor ? tokenOf(actor) : null;
  return (token?.document ?? token)?.disposition ?? null;
}

/** §181: the side of an actor's token on the displayed scene, or null. */
function sideOfActor(actor) {
  const token = actor ? tokenOf(actor) : null;
  return token ? sideOf(token) : null;
}

/** §65: does the damage the actor has just taken come from the effect's caster or one of their allies? */
function byOriginSide(actor, d) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.uuid || ((Date.now() - (noted.at ?? 0)) > DAMAGER_FRESH_MS) ) return false;
  const damager = fromUuidSync(noted.uuid, { strict: false });
  const origin = d.source ? fromUuidSync(d.source, { strict: false }) : null;
  return damagedByOriginSide({ damager: damager?.uuid ?? null, origin: origin?.uuid ?? null,
    damagerDisposition: dispositionOf(damager), originDisposition: dispositionOf(origin),
    damagerSide: sideOfActor(damager), originSide: sideOfActor(origin) });
}

/** §294: does the damage the actor has just taken come from an activity other than the one that placed the effect? Unknown: yes. */
function byOtherActivity(actor, d) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.activity || ((Date.now() - (noted.at ?? 0)) > DAMAGER_FRESH_MS) ) return true;
  return !sameActivity(noted.activity, d.activity);
}

function onDamaged(actor, changes) {
  if ( !(changes?.total < 0) || !actor ) return;
  const token = tokenOf(actor);
  const tokenDocument = token?.document ?? token ?? null;
  // §499: the activity and the types of the damage taken, if known and fresh (`activity.isMelee`, `damage.hasType`).
  const noted = freshDamager(actor);
  const hurtBy = noted?.activity ? fromUuidSync(noted.activity, { strict: false }) : null;
  const damageTypes = noted?.parts ? [...new Set(noted.parts.map(p => p.type))] : null;
  const declarations = matching("isDamaged", { actor, target: actor, source: null, targetToken: tokenDocument, activity: hurtBy, damageTypes })
    .filter(d => (d.via === "effect") && d.effect)
    // §65: "if you or your allies deal it damage" (Suggestion) — other damage does not count.
    .filter(d => (d.by !== "originSide") || byOriginSide(actor, d))
    .filter(d => (d.by !== "otherActivity") || byOtherActivity(actor, d));
  if ( !declarations.length ) return;
  return enqueue(`damaged:${actor.uuid}`, async () => {
    for ( const d of declarations ) {
      const effect = await fromUuid(d.effect);
      if ( !effect ) continue;   // already removed (two declarations of the same item, or removed in the meantime)
      if ( stepsOf(d, "remove").length ) {
        await effect.delete();
        log(`${d.name}: ends on ${actor.name}, who just took damage`);
        await say({ actor }, locEsc("FinSurDegats", { name: actor.name, item: d.name }),
          { ended: { effect: d.effect, item: d.identifier, actor: actor.uuid, moment: "isDamaged" } });
        continue;
      }
      // Warding Bond (§16.11): the effect's caster takes the same amount (or the declared formula).
      for ( const step of stepsOf(d, "damage").filter(s => s.to === "origin") ) {
        // §156: the engine always shares; a module that would do so too is disarmed beforehand (below), and again here if needed.
        const owner = await disarmForeignDamageShare(effect).catch(() => null);
        if ( owner ) log(`${d.name}: damage sharing by ${owner} disarmed, the engine shares`);
        const origin = await fromUuid(d.source ?? "");
        if ( !origin || (origin === actor) || !((origin.system?.attributes?.hp?.value ?? 0) > 0) ) continue;
        const amount = step.formula ? (await new Roll(step.formula).evaluate()).total : -changes.total;
        if ( !(amount > 0) ) continue;
        await origin.applyDamage(step.formula ? [{ value: amount, type: step.damageType }] : amount);
        log(`${d.name}: ${origin.name} takes ${amount} damage along with ${actor.name}`);
        await say({ actor: origin }, locEsc("PartageDegats", { name: origin.name, item: d.name, n: amount, bearer: actor.name }),
          { shared: { item: d.identifier, from: actor.uuid, to: origin.uuid, amount } });
      }
      // §499 (B19): the same-amount riposte.
      for ( const step of stepsOf(d, "damage").filter(s => (s.to === "source") && ("same" in s)) ) await returnDamage(actor, d, step, noted);
      const resave = stepsOf(d, "resave")[0];
      if ( !resave ) continue;
      const activity = saveActivityOf(await fromUuid(d.activity ?? ""));
      if ( (activity?.type !== "save") || !tokenDocument ) { log(`${d.name}: saving throw on damage impossible (save activity or token not found)`); continue; }
      log(`${d.name}: ${actor.name} repeats the saving throw (damage taken)`);
      await resaveAgainst(effect, activity, tokenDocument, "isDamaged", { advantage: resave.advantage === true });
    }
  });
}

/**
 * §156: an effect whose item declares damage sharing toward the caster (Warding Bond), which another module marks to
 * do so too (BLFX, after the effect's creation): its mark is disarmed — otherwise the caster would pay twice.
 */
async function onEffectMarked(effect) {
  if ( !foreignDamageShare(effect) || (effect.parent?.documentName !== "Actor") ) return;
  const shares = declarationsOfEffects(effect.parent)
    .some(d => (d.effect === effect.uuid) && [d.on].flat().includes("isDamaged") && stepsOf(d, "damage").some(s => s.to === "origin"));
  if ( !shares ) return;
  const owner = await disarmForeignDamageShare(effect);
  if ( owner ) log(`${effect.name}: damage sharing by ${owner} disarmed, the engine shares`);
}

/**
 * §484: on the client that rolls, an ability check (skills, Initiative) or a saving throw with the Disadvantage that a trait
 * declares conditionally (`rollDisadvantage`: "in sunlight, Disadvantage on ability checks"). The dnd5e roll window
 * shows it; the GM can dismiss it by hand.
 */
const onPreRollDisadvantage = kind => config => {
  const actor = config?.subject;
  const roll = config?.rolls?.[0];
  if ( (actor?.documentName !== "Actor") || !roll ) return true;
  const names = declaredRollDisadvantage(actor, kind);
  // The counterpart (`rollAdvantage`): dnd5e itself combines both when the roll has one and the other.
  const favoured = declaredRollAdvantage(actor, kind);
  if ( !names.length && !favoured.length ) return true;
  roll.options ??= {};
  if ( names.length ) roll.options.disadvantage = true;
  if ( favoured.length ) roll.options.advantage = true;
  const what = `${actor.name}: ${kind} (${config.ability ?? config.skill ?? "?"})`;
  if ( names.length ) log(`${what} with Disadvantage (${names.join(", ")})`);
  if ( favoured.length ) log(`${what} with Advantage (${favoured.join(", ")})`);
  return true;
};

export function registerTriggers() {
  route("dnd5e.preRollAbilityCheckV2", onPreRollDisadvantage("check"), { label: "declared Disadvantage on ability checks" });
  route("dnd5e.preRollSavingThrowV2", onPreRollDisadvantage("save"), { label: "declared Disadvantage on saving throws" });
  route("createActiveEffect", onEffectMarked, { executor: true, label: "Warding Bond: foreign damage sharing not disarmed" });
  route("updateActiveEffect", onEffectMarked, { executor: true, label: "Warding Bond: foreign damage sharing not disarmed" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "trigger bonus damage" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "creature's turn: triggers interrupted" });
  route("dnd5e.calculateDamage", noteCalculated, { label: "damage taken: parts not noted" });
  route("dnd5e.preApplyDamage", recordDamager, { label: "damage taken: source not recorded" });
  route("dnd5e.damageActor", onDamaged, { executor: true, label: "damage taken: bearer's effects not handled" });
  // Trace of a use (§16.9, content `trace: true`): not for an area replay or a repeated saving throw.
  // Marks consumed (§16.12, B10): at the attack roll message.
  route("createChatMessage", async message => {
    if ( message.type === "attack" ) return onAttackRolled(message);
    if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
    const effect = await leaveTrace(message);
    if ( effect ) log(`${effect.name}: trace placed on ${effect.parent?.name}`);
  }, { executor: true, label: "trace or mark not handled" });
}
