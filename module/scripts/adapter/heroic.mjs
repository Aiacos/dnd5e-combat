/**
 * §282: Heroic Inspiration, what touches dnd5e and the client — who has it (`system.attributes.inspiration`, player characters
 * only: "if you (a player character) have Heroic Inspiration"), what a roll read from its card is worth, and the question to
 * the player, filtered by THEIR setting (`heroicInspiration`, client: on every roll / only on a failure / never).
 *
 * The question goes out like the other combat choices (adapter/choices.mjs): to the connected player who owns the actor,
 * otherwise to the GM. It has its own query because the filter is read on the side of whoever answers: the setting is
 * that of their client.
 */

import { MODULE_ID } from "../constants.mjs";
import { handleChoiceQuery } from "./choices.mjs";
import { rollerFor } from "./concentration.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { heroicWanted, HEROIC_MODES, liveDice } from "../core/heroic.mjs";
import { d20Keep } from "../core/d20.mjs";

export const HEROIC_QUERY = `${MODULE_ID}.heroic`;
export const HEROIC_SETTING = "heroicInspiration";

/** Timeout for a player's answer (beyond that of their window). */
const HEROIC_TIMEOUT = 25000;

/** This client's setting: "on", "failure" or "off" ("on" if it cannot be read). */
export function heroicMode() {
  try {
    const mode = game.settings.get(MODULE_ID, HEROIC_SETTING);
    return HEROIC_MODES.includes(mode) ? mode : "on";
  }
  catch { return "on"; }
}

/** Does the player character have Heroic Inspiration? */
export function hasHeroic(actor) {
  return (actor?.type === "character") && !!actor.system?.attributes?.inspiration;
}

/**
 * What a d20 roll says about its d20s: the values rolled (not those that a dnd5e reroll replaced, Halfling Lucky), the mode
 * (Advantage: "kh", Disadvantage: "kl"), the total and the die's critical thresholds. null without a d20.
 */
export function d20Facts(roll) {
  const die = roll?.dice?.find?.(d => d.faces === 20);
  if ( !die || !Number.isFinite(roll.total) ) return null;
  const values = die.results.filter(r => !r.rerolled).map(r => r.result);
  if ( !values.length ) return null;
  // §435: dnd5e writes `adv` / `dis` on the d20, not `kh` / `kl` — a Disadvantage was read as an Advantage (the wrong d20 kept).
  const keep = d20Keep(die.modifiers, die.options?.advantageMode);
  const mode = (values.length < 2) ? null : (keep === "kl") ? "disadvantage" : "advantage";
  return { values, mode, total: roll.total,
    criticalSuccess: Number(die.options?.criticalSuccess) || 20, criticalFailure: Number(die.options?.criticalFailure) || 1 };
}

/**
 * The dice of a damage or healing roll, one per result rolled: its roll, its term, its place, its faces, its value, its type, its
 * modifiers (Great Weapon Fighting: "min3") and its properties (to find its share in the engine's aggregate).
 */
export function damageDice(rolls) {
  const dice = [];
  rolls.forEach((roll, r) => {
    // §435: the dice of the roll that Savage Attacker discards (`{2d6,2d6}kh`) are not offered — rerolling them would
    // change nothing.
    for ( const { term, result: res, index } of liveDice(roll.terms) ) {
      dice.push({ roll: r, result: index, faces: term.faces, value: res.result, type: roll.options?.type ?? null,
        properties: [...(roll.options?.properties ?? [])], modifiers: (term.modifiers ?? []).filter(m => /^(min|max)\d+$/.test(m)) });
    }
  });
  return dice;
}

/**
 * On the answering side: their setting first (`failed`: the roll failed — true, false, or null when the outcome is not known),
 * then the window, in the foreground. Returns `{ id }` ("skip": the setting wants none).
 */
export async function handleHeroicQuery(payload) {
  if ( !heroicWanted(heroicMode(), payload?.failed ?? null) ) return { id: "skip" };
  // Recognizable without shouting (user feedback, 2026-10-30): a star in the title, a golden rule, the rule in one line; the dice
  // to reroll as big tiles (runtime/heroic.mjs). No sound on opening: the audio feedback is that of the reroll.
  const heading = `<p class="dnd5e-combat-heroic-rule">${game.i18n.localize("DND5ECOMBAT.Heroique.Regle")}</p>`;
  return handleChoiceQuery({ ...payload, front: true, heading, icon: "fa-solid fa-star", classes: ["dnd5e-combat-heroic"] });
}

/**
 * On the client that asks the question: to the player who owns the actor, otherwise here. A window closed without choosing, a
 * player who does not answer: the roll is kept (Inspiration is not spent without consent, and the GM is not consulted
 * in their place).
 */
export async function askHeroic(actor, payload) {
  const userId = rollerFor(actor);
  if ( !userId || (userId === game.user.id) ) return handleHeroicQuery(payload);
  try { return await queryPlayer(game.users.get(userId), HEROIC_QUERY, payload, { timeout: HEROIC_TIMEOUT, actor, label: waitLabel("Heroique") }); }
  catch(err) {
    console.warn(`${MODULE_ID} | Heroic Inspiration for ${actor.name}: no answer from the player`, err);
    return null;
  }
}

/** Spends the Inspiration (false if it is no longer there: spent elsewhere in the meantime). */
export async function spendHeroic(actor) {
  if ( !hasHeroic(actor) ) return false;
  await actor.update({ "system.attributes.inspiration": false });
  return true;
}
