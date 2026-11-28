/**
 * The turn budget in the combat tracker (SPEC §6): action / Bonus Action / Reaction pips,
 * remaining attacks, movement, and the Dash / Disengage / Dodge buttons. This is the GM's display: players
 * look at their own interface (Darsh UI DnD5, which reads `api.ui`, §40.1). Reading the budget and the clicks are shared
 * (ui/budget.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { budgetView, budgetVisible, applyBudgetIntent } from "./budget.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

const LETTERS = { action: "A", bonus: "B", reaction: "R" };

function pip({ key, available }, editable) {
  const el = document.createElement(editable ? "button" : "span");
  if ( editable ) el.type = "button";
  el.classList.add("pip", available ? "available" : "spent");
  el.dataset.key = key;
  el.textContent = LETTERS[key];
  el.dataset.tooltip = loc(`Pastille.${key}`);
  return el;
}

function budgetRow(combatant) {
  const view = budgetView(combatant);
  const row = document.createElement("div");
  row.classList.add("dnd5e-combat-budget");
  row.append(...view.resources.map(r => pip(r, view.editable)));
  if ( view.attacks ) {
    const attacks = document.createElement("span");
    attacks.classList.add("attacks");
    attacks.textContent = view.attacks.text;
    if ( view.attacks.tooltip ) attacks.dataset.tooltip = view.attacks.tooltip;
    row.append(attacks);
  }
  if ( view.movement ) {
    const move = document.createElement("span");
    move.classList.add("movement");
    if ( view.movement.over ) move.classList.add("over");
    move.textContent = `${view.movement.spent} / ${view.movement.allowance} ${view.movement.units}`;
    row.append(move);
    if ( view.editable && view.ownTurn ) {
      for ( const common of view.commons ) {
        if ( common.done ) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("dash");
        button.dataset.key = common.key;
        button.textContent = common.label;
        button.disabled = !common.enabled;
        row.append(button);
      }
    }
  }
  if ( view.editable ) row.addEventListener("click", async event => {
    const key = event.target.closest("[data-key]")?.dataset.key;
    if ( !key ) return;
    event.stopPropagation();   // do not activate the combatant under the pip
    await applyBudgetIntent(combatant, key);
  });
  return row;
}

function onRenderCombatTracker(app, html) {
  const combat = app.viewed ?? game.combat;
  if ( !combat?.started ) return;
  for ( const li of html.querySelectorAll("li.combatant[data-combatant-id]") ) {
    const combatant = combat.combatants.get(li.dataset.combatantId);
    // The GM's NPCs do not reveal their budget to players.
    if ( !budgetVisible(combatant) ) continue;
    li.append(budgetRow(combatant));
  }
}

export function registerTracker() {
  route("renderCombatTracker", onRenderCombatTracker, { label: "budget in the tracker" });

  // Movement lives on the token, not on the combatant: the tracker does not see it move by itself.
  const refresh = foundry.utils.debounce(() => ui.combat?.render(), 150);
  route("updateToken", (token, changes) => {
    if ( game.combat?.started && (("x" in changes) || ("y" in changes) || ("_movementHistory" in changes)) ) refresh();
  }, { label: "tracker: movement" });
  route("updateCombatant", (combatant, changes) => {
    if ( changes.flags?.[MODULE_ID] ) refresh();
  }, { label: "tracker: budget" });
}
