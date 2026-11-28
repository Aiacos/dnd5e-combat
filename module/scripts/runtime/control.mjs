/**
 * §285: control spells (batch 3 of the 2026-10-30 workstreams). Active GM.
 *  - Panic (`panic`) — Fear: "drops what it is holding" on a failure (closed resolution); Fear and Evil Eye (Panicked): on
 *    each of its turns, the creature takes the Dash action and moves away from the caster by the engine's A*
 *    (Opportunity Attacks, walls). Evil Eye: the effect ends if it finishes this move at `endsAt` from the caster without
 *    seeing the caster. The "safest path" is left to the GM.
 *  - Confusion (`confusion`): 1d10 shown at the start of its turn (core/control.mjs) — wander, nothing, a random strike
 *    within its reach (announced: the attack roll stays with the player or the GM), or free. Neither Bonus Action (`noBonus`) nor
 *    Reaction (`noReactions`).
 *  - Crown of Madness (`forcedAttack`, `upkeep`): at the start of the Charmed creature's turn, the reminder
 *    "make a melee attack against a creature the caster chooses, before moving"; at the end of each following turn of the caster,
 *    the spell ends if the caster has not maintained it (Magic action: "Maintain" entry in the token menu, `maintain`).
 * Visual and audio feedback seen by everyone (`notice`, `all`), card in the chat.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { confusionBehavior, wanderCells } from "../core/control.mjs";
import { dash as dashBudget } from "../core/turn.mjs";
import { isWithinRange } from "../core/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { dropHeld } from "../adapter/orders.mjs";
import { combatantFor, readBudget, writeBudget, currentTurnKey, turnKeyAt, distanceBetween, speedOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { seesBetween } from "../adapter/vision.mjs";
import { cellOf, footprintOf, sizeOf } from "../adapter/movement.mjs";
import { footprintDistance } from "../core/orders.mjs";
import { fleeFrom, approach } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, sleep, waitForDice } from "./shared.mjs";

const handled = new Set();
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

/** The actor's Active Effects whose source item declares `key` (and, if the rule names an effect, that one): `{ effect, item, rule }`. */
function ruled(actor, key, effectOf=rule => rule?.effect ?? null) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // The caster's concentration effect comes from the same item: it does not carry the target's rule (like adapter/triggers.mjs).
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.[key] : null;
    if ( !rule ) continue;
    const id = effectOf(rule);
    if ( id && !comesFromItemEffect(effect, id) ) continue;
    out.push({ effect, item, rule });
  }
  return out;
}

/** The token of an item's caster on the scene of `token`, or null. */
function casterToken(item, token) {
  const actor = item?.actor;
  if ( !actor || (actor === token.actor) ) return null;
  return actor.getActiveTokens?.(false, true)?.find(t => t.parent === token.parent) ?? null;
}

const canAct = actor => ((actor?.system?.attributes?.hp?.value ?? 0) > 0) && !INCAPACITATING.some(s => actor.statuses?.has(s));

/* -------------------------------------------- */
/*  Fear: drop on a failure                     */
/* -------------------------------------------- */

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || handled.has(resolution.origin) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  if ( !item || (contentOf(item).entry?.panic?.drop !== true) ) return;
  handled.add(resolution.origin);
  for ( const t of (resolution.targets ?? []).filter(x => x.save && !x.save.success) ) {
    const token = await fromUuid(t.token);
    if ( !token?.actor ) continue;
    const dropped = await dropHeld(token);
    const lines = [locEsc("Controle.Lache", { name: token.name, item: item.name })];
    if ( dropped.items.length ) lines.push(locEsc(dropped.pile ? "Ordre.LacheTas" : "Ordre.LacheInventaire", { items: dropped.items.join(", ") }));
    if ( dropped.kept?.length ) lines.push(locEsc("Ordre.LacheGarde", { items: dropped.kept.join(", ") }));
    if ( !dropped.items.length && !dropped.kept?.length ) lines.push(locEsc("Ordre.RienEnMain", { name: token.name }));
    log(`${item.name}: ${token.name} drops what it holds (${dropped.items.join(", ") || "nothing"})`);
    await say({ token }, lines, { control: { kind: "drop", item: item.name, token: token.uuid, items: dropped.items } });
  }
}

/* -------------------------------------------- */
/*  Start of the bearer's turn                  */
/* -------------------------------------------- */

/** Panic: Dash, then move away from the caster; Evil Eye: ends at `endsAt` out of sight. */
async function panic(combatant, token, { effect, item, rule }) {
  const caster = casterToken(item, token);
  if ( !caster || !canAct(token.actor) ) return;
  const budget = readBudget(combatant);
  const dashed = dashBudget(budget);
  if ( dashed !== budget ) await writeBudget(combatant, dashed);
  const fled = await fleeFrom(token, caster);
  const lines = [locEsc("Controle.Fuit", { name: token.name, caster: caster.name, item: item.name })];
  if ( !fled.moved ) lines.push(locEsc("Controle.FuitBloque", { name: token.name }));
  log(`${item.name}: ${token.name} dashes away from ${caster.name} (${fled.from} → ${fled.to} squares${fled.reason ? `, ${fled.reason}` : ""})`);
  notice(token, { key: "Controle.Panique" }, "refused", { all: true, action: "control", outcome: "failure" });
  let ended = false;
  if ( rule.endsAt ) {
    const far = isWithinRange(distanceBetween(token, caster), { value: rule.endsAt.distance, units: rule.endsAt.units }, readUnitFactors()) === false;
    if ( far && (seesBetween(token.actor, caster.actor) === false) ) {
      await effect.delete();
      ended = true;
      lines.push(locEsc("Controle.PaniqueFin", { name: token.name, item: item.name }));
      log(`${item.name}: ${token.name} is far enough and cannot see ${caster.name} — the effect ends`);
    }
  }
  await say({ token }, lines, { control: { kind: "panic", item: item.name, token: token.uuid, from: fled.from, to: fled.to, ended } });
}

/** Confusion : le d10, puis ce qu'il impose. */
async function confused(combatant, token, { item }) {
  if ( !canAct(token.actor) ) return;
  const roll = await new Roll("1d10").evaluate();
  const message = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token }), flavor: loc("Controle.ConfusionJet", { name: token.name, item: item.name }) });
  await waitForDice(message);
  const behavior = confusionBehavior(roll.total);
  const lines = [locEsc(`Controle.Confusion.${behavior.kind}`, { name: token.name })];
  let budget = { ...readBudget(combatant), bonus: 0 };
  let target = null;
  if ( behavior.kind === "wander" ) {
    const d8 = await new Roll("1d8").evaluate();
    const shown = await d8.toMessage({ speaker: ChatMessage.getSpeaker({ token }), flavor: loc("Controle.ConfusionDirection", { name: token.name }) });
    await waitForDice(shown);
    const speed = speedOf(token.actor, readUnitFactors(), token._source?.movementAction ?? null, token.parent)?.speed ?? 0;
    const cells = Math.floor(speed / (token.parent.grid.distance || 5));
    const grid = token.parent.grid;
    const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
    const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
    const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
    const goal = wanderCells(cellOf(token), d8.total, cells, sizeOf(token), { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j });
    await writeBudget(combatant, { ...budget, action: 0 });
    for ( const cell of goal ) {
      const r = await approach(token, { cells: [cell] });
      if ( r.arrived || (r.reason === "stopped") ) break;
    }
    budget = { ...readBudget(combatant), action: 0, bonus: 0, stopped: true };
  }
  else if ( behavior.kind === "idle" ) budget = { ...budget, action: 0, stopped: true };
  else if ( behavior.kind === "lash" ) {
    const near = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.hidden && ((t.actor.system?.attributes?.hp?.value ?? 0) > 0)
      && (footprintDistance(footprintOf(token), footprintOf(t)) === 0));
    target = near.length ? near[Math.floor(Math.random() * near.length)] : null;
    budget = target ? { ...budget, stopped: true } : { ...budget, action: 0, stopped: true };
    lines.push(target ? locEsc("Controle.Confusion.lashTarget", { name: token.name, target: target.name }) : locEsc("Controle.Confusion.lashNone", { name: token.name }));
  }
  await writeBudget(combatant, budget);
  log(`${item.name}: ${token.name} rolls ${roll.total} — ${behavior.kind}${target ? ` (${target.name})` : ""}`);
  notice(token, { key: `Controle.Confusion.${behavior.kind}Court` }, "refused", { all: true, action: "control", outcome: behavior.kind === "free" ? "success" : "failure" });
  await say({ token }, lines, { control: { kind: "confusion", item: item.name, token: token.uuid, roll: roll.total, behavior: behavior.kind, target: target?.uuid ?? null } });
}

/** Crown of Madness: the reminder of the imposed attack. */
async function forcedAttack(token, { item }) {
  if ( !canAct(token.actor) ) return;
  const caster = item.actor;
  notice(token, { key: "Controle.Couronne" }, "refused", { all: true, action: "control", outcome: "failure" });
  await say({ token }, [locEsc("Controle.CouronneRappel", { name: token.name, caster: caster?.name ?? "", item: item.name })],
    { control: { kind: "forcedAttack", item: item.name, token: token.uuid } });
}

async function onTurnStart(combatant) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  const panics = ruled(actor, "panic");
  const confusions = ruled(actor, "confusion", rule => (typeof rule === "string") ? rule : null);
  const crowns = ruled(actor, "forcedAttack", rule => (typeof rule === "string") ? rule : null);
  if ( !panics.length && !confusions.length && !crowns.length ) return;
  // The budget reset (runtime/turn.mjs) fires on the same turn change: we let it happen (like Command).
  await sleep(600);
  if ( panics.length ) await panic(combatant, token, panics[0]);
  else if ( confusions.length ) await confused(combatant, token, confusions[0]);
  if ( crowns.length ) await forcedAttack(token, crowns[0]);
}

/* -------------------------------------------- */
/*  Entretien par l'action Magie (Couronne)     */
/* -------------------------------------------- */

/** The caster's spells to maintain: its concentration effects whose item declares `upkeep`. */
export function upkeepsOf(actor) {
  return Array.from(actor?.effects ?? []).filter(e => !e.disabled && (e.statuses?.has?.("concentrating") || (e.getFlag?.("dnd5e", "type") === "concentration")))
    .map(effect => ({ effect, item: originItemOf(effect) })).filter(({ item }) => item && (contentOf(item).entry?.upkeep === true));
}

/** Can upkeep be done now (in combat, on its turn, not already done this turn)? */
export function canMaintain(token, effect) {
  const combatant = combatantFor(token?.actor);
  const key = currentTurnKey();
  if ( !combatant || !key || (game.combat?.combatant?.id !== combatant.id) ) return false;
  // `since`: noted at the end of the casting turn (onTurnEnd) — during that turn, nothing to maintain.
  const flag = effect.getFlag(MODULE_ID, "upkeep") ?? {};
  return !!flag.since && (flag.since !== key) && (flag.done !== key);
}

/** The Magic action that maintains the spell: the turn's action, noted on the concentration effect. On the acting client. */
export async function maintain(token, effect, item) {
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return false;
  const budget = readBudget(combatant);
  if ( !(budget.action >= 1) ) { notice(token, loc("Controle.EntretienSansAction", { item: item.name })); return false; }
  await writeBudget(combatant, { ...budget, action: budget.action - 1 });
  await effect.setFlag(MODULE_ID, "upkeep", { ...(effect.getFlag(MODULE_ID, "upkeep") ?? {}), done: currentTurnKey() });
  notice(token, { key: "Controle.Entretenu", data: { item: item.name } }, "gain", { all: true, action: "upkeep", outcome: "success" });
  await say({ token }, [locEsc("Controle.EntretienFait", { name: token.name, item: item.name })], { control: { kind: "upkeep", item: item.name, token: token.uuid } });
  log(`${item.name}: ${token.name} maintains the spell (Magic action)`);
  return true;
}

/** End of the caster's turn: the casting turn is noted; afterwards, without upkeep that turn, concentration drops. */
async function onTurnEnd(combatant, priorKey) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor || !priorKey ) return;
  for ( const { effect, item } of upkeepsOf(actor) ) {
    const flag = effect.getFlag(MODULE_ID, "upkeep") ?? {};
    if ( !flag.since ) { await effect.setFlag(MODULE_ID, "upkeep", { since: priorKey }); continue; }
    if ( (flag.since === priorKey) || (flag.done === priorKey) ) continue;
    log(`${item.name}: ${actor.name} did not maintain the spell — it ends`);
    await actor.endConcentration(item);
    notice(token, { key: "Controle.NonEntretenu", data: { item: item.name } }, "refused", { all: true, action: "upkeep", outcome: "failure" });
    await say({ token }, [locEsc("Controle.EntretienManque", { name: token.name, item: item.name })], { control: { kind: "upkeepLost", item: item.name, token: token.uuid } });
  }
}

export function registerControl() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`control:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "control spells: dropped items not handled" });
  route("combatTurnChange", (combat, prior, current) => {
    const ended = combat.combatants.get(prior?.combatantId);
    if ( ended?.token ) enqueue(`upkeep:${ended.token.uuid}`, () => onTurnEnd(ended, turnKeyAt(combat, prior)));
    const started = combat.combatants.get(current?.combatantId);
    if ( started?.token ) return enqueue(`control:${started.token.uuid}`, () => onTurnStart(started));
  }, { executor: true, label: "control spells: turn behaviour not played" });
}
