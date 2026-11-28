import { MODULE_ID } from "../constants.mjs";
import { critMargin } from "../adapter/criticals.mjs";
import { current, pendingChoice, settled, STEPS } from "../core/action.mjs";
import { undo, CHAT_LIGHT_SETTING } from "../runtime/engine.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { overriddenShownOn } from "../runtime/forced.mjs";
import { typesLabel } from "../adapter/eligibility.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { convertLength } from "../core/units.mjs";
import { keptAndDropped } from "../core/d20.mjs";
import { manualModeOverride } from "../core/conditions.mjs";

/**
 * World setting (off by default: up to the GM to enable it): one row per target — verdict icon, portrait, name, detail —,
 * like the Midi-QOL card.
 */
export const CHAT_ROWS_SETTING = "chatRows";

export const rowsEnabled = () => { try { return !!game.settings.get(MODULE_ID, CHAT_ROWS_SETTING); } catch { return false; } };

/** A row's verdict icon, by row class (Midi-QOL's: check, double check on a Critical Hit, cross). */
const ROW_ICONS = Object.freeze({ hit: "fa-check", critical: "fa-check-double", miss: "fa-xmark", pending: "fa-hourglass-half",
  undone: "fa-rotate-left" });

/** A target's token image, or null (token gone, old card without uuid). */
function tokenImage(uuid) {
  const token = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return token?.texture?.src ?? token?.actor?.img ?? null;
}

/**
 * A result's lines as rows, in the markup of the Midi-QOL card (its `hits.html` and `saves.html` templates, MIT —
 * the notice is in styles/dnd5e-combat.css):
 * a dnd5e target list (`ul.evaluation` > `li.target.success|failure`) with the verdict symbol, the token portrait
 * and the name; for an attack, the target's AC on the right (GM only); for a saving throw, a title (ability, and DC
 * if dnd5e shows it to this player) and the total of each roll on the right, its detail on hover. What the engine did to
 * the target (HP lost, effects) is the tooltip of its row.
 */
function rows(lines, context={}) {
  const saves = lines.some(line => line.save) && !lines.some(line => line.attack);
  const results = document.createElement("div");
  results.classList.add("midi-results", "dnd5e-combat-rows");
  const section = document.createElement("div");
  section.classList.add(saves ? "midi-qol-saves-display" : "midi-qol-hits-display", "midi-qol-section-filled");
  const list = document.createElement("ul");
  list.classList.add("unlist", "evaluation", "wrapper");
  for ( const line of lines ) {
    const li = saves ? saveRow(line, context) : hitRow(line, context);
    // Like Midi-QOL: hover, click and right-click on the row act on the token.
    li.addEventListener("mouseenter", hoverTarget);
    li.addEventListener("mouseleave", leaveTarget);
    li.addEventListener("click", selectTarget);
    li.addEventListener("contextmenu", showTarget);
    list.append(li);
  }
  if ( saves ) {
    const holder = document.createElement("div");
    if ( context.save ) holder.append(...saveHeadings(context, lines.length));
    holder.append(list);
    section.append(holder);
  } else {
    const card = document.createElement("div");
    card.classList.add("midi-qol-single-hit-card");
    const evaluation = document.createElement("div");
    evaluation.classList.add("evaluation");
    evaluation.append(list);
    card.append(evaluation);
    section.append(card);
  }
  results.append(section);
  return results;
}

/** Is the DC shown to this user? To the GM, to the caster's owner, otherwise per dnd5e's setting. */
function challengeVisible(caster) {
  if ( game.user.isGM || caster?.testUserPermission?.(game.user, "OWNER") ) return true;
  let mode = "none";
  try { mode = game.settings.get("dnd5e", "challengeVisibility"); } catch { /* setting missing */ }
  return (mode === "all") || ((mode === "player") && !!caster?.hasPlayerOwner);
}

/** Share of damage on a successful save, as Midi-QOL notes it under the title. */
const ON_SAVE_MARK = Object.freeze({ none: "0", half: "½", full: "1" });

/**
 * Saving throw titles, as on the Midi-QOL card: "DC 14 Charisma Saving Throw" (plural for several targets, without the DC for
 * whoever must not see it), then, if the action deals damage, their share on a success.
 */
function saveHeadings({ save, damage, caster }, count) {
  const heading = text => {
    const div = document.createElement("div");
    div.classList.add("midi-qol-save-heading");
    const strong = document.createElement("strong");
    strong.append(...text);
    div.append(strong);
    return div;
  };
  const ability = CONFIG.DND5E?.abilities?.[save.ability]?.label ?? save.ability ?? "";
  const title = [];
  if ( Number.isFinite(save.dc) && challengeVisible(caster) ) {
    const dc = document.createElement("label");
    dc.classList.add("midi-qol-saveDC");
    dc.textContent = `${game.i18n.localize("DND5E.AbbreviationDC")} ${save.dc}`;
    title.push(dc, " ");
  }
  title.push(loc((count > 1) ? "Rangees.Sauvegardes" : "Rangees.Sauvegarde", { ability }));
  const out = [heading(title)];
  if ( damage ) out.push(heading([`${game.i18n.localize("DND5E.Damage")} ${ON_SAVE_MARK[save.onSave ?? "half"] ?? "½"}`]));
  return out;
}

/** A row's token, if it is on the displayed scene. */
function rowToken(event) {
  const uuid = event.currentTarget?.dataset?.uuid;
  const document = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return (document?.parent === canvas?.scene) ? document.object : null;
}

/** Hover over a row: the token is highlighted, unless it is already selected. */
let highlighted = null;
function hoverTarget(event) {
  const token = rowToken(event);
  if ( !token?.isVisible ) return;
  if ( !token.controlled ) token._onHoverIn(event);
  highlighted = token;
}

function leaveTarget(event) {
  highlighted?._onHoverOut(event);
  highlighted = null;
}

/** Click on a row: the token is selected (and the view pans to it) if the user owns it; a second click releases it. */
function selectTarget(event) {
  event.stopPropagation();
  event.preventDefault();
  const token = rowToken(event);
  if ( token?.controlled ) token.release();
  else if ( token?.isVisible && token.actor?.testUserPermission(game.user, "OWNER") ) {
    token.control({ releaseOthers: false });
    canvas.animatePan(token.center);
  }
}

/** Right-click on a row: the actor's sheet, for its owner. */
function showTarget(event) {
  event.stopImmediatePropagation();
  event.preventDefault();
  const token = rowToken(event);
  if ( token?.actor?.testUserPermission(game.user, "OWNER") ) token.actor.sheet?.render(true);
}

/** A target's name. */
function stackedName(line) {
  const stacked = document.createElement("div");
  stacked.classList.add("name-stacked");
  const name = document.createElement("span");
  name.classList.add("midi-qol-target-name", "title");
  name.textContent = line.name;
  stacked.append(name);
  return stacked;
}

function symbol(name, ...classes) {
  const icon = document.createElement("i");
  icon.className = [...classes, "fas", name].filter(Boolean).join(" ");
  return icon;
}

function portrait(line, css) {
  const img = document.createElement("img");
  img.classList.add(css);
  img.src = tokenImage(line.token) ?? "icons/svg/mystery-man.svg";
  img.alt = "";
  return img;
}

/** A target's row: its classes, its token, and what the engine did to it as a tooltip. */
function targetRow(line, ...classes) {
  const li = document.createElement("li");
  li.classList.add("target", "midi-qol", "midi-qol-target-select", ...classes);
  if ( line.token ) { li.dataset.uuid = line.token; li.dataset.id = line.token.split(".").at(-1); }
  // `tooltipText`: text, never re-read as HTML (a name, a roll's detail).
  if ( line.detail ) { li.dataset.tooltipText = line.detail; li.dataset.tooltipDirection = "LEFT"; }
  return li;
}

/**
 * An attack target: `li.target.success|failure` — check, double check on a Critical Hit, cross — and its AC for the GM. A target
 * without a verdict (healing, effect without a roll) has neither tint nor symbol.
 */
function hitRow(line, { plain=false }={}) {
  const neutral = plain && (line.css === "hit");
  const outcome = neutral ? null : ({ hit: "success", miss: "failure" }[line.css] ?? `dnd5e-combat-${line.css}`);
  const li = targetRow(line, "midi-qol-hit-class", ...(outcome ? [outcome] : []));
  li.append(symbol(neutral ? "" : (ROW_ICONS[line.critical ? "critical" : line.css] ?? ROW_ICONS.hit), "midi-qol-hit-symbol"));
  li.append(portrait(line, "midi-qol-target-img"), stackedName(line));
  if ( game.user.isGM && line.attack && Number.isFinite(line.ac) ) {
    const ac = document.createElement("div");
    ac.classList.add("midi-qol-ac");
    const value = document.createElement("span");
    value.classList.add("midi-qol-ac-value");
    value.textContent = line.ac;
    const inner = document.createElement("span");
    inner.append(symbol("fa-shield-halved"), " ", value);
    ac.append(inner);
    li.append(ac);
  }
  return li;
}

/** A save target: `li.target.success|failure` (the target's own), the total of its roll on the right, detailed on hover. */
function saveRow(line, { save=null, caster=null }={}) {
  const outcome = line.save ? (line.save.success ? "success" : "failure") : null;
  const li = targetRow(line, "midi-qol-save-class", outcome ?? `dnd5e-combat-${line.css}`);
  li.append(symbol(outcome ? (line.save.success ? "fa-check" : "fa-xmark") : (ROW_ICONS[line.css] ?? ROW_ICONS.pending),
    "midi-qol-save-symbol"));
  li.append(portrait(line, "midi-qol-save-img"));
  const name = document.createElement("div");
  name.classList.add("midi-qol-target-name", "midi-qol-save-name");
  name.append(stackedName(line));
  li.append(name);
  if ( Number.isFinite(line.save?.total) ) {
    const indicators = document.createElement("div");
    indicators.classList.add("midi-qol-save-indicators");
    const total = document.createElement("span");
    total.classList.add("midi-qol-tooltip", "midi-qol-save-total");
    total.append(String(line.save.total));
    const roll = game.messages.get(line.save.messageId)?.rolls?.[0];
    if ( roll ) {
      // Like Midi-QOL: the calculation as a tooltip (with the DC for whoever sees it), the roll on hover.
      const versus = (Number.isFinite(save?.dc) && challengeVisible(caster))
        ? ` vs ${game.i18n.localize("DND5E.AbbreviationDC")} ${save.dc}` : "";
      total.dataset.tooltipText = `${line.save.total} = ${roll.result}${versus}`;
      total.append(saveTooltip(roll, line.save, outcome));
    }
    indicators.append(total);
    li.append(indicators);
  }
  return li;
}

/** A target's saving throw, shown on hover over its total: formula, then tinted total. */
function saveTooltip(roll, save, outcome) {
  const tip = document.createElement("span");
  tip.classList.add("midi-qol-tooltiptext", "midi-qol-save-tooltip");
  const block = document.createElement("div");
  block.classList.add("dice-roll");
  block.dataset.action = "expandRoll";
  const result = document.createElement("div");
  result.classList.add("dice-result");
  const formula = document.createElement("div");
  formula.classList.add("dice-formula");
  formula.textContent = roll.formula;
  const total = document.createElement("h4");
  total.classList.add("dice-total", outcome);
  const icons = document.createElement("div");
  icons.classList.add("icons");
  const icon = symbol(save.success ? "fa-check" : "fa-xmark");
  icon.inert = true;
  icons.append(icon);
  const value = document.createElement("span");
  value.classList.add("total");
  value.textContent = save.total;
  total.append(icons, value);
  const collapser = document.createElement("div");
  collapser.classList.add("dice-tooltip-collapser");
  result.append(formula, collapser, total);
  roll.getTooltip().then(html => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const tip = template.content.querySelector(".dice-tooltip");
    if ( tip ) collapser.replaceChildren(tip);
  }).catch(() => {});
  block.append(result);
  tip.append(block);
  return tip;
}

function block(lines, context={}) {
  const div = document.createElement("div");
  div.classList.add("dnd5e-combat-result");
  // In rows, only one result per target: the reasons for Advantage, the bonuses and the waits remain lines.
  if ( rowsEnabled() && lines.length && lines.every(line => line.name) ) { div.append(rows(lines, context)); return div; }
  for ( const line of lines ) {
    const p = document.createElement("p");
    p.classList.add(line.css);
    fillLine(p, line);
    div.append(p);
  }
  return div;
}

/**
 * A line's content: its `text`, or its `nodes` pieces — a string, or `{ struck }` for a struck-out number (the discarded die of an
 * Advantage or Disadvantage, issue #47).
 */
export function fillLine(p, { text, nodes }) {
  if ( !nodes ) { p.textContent = text; return; }
  for ( const node of nodes ) {
    if ( typeof node === "string" ) { p.append(node); continue; }
    const s = document.createElement("s");
    s.textContent = node.struck;
    s.dataset.tooltip = loc("Compact.Ecarte");
    p.append(s);
  }
}

// An automatic reason per creature type (`type:plant`, core/conditions.mjs) is read through the type's name.
const statusName = id => String(id).startsWith("type:")
  ? game.i18n.localize(CONFIG.DND5E.creatureTypes[String(id).slice(5)]?.label ?? String(id).slice(5))
  : game.i18n.localize(CONFIG.statusEffects[id]?.name ?? id);

/**
 * A rule distance ("at 5 ft") in the scene's unit, formatted by dnd5e: "1.5 m" on a metric scene (SPEC §5.7;
 * the fixed text "5 ft" stayed in feet on a scene in meters — table feedback, 2026-10-17).
 */
function sceneLength(feet) {
  const units = canvas?.scene?.grid?.units ?? "ft";
  try { return dnd5e.utils.formatLength(convertLength(feet, "ft", units, readUnitFactors()), units); }
  catch { return dnd5e.utils.formatLength(feet, "ft"); }   // scene unit unknown to dnd5e: the rule in feet
}

/** A source of Advantage or Disadvantage (core/conditions.mjs), in plain words. */
export function describeReason(r) {
  if ( r.who === "situation" ) return game.i18n.format(`DND5ECOMBAT.Raison.${r.key}`, { distance: sceneLength(5), ally: r.ally ?? "" });
  if ( r.who === "content" ) return r.key;   // the name of the item that declares it (§16, B6)
  if ( r.key === "unseen" ) return loc(`Raison.unseen.${r.who}`);   // sight (P1): not a condition
  return game.i18n.format(`DND5ECOMBAT.Raison.${r.who}`, { status: r.key === "proneFar" ? loc("Raison.proneFar") : statusName(r.key) });
}

/**
 * "Advantage: target Prone, attacker Invisible": the lines, under the attack roll or on the single card (ui/compact.mjs).
 * §480: with the roll made (`roll`), one more line when an engine Disadvantage was discarded by hand (`manualModeOverride`).
 */
export function modifierLines(modifiers, roll=null) {
  const describe = describeReason;
  const lines = [];
  if ( !modifiers.agreed ) lines.push({ css: "pending", text: loc("CiblesDivergentes") });
  if ( modifiers.advantage?.length ) lines.push({ css: "hit", text: loc("LabelValue", { label: loc("Avantage"), value: modifiers.advantage.map(describe).join(", ") }) });
  if ( modifiers.disadvantage?.length ) lines.push({ css: "miss", text: loc("LabelValue", { label: loc("Desavantage"), value: modifiers.disadvantage.map(describe).join(", ") }) });
  if ( modifiers.advantage?.length && modifiers.disadvantage?.length ) lines.push({ css: "pending", text: loc("SAnnulent") });
  const manual = roll ? manualModeOverride(modifiers, roll.options) : null;
  if ( manual ) lines.push({ css: "pending", text: loc(`ModeManuel.${manual}`) });
  return lines;
}

/**
 * Issue #47: "Disadvantage: 11, 13", the 13 struck out — the kept die then the discarded die. dnd5e's roll line, like the
 * single card, only showed the kept die: a Disadvantage read like a normal roll, or the total and the die like two dice.
 * Returns the pieces of a line (`fillLine`), or null for a single-d20 roll.
 */
export function d20Nodes(roll) {
  const dice = keptAndDropped(roll?.dice?.[0]?.results, roll?.options?.advantageMode);
  if ( !dice ) return null;
  const nodes = [loc("LabelValue", { label: loc(dice.mode === 1 ? "Avantage" : "Desavantage"), value: dice.kept.join(", ") })];
  for ( const d of dice.dropped ) nodes.push(", ", { struck: String(d) });
  return nodes;
}

/** Under the unfolded attack roll (or without a single card): the two d20s of an Advantage or Disadvantage. */
function renderD20(message, html) {
  const nodes = (message.type === "attack") ? d20Nodes(message.rolls?.[0]) : null;
  if ( nodes ) html.querySelector(".message-content")?.append(block([{ css: "note", nodes }]));
}

function renderModifiers(html, modifiers, roll=null) {
  const lines = modifierLines(modifiers, roll);
  if ( lines.length ) html.querySelector(".message-content")?.append(block(lines));
}

/** "Hex: +1d6 necrotic": the lines, under the damage roll or on the single card. */
export function bonusLines(bonuses) {
  const typeName = t => game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t);
  // §161: several types to choose from (Conjure Minor Elementals).
  return bonuses.map(b => ({ css: "note", text: loc("DegatsBonus", { name: b.name, formula: b.formula, type: [b.damageType].flat().map(typeName).join(" / ") }) }));
}

/**
 * §408: the card of an action for which a rule was overridden — a "Rule overridden" banner at the top, the reasons as a tooltip and
 * below, visible to the whole table (user's rule: the player decides, the table is informed) — except with the setting
 * `overrideVisibility` (issue #178): then the GM and the one who forced it only.
 */
function renderOverridden(html, reasons) {
  const content = html.querySelector(".message-content");
  if ( !content || content.querySelector(".das-overridden") ) return;
  const div = document.createElement("div");
  div.className = "das-overridden";
  div.dataset.tooltip = reasons.join("<br>");
  const title = document.createElement("strong");
  title.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ';
  title.append(loc("Force.Carte"));
  const list = document.createElement("ul");
  for ( const reason of reasons ) {
    const li = document.createElement("li");
    li.textContent = reason;
    list.append(li);
  }
  div.append(title, list);
  content.prepend(div);
}

function renderBonuses(html, bonuses) {
  html.querySelector(".message-content")?.append(block(bonusLines(bonuses)));
}

/** "Unaffected: a Humanoid only", "unaffected: Immunity (Charmed)", "unaffected". */
function unaffectedText({ reason, detail }) {
  if ( reason === "type" ) return loc("NonAffecte.type", { types: typesLabel((detail ?? "").split(",").filter(Boolean)) });
  if ( reason === "immune" ) return loc("NonAffecte.immune", { status: statusName(detail) });
  if ( reason === "globe" ) return loc("NonAffecte.globe", { item: detail ?? "" });
  if ( reason === "antimagic" ) return loc("NonAffecte.antimagic", { item: detail ?? "" });
  if ( reason === "plane" ) return loc("NonAffecte.plane");
  if ( reason === "enclosed" ) return loc("NonAffecte.enclosed", { item: detail ?? "" });
  return loc("NonAffecte.content");
}

/** A target's verdict, in plain words. AC is never displayed. */
function verdictText(t) {
  const key = t.critical ? "Critique" : t.hit ? "Touche" : (t.reason === "cover" ? "AbriTotal" : "Rate");
  const notes = [];
  if ( t.reaction ) notes.push(t.reaction);
  if ( t.reason === "duplicate" ) notes.push(loc("Repliques.Note"));
  else if ( t.reason === "autoCritical" ) notes.push(loc("CritiqueDOffice"));
  else if ( t.reason === "beatsAc" ) notes.push(loc("CritOption.Ecart", { margin: critMargin() }));   // §207
  else if ( t.reason === "atCost" ) notes.push(loc("APrix.Note"));   // issue #32: success at a cost
  // P1 (b): the Cover computed by the engine, without the AC.
  if ( t.cover && (t.cover.bonus !== null) ) notes.push(`${loc(`Abri.${t.cover.degree}`)} +${t.cover.bonus}`);
  return `${loc(key)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** Hit / miss per target under the attack roll, visible to all, when the bearer is another message. */
function renderVerdict(html, resolution) {
  if ( !resolution.attack || [STEPS.AWAITING_ATTACK, STEPS.AWAITING_REACTION].includes(resolution.step) ) return;
  const lines = resolution.targets.map(t => ({ css: t.hit ? "hit" : "miss", text: `${t.name} — ${verdictText(t)}`,
    name: t.name, token: t.token, detail: verdictText(t), critical: !!(t.hit && t.critical), attack: true, ac: t.ac }));
  html.querySelector(".message-content")?.append(block(lines));
}

/** "Cancelled" note, or cancel button for the GM. */
function appendUndo(div, message, undone) {
  if ( undone ) {
    const p = document.createElement("p");
    p.classList.add("note");
    p.textContent = loc("Annule");
    div.append(p);
  } else if ( game.user.isGM ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = loc("Annuler");
    button.addEventListener("click", () => undo(message));
    div.append(button);
  }
}

/** Damage actually lost per target, and cancel button for the GM. */
function renderDamage(message, html, applied) {
  const lines = applied.lines.map(l => ({
    css: applied.undone ? "undone" : "hit",
    text: `${l.name} — ${lostOrHealed(l.applied)}`,
    name: l.name, token: l.token ?? null, detail: lostOrHealed(l.applied)
  }));
  const div = block(lines);
  appendUndo(div, message, applied.undone);
  html.querySelector(".message-content")?.append(div);
}

const lostOrHealed = applied => (applied < 0) ? loc("PvRendus", { n: -applied }) : loc("PvPerdus", { n: applied });

/**
 * In rows, once the action is settled, the card loses what the Midi-QOL card no longer has at this stage: dnd5e's attack roll,
 * damage and saving throw buttons (the rolls are made), the DC row (it is in the saves title),
 * dnd5e's save summaries (the rows give them) and the drawer of effects the engine has already applied. Not the card
 * of a cancelled action (`settled`).
 */
function trimCard(content, plan) {
  const spent = ["rollAttack", "rollDamage", "rollSave"].map(action => `.chat-card button[data-action="${action}"]`).join(", ");
  for ( const button of content.querySelectorAll(spent) ) {
    const item = button.closest("li") ?? button;
    const row = item.closest("section.icon-row");
    item.remove();
    if ( row && !row.querySelector("button") ) row.remove();
  }
  if ( plan.save ) {
    content.querySelector(".chat-card section.icon-row:has(> i.fa-shield-heart)")?.remove();
    for ( const summary of content.querySelectorAll(":scope > .card-summary") ) summary.remove();
  }
  if ( plan.effects?.length ) content.querySelector(":scope > effect-application")?.remove();
}

/**
 * The whole action on its bearer: one line per target — verdict, save, HP, effects — pending then
 * settled. Neither the AC nor the DC are displayed. As long as a Reaction can still
 * change the verdict, it is not shown.
 */
function renderResolution(message, html, resolution) {
  const { plan, step } = resolution;
  if ( step === STEPS.AWAITING_ATTACK ) return;
  const content = html.querySelector(".message-content");
  if ( !content ) return console.warn(`${MODULE_ID} | card without .message-content, resolution not shown`, html);
  if ( step === STEPS.AWAITING_REACTION ) return content.append(block([{ css: "pending", text: loc("ReactionEnAttente") }]));
  if ( pendingChoice(resolution) ) return content.append(block([{ css: "pending", text: loc("ChoixEnAttente") }]));
  // Not a cancelled card: the GM may want to reroll, it keeps dnd5e's buttons and its effects drawer.
  if ( rowsEnabled() && settled(step) ) trimCard(content, plan);

  const undone = step === STEPS.UNDONE;
  const lines = resolution.targets.map(t => {
    // §16.8: out of the action's reach (creature type, content rule, Immunity) — nothing else to say.
    if ( t.unaffected ) return { css: undone ? "undone" : "miss", text: `${t.name} — ${unaffectedText(t.unaffected)}`,
      name: t.name, token: t.token, detail: unaffectedText(t.unaffected) };
    const parts = [];
    let css = "hit";
    if ( plan.attack ) { parts.push(verdictText(t)); if ( !t.hit ) css = "miss"; }
    const reached = !plan.attack || t.hit;
    if ( plan.save && reached ) {
      if ( !t.save ) { parts.push(loc("SauvegardeAttendue")); css = "pending"; }
      else {
        // §232: `willing` — a willing creature (Otiluke's Resilient Sphere).
        parts.push((t.save.auto === "noSave") ? loc("SansSauvegarde") : (t.save.auto === "willing") ? loc("Consentant.Carte")
          : t.save.auto ? loc("SauvegardeDOffice", { status: statusName(t.save.auto) })
          : loc(t.save.success ? "SauvegardeReussie" : "SauvegardeRatee", { n: t.save.total }));
        if ( t.save.atCost ) parts.push(loc("APrix.Note"));   // issue #32: success at a cost
        if ( t.save.success && !plan.attack ) css = "miss";
      }
    }
    if ( t.damage ) parts.push(lostOrHealed(t.damage.applied));
    // #269 (§545): only some targets were Critical Hits — say which ones took the critical dice rolled apart.
    if ( t.damage && plan.attack && t.hit && t.critical && resolution.damageRoll?.critical?.length ) parts.push(loc("CoupCritique.DesCritiques"));
    if ( t.effects?.length ) parts.push(loc("EffetsAppliques", { n: t.effects.length }));
    // In rows: the target's saving throw (total, success) has its place on the right; an automatic save has none.
    const rolled = (plan.save && reached && t.save && !t.save.auto)
      ? { total: t.save.total, success: !!t.save.success, messageId: t.save.messageId } : null;
    return { css: undone ? "undone" : css, text: `${t.name} — ${parts.join(", ")}`,
      name: t.name, token: t.token, detail: parts.join(", "), critical: !!(plan.attack && t.hit && t.critical),
      attack: !!plan.attack, ac: plan.attack ? t.ac : null, ...(rolled ? { save: rolled } : {}) };
  });
  const caster = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
  const div = block(lines, { save: plan.save, damage: !!plan.damage, plain: !plan.attack && !plan.save, caster });
  if ( (step === STEPS.DONE) || undone ) appendUndo(div, message, undone);
  content.append(div);
}

/** Lightened log: off-screen cards are neither laid out nor painted (content-visibility, styles/dnd5e-combat.css). */
function applyChatLight() {
  document.body.classList.toggle("dnd5e-combat-chat-light", !!game.settings.get(MODULE_ID, CHAT_LIGHT_SETTING));
}

export function registerChat() {
  game.settings.register(MODULE_ID, CHAT_ROWS_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CHAT_ROWS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CHAT_ROWS_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => ui.chat?.render?.()
  });
  route("ready", applyChatLight, { label: "light chat log" });
  route("updateSetting", setting => { if ( setting.key === `${MODULE_ID}.${CHAT_LIGHT_SETTING}` ) applyChatLight(); },
    { label: "light chat log: setting changed" });
  // Not `renderChatMessageHTML`: the core emits it BEFORE dnd5e replaces the content of
  // `.message-content` with its own card (chat-message-data-model.mjs:80-82), which erased
  // our block. `dnd5e.renderChatMessage` is emitted afterwards (documents/chat-message.mjs:168).
  route("dnd5e.renderChatMessage", (message, html) => {
    const overridden = message.getFlag(MODULE_ID, "overridden");
    if ( overridden?.length && overriddenShownOn(message) ) renderOverridden(html, overridden);   // issue #178
    if ( message.isContentVisible !== false ) renderD20(message, html);   // a secret roll keeps its dice
    const modifiers = message.getFlag(MODULE_ID, "modifiers");
    if ( modifiers ) renderModifiers(html, modifiers, (message.type === "attack") ? message.rolls?.[0] : null);
    const bonuses = message.getFlag(MODULE_ID, "bonuses");
    if ( bonuses?.length ) renderBonuses(html, bonuses);
    // A resolution from an old schema (before 0.9.0) is no longer displayed.
    const resolution = current(message.getFlag(MODULE_ID, "resolution"));
    if ( resolution ) renderResolution(message, html, resolution);
    const verdict = message.getFlag(MODULE_ID, "verdict");
    const judged = verdict ? current(game.messages.get(verdict.carrier)?.getFlag(MODULE_ID, "resolution")) : null;
    if ( judged ) renderVerdict(html, judged);
    const applied = message.getFlag(MODULE_ID, "applied");
    if ( applied ) renderDamage(message, html, applied);
  }, { label: "verdict on the chat card" });
}
