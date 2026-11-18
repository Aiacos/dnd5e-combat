/**
 * Carte unique (SPEC §58, réglage de monde `chatCompact`, activé par défaut) : une action ne laisse plus qu'une carte dans le
 * journal, celle de son utilisation — comme la carte fusionnée de Midi-QOL.
 *
 *  - Les messages de jet qu'une utilisation entraîne (`attack`, `damage`, `healing` de dnd5e 6, dont `system.origin` est
 *    l'id du message d'utilisation : activity/attack.mjs:158-166, activity/mixin.mjs:879-885) restent en base — Dice So Nice, les animations (BLFX), le moteur et l'annulation les lisent —
 *    mais sont **repliés** : `display: none` dans le journal et en surimpression, ni mis en page ni dessinés.
 *  - La carte d'utilisation reçoit le résumé de ces jets (attaque, dégâts par type) au-dessus du verdict par cible
 *    (ui/chat.mjs) ; un bouton « Détails » rouvre, sur ce client, les cartes repliées de cette action.
 *  - Les sauvegardes et tests, dnd5e les résume déjà dans la carte d'utilisation (réglage client `chatCardSummary`, activé
 *    par défaut : data/chat-message/usage-message-data.mjs:228, documents/chat-message.mjs:154) : on n'y touche pas.
 *  - Un jet n'apparaît sur la carte qu'une fois ses dés 3D arrêtés (`waitForDice`), comme le verdict.
 *
 * Rien n'est écrit : tout est rendu, sur chaque client. Désactiver le réglage rend le journal d'avant.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc, waitForDice } from "../runtime/shared.mjs";
import { attackMark } from "../core/attack.mjs";
import { STEPS } from "../core/action.mjs";
import { modifierLines, bonusLines, d20Nodes, fillLine, rowsEnabled } from "./chat.mjs";

export const CHAT_COMPACT_SETTING = "chatCompact";

/** Types de message de jet qu'une action replie dans sa carte d'utilisation. */
const FOLDED_TYPES = new Set(["attack", "damage", "healing"]);

/** Jets dont les dés 3D roulent encore : pas encore montrés sur la carte. */
const rolling = new Set();
/** Cartes d'utilisation dont les jets sont dépliés sur ce client. */
const unfolded = new Set();

const enabled = () => { try { return !!game.settings.get(MODULE_ID, CHAT_COMPACT_SETTING); } catch { return false; } };

/** La carte d'utilisation où ce jet se replie, ou null. */
export function carrierOf(message) {
  if ( !FOLDED_TYPES.has(message?.type) ) return null;
  const origin = message._source?.system?.origin;
  const carrier = origin ? game.messages.get(origin) : null;
  return (carrier?.type === "usage") ? carrier : null;
}

/** Les jets repliés dans cette carte, dans l'ordre : ils viennent toujours après elle. */
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

/** « Attaque : 17 (d20 : 12, critique) » ; avec deux d20 (issue #47) : « Attaque : 9 (Désavantage : 4, 17) », le dé écarté barré. */
function attackLine(message, carrier=null) {
  const roll = message.rolls?.[0];
  if ( !roll ) return null;
  const d20 = roll.dice?.[0]?.total ?? null;
  const notes = [];
  const twoDice = d20Nodes(roll);
  if ( !twoDice && (d20 !== null) ) notes.push(loc("LabelValue", { label: "d20", value: d20 }));
  // Un 19 au seuil de critique abaissé qui rate n'est ni « critique » ni vert : le verdict jugé sur ce jet tranche.
  const resolution = carrier?.getFlag(MODULE_ID, "resolution");
  const natural = roll.d20?.total ?? d20;
  const mark = attackMark({ isCritical: roll.isCritical === true, isFumble: roll.isFumble === true,
    ...(Number.isFinite(natural) ? { natural } : {}) }, (resolution?.attack?.messageId === message.id) ? resolution.targets : null);
  if ( mark === "critical" ) notes.push(loc("Compact.Critique"));
  else if ( mark === "fumble" ) notes.push(loc("Compact.Echec"));
  const css = (mark === "critical") ? "hit" : ((mark === "fumble") ? "miss" : "note");
  const head = loc("LabelValue", { label: loc("Compact.Attaque"), value: roll.total });
  // Deux d20 : « Attaque : 9 (Désavantage : 4, 17, critique) », le 17 barré.
  if ( twoDice ) return { css, title: roll.formula, nodes: [`${head} (`, ...twoDice, `${notes.map(n => `, ${n}`).join("")})`] };
  return { css, title: roll.formula, text: `${head}${notes.length ? ` (${notes.join(", ")})` : ""}` };
}

/** « Dégâts : 9 (6 tranchants + 3 feu) » — par type, comme le plateau de dégâts du système. */
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
 * Les jets d'une action repliée, en blocs de dés comme sur la carte de Midi-QOL (ses gabarits `attack-roll.html` et
 * `damage-roll.html`, MIT) : une étiquette (Attaque, Avantage, Désavantage, Dégâts), la formule, le détail des dés qui se déplie
 * au clic, le total — teinté selon le verdict pour l'attaque, précédé de l'icône du type pour les dégâts. Pour la carte en
 * rangées (réglage `chatRows`). Le HTML est gardé par message tant qu'il ne change pas : la carte d'utilisation est redessinée
 * plusieurs fois par action.
 */
const midiBlocks = new Map();

const escapeHTML = text => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * Le détail des dés d'un jet, dans l'enveloppe repliable de dnd5e (que son gabarit fournit déjà, ou non selon la version), annoté
 * comme sur la carte de Midi-QOL : le nom de ce que vaut chaque terme constant d'une attaque, le type sous le total des dégâts.
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
 * Les termes constants d'un jet d'attaque sans nom : le modificateur de la caractéristique du jet, puis le bonus de maîtrise, quand
 * leurs valeurs sont celles de l'acteur — sinon le terme reste sans nom (un bonus de situation n'est pas deviné).
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
 * Le détail d'un jet de dégâts ou de soins, comme Midi-QOL le montre : quand il n'a qu'un groupe de dés, ses termes constants
 * rejoignent les dés et le total est celui du jet ; le type est écrit sous le total quand dnd5e ne l'a pas fait.
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

/** L'étiquette d'un jet d'attaque : son mode. */
function attackLabel(roll) {
  const mode = roll.options?.advantageMode ?? 0;
  return game.i18n.localize((mode > 0) ? "DND5E.Advantage" : (mode < 0) ? "DND5E.Disadvantage" : "DND5E.Attack");
}

/**
 * Le verdict d'un jet d'attaque sur la carte, comme Midi-QOL le marque : `success` ou `failure` selon qu'une cible est touchée,
 * plus `critical` (coche double) ou `fumble` (deux croix).
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

/** Les icônes des types d'un jet de dégâts ou de soins, celles de dnd5e. */
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
 * Pose dans `host` les blocs de dés de ces messages, dans l'ordre de la carte de Midi-QOL : l'attaque, les cibles touchées ou
 * ratées (la liste que ui/chat.mjs a posée plus bas sur la même carte y est remontée), puis les dégâts.
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
  // La section des sauvegardes ferme la zone, vide s'il n'y en a pas (elle y a son retrait, comme sur la carte de Midi-QOL).
  const saves = rows?.querySelector(":scope > .midi-qol-saves-display") ?? document.createElement("div");
  saves.classList.add("midi-qol-saves-display");
  host.append(saves);
  gatherActions(host.closest(".message-content"));
}

/** Les boutons du moteur (détails des jets, annulation) sur une seule ligne, sous la zone de résultats. */
function gatherActions(content) {
  const buttons = Array.from(content?.querySelectorAll(":scope > .dnd5e-combat-result > button") ?? []);
  if ( !buttons.length ) return;
  const bar = document.createElement("div");
  bar.classList.add("dnd5e-combat-actions");
  bar.append(...buttons);
  content.append(bar);
  // Les blocs vidés de leurs rangées et de leur bouton ne gardent pas leur place.
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

/** Le résumé des jets sur la carte d'utilisation, et le bouton qui les déplie. */
function renderSummary(carrier, html) {
  const folded = foldedIn(carrier);
  if ( !folded.length ) return;
  // En rangées (`chatRows`) : les jets sont montrés en blocs de dés, comme sur la carte de Midi-QOL, pas par une ligne de texte.
  const native = rowsEnabled();
  const lines = [];
  for ( const m of folded ) {
    if ( rolling.has(m.id) ) continue;
    const line = native ? null : ((m.type === "attack") ? attackLine(m, carrier) : damageLine(m));
    if ( line ) lines.push(line);
    // Ce que le moteur écrit sous ces jets (raisons d'Avantage, dégâts ajoutés) : sur la carte, puisqu'ils sont repliés.
    const modifiers = m.getFlag(MODULE_ID, "modifiers");
    if ( modifiers ) lines.push(...modifierLines(modifiers));
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
  // Avant le verdict par cible (ui/chat.mjs l'ajoute ensuite) : les dés, puis ce qu'ils ont fait.
  html.querySelector(".message-content")?.append(div);
}

/** Replie ou déplie les cartes d'un jet déjà dans le DOM (journal, surimpression, fenêtre détachée). */
function setFolded(message, folded) {
  for ( const li of document.querySelectorAll(`.chat-message[data-message-id="${message.id}"]`) ) li.classList.toggle("dnd5e-combat-folded", folded);
}

/** Redessine la carte d'utilisation (une fois par lot d'arrivées). */
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
  // Inscrit AVANT ui/chat.mjs : le résumé des dés précède le verdict par cible.
  route("dnd5e.renderChatMessage", onRender, { label: "single card: render" });
}
