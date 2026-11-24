/**
 * §536 (issue #160) : the standing mastery of a weapon — Tactical Master (Fighter 9, PHB 2024) and any other source of bonus
 * masteries let a weapon use Push, Sap or Slow instead of its own. The player chooses once per weapon, from the right-click menu of
 * their own token (GM side and player side) or of the weapon in the sheet's inventory (`dnd5e.getItemContextOptions`,
 * applications/components/inventory.mjs); the engine applies it at every attack (runtime/mastery.mjs) until it is changed.
 * The interface asks; runtime/mastery.mjs stores and gives the feedback.
 */

import { weaponsWithChoice, masteryChoicesOf, standingMasteryOf, masteryLabel } from "../adapter/mastery.mjs";
import { setStandingMastery } from "../runtime/mastery.mjs";
import { route } from "../runtime/router.mjs";
import { esc, loc } from "../runtime/shared.mjs";

/** The menu label of a weapon: « Mastery: Longsword (Sap) ». */
const entryLabel = item => loc("Botte.Permanente.Menu", { weapon: item.name, mastery: masteryLabel(standingMasteryOf(item)) });

/**
 * The choice window: one button per mastery the weapon offers, its own first (marked), the current one by default.
 * @returns {Promise<string|null>}
 */
async function askStanding(item) {
  const options = masteryChoicesOf(item);
  const current = standingMasteryOf(item);
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Botte.Permanente.Titre", { weapon: item.name }), icon: "fa-solid fa-chess-knight" },
    content: `<p>${esc(loc("Botte.Permanente.Question"))}</p>`,
    buttons: options.map((key, i) => ({
      action: key,
      label: i ? masteryLabel(key) : loc("Botte.Permanente.Propre", { mastery: masteryLabel(key) }),
      default: key === current
    })),
    rejectClose: false
  }).catch(() => null);
  return options.includes(choice) ? choice : null;
}

/** Ask, then store. */
export async function chooseStanding(item) {
  const choice = await askStanding(item);
  if ( choice ) await setStandingMastery(item, choice);
}

/** §536 : the entries of one's own token — one per weapon that offers a choice of mastery (only for an owner). */
export function standingMasteryEntries(token) {
  if ( !token?.isOwner || !token.actor ) return [];
  return weaponsWithChoice(token.actor).map(item => ({ icon: "fa-solid fa-chess-knight", label: entryLabel(item), run: () => chooseStanding(item) }));
}

/** §536 : the same choice in the weapon's menu in the sheet's inventory. */
function onItemContext(item, options) {
  if ( !item?.isOwner || !Array.isArray(options) || (masteryChoicesOf(item).length < 2) ) return;
  options.push({ label: entryLabel(item), icon: "fa-solid fa-chess-knight", group: "action", onClick: () => chooseStanding(item) });
}

export function registerStandingMasteryUi() {
  route("dnd5e.getItemContextOptions", onItemContext, { label: "standing mastery: no menu entry" });
}
