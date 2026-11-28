/**
 * §181: the factions window (GM) — the relations matrix, and assignment by drag and drop.
 *
 * - **Matrix**: one row and one column per faction; a click on a cell cycles the pair's relation:
 *   "=" (follow the disposition) → hostile → neutral → allied → "=". The matrix is symmetric.
 * - **Assign**: drag an actor from the sidebar onto a faction's row (applies to all its tokens); drag a
 *   faction's badge onto a scene token (that token only); a row's "selection" button (controlled tokens);
 *   the "None" zone removes the assignment (back to the per-type rules).
 * - **Edit**: name, color, rules by type / subtype / identifier, delete; "Suggested relations".
 * - A token HUD button opens the faction list; a token toolbar tool opens the window.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { PARTY, pairKey, RELATIONS } from "../core/factions.mjs";
import { factionSettings, factionName, factionOf, explicitFaction, NONE } from "../adapter/factions.mjs";
import { assignFaction, setRelation, addFaction, removeFaction, saveFactions, applySuggested } from "../runtime/factions.mjs";

const DRAG_TYPE = "DASFaction";
const CYCLE = [null, ...RELATIONS];
const ICON = { hostile: "fa-solid fa-swords", neutral: "fa-solid fa-minus", allied: "fa-solid fa-handshake" };

let FactionsClass = null;
/**
 * B6: the open window, whatever the path (toolbar button, HUD, settings menu) — a single instance,
 * the one the core holds for this id (`foundry.applications.instances`).
 */
const WINDOW_ID = "das-factions";
const openWindow = () => foundry.applications.instances.get(WINDOW_ID) ?? null;

/** The controlled tokens on the canvas, as documents. */
const selected = () => (canvas?.tokens?.controlled ?? []).map(t => t.document);

export const FactionsApp = () => FactionsClass ??= class FactionsApp extends foundry.applications.api.ApplicationV2 {
  /** B6: a single instance — the settings menu creates the window with `new`: it receives the one already open. */
  constructor(options={}) {
    const existing = openWindow();
    if ( existing instanceof FactionsApp ) return existing;
    super(options);
  }

  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-screen", "das-factions"],
    window: { title: "DND5ECOMBAT.Factions.Titre", icon: "fa-solid fa-flag", resizable: true },
    position: { width: 780, height: "auto" }
  };

  async _renderHTML() {
    const { factions, relations } = factionSettings();
    const scene = canvas?.scene ?? null;
    const counts = new Map();
    for ( const t of scene?.tokens ?? [] ) {
      const f = factionOf(t);
      if ( f ) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const chip = f => `<span class="das-faction-chip" draggable="true" data-drag-faction="${esc(f.id)}" style="--faction:${esc(f.color)}"
      data-tooltip="${esc(loc("Factions.GlisserToken"))}">${esc(factionName(f))}</span>`;
    const head = factions.map(f => `<th class="das-faction-col" style="--faction:${esc(f.color)}" data-tooltip="${esc(factionName(f))}">
      <span>${esc(factionName(f))}</span></th>`).join("");
    const rows = factions.map(a => {
      const cells = factions.map(b => {
        if ( a.id === b.id ) return `<td class="das-rel self"></td>`;
        const value = relations[pairKey(a.id, b.id)] ?? null;
        const title = loc(`Factions.Relation.${value ?? "disposition"}`);
        return `<td class="das-rel ${value ?? "disposition"}" data-a="${esc(a.id)}" data-b="${esc(b.id)}" data-tooltip="${esc(`${factionName(a)} ↔ ${factionName(b)} : ${title}`)}">
          ${value ? `<i class="${ICON[value]}"></i>` : "="}</td>`;
      }).join("");
      return `<tr class="das-faction-row" data-faction="${esc(a.id)}">
        <th class="das-faction-head">${chip(a)} <span class="das-muted das-faction-count" data-tooltip="${esc(loc("Factions.Compte"))}">${counts.get(a.id) ?? 0}</span>
          <button type="button" class="das-icon" data-assign="${esc(a.id)}" data-tooltip="${esc(loc("Factions.AffecterSelection"))}"><i class="fa-solid fa-crosshairs"></i></button>
        </th>${cells}</tr>`;
    }).join("");
    const editors = factions.map(f => {
      const party = f.id === PARTY;
      const rules = k => esc((f.rules?.[k] ?? []).join(", "));
      return `<tr data-edit="${esc(f.id)}">
        <td><input type="color" name="color" value="${esc(f.color)}"></td>
        <td><input type="text" name="name" value="${esc(f.name)}" placeholder="${esc(factionName({ ...f, name: "" }))}"></td>
        <td><input type="text" name="types" value="${rules("types")}" ${party ? "disabled" : ""} placeholder="beast, undead"></td>
        <td><input type="text" name="subtypes" value="${rules("subtypes")}" ${party ? "disabled" : ""} placeholder="goblinoid"></td>
        <td><input type="text" name="identifiers" value="${rules("identifiers")}" ${party ? "disabled" : ""} placeholder="wolf"></td>
        <td>${party ? "" : `<button type="button" class="das-icon" data-remove="${esc(f.id)}" data-tooltip="${esc(loc("Factions.Supprimer"))}"><i class="fa-solid fa-trash"></i></button>`}</td>
      </tr>`;
    }).join("");
    const root = document.createElement("div");
    root.className = "das-factions__body";
    root.innerHTML = `
      <p class="das-muted">${esc(loc("Factions.Aide"))}</p>
      <div class="das-factions__matrix"><table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="das-factions__none" data-faction="${NONE}">
        <i class="fa-solid fa-ban"></i> ${esc(loc("Factions.ZoneAucune"))}
        <button type="button" class="das-button ghost" data-clear="selection">${esc(loc("Factions.RetirerSelection"))}</button>
      </div>
      <div class="das-factions__tools">
        <button type="button" class="das-button" data-action="add"><i class="fa-solid fa-plus"></i> ${esc(loc("Factions.Ajouter"))}</button>
        <button type="button" class="das-button ghost" data-action="suggest"><i class="fa-solid fa-lightbulb"></i> ${esc(loc("Factions.Suggerer"))}</button>
      </div>
      <details class="das-factions__edit"><summary>${esc(loc("Factions.Editer"))}</summary>
        <table><thead><tr><th></th><th>${esc(loc("Factions.Nom"))}</th><th>${esc(loc("Factions.Types"))}</th>
          <th>${esc(loc("Factions.SousTypes"))}</th><th>${esc(loc("Factions.Identifiants"))}</th><th></th></tr></thead>
          <tbody>${editors}</tbody></table>
        <p class="das-muted">${esc(loc("Factions.AideRegles"))}</p>
        <button type="button" class="das-button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${esc(loc("Factions.Enregistrer"))}</button>
      </details>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this.#listen(content);
  }

  #listen(root) {
    const rerender = () => this.render();
    root.querySelectorAll("td.das-rel[data-a]").forEach(td => td.addEventListener("click", async () => {
      const value = factionSettings().relations[pairKey(td.dataset.a, td.dataset.b)] ?? null;
      const next = CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
      await setRelation(td.dataset.a, td.dataset.b, next);
      rerender();
    }));
    root.querySelectorAll("[data-assign]").forEach(b => b.addEventListener("click", async () => {
      const tokens = selected();
      if ( !tokens.length ) return ui.notifications.info(loc("Factions.RienSelectionne"));
      await assignFaction(tokens, b.dataset.assign);
      rerender();
    }));
    root.querySelector("[data-clear]")?.addEventListener("click", async () => {
      const tokens = selected();
      if ( !tokens.length ) return ui.notifications.info(loc("Factions.RienSelectionne"));
      await assignFaction(tokens, null);
      rerender();
    });
    root.querySelector("[data-action=add]")?.addEventListener("click", async () => {
      await addFaction({ name: loc("Factions.NouvelleFaction") });
      rerender();
    });
    root.querySelector("[data-action=suggest]")?.addEventListener("click", async () => { await applySuggested(); rerender(); });
    root.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: loc("Factions.Supprimer") },
        content: `<p>${esc(loc("Factions.SupprimerConfirmer", { name: b.closest("tr").querySelector("[name=name]").value || b.dataset.remove }))}</p>` });
      if ( ok ) { await removeFaction(b.dataset.remove); rerender(); }
    }));
    root.querySelector("[data-action=save]")?.addEventListener("click", async () => {
      const current = factionSettings();
      const split = v => String(v ?? "").split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      const factions = current.factions.map(f => {
        const row = root.querySelector(`tr[data-edit="${CSS.escape(f.id)}"]`);
        if ( !row ) return f;
        const val = n => row.querySelector(`[name=${n}]`)?.value;
        return { ...f, name: val("name") ?? f.name, color: val("color") ?? f.color,
          rules: f.id === PARTY ? {} : { types: split(val("types")), subtypes: split(val("subtypes")), identifiers: split(val("identifiers")) } };
      });
      await saveFactions({ ...current, factions });
      ui.notifications.info(loc("Factions.Enregistre"));
      rerender();
    });
    // Drag a badge (onto a scene token); drop an actor on a row or on "None".
    root.querySelectorAll("[data-drag-faction]").forEach(el => el.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, faction: el.dataset.dragFaction }));
    }));
    root.querySelectorAll("[data-faction]").forEach(zone => {
      zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("drop"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
      zone.addEventListener("drop", async ev => {
        ev.preventDefault();
        zone.classList.remove("drop");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
        const id = zone.dataset.faction === NONE ? null : zone.dataset.faction;
        let count = 0;
        if ( data?.type === "Actor" ) {
          const actor = await fromUuid(data.uuid);
          if ( actor?.documentName === "Actor" ) count = await assignFaction([actor], id);
        } else if ( data?.type === "Folder" ) {
          const folder = await fromUuid(data.uuid);
          if ( folder?.type === "Actor" ) count = await assignFaction(folder.contents, id);
        }
        // #275: the row count only shows tokens on this scene, so an actor without a token here leaves it unchanged —
        // say what the drop did.
        if ( count ) {
          const faction = factionSettings().factions.find(f => f.id === id);
          ui.notifications.info(id ? loc("Factions.Affecte", { count, name: faction ? factionName(faction) : id })
            : loc("Factions.Retire", { count }));
        }
        rerender();
      });
    });
  }

};

/** Open (or bring to the front) the window. */
export function openFactions() {
  return new (FactionsApp())().render({ force: true });
}

/** A badge dropped on the scene: the token under the cursor joins the faction. */
function onDropCanvas(canvasRef, data) {
  if ( (data?.type !== DRAG_TYPE) || !game.user.isGM ) return;
  const token = canvas.tokens.placeables.filter(t => t.visible && t.bounds.contains(data.x, data.y))
    .sort((a, b) => b.document.sort - a.document.sort)[0];
  if ( !token ) return false;
  assignFaction([token.document], data.faction).then(() => openWindow()?.render());
  return false;
}

/** The token HUD (GM): a button in its faction's color, which opens the list. */
function onTokenHUD(hud, html) {
  if ( !game.user.isGM || !iconsShown() ) return;
  const token = hud.document;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !token || !column ) return;
  const { factions } = factionSettings();
  const current = factions.find(f => f.id === factionOf(token)) ?? null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon das-faction-hud";
  if ( current ) button.style.setProperty("--faction", current.color);
  button.dataset.tooltip = current ? loc("Factions.HUD", { name: factionName(current) }) : loc("Factions.HUDAucune");
  button.innerHTML = `<i class="fa-solid fa-flag"></i>`;
  button.addEventListener("click", async ev => {
    ev.preventDefault(); ev.stopPropagation();
    const own = token.getFlag(MODULE_ID, "faction") ?? "";
    const options = [`<option value="">${esc(loc("Factions.ParDefaut"))}</option>`, `<option value="${NONE}" ${own === NONE ? "selected" : ""}>${esc(loc("Factions.Aucune"))}</option>`,
      ...factions.map(f => `<option value="${esc(f.id)}" ${own === f.id ? "selected" : ""}>${esc(factionName(f))}</option>`)].join("");
    const inherited = explicitFaction(token) && !own ? `<p class="das-muted">${esc(loc("Factions.DeLActeur"))}</p>` : "";
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("Factions.HUDTitre", { name: token.name }) },
      content: `<div class="form-group"><label>${esc(loc("Factions.Choix"))}</label><select name="faction">${options}</select></div>${inherited}
        <label class="checkbox"><input type="checkbox" name="actor"> ${esc(loc("Factions.PourActeur"))}</label>`,
      ok: { label: "OK", callback: (event, b) => ({ faction: b.form.elements.faction.value, actor: b.form.elements.actor.checked }) },
      rejectClose: false
    });
    if ( !value ) return;
    const target = (value.actor && token.baseActor) ? token.baseActor : token;
    await assignFaction([target], value.faction || null);
    hud.render();
    openWindow()?.render();
  });
  column.append(button);
}

/**
 * Faction icons (token toolbar tool, token HUD button): a world setting, unchecked by default — the GM
 * displays them if they use them (user's decision, 2026-10-18).
 */
const ICONS_SETTING = "factionIcons";
const iconsShown = () => game.settings.get(MODULE_ID, ICONS_SETTING) === true;

export function registerFactionsUI() {
  game.settings.register(MODULE_ID, ICONS_SETTING, {
    name: "DND5ECOMBAT.Reglage.factionIcons.nom", hint: "DND5ECOMBAT.Reglage.factionIcons.aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => ui.controls?.render({ reset: true })
  });
  // The factions window opens from the settings window (Vision and Stealth tab, ui/settings.mjs).
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM || !iconsShown() ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools["das-factions"] = { name: "das-factions", order: last + 1, icon: "fa-solid fa-flag", title: "DND5ECOMBAT.Factions.Titre",
      button: true, visible: true, onChange: () => openFactions() };
  }, { label: "factions: tool" });
  route("renderTokenHUD", onTokenHUD, { label: "factions: token HUD" });
  route("dropCanvasData", onDropCanvas, { label: "factions: token drop", cancellable: true });
  route(`${MODULE_ID}.factionsChanged`, () => openWindow()?.render(), { label: "factions: window refresh" });
}
