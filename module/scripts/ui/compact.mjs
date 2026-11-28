/**
 * Single card (SPEC §58, world setting `chatCompact`, on by default): an action leaves only one card in the
 * log, that of its use — like Midi-QOL's merged card.
 *
 *  - The roll messages that a use entails (`attack`, `damage`, `healing` of dnd5e 6, whose `system.origin` is
 *    the id of the use message: activity/attack.mjs:158-166, activity/mixin.mjs:879-885) stay in the database — Dice So Nice,
 *    the animations (BLFX), the engine and the cancellation read them — but are **collapsed**: `display: none` in the log and
 *    in the overlay, neither laid out nor painted.
 *  - The use card receives the summary of these rolls (attack, damage by type) above the verdict per target
 *    (ui/chat.mjs); a "Details" button reopens, on this client, the collapsed cards of this action.
 *  - Saving throws and checks, dnd5e already summarizes them in the use card (client setting `chatCardSummary`, on
 *    by default: data/chat-message/usage-message-data.mjs:228, documents/chat-message.mjs:154): we leave them alone.
 *  - A roll appears on the card only once its 3D dice have stopped (`waitForDice`), like the verdict.
 *
 * Nothing is written: everything is rendered, on each client. Disabling the setting gives back the previous log.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc, waitForDice } from "../runtime/shared.mjs";
import { attackMark } from "../core/attack.mjs";
import { STEPS } from "../core/action.mjs";
import { modifierLines, bonusLines, d20Nodes, fillLine, rowsEnabled } from "./chat.mjs";

export const CHAT_COMPACT_SETTING = "chatCompact";

/** Roll message types that an action collapses into its use card. */
const FOLDED_TYPES = new Set(["attack", "damage", "healing"]);

/** Rolls whose 3D dice are still rolling: not shown on the card yet. */
const rolling = new Set();
/** Use cards whose rolls are unfolded on this client. */
const unfolded = new Set();

const enabled = () => { try { return !!game.settings.get(MODULE_ID, CHAT_COMPACT_SETTING); } catch { return false; } };

/** The use card where this roll collapses, or null. */
export function carrierOf(message) {
  if ( !FOLDED_TYPES.has(message?.type) ) return null;
  const origin = message._source?.system?.origin;
  const carrier = origin ? game.messages.get(origin) : null;
  return (carrier?.type === "usage") ? carrier : null;
}

/** The rolls collapsed into this card, in order: they always come after it. */
function foldedIn(carrier) {
  const all = game.messages.contents;
  const out = [];
  for ( let i = all.length - 1; i >= 0; i-- ) {
    const m = all[i];
    if ( m.id === carrier.id ) break;
    if ( (m._source.system?.origin === carrier.id) && FOLDED_TYPES.has(m.type) ) out.push(m);
  }
  return out.reverse();
}

const damageLabel = type => game.i18n.localize(CONFIG.DND5E.damageTypes[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? type ?? "");

/** "Attack: 17 (d20: 12, critical)"; with two d20s (issue #47): "Attack: 9 (Disadvantage: 4, 17)", the discarded die struck out. */
function attackLine(message, carrier=null) {
  const roll = message.rolls?.[0];
  if ( !roll ) return null;
  const d20 = roll.dice?.[0]?.total ?? null;
  const notes = [];
  const twoDice = d20Nodes(roll);
  if ( !twoDice && (d20 !== null) ) notes.push(loc("LabelValue", { label: "d20", value: d20 }));
  // A 19 at a lowered critical threshold that misses is neither "critical" nor green: the verdict judged on this roll decides.
  const resolution = carrier?.getFlag(MODULE_ID, "resolution");
  const natural = roll.d20?.total ?? d20;
  const mark = attackMark({ isCritical: roll.isCritical === true, isFumble: roll.isFumble === true,
    ...(Number.isFinite(natural) ? { natural } : {}) }, (resolution?.attack?.messageId === message.id) ? resolution.targets : null);
  if ( mark === "critical" ) notes.push(loc("Compact.Critique"));
  else if ( mark === "fumble" ) notes.push(loc("Compact.Echec"));
  const css = (mark === "critical") ? "hit" : ((mark === "fumble") ? "miss" : "note");
  const head = loc("LabelValue", { label: loc("Compact.Attaque"), value: roll.total });
  // Two d20s: "Attack: 9 (Disadvantage: 4, 17, critical)", the 17 struck out.
  if ( twoDice ) return { css, title: roll.formula, nodes: [`${head} (`, ...twoDice, `${notes.map(n => `, ${n}`).join("")})`] };
  return { css, title: roll.formula, text: `${head}${notes.length ? ` (${notes.join(", ")})` : ""}` };
}

/** "Damage: 9 (6 slashing + 3 fire)" — by type, like the system's damage tray. */
function damageLine(message) {
  const rolls = message.rolls ?? [];
  if ( !rolls.length ) return null;
  const byType = new Map();
  for ( const roll of rolls ) {
    const type = roll.options?.type ?? (message.type === "healing" ? "healing" : "");
    byType.set(type, (byType.get(type) ?? 0) + Math.max(0, roll.total ?? 0));
  }
  const total = [...byType.values()].reduce((x, y) => x + y, 0);
  const types = [...byType];
  const critical = rolls.some(r => r.isCritical) ? `, ${loc("Compact.Critique")}` : "";
  const detail = (types.length > 1) ? ` (${types.map(([type, n]) => `${n} ${damageLabel(type).toLowerCase()}`).join(" + ")}${critical})`
    : ` ${damageLabel(types[0][0]).toLowerCase()}${critical ? ` (${loc("Compact.Critique")})` : ""}`;
  const key = (message.type === "healing") ? "Compact.Soins" : "Compact.Degats";
  return { css: "note", title: rolls.map(r => r.formula).join(" + "), text: `${loc("LabelValue", { label: loc(key), value: total })}${detail.trimEnd()}` };
}

/**
 * A collapsed action's rolls, as dice blocks like on the Midi-QOL card (its `attack-roll.html` and
 * `damage-roll.html` templates, MIT): a label (Attack, Advantage, Disadvantage, Damage), the formula, the dice detail that unfolds
 * on click, the total — tinted by the verdict for the attack, preceded by the type icon for damage. For the card in
 * rows (setting `chatRows`). The HTML is kept per message as long as it does not change: the use card is redrawn
 * several times per action.
 */
const midiBlocks = new Map();

const escapeHTML = text => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * A roll's dice detail, in dnd5e's collapsible wrapper (which its template already provides, or not depending on the version),
 * annotated like on the Midi-QOL card: the name of what each constant term of an attack is worth, the type under the damage total.
 */
async function breakdownOf(rolls, message) {
  const parts = await Promise.all(rolls.map(roll => roll.getTooltip().catch(() => "")));
  const holder = document.createElement("div");
  const attack = message.type === "attack";
  rolls.forEach((roll, index) => {
    const template = document.createElement("template");
    template.innerHTML = parts[index];
    const tip = template.content.querySelector(".dice-tooltip") ?? template.content;
    if ( attack ) nameConstants(tip, roll, message);
    else nameDamage(tip, roll);
    holder.append(...tip.childNodes);
  });
  return `<div class="dice-tooltip-collapser"><div class="dice-tooltip">${holder.innerHTML}</div></div>`;
}

/**
 * The unnamed constant terms of an attack roll: the roll's ability modifier, then the proficiency bonus, when
 * their values are the actor's — otherwise the term stays unnamed (a situational bonus is not guessed).
 */
function nameConstants(tip, roll, message) {
  const actor = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker);
  if ( !actor ) return;
  const ability = roll.options?.ability;
  const known = [
    { value: actor.system?.abilities?.[ability]?.mod, label: CONFIG.DND5E?.abilities?.[ability]?.label },
    { value: actor.system?.attributes?.prof, label: game.i18n.localize("DND5E.Proficiency") }
  ].filter(k => Number.isFinite(k.value) && k.label);
  for ( const part of tip.querySelectorAll(".tooltip-part.constant-term") ) {
    const flavor = part.querySelector(".flavor");
    if ( !flavor || flavor.textContent.trim() ) continue;
    const value = Number(part.querySelector(".value")?.textContent.replace(/\s+/g, "").replace("−", "-"));
    const at = known.findIndex(k => k.value === value);
    if ( at < 0 ) continue;
    flavor.textContent = known[at].label;
    known.splice(0, at + 1);
  }
}

/**
 * The detail of a damage or healing roll, as Midi-QOL shows it: when it has only one dice group, its constant terms
 * join the dice and the total is the roll's; the type is written under the total when dnd5e has not done so.
 */
function nameDamage(tip, roll) {
  const dice = Array.from(tip.querySelectorAll(".tooltip-part:not(.constant-term)"));
  const constants = Array.from(tip.querySelectorAll(".tooltip-part.constant-term"));
  const list = dice[0]?.querySelector(".dice-rolls");
  const unnamed = constants.every(part => !part.querySelector(".flavor")?.textContent.trim());
  if ( (dice.length === 1) && list && constants.length && unnamed ) {
    for ( const part of constants ) {
      const li = document.createElement("li");
      li.classList.add("constant");
      li.append(...(part.querySelector(".value")?.childNodes ?? []));
      list.append(li);
      part.remove();
    }
    const value = dice[0].querySelector(".total .value");
    if ( value && Number.isFinite(roll.total) ) value.textContent = roll.total;
  }
  const type = roll.options?.type;
  const label = (CONFIG.DND5E?.damageTypes?.[type] ?? CONFIG.DND5E?.healingTypes?.[type])?.label;
  if ( !label ) return;
  for ( const total of tip.querySelectorAll(".total .label") ) if ( !total.textContent.trim() ) total.textContent = label;
}

/** An attack roll's label: its mode. */
function attackLabel(roll) {
  const mode = roll.options?.advantageMode ?? 0;
  return game.i18n.localize((mode > 0) ? "DND5E.Advantage" : (mode < 0) ? "DND5E.Disadvantage" : "DND5E.Attack");
}

/**
 * An attack roll's verdict on the card, as Midi-QOL marks it: `success` or `failure` depending on whether a target is hit,
 * plus `critical` (double check) or `fumble` (two crosses).
 */
function attackOutcome(roll, carrier) {
  const resolution = carrier?.getFlag(MODULE_ID, "resolution");
  const judged = !!resolution?.attack && ![STEPS.AWAITING_ATTACK, STEPS.AWAITING_REACTION].includes(resolution.step);
  const hit = judged && (resolution.targets ?? []).some(t => t.hit);
  if ( roll.isCritical ) return { css: "critical success", icons: ["fa-check-double"] };
  if ( roll.isFumble ) return { css: "fumble failure", icons: ["fa-xmark", "fa-xmark"] };
  if ( !judged ) return null;
  return hit ? { css: "success", icons: ["fa-check"] } : { css: "failure", icons: ["fa-xmark"] };
}

/** The icons of a damage or healing roll's types, dnd5e's. */
function damageIcons(rolls) {
  const types = [...new Set(rolls.map(roll => roll.options?.type).filter(Boolean))];
  const icons = types.map(type => {
    const config = CONFIG.DND5E?.damageTypes?.[type] ?? CONFIG.DND5E?.healingTypes?.[type];
    if ( !config?.icon ) return "";
    const label = escapeHTML(config.label);
    return `<dnd5e-icon class="midi-damage-type-icon" src="${escapeHTML(config.icon)}" aria-label="${label}"`
      + ` data-tooltip="${label}"></dnd5e-icon>`;
  }).join("");
  return icons ? `<div class="midi-damage-icons">${icons}</div>` : "";
}

async function midiBlockOf(message, carrier) {
  const rolls = message.rolls ?? [];
  if ( !rolls.length ) return null;
  const attack = message.type === "attack";
  const outcome = attack ? attackOutcome(rolls[0], carrier) : null;
  const key = `${message._stats?.modifiedTime ?? 0}:${rolls.length}:${outcome?.css ?? ""}`;
  const kept = midiBlocks.get(message.id);
  if ( kept?.key === key ) return kept.block;
  const formula = escapeHTML(rolls.map(roll => roll.formula).join(" + "));
  const total = rolls.reduce((sum, roll) => sum + (roll.total ?? 0), 0);
  const breakdown = await breakdownOf(rolls, message);
  let html;
  if ( attack ) {
    const marks = (outcome?.icons ?? []).map(icon => `<i class="fas ${icon}" inert></i>`).join("");
    const icons = marks ? `<div class="icons">${marks}</div>` : "";
    html = `<div class="midi-qol-attack-roll midi-qol-section-filled">`
      + `<div class="midi-roll-label">${escapeHTML(attackLabel(rolls[0]))}</div>`
      + `<div class="midi-attack-roll midi-dice-roll dice-roll"><div class="dice-result"><div class="dice-formula">${formula}</div>`
      + `${breakdown}<h4 class="dice-total ${outcome?.css ?? ""}">${icons}<span class="total">${total}</span></h4>`
      + `</div></div></div>`;
  } else {
    const healing = !!CONFIG.DND5E?.healingTypes?.[rolls[0].options?.type];
    const label = escapeHTML(game.i18n.localize(healing ? "DND5E.HEAL.FIELDS.healing.label" : "DND5E.Damage"));
    html = `<div class="midi-qol-damage-roll midi-qol-section-filled"><div class="midi-roll-label">${label}</div>`
      + `<div class="dice-roll midi-damage-roll"><div class="dice-result"><div class="dice-formula">${formula}</div>`
      + `<h4 class="dice-total">${damageIcons(rolls)}<span class="total">${total}</span></h4>${breakdown}</div></div></div>`;
  }
  const block = { attack, html };
  midiBlocks.set(message.id, { key, block });
  return block;
}

/**
 * Puts into `host` the dice blocks of these messages, in the order of the Midi-QOL card: the attack, the hit or missed targets
 * (the list that ui/chat.mjs placed lower on the same card is moved up there), then the damage.
 */
async function fillMidiBlocks(host, messages, carrier) {
  const blocks = (await Promise.all(messages.map(m => midiBlockOf(m, carrier).catch(() => null)))).filter(Boolean);
  const template = document.createElement("template");
  template.innerHTML = blocks.filter(b => b.attack).map(b => b.html).join("");
  const damage = document.createElement("template");
  damage.innerHTML = blocks.filter(b => !b.attack).map(b => b.html).join("");
  host.replaceChildren(template.content);
  const rows = host.closest(".message-content")?.querySelector(".dnd5e-combat-rows");
  const hits = rows?.querySelector(":scope > .midi-qol-hits-display");
  if ( hits ) host.append(hits);
  host.append(damage.content);
  // The saves section closes the area, empty if there are none (it has its indent there, as on the Midi-QOL card).
  const saves = rows?.querySelector(":scope > .midi-qol-saves-display") ?? document.createElement("div");
  saves.classList.add("midi-qol-saves-display");
  host.append(saves);
  gatherActions(host.closest(".message-content"));
}

/** The engine's buttons (roll details, cancellation) on a single line, under the results area. */
function gatherActions(content) {
  const buttons = Array.from(content?.querySelectorAll(":scope > .dnd5e-combat-result > button") ?? []);
  if ( !buttons.length ) return;
  const bar = document.createElement("div");
  bar.classList.add("dnd5e-combat-actions");
  bar.append(...buttons);
  content.append(bar);
  // Blocks emptied of their rows and of their button do not keep their place.
  for ( const div of content.querySelectorAll(":scope > .dnd5e-combat-result") ) {
    if ( !div.querySelector(":scope > :not(.midi-results:empty)") ) div.remove();
  }
}

function onBlockClick(event) {
  const block = event.target.closest?.(".dice-roll");
  if ( !block ) return;
  event.stopPropagation();
  block.classList.toggle("expanded");
}

/** The roll summary on the use card, and the button that unfolds them. */
function renderSummary(carrier, html) {
  const folded = foldedIn(carrier);
  if ( !folded.length ) return;
  // In rows (`chatRows`): the rolls are shown as dice blocks, like on the Midi-QOL card, not as a line of text.
  const native = rowsEnabled();
  const lines = [];
  for ( const m of folded ) {
    if ( rolling.has(m.id) ) continue;
    const line = native ? null : ((m.type === "attack") ? attackLine(m, carrier) : damageLine(m));
    if ( line ) lines.push(line);
    // What the engine writes under these rolls (reasons for Advantage, added damage): on the card, since they are collapsed.
    const modifiers = m.getFlag(MODULE_ID, "modifiers");
    if ( modifiers ) lines.push(...modifierLines(modifiers, (m.type === "attack") ? m.rolls?.[0] : null));
    const bonuses = m.getFlag(MODULE_ID, "bonuses");
    if ( bonuses?.length ) lines.push(...bonusLines(bonuses));
  }
  const div = document.createElement("div");
  div.classList.add("dnd5e-combat-result", "dnd5e-combat-rolls");
  if ( native ) {
    const host = document.createElement("div");
    host.classList.add("midi-results");
    host.addEventListener("click", onBlockClick);
    div.append(host);
    fillMidiBlocks(host, folded.filter(m => !rolling.has(m.id)), carrier)
      .catch(err => console.error(`${MODULE_ID} | dice blocks`, err));
  }
  for ( const line of lines ) {
    const p = document.createElement("p");
    p.classList.add(line.css);
    fillLine(p, line);
    if ( line.title ) p.title = line.title;
    div.append(p);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("dnd5e-combat-details");
  const open = unfolded.has(carrier.id);
  button.textContent = loc(open ? "Compact.Masquer" : "Compact.Details", { n: folded.length });
  button.addEventListener("click", event => {
    event.stopPropagation();
    if ( unfolded.has(carrier.id) ) unfolded.delete(carrier.id); else unfolded.add(carrier.id);
    for ( const m of foldedIn(carrier) ) setFolded(m, !unfolded.has(carrier.id));
    ui.chat?.updateMessage?.(carrier);
  });
  div.append(button);
  // Before the verdict per target (ui/chat.mjs adds it afterwards): the dice, then what they did.
  html.querySelector(".message-content")?.append(div);
}

/** Collapses or unfolds the cards of a roll already in the DOM (log, overlay, detached window). */
function setFolded(message, folded) {
  for ( const li of document.querySelectorAll(`.chat-message[data-message-id="${message.id}"]`) ) li.classList.toggle("dnd5e-combat-folded", folded);
}

/** Redraws the use card (once per batch of arrivals). */
const pendingRefresh = new Set();
function refresh(carrier) {
  if ( pendingRefresh.has(carrier.id) ) return;
  pendingRefresh.add(carrier.id);
  setTimeout(() => {
    pendingRefresh.delete(carrier.id);
    if ( game.messages.has(carrier.id) ) ui.chat?.updateMessage?.(carrier);
  }, 50);
}

function onCreate(message) {
  if ( !enabled() ) return;
  const carrier = carrierOf(message);
  if ( !carrier ) return;
  if ( message.rolls?.length ) {
    rolling.add(message.id);
    waitForDice(message).finally(() => { rolling.delete(message.id); refresh(carrier); });
  } else refresh(carrier);
}

function onRender(message, html) {
  if ( !enabled() ) return;
  if ( message.type === "usage" ) return renderSummary(message, html);
  const carrier = carrierOf(message);
  if ( carrier && !unfolded.has(carrier.id) ) html.classList.add("dnd5e-combat-folded");
}

function applyCompact() {
  document.body.classList.toggle("dnd5e-combat-compact", enabled());
}

export function registerCompact() {
  game.settings.register(MODULE_ID, CHAT_COMPACT_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CHAT_COMPACT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CHAT_COMPACT_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => { applyCompact(); ui.chat?.render?.(); }
  });
  route("ready", applyCompact, { label: "single card" });
  route("createChatMessage", onCreate, { label: "single card: roll not folded" });
  route("deleteChatMessage", message => { midiBlocks.delete(message.id); }, { label: "single card: dice blocks kept" });
  // Registered BEFORE ui/chat.mjs: the dice summary precedes the verdict per target.
  route("dnd5e.renderChatMessage", onRender, { label: "single card: render" });
}
