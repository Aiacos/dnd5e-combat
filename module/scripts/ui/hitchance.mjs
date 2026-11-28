/**
 * The hit chance near the cursor, BG3 style (SPEC §15.3). `ui/pointer.mjs` decides when to
 * display it (hovering a target with the base attack in combat, or in aiming mode); here we only
 * draw it. The calculation is in adapter/hitchance.mjs, the formula in core/hitchance.mjs.
 *
 * What a player sees is a world setting: percentage and AC (like BG3), percentage only,
 * or nothing. The GM always sees everything.
 */

import { MODULE_ID } from "../constants.mjs";
import { asPercent, hitChanceShows } from "../core/hitchance.mjs";
import { hitChanceOf, saveChanceOf } from "../adapter/hitchance.mjs";
import { coverPreviewOf } from "../adapter/cover-preview.mjs";
import { coverPreviewText } from "../core/cover-preview.mjs";
import { hideAttackLine, attackLineShown } from "./attack-line.mjs";
import { loc } from "../runtime/shared.mjs";
import { describeReason } from "./chat.mjs";

const OFFSET = 18;
let badge = null;
/** #33: the badge placed under a menu (its rectangle) instead of following the cursor; null: at the cursor. */
let anchor = null;

function element() {
  if ( badge ) return badge;
  badge = document.createElement("div");
  badge.classList.add("dnd5e-combat-hitchance");
  badge.hidden = true;
  document.body.append(badge);
  return badge;
}

/** What this client may see: "full", "percent", "advantage" (#247: the reasons for advantage only) or "off". */
function reveal() {
  if ( !game.settings.get(MODULE_ID, "hitChance") ) return "off";
  return game.user.isGM ? "full" : game.settings.get(MODULE_ID, "hitChancePlayers");
}

function line(css, text) {
  const p = document.createElement("div");
  p.classList.add(css);
  p.textContent = text;
  return p;
}

/** #33: is the Cover preview in service (world setting, disabled by default)? */
function previewOn() {
  try { return game.settings.get(MODULE_ID, "coverPreview") === true; } catch { return false; }
}

/** #33: the Cover preview's lines, or null (setting off, not an attack, canvas unavailable). */
function previewLines(attacker, target, activity, posA, attackMode=null) {
  if ( !previewOn() ) return null;
  let preview = null;
  try { preview = coverPreviewOf(attacker, target, activity, { posA, attackMode }); }
  catch(err) { console.warn(`${MODULE_ID} | cover preview`, err); }
  const text = coverPreviewText(preview, (key, data) => loc(key, data));
  if ( !text ) return null;
  const main = line("cover", text.main);
  main.classList.add(text.css);
  const icon = document.createElement("i");
  icon.className = `fa-solid ${text.css === "clear" ? "fa-shield" : (text.css === "total" ? "fa-ban" : "fa-shield-halved")}`;
  main.prepend(icon);
  return text.sub ? [main, line("cover-source", text.sub)] : [main];
}

/** Is the badge displayed? (#33: replay the hover when a token moves) */
export function hitChanceShown() {
  return (!!badge && !badge.hidden) || attackLineShown();
}

function coverText(cover) {
  if ( !cover ) return null;
  return (cover.bonus === null) ? loc("AbriTotal") : `${loc(`Abri.${cover.degree}`)} (+${cover.bonus})`;
}

/** Follows the cursor (at each movement, without waiting for the calculation, which is throttled). */
export function placeHitChance(event) {
  if ( !badge || badge.hidden ) return;
  const { offsetWidth: w, offsetHeight: h } = badge;
  // #33: under the context menu (above if there is no room), aligned on its left edge.
  if ( anchor ) {
    const below = anchor.bottom + 4;
    badge.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - w - 4))}px`;
    badge.style.top = `${(below + h <= window.innerHeight - 4) ? below : Math.max(4, anchor.top - h - 4)}px`;
    return;
  }
  if ( !event ) return;
  badge.style.left = `${Math.min(event.clientX + OFFSET, window.innerWidth - w - 4)}px`;
  badge.style.top = `${Math.min(event.clientY + OFFSET, window.innerHeight - h - 4)}px`;
}

/** A badge at the cursor, without a hit chance: "Out of range", "Already targeted" (§16.29). */
export function showBadge(event, text, { at=null }={}) {
  if ( reveal() === "off" ) return hideHitChance();
  anchor = at;
  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair");
  el.classList.add("poor");
  el.append(line("percent", text));
  el.hidden = false;
  placeHitChance(event);
}

export function hideHitChance() {
  if ( badge ) badge.hidden = true;
  anchor = null;
  hideAttackLine();   // #33: the aiming line goes with the badge
}

/**
 * Displays the chance that `attacker` hits `target` with `activity`.
 * @param {PointerEvent} event
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]         The attacker's position at the end of their approach.
 * @param {boolean} [options.outOfReach]  The approach does not get within range this turn.
 * @param {{advantage?: boolean, disadvantage?: boolean}} [options.keys]  Advantage / Disadvantage keys held.
 * @param {string|null} [options.attackMode]  dnd5e's attack mode ("thrown"…), when the menu chooses it.
 * @param {DOMRect|null} [options.at]         #33: place the badge under this rectangle (the context menu), not at the cursor.
 */
export function showHitChance(event, attacker, target, activity, { posA, outOfReach=false, keys={}, attackMode=null, at=null }={}) {
  const level = reveal();
  if ( activity?.type !== "attack" ) return hideHitChance();
  // #33: the Cover preview is displayed even when the hit chance is hidden from this client.
  const cover = previewLines(attacker, target, activity, posA, attackMode);
  if ( (level === "off") && !cover ) return hideHitChance();
  let info = null;
  if ( !outOfReach && (level !== "off") ) {
    try { info = hitChanceOf(attacker, target, activity, { posA, keys, attackMode }); }
    catch(err) { console.warn(`${MODULE_ID} | hit chance`, err); }
    if ( !info && !cover ) return hideHitChance();
  }

  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair", "poor", "cover-only");
  const shows = hitChanceShows(level);
  if ( (level === "off") || (!outOfReach && !info) ) el.classList.add("cover-only");
  else if ( outOfReach ) {
    el.classList.add("poor");
    el.append(line("percent", loc("Toucher.HorsDatteinte")));
  }
  else {
    if ( shows.percent ) {
      const percent = asPercent(info.hit);
      el.classList.add(percent >= 60 ? "good" : percent >= 35 ? "fair" : "poor");
      el.append(line("percent", `${percent} %`));
      const crit = (info.critical > 0) && (info.critical < 0.005) ? "< 1" : asPercent(info.critical);
      if ( info.hit > 0 ) el.append(line("detail", loc("Toucher.Critique", { percent: crit })));
      // AC and Cover: the AC only if the GM reveals it to players. #33: with the preview, Cover has its own line.
      const coverNote = cover ? null : coverText(info.cover);
      if ( info.ac === null ) { if ( coverNote ) el.append(line("detail", coverNote)); }
      else if ( shows.ac ) el.append(line("detail", `${loc("Toucher.CA")} ${info.ac}${coverNote ? ` — ${coverNote}` : ""}`));
      else if ( coverNote ) el.append(line("detail", coverNote));
    }
    // #247: the reasons only — no percentage or color; without a reason (and without a Cover preview), nothing to show.
    else el.classList.add("cover-only");
    if ( cover ) el.append(...cover);
    const advantage = info.advantage.map(describeReason);
    const disadvantage = info.disadvantage.map(describeReason);
    if ( info.system.advantage ) advantage.push(loc("Toucher.Fiche"));
    if ( info.system.disadvantage ) disadvantage.push(loc("Toucher.Fiche"));
    if ( info.keys.advantage ) advantage.push(loc("Toucher.Touche"));
    if ( info.keys.disadvantage ) disadvantage.push(loc("Toucher.Touche"));
    if ( advantage.length ) el.append(line("advantage", loc("LabelValue", { label: loc("Avantage"), value: advantage.join(", ") })));
    if ( disadvantage.length ) el.append(line("disadvantage", loc("LabelValue", { label: loc("Desavantage"), value: disadvantage.join(", ") })));
    if ( advantage.length && disadvantage.length ) el.append(line("detail", loc("Toucher.SAnnulent")));
    if ( !shows.percent && !cover && !advantage.length && !disadvantage.length ) return hideHitChance();
  }
  if ( cover && !info ) el.append(...cover);
  anchor = at;
  el.hidden = false;
  placeHitChance(event);
}

/**
 * Displays the chance that `target` fails the saving throw of `activity` (§15.3): the failure percentage, from the
 * caster's point of view; the DC and the target's bonus if the GM reveals them (setting "percentage and AC"); advantage,
 * disadvantage, automatic failure, Immunity, Legendary Resistance.
 */
export function showSaveChance(event, caster, target, activity, { outOfReach=false }={}) {
  const level = reveal();
  // #247: "advantage" shows nothing of a saving throw — its reasons are about the target (a resistance, a condition), not the
  // caster.
  if ( !hitChanceShows(level).percent || (activity?.type !== "save") ) return hideHitChance();
  let info = null;
  if ( !outOfReach ) {
    try { info = saveChanceOf(caster, target, activity); }
    catch(err) { console.warn(`${MODULE_ID} | saving throw failure chance`, err); }
    if ( !info ) return hideHitChance();
  }
  const el = element();
  el.replaceChildren();
  el.classList.remove("good", "fair", "poor");
  if ( outOfReach ) {
    el.classList.add("poor");
    el.append(line("percent", loc("Toucher.HorsDatteinte")));
  }
  else {
    const percent = asPercent(info.fail);
    el.classList.add(percent >= 60 ? "good" : percent >= 35 ? "fair" : "poor");
    el.append(line("percent", loc("Sauvegarde.Echec", { percent })));
    const ability = game.i18n.localize(CONFIG.DND5E.abilities[info.ability]?.label ?? info.ability);
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    const dice = info.dice.map(d => `${d.sign < 0 ? "-" : "+"}${d.number}d${d.faces}`).join("");
    if ( level === "full" ) el.append(line("detail", loc("Sauvegarde.DD", { dc: info.dc, ability, bonus: `${sign(info.bonus)}${dice}` })));
    else el.append(line("detail", ability));
    if ( info.immune ) el.append(line("detail", loc("Sauvegarde.Immunise")));
    if ( info.autoFail ) el.append(line("disadvantage", loc("Sauvegarde.AutoEchec",
      { status: game.i18n.localize(CONFIG.DND5E.conditionTypes[info.autoFail]?.name ?? info.autoFail) })));
    const reason = key => loc(`Sauvegarde.Raison.${key}`);
    if ( info.advantage.length ) el.append(line("advantage", loc("LabelValue", { label: loc("Avantage"), value: info.advantage.map(reason).join(", ") })));
    if ( info.disadvantage.length ) el.append(line("disadvantage", loc("LabelValue", { label: loc("Desavantage"), value: info.disadvantage.map(reason).join(", ") })));
    if ( info.advantage.length && info.disadvantage.length ) el.append(line("detail", loc("Toucher.SAnnulent")));
    if ( (info.legendary > 0) && (level === "full") ) el.append(line("detail", loc("Sauvegarde.Legendaire", { n: info.legendary })));
  }
  el.hidden = false;
  placeHitChance(event);
}

export function registerHitChance() {
  // #33: the Cover preview in the badge — decided by the GM for the table, disabled by default.
  game.settings.register(MODULE_ID, "coverPreview", { scope: "world", config: true, type: Boolean, default: false,
    name: "DND5ECOMBAT.Reglage.coverPreview.Nom", hint: "DND5ECOMBAT.Reglage.coverPreview.Aide" });
  game.settings.register(MODULE_ID, "hitChance", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.hitChance.Nom", hint: "DND5ECOMBAT.Reglage.hitChance.Aide" });
  game.settings.register(MODULE_ID, "hitChancePlayers", { scope: "world", config: true, type: String, default: "full",
    name: "DND5ECOMBAT.Reglage.hitChancePlayers.Nom", hint: "DND5ECOMBAT.Reglage.hitChancePlayers.Aide",
    choices: {
      full: "DND5ECOMBAT.Reglage.hitChancePlayers.full",
      percent: "DND5ECOMBAT.Reglage.hitChancePlayers.percent",
      advantage: "DND5ECOMBAT.Reglage.hitChancePlayers.advantage",
      off: "DND5ECOMBAT.Reglage.hitChancePlayers.off"
    } });
}
