/**
 * §242 (issue #18): the rolls requested by the GM, on screen.
 *
 *  - **Request window** (GM): the label ("Jump the bridge"), the roll type (ability check, saving throw, skill,
 *    tool) and what is rolled, the characters concerned (dnd5e's group, the players' characters, plus the selected tokens
 *    or the one we come from; a green dot for a connected player), the DC (optional, hidden or not from players), Advantage /
 *    Disadvantage, a fixed modifier and the 2024 group check. "Request" hands over to runtime/group-roll.mjs.
 *  - **Where to open it**: a die in the token toolbar, the "Request a roll" entry of the engine menu on a creature (GM,
 *    ui/pointer-menu.mjs), and `api.rolls.open({ actors })`.
 *  - **Save as macro**: a script macro that redoes the same request (same characters, same check, same options), in one click
 *    from the macro bar.
 *  - **Card**: dnd5e's request card, completed — the DC ("hidden" for players), the successes that dnd5e does not mark
 *    (hidden DC: the rolls carry none, only the GM sees them), and the group's verdict.
 */

import { MODULE_ID } from "../constants.mjs";
import { ROLL_TYPES, normalizeRequest } from "../core/group-roll.mjs";
import { requestOf, viewOf, toolLabel, testTitle } from "../adapter/group-roll.mjs";
import { requestGroupRoll } from "../runtime/group-roll.mjs";
import { openTracker } from "./group-roll-tracker.mjs";
import { decorateGroupCard } from "./success-at-cost.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

/* -------------------------------------------- */
/*  Request window                              */
/* -------------------------------------------- */

/** The GM's last choice on this client, reused at the next opening (except the characters). */
let remembered = { type: "skill", key: "ath", dc: "", hideDc: false, mode: "normal", bonus: "", group: false };

/** What can be rolled for each type, sorted by name. */
function keyChoices(type) {
  const sort = list => list.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  if ( (type === "check") || (type === "save") ) {
    return Object.entries(CONFIG.DND5E.abilities ?? {}).map(([value, a]) => ({ value, label: game.i18n.localize(a.label) }));
  }
  if ( type === "skill" ) return sort(Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, s]) => ({ value, label: game.i18n.localize(s.label) })));
  return sort(Object.keys(CONFIG.DND5E.tools ?? {}).map(value => ({ value, label: toolLabel(value) })));
}

/** The (non-GM) players who own the actor. */
const ownersOf = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));

/** The characters offered: dnd5e's group, the players', then those brought in (selected tokens…). */
function candidates(extra=[]) {
  const out = new Map();
  const add = actor => { if ( actor?.system?.abilities && !out.has(actor.uuid) ) out.set(actor.uuid, actor); };
  for ( const member of game.actors.party?.system?.members ?? [] ) add(member.actor ?? member);
  for ( const user of game.users ) if ( !user.isGM ) add(user.character);
  for ( const actor of extra ) add(actor);
  return [...out.values()];
}

const windowId = "das-group-roll";
let GroupRollClass = null;

const GroupRollApp = () => GroupRollClass ??= class GroupRollApp extends foundry.applications.api.ApplicationV2 {
  /** @param {{actors?: Actor[]}} [preset]  The characters checked by default; without them, those of the connected players. */
  constructor(preset={}, options={}) {
    super({ ...options, id: windowId });
    this.preset = preset.actors ?? [];
    const { ability=null, ...values } = preset.values ?? {};
    this.values = { label: "", ...remembered, ...values };
    // §536: a non-default ability (`[[/check int ath]]`) is kept while the test stays the one that came with it.
    this.ability = ability ? { type: values.type, key: values.key, ability } : null;
    const list = candidates(this.preset);
    const online = list.filter(a => ownersOf(a).some(u => u.active));
    const start = this.preset.length ? this.preset : (online.length ? online : list);
    this.chosen = new Set(start.map(a => a.uuid));
  }

  static DEFAULT_OPTIONS = {
    classes: ["das-screen", "das-group-roll"],
    window: { icon: "fa-solid fa-dice-d20", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      send: GroupRollApp.#send,
      macro: GroupRollApp.#macro,
      tracker: () => openTracker(),
      pick: GroupRollApp.#pick
    }
  };

  get title() {
    return loc("JetGroupe.Titre");
  }

  async _renderHTML() {
    const v = this.values;
    // §397: initiative is requested by starting the combat (ui/combat-launch.mjs), not here.
    const types = ROLL_TYPES.filter(t => t !== "initiative").map(t => `<option value="${t}" ${v.type === t ? "selected" : ""}>${esc(loc(`JetGroupe.Type.${t}`))}</option>`).join("");
    const keys = keyChoices(v.type);
    if ( !keys.some(k => k.value === v.key) ) v.key = keys[0]?.value ?? "";
    const keyOptions = keys.map(k => `<option value="${esc(k.value)}" ${v.key === k.value ? "selected" : ""}>${esc(k.label)}</option>`).join("");
    const modes = ["advantage", "normal", "disadvantage"].map(m => `<label class="das-group-roll__mode">
      <input type="radio" name="mode" value="${m}" ${v.mode === m ? "checked" : ""}> ${esc(loc(`JetGroupe.Mode.${m}`))}</label>`).join("");
    const people = candidates(this.preset).map(actor => {
      const owners = ownersOf(actor);
      const online = owners.some(u => u.active);
      const who = owners.length ? owners.map(u => esc(u.name)).join(", ") : esc(loc("JetGroupe.SansJoueur"));
      const on = this.chosen.has(actor.uuid);
      return `<label class="das-group-roll__actor${on ? " on" : ""}">
        <input type="checkbox" data-uuid="${esc(actor.uuid)}" ${on ? "checked" : ""}>
        <img src="${esc(actor.img)}" alt="">
        <span class="name">${esc(actor.name)}<small><i class="fa-solid fa-circle ${online ? "online" : "offline"}"></i> ${who}</small></span>
      </label>`;
    }).join("");
    return `<form class="das-group-roll__body" autocomplete="off">
      <div class="das-group-roll__row">
        <label class="wide">${esc(loc("JetGroupe.Libelle"))}
          <input type="text" name="label" value="${esc(v.label)}"></label>
      </div>
      <div class="das-group-roll__row">
        <label>${esc(loc("JetGroupe.TypeJet"))}<select name="type">${types}</select></label>
        <label class="wide">${esc(loc(`JetGroupe.Cle.${v.type}`))}<select name="key">${keyOptions}</select></label>
      </div>
      <div class="das-group-roll__row">
        <label>${esc(loc("JetGroupe.DD"))}<input type="number" name="dc" min="0" max="40" value="${esc(v.dc)}" placeholder="—"></label>
        <label class="check"><input type="checkbox" name="hideDc" ${v.hideDc ? "checked" : ""}> ${esc(loc("JetGroupe.DDCache"))}</label>
        <label>${esc(loc("JetGroupe.Bonus"))}<input type="number" name="bonus" min="-20" max="20" value="${esc(v.bonus)}" placeholder="0"></label>
      </div>
      <div class="das-group-roll__row modes">${modes}</div>
      <label class="check"><input type="checkbox" name="group" ${v.group ? "checked" : ""}> ${esc(loc("JetGroupe.Groupe"))}</label>
      <p class="das-muted">${esc(loc("JetGroupe.GroupeAide"))}</p>
      <fieldset class="das-group-roll__actors">
        <legend>${esc(loc("JetGroupe.Personnages"))}
          <button type="button" class="das-link" data-action="pick" data-pick="online">${esc(loc("JetGroupe.Connectes"))}</button>
          <button type="button" class="das-link" data-action="pick" data-pick="all">${esc(loc("JetGroupe.Tous"))}</button>
          <button type="button" class="das-link" data-action="pick" data-pick="none">${esc(loc("JetGroupe.Aucun"))}</button>
        </legend>
        ${people || `<p class="das-muted">${esc(loc("JetGroupe.AucunPersonnage"))}</p>`}
      </fieldset>
      <footer class="das-group-roll__foot">
        <button type="button" class="das-button ghost" data-action="tracker"><i class="fa-solid fa-list-check"></i>${esc(loc("JetGroupe.Suivi.Bouton"))}</button>
        <button type="button" class="das-button ghost" data-action="macro" ${this.chosen.size ? "" : "disabled"}
          data-tooltip="${esc(loc("JetGroupe.MacroAide"))}"><i class="fa-solid fa-code"></i>${esc(loc("JetGroupe.Macro"))}</button>
        <button type="button" class="das-button" data-action="send" ${this.chosen.size ? "" : "disabled"}>
          <i class="fa-solid fa-dice-d20"></i>${esc(loc("JetGroupe.Demander", { count: this.chosen.size }))}</button>
      </footer>
    </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const form = content.querySelector("form");
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("change", event => {
      const input = event.target;
      if ( input.dataset.uuid ) {
        if ( input.checked ) this.chosen.add(input.dataset.uuid);
        else this.chosen.delete(input.dataset.uuid);
      }
      this.#read(form);
      // The type changes the list of what is rolled; a checked box changes the button's count.
      if ( (input.name === "type") || input.dataset.uuid ) this.render();
    });
  }

  /** The form's values, kept from one render to the next. */
  #read(form) {
    const f = form.elements;
    Object.assign(this.values, {
      label: f.label.value, type: f.type.value, key: f.key.value, dc: f.dc.value, hideDc: f.hideDc.checked, bonus: f.bonus.value,
      mode: form.querySelector("input[name=mode]:checked")?.value ?? "normal", group: f.group.checked
    });
  }

  static #pick(event, target) {
    const list = candidates(this.preset);
    const which = target.dataset.pick;
    this.chosen = new Set(list.filter(a => (which === "all") || ((which === "online") && ownersOf(a).some(u => u.active))).map(a => a.uuid));
    this.#read(this.element.querySelector("form"));
    this.render();
  }

  /** The request as the window describes it, ready for `api.rolls.request` (characters as uuids). */
  #request() {
    this.#read(this.element.querySelector("form"));
    const v = this.values;
    return { actors: [...this.chosen], type: v.type, key: v.key, dc: v.dc, hideDc: v.hideDc, bonus: v.bonus, label: v.label, group: v.group,
      advantage: v.mode === "advantage", disadvantage: v.mode === "disadvantage" };
  }

  /**
   * "Save as macro": a script macro (in the macro directory, to drag onto the bar) that redoes this request —
   * same characters (those that no longer exist are ignored), same check, same options — through the engine's public API.
   */
  static async #macro() {
    const input = this.#request();
    const { request, error } = normalizeRequest(input);
    if ( error || !input.actors.length ) return ui.notifications.warn(loc("JetGroupe.Erreur"));
    const data = { ...request, actors: input.actors };
    const name = request.label || testTitle(request);
    const command = [
      `// DAS · Core — ${loc("JetGroupe.MacroCommentaire", { name })}`,
      `const rolls = game.modules.get("dnd5e-combat")?.api?.rolls;`,
      `if ( !rolls || !game.user.isGM ) return ui.notifications.warn(${JSON.stringify(loc("JetGroupe.MacroMJ"))});`,
      `const request = ${JSON.stringify(data, null, 2)};`,
      `request.actors = request.actors.filter(uuid => fromUuidSync(uuid));`,
      `if ( !request.actors.length ) return ui.notifications.warn(${JSON.stringify(loc("JetGroupe.MacroPersonne"))});`,
      `rolls.request(request);`
    ].join("\n");
    const macro = await Macro.implementation.create({ name, type: "script", img: "icons/svg/d20-highlight.svg", command });
    if ( macro ) ui.notifications.info(loc("JetGroupe.MacroCreee", { name: macro.name }));
  }

  static async #send() {
    this.#read(this.element.querySelector("form"));
    const v = this.values;
    const actors = [...this.chosen].map(uuid => fromUuidSync(uuid)).filter(Boolean);
    if ( !actors.length ) return;
    const { label, ...kept } = v;   // the label is not kept from one request to the next
    remembered = kept;
    this.close();
    try {
      const ability = ((this.ability?.type === v.type) && (this.ability?.key === v.key)) ? this.ability.ability : null;
      await requestGroupRoll({ actors, type: v.type, key: v.key, ability, dc: v.dc, hideDc: v.hideDc, bonus: v.bonus, label: v.label, group: v.group,
        advantage: v.mode === "advantage", disadvantage: v.mode === "disadvantage" });
    } catch(err) {
      console.error(err);
      ui.notifications.error(loc("JetGroupe.Erreur"));
    }
  }
};

/**
 * Opens the request window (GM). `actors`: actors, tokens or uuids checked by default; `values`: the pre-filled fields
 * (`type`, `key`, `dc`, `hideDc`, `mode`, `bonus`, `label`, `group`, and `ability` for a skill or tool with another ability).
 */
export function openGroupRoll({ actors=[], values={} }={}) {
  if ( !game.user.isGM ) return null;
  const list = actors.map(a => (typeof a === "string") ? fromUuidSync(a) : (a?.actor ?? a)).filter(a => a instanceof Actor);
  foundry.applications.instances.get(windowId)?.close();
  const app = new (GroupRollApp())({ actors: list, values });
  app.render({ force: true });
  return app;
}

/** The actors of the selected tokens, plus the one we come from. */
function withSelection(token=null) {
  const list = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  if ( token?.actor && !list.includes(token.actor) ) list.push(token.actor);
  return list;
}

/** The engine menu entry on a character (ui/pointer-menu.mjs), GM only. */
export function groupRollEntry(target) {
  if ( !game.user.isGM || !target?.actor?.system?.abilities ) return null;
  return { icon: "fa-solid fa-dice-d20", label: loc("JetGroupe.Menu"), run: () => openGroupRoll({ actors: withSelection(target) }) };
}

/* -------------------------------------------- */
/*  Carte                                       */
/* -------------------------------------------- */

function onRenderCard(message, html) {
  if ( !requestOf(message) ) return;
  const view = viewOf(message);
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !view || !root ) return;
  root.classList.add("das-group-roll-card");
  const gm = game.user.isGM;
  const { request } = view;
  const lines = [];
  if ( request.label ) lines.push(`<p class="das-group-roll__label">${esc(request.label)}</p>`);
  if ( request.dc !== null ) {
    const dc = (request.hideDc && !gm) ? loc("JetGroupe.CarteDDCache") : loc(request.hideDc ? "JetGroupe.CarteDDCacheMJ" : "JetGroupe.CarteDD", { dc: request.dc });
    lines.push(`<p class="das-group-roll__dc">${esc(dc)}</p>`);
  }
  const tags = [];
  if ( request.advantage ) tags.push(loc("JetGroupe.Mode.advantage"));
  if ( request.disadvantage ) tags.push(loc("JetGroupe.Mode.disadvantage"));
  if ( request.bonus ) tags.push(`${request.bonus > 0 ? "+" : ""}${request.bonus}`);
  if ( request.group ) tags.push(loc("JetGroupe.CarteGroupe"));
  if ( tags.length ) lines.push(`<p class="das-group-roll__tags">${tags.map(esc).join(" · ")}</p>`);
  const content = root.querySelector(".message-content") ?? root;
  content.querySelector(".das-group-roll__head")?.remove();
  const head = document.createElement("div");
  head.className = "das-group-roll__head";
  head.innerHTML = lines.join("");
  content.prepend(head);

  // The total and success of each line are ours: dnd5e reads only the roll (without the Bardic Inspiration die added
  // afterwards), and with a hidden DC the rolls have no target — dnd5e marks nothing. Always to the GM, to players when the
  // DC is not hidden.
  for ( const item of root.querySelectorAll(".targets [data-uuid]") ) {
    const entry = view.entries.find(e => e.uuid === item.dataset.uuid);
    const status = item.querySelector(".status");
    if ( !status || !entry ) continue;
    // Pending a decision: the roll is there, the Bardic Inspiration die not yet settled.
    const raw = status.querySelector(".total");
    if ( entry.deciding && raw ) {
      raw.textContent = `${entry.rolled}…`;
      raw.dataset.tooltip = loc("JetGroupe.CarteDecision");
    }
    if ( entry.status !== "rolled" ) continue;
    const total = status.querySelector(".total");
    if ( total && entry.bonus ) {
      total.textContent = String(entry.total);
      total.dataset.tooltip = loc("JetGroupe.CarteBonus", { bonus: entry.bonus });
    }
    if ( (entry.success === null) || (request.hideDc && !gm) ) continue;
    status.classList.toggle("success", entry.success);
    status.classList.toggle("failure", !entry.success);
    status.querySelectorAll(".fa-check, .fa-xmark").forEach(i => i.remove());
    status.append(foundry.applications.fields.createFontAwesomeIcon(entry.success ? "check" : "xmark"));
  }
  // Issue #32: success at a cost — GM button on a line that failed by 1 or 2, mark on an accepted line.
  decorateGroupCard(message, root, view, { what: testTitle(request) });
  // The verdict: always to the GM, to players when the DC is not hidden.
  root.querySelector(".das-group-roll__verdict")?.remove();
  if ( (view.success !== null) && (gm || !request.hideDc) ) {
    const verdict = document.createElement("p");
    verdict.className = `das-group-roll__verdict ${view.success ? "success" : "failure"}`;
    const key = request.group ? (view.success ? "VerdictGroupeReussi" : "VerdictGroupeRate") : (view.success ? "VerdictReussi" : "VerdictRate");
    verdict.textContent = loc(`JetGroupe.${key}`, { successes: view.successes, count: view.entries.length });
    content.append(verdict);
  }
}

export function registerGroupRollUI() {
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-group-roll"] = { name: "das-group-roll", order: last + 1, icon: "fa-solid fa-dice-d20", title: "DND5ECOMBAT.JetGroupe.Titre",
      button: true, visible: true, onChange: () => openGroupRoll({ actors: withSelection() }) };
  }, { always: true, label: "group roll: tool" });
  route("dnd5e.renderChatMessage", onRenderCard, { always: true, label: "group roll: card" });
}
