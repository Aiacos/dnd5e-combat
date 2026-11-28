/**
 * Imposed order (SPEC §16.59): Command. Active GM.
 *  - The resolution closed (`dnd5e-combat.resolution`, DONE), each target that failed its saving throw receives the order's effect.
 *    The order: the one the intent set on the card (`flags["dnd5e-combat"].order`, a scenario), otherwise asked of
 *    the author (adapter/choices.mjs, `askChoice`: their client, then the GM; with no answer, the first).
 *  - At the start of the target's turn (`combatTurnChange`), the order is carried out: Prone (Grovel), what it holds dropped
 *    (Drop), walks toward the caster or away from them (Approach, Flee, by the engine's A*), then the turn ends — no more
 *    action, Bonus Action or movement (budget: `stopped`). The effect falls at the end of that turn (content: `remove`).
 * What stays with the GM: a creature that does not understand the order, the order that would put it in obvious danger,
 * orders outside the spell's list.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { orderPlan } from "../core/orders.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { orderOn, orderEffectData, dropHeld } from "../adapter/orders.mjs";
import { readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { movementCap, walkToGap, gapBetween } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep, say, esc } from "./shared.mjs";

const handled = new Set();

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || handled.has(resolution.origin) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  const orders = item ? contentOf(item).entry?.orders : null;
  if ( !orders?.length ) return;
  handled.add(resolution.origin);
  const failed = (resolution.targets ?? []).filter(t => t.save && !t.save.success);
  if ( !failed.length ) return;
  const usage = game.messages.get(resolution.origin);
  let order = usage?.getFlag(MODULE_ID, "order");
  if ( !orders.includes(order) ) {
    const caster = activity.actor;
    const answer = caster ? await askChoice(caster, { actor: caster.uuid, item: item.name, prompt: loc("Ordre.Choisir"),
      options: orders.map(o => ({ id: o, label: loc(`Ordre.${o}.Nom`) })) }) : null;
    order = orders.includes(answer?.id) ? answer.id : orders[0];
  }
  const sp = usage?.speaker ?? {};
  const fromToken = (sp.scene && sp.token) ? `Scene.${sp.scene}.Token.${sp.token}` : null;
  const label = loc(`Ordre.${order}.Nom`);
  for ( const t of failed ) {
    const token = await fromUuid(t.token);
    if ( !token?.actor ) continue;
    await token.actor.createEmbeddedDocuments("ActiveEffect", [orderEffectData({ item, activity, order, label, fromToken, message: usage })]);
    log(`${item.name}: ${token.name} must obey — ${label}`);
    notice(token, label, "reaction");
  }
}

/** The order is carried out at the start of the turn of whoever bears it. */
async function obey(combatant) {
  const token = combatant?.token;
  const held = orderOn(token?.actor);
  if ( !held || held.done ) return;
  const plan = orderPlan(held.order);
  if ( !plan ) return;
  // The budget reset (runtime/turn.mjs, registered before) goes at the same turn change: we let it happen.
  await sleep(600);
  await held.effect.setFlag(MODULE_ID, "order", { ...held.effect.getFlag(MODULE_ID, "order"), done: true });
  const caster = held.from ? await fromUuid(held.from) : null;
  const lines = [loc(`Ordre.${held.order}.Execute`, { name: token.name, caster: caster?.name ?? "" })];
  if ( plan.prone ) await token.actor.toggleStatusEffect("prone", { active: true });
  if ( plan.drop ) {
    const dropped = await dropHeld(token);
    if ( dropped.items.length ) lines.push(loc(dropped.pile ? "Ordre.LacheTas" : "Ordre.LacheInventaire", { items: dropped.items.join(", ") }));
    // §122: what did not fall (a creature attack) — dropped anyway, unequipped.
    if ( dropped.kept?.length ) lines.push(loc("Ordre.LacheGarde", { items: dropped.kept.join(", ") }));
    if ( !dropped.items.length && !dropped.kept?.length ) lines.push(loc("Ordre.RienEnMain", { name: token.name }));
  }
  let arrived = false;
  if ( plan.move && caster ) {
    if ( plan.move === "toward" ) arrived = await walkToGap(token, caster, 0);
    else {
      const movement = movementOf(combatant, readUnitFactors());
      const left = Math.max(0, movementCap(token) - (movement?.spent ?? 0));
      const cells = Math.floor(left / token.parent.grid.distance);
      if ( cells > 0 ) await walkToGap(token, caster, gapBetween(token, caster) + cells);
    }
  }
  // The combat may have ended during the walk (Opportunity Attack window, animation): no turn left to end.
  const alive = !!game.combats.get(combatant.parent?.id)?.combatants.get(combatant.id);
  if ( alive && ((plan.ends === "always") || ((plan.ends === "ifArrived") && arrived)) ) {
    await writeBudget(combatant, { ...readBudget(combatant), action: 0, bonus: 0, stopped: true });
    lines.push(loc("Ordre.TourAcheve", { name: token.name }));
  }
  log(`${token.name} obeys (${held.order}): ${lines.slice(1).join(" ") || "—"}`);
  notice(token, loc(`Ordre.${held.order}.Nom`), "reaction");
  await say({ token }, lines.map(esc));
}

export function registerOrders() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`order:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "imposed command: effect not placed" });
  route("combatTurnChange", (combat, prior, current) => {
    const combatant = combat.combatants.get(current?.combatantId);
    if ( combatant?.token ) return enqueue(`obey:${combatant.token.uuid}`, () => obey(combatant));
  }, { executor: true, label: "imposed command: not carried out" });
}
