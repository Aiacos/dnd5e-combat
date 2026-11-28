/**
 * §211: Ready (2024 rules) — acting outside one's turn.
 *
 *  - On one's turn, the basic action "Ready" (content/actions.mjs) spends the action; on the client that took it, a window
 *    asks what to prepare (an attack, a spell cast with an action), the trigger — an enemy comes within range of the action,
 *    an enemy attacks, an enemy casts a spell — and, optionally, the single creature that triggers it (a target of the
 *    moment). The plan is stored in the turn's budget (`readied`): it expires at the start of the combatant's next turn,
 *    like the budget.
 *  - A readied spell is cast now: the chosen slot is spent, the creature concentrates on it (effect marked
 *    `readied`); Concentration broken, the spell is lost; not released at the start of its turn, likewise.
 *  - Once the trigger occurs, the Reaction is offered to the one who readied (`askReaction`), against the creature that
 *    triggered it: "comes within range" plays when it has arrived — its move is cut there, then resumes
 *    (runtime/reactions.mjs, `splitForReady`); "attack" and "casts a spell", once the enemy's action is resolved (active GM).
 *    Declining leaves the plan armed ("you can ignore the trigger"); releasing it serves it (runtime/turn.mjs, `readiedRelease`).
 * The readied move ("move up to your Speed") stays at the table.
 */

import { MODULE_ID } from "../constants.mjs";
import { READY_TRIGGERS, readyPlanOf, readyTriggered } from "../core/ready.mjs";
import { readyOptionsOf, slotsFor, spendSlot, holdSpell } from "../adapter/ready.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { reactionState } from "../adapter/reactions.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { canSee } from "../adapter/vision.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { current } from "../core/action.mjs";
import { releaseReady } from "./reactions.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, notice, say, sleep } from "./shared.mjs";

/* -------------------------------------------- */
/*  Prepare                                     */
/* -------------------------------------------- */

/** The "Ready" window; null if it is closed. */
async function askPlan(actor, token) {
  const options = readyOptionsOf(actor);
  if ( !options.length ) { ui.notifications.warn(loc("Pret.Rien", { name: actor.name })); return null; }
  const targets = Array.from(game.user.targets ?? []).filter(t => t.document !== token).map(t => t.document);
  const opt = (value, label, selected=false) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const slotsOf = o => (o.spell && o.level > 0) ? slotsFor(actor, o.level) : [];
  const usable = options.filter(o => !o.spell || (o.level === 0) || slotsOf(o).length);
  if ( !usable.length ) { ui.notifications.warn(loc("Pret.Rien", { name: actor.name })); return null; }
  const content = `<p>${loc("Pret.Intro")}</p>
    <div class="form-group"><label>${loc("Pret.Action")}</label><select name="action">${usable.map((o, i) => opt(i, o.name)).join("")}</select></div>
    <div class="form-group"><label>${loc("Pret.Declencheur")}</label><select name="trigger">${READY_TRIGGERS.map(k => opt(k, loc(`Pret.Si.${k}`))).join("")}</select></div>
    <div class="form-group"><label>${loc("Pret.Qui")}</label><select name="target">${opt("", loc("Pret.NImporteQui"))}${targets.map(t => opt(t.uuid, t.name, targets.length === 1)).join("")}</select></div>
    <div class="form-group" data-slot><label>${loc("Pret.Emplacement")}</label><select name="slot"></select></div>
    <p class="hint">${loc("Pret.Aide")}</p>`;
  const fillSlots = root => {
    const choice = usable[Number(root.querySelector("select[name=action]")?.value) || 0];
    const slots = slotsOf(choice);
    const select = root.querySelector("select[name=slot]");
    select.innerHTML = slots.map(s => opt(s.key, loc("Pret.Niveau", { level: s.level, left: s.value }))).join("");
    root.querySelector("[data-slot]").hidden = !slots.length;
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Pret.Titre", { name: actor.name }) }, content, rejectClose: false, position: { width: 460 },
    render: (event, dialog) => {
      const root = dialog.element;
      fillSlots(root);
      root.querySelector("select[name=action]")?.addEventListener("change", () => fillSlots(root));
    },
    buttons: [
      { action: "ready", label: loc("Pret.Valider"), icon: "fa-solid fa-hourglass-half", default: true,
        callback: (event, button) => {
          const f = button.form.elements;
          return { option: usable[Number(f.action.value) || 0], trigger: f.trigger.value, target: f.target.value || null, slot: f.slot?.value || null };
        } },
      { action: "cancel", label: loc("Pret.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return (answer && (typeof answer === "object")) ? answer : null;
}

/** Has the budget already taken the "Ready" action (written by the active GM, runtime/turn.mjs)? We wait for it a little. */
async function readiedRecorded(combatant) {
  for ( let waited = 0; waited < 6000; waited += 200 ) {
    if ( readBudget(combatant).readied ) return true;
    await sleep(200);
  }
  return false;
}

/** `dnd5e.postUseActivity`, on the client that took the action: the window, then the plan in the budget. */
async function onReadyUsed(activity) {
  if ( basicActionOf(activity?.item) !== "ready" ) return;
  const actor = activity.actor;
  const combatant = combatantFor(actor);
  const token = tokenOf(actor);
  if ( !combatant || !token || !actor.isOwner ) return;
  const answer = await askPlan(actor, token);
  if ( !answer ) { log(`${actor.name}: Ready taken, no readied action chosen`); return; }
  if ( !(await readiedRecorded(combatant)) ) log(`${actor.name}: Ready not recorded in the turn budget yet, the plan is written anyway`);
  await setReadyPlan(actor, answer);
}

/**
 * Stores the plan in the combatant's budget: a readied spell is cast now (slot spent, Concentration). Also called by
 * the scenarios (`api.mcp.ready`). Returns the plan, or null.
 * @param {Actor5e} actor
 * @param {{option: object, trigger: string, target?: string|null, slot?: string|null}} choice  `option`: from `readyOptionsOf`.
 */
export async function setReadyPlan(actor, { option, trigger, target: targetUuid=null, slot=null }) {
  const combatant = combatantFor(actor);
  const token = tokenOf(actor);
  if ( !combatant || !option || !READY_TRIGGERS.includes(trigger) ) return null;
  const target = targetUuid ? await fromUuid(targetUuid) : null;
  const plan = { activity: option.activity, name: option.name, img: option.img, trigger, reach: option.reach,
    target: target?.uuid ?? null, targetName: target?.name ?? null, slot: null, held: null };
  // A readied spell is cast now: the slot is spent, the energy held by Concentration.
  if ( option.spell ) {
    const spell = await fromUuid(option.activity);
    if ( option.level > 0 ) {
      if ( !slot || !(await spendSlot(actor, slot)) ) { ui.notifications.warn(loc("Pret.SansEmplacement")); return null; }
      plan.slot = slot;
    }
    const held = spell ? await holdSpell(spell) : null;
    plan.held = held?.uuid ?? null;
  }
  await writeBudget(combatant, { ...readBudget(combatant), readied: plan });
  const when = loc(`Pret.Si.${trigger}`) + (plan.targetName ? ` (${plan.targetName})` : "");
  if ( token ) notice(token, loc("Pret.Annonce", { action: plan.name }), "info");
  await say({ actor, token }, loc("Pret.Carte", { name: esc(actor.name), action: esc(plan.name), when: esc(when) }));
  log(`${actor.name}: readies ${plan.name} — ${trigger}${plan.targetName ? ` (${plan.targetName})` : ""}${plan.slot ? `, slot ${plan.slot} spent, held` : ""}`);
  return plan;
}

/* -------------------------------------------- */
/*  "Attack" and "casts a spell" triggers */
/* -------------------------------------------- */

/** Waits until the action born of this use message is resolved (damage applied); without engine resolution, a moment. */
async function actionSettled(usageId) {
  const related = () => game.messages.contents.map(m => current(m.getFlag(MODULE_ID, "resolution")))
    .filter(r => r && ((r.carrier === usageId) || (r.origin === usageId)));
  for ( let waited = 0; waited < 20000; waited += 250 ) {
    const all = related();
    if ( !all.length && (waited >= 1500) ) return;
    if ( all.length && all.every(r => ["done", "missed", "undone"].includes(r.step)) ) return;
    await sleep(250);
  }
}

/** Active GM: a creature just used an attack or a spell — those who readied against that react afterwards. */
async function onUsage(message) {
  if ( !game.combat?.started ) return;
  const activity = message.getAssociatedActivity?.();
  const source = tokenOf(activity?.actor) ?? null;
  if ( !activity || !source?.parent ) return;
  const kinds = [];
  if ( activity.type === "attack" ) kinds.push("attacks");
  if ( activity.item?.type === "spell" ) kinds.push("casts");
  if ( !kinds.length ) return;
  const watchers = [];
  for ( const combatant of game.combat.combatants ) {
    const other = combatant.token;
    if ( !other?.actor || (other === source) || (other.parent !== source.parent) || isObjectToken(other) || combatant.isDefeated ) continue;
    const plan = readyPlanOf(readBudget(combatant));
    const kind = kinds.find(k => plan?.trigger === k);
    if ( kind ) watchers.push({ other, kind });
  }
  if ( !watchers.length ) return;
  await actionSettled(message.id);
  for ( const { other, kind } of watchers ) {
    const plan = readyPlanOf(readBudget(combatantFor(other.actor)));
    if ( !plan || ((other.actor.system.attributes?.hp?.value ?? 0) <= 0) || ((source.actor?.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const state = { enemies: areEnemies(other, source), sees: canSee(other, source) ?? true, ...reactionState(other.actor) };
    if ( !readyTriggered(plan, { kind, source: source.uuid }, state) ) continue;
    // Out of range of the readied action: it cannot go off against it (the normal range; an unlimited range passes).
    if ( plan.reach ) {
      const reach = lengthIn(plan.reach.value, plan.reach.units, source.parent.grid.units, readUnitFactors());
      if ( distanceBetween(other, source).value > reach + 1e-6 ) { log(`${source.name} ${kind}: out of ${other.name}'s readied ${plan.name} range`); continue; }
    }
    await releaseReady(other, source, kind);
  }
}

/* -------------------------------------------- */
/*  Fin du plan                                 */
/* -------------------------------------------- */

/** Active GM, at the start of a combatant's turn: its unreleased readied spell is lost (the budget, though, is reset). */
async function onTurnStart(combat, prior, now) {
  const actor = combat.combatants.get(now?.combatantId)?.actor;
  const held = (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "readied"));
  if ( !held.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", held.map(e => e.id));
  const token = tokenOf(actor);
  if ( token ) notice(token, loc("Pret.Perdu"), "ended");
  log(`${actor.name}: readied spell not released before their turn, lost`);
}

/** Active GM: the Concentration that held a readied spell is broken — the plan drops (unless it was just released). */
async function onHeldEnded(effect) {
  if ( !effect.getFlag?.(MODULE_ID, "readied") ) return;
  const combatant = combatantFor(effect.parent);
  const plan = combatant ? readyPlanOf(readBudget(combatant)) : null;
  if ( !plan || (plan.held !== effect.uuid) ) return;
  await sleep(1500);   // released: the use card removes the plan by itself (runtime/turn.mjs)
  const still = readyPlanOf(readBudget(combatant));
  if ( !still || (still.held !== effect.uuid) || game.messages.contents.slice(-10).some(m => m.getFlag(MODULE_ID, "readiedRelease")
    && (m.getAssociatedActor?.() === effect.parent)) ) return;
  await writeBudget(combatant, { ...readBudget(combatant), readied: false });
  const token = tokenOf(effect.parent);
  if ( token ) notice(token, loc("Pret.Perdu"), "ended");
  log(`${effect.parent.name}: concentration on the readied spell broken, the readied action is lost`);
}

export function registerReady() {
  route("dnd5e.postUseActivity", activity => { onReadyUsed(activity).catch(err => console.error(`${MODULE_ID} | Ready`, err)); },
    { label: "Ready: readied action not chosen" });
  route("createChatMessage", message => ((message.type === "usage") ? onUsage(message) : null),
    { executor: true, label: "Ready: \"attacks / casts a spell\" trigger not checked" });
  route("combatTurnChange", onTurnStart, { executor: true, label: "Ready: held spell not lost at turn start" });
  route("deleteActiveEffect", onHeldEnded, { executor: true, label: "Ready: broken concentration not noted" });
}
