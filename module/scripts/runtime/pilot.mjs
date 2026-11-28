/**
 * Piloted objects (SPEC §16.15, B19): Spiritual Weapon, Flaming Sphere, Bigby's Hand. The caster commands them during
 * THEIR turn; a command costs their Bonus Action and opens a bounded movement plus one use.
 *
 *  - skipped turn: the object is placed in the combat right after its caster (§16.13), but the core skips its turn
 *    (`combatTurn` / `combatRound`, before the combat is written, on the client that advances); safety net on the active GM;
 *  - command offered at casting (`onCast`), at token creation;
 *  - a movement of the object opens (and pays) the turn's command, on the active GM (`moveToken`) — the cap and the
 *    turn are held before, on the client of whoever moves (runtime/actions.mjs);
 *  - its use is paid with the caster's budget (runtime/turn.mjs, `pilotUsage`);
 *  - the removed object (`endsSpell`) ends the spell's Concentration.
 * The writes of one same object go one after the other: a movement in several segments followed by an attack
 * pays only one command.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { spendUse } from "../core/turn.mjs";
import { castCommand, nextPlayableTurn } from "../core/pilot.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { readBudget, writeBudget, isOwnTurn, distanceBetween, positionOf, turnKeyAt, currentTurnKey } from "../adapter/turn.mjs";
import {
  pilotOf, commandPlan, summonerCombatant, writeCommand, readCommand, turnKey, isPilotedCombatant, pulseOf, commandKey,
  summonerToken, summonsOfWith
} from "../adapter/pilot.mjs";
import { pulseAgainst } from "../adapter/areas.mjs";
import { summonItemOf } from "../adapter/summons.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaActiveGM } from "./shared.mjs";
import { contentOf } from "../adapter/content.mjs";
import { STEPS } from "../core/action.mjs";
import { enqueue } from "./queue.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { canSee } from "../adapter/vision.mjs";

/** One write at a time per object. */
const queues = new Map();
export function serialized(tokenId, fn) {
  const run = (queues.get(tokenId) ?? Promise.resolve()).then(fn, fn);
  queues.set(tokenId, run.catch(() => {}));
  return run;
}

/**
 * Pays the gesture if it opens a command, and writes the command state. Returns what is needed for a cancellation:
 * the budget before and after, the command state before.
 */
async function charge(pilot, gesture) {
  const plan = commandPlan(pilot, gesture);
  const combatant = plan.combatant;
  if ( !combatant || !plan.next ) return null;
  const commandBefore = readCommand(combatant, pilot);
  const before = readBudget(combatant);
  let after = before;
  if ( plan.pay ) {
    after = spendUse(before, { cost: plan.pay, weaponAttack: false, usesSpellSlot: false }, { isOwnTurn: plan.ownTurn, attacksPerAction: 1 });
    await writeBudget(combatant, after);
    log(`${combatant.name}: ${plan.pay} (command from ${pilot.token.name})`);
  }
  await writeCommand(combatant, pilot, plan.next);
  return { combatant: combatant.id, before, after, command: { token: commandKey(pilot), before: commandBefore } };
}

/** The use of an object's activity (use card), on the active GM: paid from the caster's budget. */
export function pilotUsage(message, pilot) {
  return serialized(commandKey(pilot), async () => {
    const spent = await charge(pilot, "use");
    if ( spent ) await message.setFlag(MODULE_ID, "spent", spent);
  });
}

/** "Move Lights" used (use card), on the active GM: opens the turn's movement command. */
export function spellCommandUsage(message, pilot) {
  return serialized(commandKey(pilot), async () => {
    const spent = await charge(pilot, "move");
    if ( spent ) await message.setFlag(MODULE_ID, "spent", spent);
  });
}

/** Cancellation before any roll: the earlier command state comes back (the budget itself is given back by runtime/turn.mjs). */
export async function refundCommand(combatant, command) {
  if ( !combatant || !command?.token ) return;
  await combatant.setFlag(MODULE_ID, `commands.${command.token}`, command.before ?? { turn: "", paid: false, move: false, used: 0 });
}

/** Can this client dismiss the piloted object: it ends the spell, and the Concentration is one's own. */
export function canDismiss(tokenDoc) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return false;
  // Without Concentration (Duplicity: the caster dismisses it whenever they want, with no action): the caster's owner.
  if ( !tokenDoc.getFlag(MODULE_ID, "summonedBy") ) return pilot.summoner.isOwner;
  if ( !tokenDoc.getFlag(MODULE_ID, "endsSpell") ) return false;
  const effect = fromUuidSync(tokenDoc.getFlag(MODULE_ID, "summonedBy"), { strict: false });
  return !!effect?.isOwner;
}

export const DISMISS_QUERY = `${MODULE_ID}.dismissSummon`;

/** Active GM side: remove the object from a caster that the requester owns. */
async function handleDismiss({ token: tokenUuid }, { user }={}) {
  const token = await fromUuid(tokenUuid);
  const pilot = token ? pilotOf(token) : null;
  if ( !pilot || (user && !pilot.summoner.testUserPermission(user, "OWNER")) ) return false;
  log(`${token.name} dismissed`);
  await token.delete();
  return true;
}

/** A command that targets only the object (Interposing Hand): its use, like a click on the sheet. */
export async function useCommand(tokenDoc, activity, event=null) {
  tokenDoc.object?.control({ releaseOthers: true });
  return activity.use({ ...(event ? { event } : {}) });
}

/**
 * Dismissing the object (§16.15): that is ending the spell. A deleted Concentration removes its own objects (active GM,
 * runtime/concentration.mjs) — a player can delete their character's effect, not a token.
 */
export async function dismissPilot(tokenDoc) {
  if ( !tokenDoc.getFlag(MODULE_ID, "summonedBy") ) {
    // No Concentration to break: the token itself goes, by the active GM (a player does not delete tokens).
    if ( !canDismiss(tokenDoc) ) return false;
    return viaActiveGM(DISMISS_QUERY, handleDismiss, { token: tokenDoc.uuid }, { fallback: false });
  }
  const effect = fromUuidSync(tokenDoc.getFlag(MODULE_ID, "summonedBy") ?? "", { strict: false });
  if ( !effect?.isOwner ) return false;
  log(`${tokenDoc.name} dismissed: ${effect.name} ended`);
  await effect.delete();
  return true;
}

/* -------------------------------------------- */

/** The caster moves away: their `leash` objects left outside the spell's range disappear. */
async function leashAround(casterToken) {
  const actor = casterToken.actor;
  if ( !actor ) return;
  for ( const token of casterToken.parent.tokens ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin");
    if ( !origin?.startsWith(actor.uuid) ) continue;
    const pilot = pilotOf(token);
    if ( !pilot?.rule.leash || (pilot.summoner !== actor) || !beyondSpellRange(pilot) ) continue;
    log(`${token.name}: out of range of ${pilot.item.name} (the caster moves away), disappears`);
    ui.notifications.info(loc("Pilote.HorsPortee", { name: token.name, item: pilot.item.name }));
    await token.delete();
  }
}

/** A movement of the object during its caster's turn opens the turn's command (active GM). */
function onMoveToken(tokenDoc, movement) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return leashAround(tokenDoc);
  const moved = movement.passed?.waypoints ?? [];
  if ( !moved.length || moved.every(w => CONFIG.Token.movement.actions[w.action]?.teleport) ) return;
  // "A light disappears if it leaves the spell's range" (`leash`, Dancing Lights), whatever the turn.
  if ( pilot.rule.leash && beyondSpellRange(pilot) ) {
    log(`${tokenDoc.name}: out of range of ${pilot.item.name}, disappears`);
    ui.notifications.info(loc("Pilote.HorsPortee", { name: tokenDoc.name, item: pilot.item.name }));
    return tokenDoc.delete();
  }
  const combatant = summonerCombatant(pilot);
  if ( !combatant || !isOwnTurn(combatant) ) return;   // repositioned by the GM outside the turn: nothing to pay
  return serialized(commandKey(pilot), () => charge(pilot, "move"));
}

/** Is the object beyond the spell's range, measured from its caster? */
function beyondSpellRange(pilot) {
  const caster = summonerToken(pilot);
  const range = pilot.item.system.range ?? {};
  if ( !caster || (caster.parent !== pilot.token.parent) || !Number.isFinite(Number(range.value)) ) return false;
  let limit = lengthIn(Number(range.value), range.units, pilot.token.parent.grid.units);
  return distanceBetween(caster, pilot.token).value > limit + 1e-6;
}

/** At object creation, during the caster's turn: the command offered by the casting (`onCast`). */
async function onCreateToken(tokenDoc) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return;
  // A piloted object is not an ally (Pack Tactics, adapter/facts.mjs); the Duplicity illusion has the caster's features
  // (a visual double of them, `mimic`).
  const update = { [`flags.${MODULE_ID}.object`]: true };
  const look = pilot.summon.mimic ? summonerToken(pilot) : null;
  if ( look?.texture?.src ) Object.assign(update, { "texture.src": look.texture.src, "ring.enabled": look.ring?.enabled ?? false,
    "ring.subject.texture": look.ring?.subject?.texture ?? null });
  const combatant = summonerCombatant(pilot);
  const ownTurn = !!combatant && isOwnTurn(combatant);
  // §38.2: the turn of the creation ("Trickster's Swap": the Bonus Action that creates the illusion counts too).
  if ( ownTurn ) update[`flags.${MODULE_ID}.createdTurn`] = turnKey(combatant.combat);
  await tokenDoc.update(update);
  if ( !ownTurn ) return;
  const state = castCommand(pilot.rule.onCast, turnKey(combatant.combat));
  if ( !state ) return;
  await serialized(commandKey(pilot), () => writeCommand(combatant, pilot, state));
  log(`${tokenDoc.name}: command offered on cast (${pilot.rule.onCast})`);
}

/**
 * The object removed from the scene (deleted by hand, destroyed): if the spell declares it (`endsSpell`), its Concentration
 * ends — unless another of the same spell remains. A Concentration that drops removes its own objects
 * (runtime/concentration.mjs): the effect is then already gone, nothing to do here.
 */
async function onDeleteToken(tokenDoc) {
  const effectUuid = tokenDoc.getFlag(MODULE_ID, "summonedBy");
  if ( !effectUuid || !tokenDoc.getFlag(MODULE_ID, "endsSpell") ) return;
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.tokenId === tokenDoc.id) && (c.sceneId === tokenDoc.parent?.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  const others = game.scenes.some(s => s.tokens.some(t => (t.id !== tokenDoc.id) && (t.getFlag(MODULE_ID, "summonedBy") === effectUuid)));
  if ( others ) return;
  const effect = fromUuidSync(effectUuid, { strict: false });
  if ( !effect ) return;
  log(`${tokenDoc.name} removed: concentration ended (${effect.name})`);
  ui.notifications.info(loc("Pilote.FinDuSort", { name: tokenDoc.name, item: effect.name }));
  await effect.delete();
}

/**
 * End of a creature's turn (§16.15, `summon.pulse`): each object that acts around itself (Flaming Sphere) subjects it to
 * its activity if it is within `radius` or less — "any creature that ends its turn within 1.50 m of the sphere". The
 * caster included; not the object itself. Active GM.
 */
async function pulseAtTurnEnd(combat, prior) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  if ( !ended?.actor || isPilotedCombatant(combat.combatants.get(prior.combatantId)) ) return;
  const key = turnKeyAt(combat, prior);   // the end of a turn belongs to the turn that is ending
  for ( const source of ended.parent.tokens ) {
    const pulse = pulseOf(source);
    if ( !pulse || !(pulse.rule.on ?? ["turnEnd"]).includes("turnEnd") ) continue;
    if ( pulseReaches(source, pulse, ended) ) await pulseOnce(source, pulse, ended, "turnEnd", key);
  }
}

/**
 * §159: start of a creature's turn (`summon.pulse.on`) — `turnStart`: it starts its turn within range of the summon (Guardian
 * of Faith, Conjure Elemental); `casterTurnStart`: it is the caster's turn, the summon strikes ONE enemy in range, the nearest
 * (Mordenkainen's Faithful Hound: "at the start of your turn, the hound tries to bite an enemy within 1.50 m of it"). Active GM.
 */
async function pulseAtTurnStart(combat, prior, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  const started = combatant?.token;
  if ( !started?.actor || isPilotedCombatant(combatant) ) return;
  for ( const source of started.parent.tokens ) {
    const pulse = pulseOf(source);
    if ( !pulse ) continue;
    const on = pulse.rule.on ?? ["turnEnd"];
    if ( on.includes("turnStart") && pulseReaches(source, pulse, started) ) await pulseOnce(source, pulse, started, "turnStart");
    if ( on.includes("casterTurnStart") && (summonItemOf(source)?.actor === started.actor) ) {
      const near = source.parent.tokens.filter(t => pulseReaches(source, pulse, t) && pulseSeen(source, pulse, t))
        .sort((a, b) => distanceBetween(source, a).value - distanceBetween(source, b).value);
      if ( near.length ) await pulseOnce(source, pulse, near[0], "casterTurnStart");
      else log(`${source.name}: nobody within reach at ${started.name}'s turn start`);
    }
  }
}

/** What the object strikes: not itself, not a dead creature, not a piloted object; `affects: "enemy"`: the caster's enemies. */
function pulseCanHit(source, pulse, token) {
  if ( (token === source) || !token.actor || token.hidden || isObjectToken(token) ) return false;
  if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) return false;
  if ( pulse.rule.affects !== "enemy" ) return true;
  return areEnemies(pulseCaster(source) ?? source, token);
}

/**
 * The caster's token of a summon on its scene, or null. §159: an unpiloted summon (Faithful Hound, Guardian of Faith)
 * also judges enemies from its caster — its own disposition is often neutral.
 */
function pulseCaster(source) {
  const pilot = pilotOf(source);
  if ( pilot ) return summonerToken(pilot);
  const owner = summonItemOf(source)?.actor;
  return (owner?.getActiveTokens?.(false, true) ?? []).find(t => t.parent === source.parent) ?? null;
}

/**
 * §368: `seenBy: "caster"` — "a creature you can see" (Conjure Animals): the caster must see the creature, through the
 * engine's vision (Invisible, Darkness, fog, Hidden, Ethereal Plane…). With no caster token on the scene, they see nothing;
 * a vision that cannot be judged here (canvas absent: null) does not block.
 */
function pulseSeen(source, pulse, token) {
  if ( pulse.rule.seenBy !== "caster" ) return true;
  const caster = pulseCaster(source);
  if ( !caster ) return false;
  return canSee(caster, token) !== false;
}

/** Is the creature within range of the object — at a given position of either? */
function pulseReaches(source, pulse, token, { posSource, posToken }={}) {
  if ( !pulseCanHit(source, pulse, token) || (source.parent !== token.parent) ) return false;
  let radius = lengthIn(pulse.rule.radius, pulse.rule.units, token.parent.grid.units);
  return distanceBetween(source, token, { posA: posSource, posB: posToken }).value <= radius + 1e-6;
}

const pulseTurnKey = () => game.combat?.started ? `${game.combat.id}.${game.combat.round}.${game.combat.turn}` : "hors-combat";

/** "A creature makes this saving throw only once per turn": memory on the object's token. Active GM. */
function pulseOnce(source, pulse, token, moment, turn=pulseTurnKey()) {
  return serialized(`pulse:${source.id}`, async () => {
    const memory = source.getFlag(MODULE_ID, "pulse");
    const hit = (memory?.turn === turn) ? memory.hit : [];
    if ( hit.includes(token.id) ) return;
    // Not seen: no saving throw, and its "once per turn" is not spent.
    if ( !pulseSeen(source, pulse, token) ) return log(`${source.name}: ${token.name} not seen by the caster (${moment}), skipped`);
    await source.setFlag(MODULE_ID, "pulse", { turn, hit: [...hit, token.id] });
    log(`${source.name}: ${token.name} (${moment}, ${pulse.activity.item.name})`);
    await pulseAgainst(pulse.activity, source, token, moment);
  });
}

/**
 * Movements (active GM): the object comes within range of creatures (`moves`), or a creature comes within range of an object
 * (`enter`) — Conjure Animals: "whenever the pack moves within 3 m of a creature, and whenever a creature
 * enters a space within 3 m of the pack".
 */
async function pulseOnMove(tokenDoc, movement) {
  const from = movement.origin ? positionOf(movement.origin) : null;
  if ( !from ) return;
  const own = pulseOf(tokenDoc);
  if ( own && (own.rule.on ?? []).includes("moves") ) {
    for ( const other of tokenDoc.parent.tokens ) {
      if ( !pulseReaches(tokenDoc, own, other) || pulseReaches(tokenDoc, own, other, { posSource: from }) ) continue;
      await pulseOnce(tokenDoc, own, other, "moves");
      // §403: Flaming Sphere — rolling onto a creature stops it for the turn (`stopsOnContact`): no more movement command.
      if ( own.rule.stopsOnContact && (tokenDoc.getFlag(MODULE_ID, "stoppedOn") !== currentTurnKey()) ) {
        await tokenDoc.setFlag(MODULE_ID, "stoppedOn", currentTurnKey());
        log(`${tokenDoc.name}: rolled into ${other.name}, stops for this turn`);
        notice(tokenDoc, loc("Pilote.ArreteeCourt"), "reaction");
      }
    }
  }
  for ( const source of tokenDoc.parent.tokens ) {
    if ( source === tokenDoc ) continue;
    const pulse = pulseOf(source);
    if ( !pulse || !(pulse.rule.on ?? []).includes("enter") ) continue;
    if ( pulseReaches(source, pulse, tokenDoc) && !pulseReaches(source, pulse, tokenDoc, { posToken: from }) ) await pulseOnce(source, pulse, tokenDoc, "enter");
  }
}

/** §259: a summoned creature that disappears — floating text and a sound for the whole table (§252), then its combatant and its token. */
async function vanish(token) {
  log(`${token.name} at 0 HP: vanishes`);
  notice(token, { key: "Retour.Disparait" }, "ended", { all: true, action: "spellEnds", outcome: "success" });
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.sceneId === token.parent?.id) && (c.tokenId === token.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  if ( token.parent?.tokens?.has(token.id) ) await token.delete();
}

/**
 * §259: Guardian of Faith — "the guardian vanishes when it has dealt a total of 60 damage". At each resolution of a pulse
 * (`areaTick.event: "pulse"`, adapter/areas.mjs), the damage applied is added to the total noted on its token; the cap
 * (`summon.vanishesAfterDamage`) reached, it disappears. Active GM.
 */
async function onPulseResolution(resolution) {
  if ( resolution?.step !== STEPS.DONE ) return;
  const tick = game.messages.get(resolution.origin ?? "")?.getFlag(MODULE_ID, "areaTick");
  if ( tick?.event !== "pulse" ) return;
  const token = fromUuidSync(tick.source ?? "", { strict: false });
  const origin = token ? summonItemOf(token) : null;
  const cap = origin ? contentOf(origin).entry?.summon?.vanishesAfterDamage : null;
  if ( !cap || token.getFlag(MODULE_ID, "pulseCounted")?.includes?.(resolution.id) ) return;
  const dealt = (resolution.targets ?? []).reduce((sum, t) => sum + Math.max(0, Number(t.damage?.applied) || 0), 0);
  const total = (token.getFlag(MODULE_ID, "pulseDamage") ?? 0) + dealt;
  const counted = [...(token.getFlag(MODULE_ID, "pulseCounted") ?? []), resolution.id].slice(-20);
  log(`${token.name}: ${dealt} damage dealt, ${total}/${cap}`);
  if ( total >= cap ) return vanish(token);
  await token.update({ [`flags.${MODULE_ID}`]: { pulseDamage: total, pulseCounted: counted } });
}

/** The object dropped to 0 HP (`endsAtZero`, Bigby's Hand: "if it drops to 0 Hit Points, the spell ends"). Active GM. */
async function onUpdateActor(actor, changes) {
  if ( foundry.utils.getProperty(changes, "system.attributes.hp.value") === undefined ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  // §402: `vanishesWhenHurt` — it disappears as soon as it takes damage (Phantom Steed: "if it takes damage, it
  // disappears"); appeared at full HP, HP below the maximum say it took some.
  const hp = actor.system.attributes?.hp ?? {};
  const summoned = token ? summonItemOf(token) : null;
  if ( summoned && contentOf(summoned).entry?.summon?.vanishesWhenHurt && (Number(hp.value) < Number(hp.max)) ) return vanish(token);
  if ( (hp.value ?? 1) > 0 ) return;
  // §259: "it disappears when it drops to 0 Hit Points" — the token and its combatant go, the spell continues.
  const origin = summoned;
  if ( origin && contentOf(origin).entry?.summon?.vanishesAtZero ) return vanish(token);
  if ( !token?.getFlag(MODULE_ID, "endsAtZero") ) return;
  const effect = fromUuidSync(token.getFlag(MODULE_ID, "summonedBy") ?? "", { strict: false });
  if ( !effect ) return;
  log(`${token.name} at 0 HP: ${effect.name} ends`);
  await effect.delete();
}

/** The caster Incapacitated: their `endsIfIncapacitated` summons cease (Duplicity). Active GM. */
async function onIncapacitated(actor) {
  if ( !actor || !INCAPACITATING.some(s => actor.statuses?.has(s)) ) return;
  for ( const token of summonsOfWith(actor, "endsIfIncapacitated") ) {
    log(`${token.name}: ${actor.name} is Incapacitated, the summon ends`);
    await token.delete();
  }
}

/**
 * §305 (pass C10): the caster dead, their `vanishesWithCaster` summons disappear (Find Steed, Primal Companion,
 * "Reanimated Companion"). Active GM.
 */
async function onCasterDead(actor) {
  if ( !actor?.statuses?.has("dead") ) return;
  for ( const token of summonsOfWith(actor, "vanishesWithCaster") ) {
    log(`${token.name}: ${actor.name} is dead, the summon vanishes`);
    await vanish(token);
  }
}

export const REST_QUERY = `${MODULE_ID}.restSummons`;

/** §305: active GM side — on the actor's Long Rest, their `endsOnLongRest` summons go (Wild Companion). */
async function handleRestSummons({ actor: actorUuid }, { user=null }={}) {
  const actor = await fromUuid(actorUuid ?? "");
  // §472 : d'un joueur, seulement les invocations de son propre acteur.
  if ( !actor || !actsFor(user, actor) ) { if ( actor ) console.warn(`${MODULE_ID} | restSummons query from ${user.name} refused: ${actor.name} is not theirs`); return false; }
  for ( const token of summonsOfWith(actor, "endsOnLongRest") ) {
    log(`${token.name}: ${actor.name} finished a Long Rest, the summon leaves`);
    await vanish(token);
  }
  return true;
}

function onRestCompleted(actor, result) {
  if ( !result?.longRest || !actor?.isOwner ) return;
  return viaActiveGM(REST_QUERY, handleRestSummons, { actor: actor.uuid }, { fallback: false });
}

/* ---- skipped turn ---- */

const skipsOf = combat => combat.turns.map(isPilotedCombatant);

/**
 * `combatTurn` / `combatRound` (client/documents/combat.mjs:285-294, 234-237, 313): called with the write's data
 * before it leaves, on the client that advances the combat. The targeted turn, if it is a piloted object's,
 * moves to the next (or the previous when going back). At the round's edge, we let it be: the active GM's safety net advances.
 */
function onCombatAdvance(combat, updateData, updateOptions) {
  if ( !Number.isInteger(updateData?.turn) ) return;
  const skip = skipsOf(combat);
  if ( !skip[updateData.turn] || skip.every(Boolean) ) return;
  const turn = nextPlayableTurn(skip, updateData.turn, (updateOptions?.direction ?? 1) < 0 ? -1 : 1);
  if ( (turn >= 0) && (turn < skip.length) ) updateData.turn = turn;
}

/** Safety net (active GM): a piloted object's turn started anyway (click in the tracker, round edge). */
async function onTurnChange(combat, prior, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  if ( !isPilotedCombatant(combatant) || skipsOf(combat).every(Boolean) ) return;
  const back = (current.round < prior?.round) || ((current.round === prior?.round) && (current.turn < prior?.turn));
  log(`${combatant.name}: piloted object, its turn is skipped`);
  if ( back ) await combat.previousTurn();
  else await combat.nextTurn();
}

export function registerPilot() {
  route("combatTurn", onCombatAdvance, { label: "piloted object: turn skipped" });
  route("combatRound", onCombatAdvance, { label: "piloted object: turn skipped (round)" });
  route("combatStart", (combat, updateData) => onCombatAdvance(combat, updateData, { direction: 1 }), { label: "piloted object: turn skipped (start)" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "piloted object: turn not skipped" });
  route("combatTurnChange", pulseAtTurnEnd, { executor: true, label: "summoned object: end of turn within range" });
  route("combatTurnChange", pulseAtTurnStart, { executor: true, label: "summoned object: start of turn within range" });
  route("updateActor", onUpdateActor, { executor: true, label: "piloted object: spell ends at 0 HP" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`pulseCap:${resolution?.id}`, () => onPulseResolution(resolution)),
    { executor: true, label: "summoned object: damage cap not counted" });
  route("createToken", onCreateToken, { executor: true, label: "piloted object: command on cast" });
  route("moveToken", onMoveToken, { executor: true, label: "piloted object: command not paid" });
  route("moveToken", pulseOnMove, { executor: true, label: "summoned object: arriving within range" });
  route("deleteToken", onDeleteToken, { executor: true, label: "piloted object: spell not ended" });
  route("createActiveEffect", effect => onIncapacitated(effect.parent), { executor: true, label: "summon: ends on Incapacitated" });
  route("updateActiveEffect", effect => onIncapacitated(effect.parent), { executor: true, label: "summon: ends on Incapacitated" });
  CONFIG.queries[DISMISS_QUERY] = handleDismiss;
  // §305: summons that follow their caster in death, or leave at the Long Rest.
  route("createActiveEffect", effect => onCasterDead(effect.parent), { executor: true, label: "summon: not removed with its dead caster" });
  CONFIG.queries[REST_QUERY] = handleRestSummons;
  route("dnd5e.restCompleted", onRestCompleted, { label: "summon: not dismissed at a Long Rest" });
}
