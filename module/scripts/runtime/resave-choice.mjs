/**
 * §485: replay the save of a carried effect, as a Reaction (Indomitable: "at the end of a hostile creature's turn, make the saving
 * throw again against an effect or a condition affecting it"). The Reaction (`use` step) is already taken by the
 * `enemyTurnEnd` window (runtime/reactions.mjs); here, the effect is chosen by the one playing the creature — its player,
 * failing that the GM (adapter/choices.mjs, same circuit as the choice of an exclusive effect) — then its save is replayed by
 * the usual card (adapter/areas.mjs,
 * `resaveAgainst`, "reaction" moment): succeeded, the effect ends. A single effect: no question. Active GM only.
 */

import { savableEffectsOf } from "../adapter/facts.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { log, loc, notice } from "./shared.mjs";

/** The label of an effect to replay: its name, the item that applied it, the save's DC. */
function optionOf({ effect, activity }) {
  const dc = Number(activity.save?.dc?.value);
  return { id: effect.uuid, label: loc("Resave.Option", { effect: effect.name, item: activity.item?.name ?? "", dc: Number.isFinite(dc) ? dc : "?" }),
    icon: "fa-solid fa-rotate" };
}

/**
 * @param {Actor} actor                 The reactor.
 * @param {TokenDocument} token         Its token.
 * @param {{own: string, advantage?: boolean}} rule  The `resave` step of the Reaction taken.
 * @param {string} name                 The Reaction's name (title of the question).
 * @returns {Promise<boolean>}  Was a save replayed?
 */
export async function resaveChosen(actor, token, rule, name) {
  const candidates = savableEffectsOf(actor);
  if ( !candidates.length || !token ) {
    log(`${name}: ${actor.name} has no effect whose saving throw can be repeated`);
    if ( token ) notice(token, loc("Resave.RienARejouer", { name: actor.name }));
    return false;
  }
  let picked = candidates[0];
  if ( candidates.length > 1 ) {
    const answer = await askChoice(actor, { actor: actor.uuid, item: name, prompt: loc("Resave.Choisir", { name: actor.name }),
      options: candidates.map(optionOf) });
    // Window closed without choosing: the Reaction is taken, the effect the first in the list (like a choice left to the timeout).
    picked = candidates.find(c => c.effect.uuid === answer?.id) ?? candidates[0];
  }
  log(`${name}: ${actor.name} repeats the saving throw against "${picked.effect.name}" (${picked.activity.item?.name ?? "?"})`);
  await resaveAgainst(picked.effect, picked.activity, token, "reaction", { advantage: rule.advantage === true });
  return true;
}
