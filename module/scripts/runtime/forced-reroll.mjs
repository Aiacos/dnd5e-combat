/**
 * §489: the forced reroll of an attack roll — `reroll` step of a "hit" reaction (a monster's Parry: "the attacker rerolls its
 * attack roll and must use the new result").
 *
 * The attack message's roll is rerolled as is: `Roll#reroll` (core, client/dice/roll.mjs:475) evaluates a clone, same formula, same
 * Advantage, same bonuses (the cloned D20Roll keeps `options.configured`, dnd5e dice/d20-roll.mjs:24). It goes out on its own card,
 * in the name of the attacker, Dice So Nice awaited; then the core re-judges that hit against the target alone (core/action.mjs,
 * `reactionResolved`, `roll`).
 * What was added to the first roll afterwards (Bardic Inspiration, Heroic) does not follow: it is a new roll.
 *
 * Return to the whole table: text above the reactor and sound ("parry succeeded" if the hit now misses, otherwise
 * "the hit goes through").
 */

import { MODULE_ID } from "../constants.mjs";
import { d20Mode } from "../adapter/messages.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { esc, loc, log, notice, waitForDice } from "./shared.mjs";

/** The rerolled roll, in the core's form (core/attack.mjs, `AttackRoll`), plus the old total (`from`). */
function rollFacts(roll, from) {
  return { total: roll.total, isCritical: roll.isCritical === true, isFumble: roll.isFumble === true,
    ...(Number.isFinite(roll.d20?.total) ? { natural: roll.d20.total } : {}), ...(d20Mode(roll) ? { mode: d20Mode(roll) } : {}), from };
}

/**
 * Rerolls the resolution's attack roll, for the target `target` that reacted.
 * @param {object} resolution        The resolution awaiting a reaction (its `attack.messageId`).
 * @param {object} target            The resolution's target (`ac`, `cover`, `name`).
 * @param {Actor} reactor            Whoever forces the reroll.
 * @param {string} name              The reaction's name ("Parry").
 * @param {number} ac                The target's AC for this re-judging (Cover included).
 * @returns {Promise<object|null>}   The new roll (`AttackRoll` + `from`), or null if the original roll cannot be found.
 */
export async function forceReroll(resolution, target, reactor, name, ac) {
  const message = game.messages.get(resolution?.attack?.messageId ?? "");
  const roll = message?.rolls?.[0];
  if ( !roll?.reroll ) {
    console.warn(`${MODULE_ID} | ${name}: the attack roll to reroll was not found, nothing rerolled`);
    return null;
  }
  const from = resolution.attack.roll?.total ?? roll.total;
  const again = await roll.reroll();
  const facts = rollFacts(again, from);
  const attacker = message.speaker?.alias ?? message.getAssociatedActor?.()?.name ?? "";
  const lands = !facts.isFumble && (facts.isCritical || (Number.isFinite(ac) && (facts.total >= ac)));
  const card = await again.toMessage({ speaker: message.speaker,
    flavor: esc(loc("RelanceForcee.Carte", { name: reactor.name, item: name, attacker, before: from, after: facts.total })),
    flags: { [MODULE_ID]: { forcedReroll: { reactor: reactor.uuid, item: name, target: target?.token ?? null, from, total: facts.total,
      fumble: facts.isFumble } } } });
  if ( card ) await waitForDice(card);
  const token = tokenOf(reactor);
  if ( token ) notice(token, { key: lands ? "RelanceForcee.AvisTouche" : "RelanceForcee.AvisPare", data: { item: name, before: from, after: facts.total } },
    "strike", { all: true, action: "reroll", outcome: lands ? "failure" : "success" });
  log(`${reactor.name}: ${name}, ${attacker} rerolls the attack ${from} → ${facts.total}${facts.isFumble ? " (natural 1)" : ""}`);
  return facts;
}
