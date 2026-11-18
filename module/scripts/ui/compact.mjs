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
 * Les rangées de jet de dnd5e (`section.icon-row` : le total, le d20, et le détail des dés au clic) d'un jet replié, telles que
 * le système les dessine dans sa propre carte — pour la carte en rangées (réglage `chatRows`), qui montre les jets comme le
 * système et non en lignes de texte. Le HTML rendu est gardé par message tant que le message ne change pas : la carte
 * d'utilisation est redessinée plusieurs fois par action.
 */
const nativeRows = new Map();

async function nativeRowsOf(message) {
  const key = `${message._stats?.modifiedTime ?? 0}:${message.rolls?.length ?? 0}`;
  const kept = nativeRows.get(message.id);
  if ( kept?.key === key ) return kept.html;
  const rendered = await message.renderHTML();
  // Seulement les rangées de jet : la rangée « Cibles » du système (pastilles, avec la CA) ferait double emploi avec les rangées
  // par cible de cette carte, qui ne montrent ni la CA ni le DD.
  const html = Array.from(rendered.querySelectorAll(".message-content > section.icon-row"))
    .filter(section => section.querySelector("button.dice-roll")).map(section => section.outerHTML);
  nativeRows.set(message.id, { key, html });
  return html;
}

/** Pose dans `host` les rangées de jet du système pour ces messages, dans l'ordre ; le détail des dés s'ouvre au clic. */
async function fillNativeRows(host, messages) {
  const all = await Promise.all(messages.map(m => nativeRowsOf(m).catch(() => [])));
  if ( !host.isConnected && !host.parentElement ) return;
  const template = document.createElement("template");
  template.innerHTML = all.flat().join("");
  // dnd5e relie le bouton au détail par `popoverTargetElement` (propriété, perdue en passant par le HTML) : on la remet.
  for ( const section of template.content.querySelectorAll("section.icon-row") ) {
    const button = section.querySelector("button.dice-roll");
    const breakdown = section.querySelector("[popover]");
    if ( button && breakdown ) button.popoverTargetElement = breakdown;
  }
  host.replaceChildren(template.content);
}

/** Le résumé des jets sur la carte d'utilisation, et le bouton qui les déplie. */
function renderSummary(carrier, html) {
  const folded = foldedIn(carrier);
  if ( !folded.length ) return;
  // En rangées (`chatRows`) : les jets sont montrés par les rangées du système, pas par une ligne de texte.
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
    host.classList.add("dnd5e-combat-native-rolls");
    div.append(host);
    fillNativeRows(host, folded.filter(m => !rolling.has(m.id)))
      .catch(err => console.error(`${MODULE_ID} | native roll rows`, err));
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
  route("deleteChatMessage", message => { nativeRows.delete(message.id); }, { label: "single card: roll rows kept" });
  // Inscrit AVANT ui/chat.mjs : le résumé des dés précède le verdict par cible.
  route("dnd5e.renderChatMessage", onRender, { label: "single card: render" });
}
