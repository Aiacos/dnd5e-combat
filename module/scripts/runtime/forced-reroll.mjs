/**
 * §489 : la relance forcée d'un jet d'attaque — étape `reroll` d'une réaction « touché » (Parade d'un monstre : « l'attaquant relance son
 * jet d'attaque et doit utiliser le nouveau résultat »).
 *
 * Le jet du message d'attaque est relancé tel quel : `Roll#reroll` (cœur, client/dice/roll.mjs:475) évalue un clone, même formule, même
 * Avantage, mêmes bonus (le D20Roll cloné garde `options.configured`, dnd5e dice/d20-roll.mjs:24). Il part sur sa propre carte, au nom
 * de l'attaquant, Dice So Nice attendu ; puis le cœur rejuge ce coup contre la cible seule (core/action.mjs, `reactionResolved`, `roll`).
 * Ce qui s'était ajouté au premier jet après coup (Inspiration bardique, héroïque) ne suit pas : c'est un nouveau jet.
 *
 * Retour à toute la table : texte au-dessus du réacteur et son (« parade réussie » si le coup rate désormais, sinon « le coup passe »).
 */

import { MODULE_ID } from "../constants.mjs";
import { d20Mode } from "../adapter/messages.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { esc, loc, log, notice, waitForDice } from "./shared.mjs";

/** Le jet relancé, dans la forme du cœur (core/attack.mjs, `AttackRoll`), plus l'ancien total (`from`). */
function rollFacts(roll, from) {
  return { total: roll.total, isCritical: roll.isCritical === true, isFumble: roll.isFumble === true,
    ...(Number.isFinite(roll.d20?.total) ? { natural: roll.d20.total } : {}), ...(d20Mode(roll) ? { mode: d20Mode(roll) } : {}), from };
}

/**
 * Relance le jet d'attaque de la résolution, pour la cible `target` qui a réagi.
 * @param {object} resolution        La résolution en attente de réaction (son `attack.messageId`).
 * @param {object} target            La cible de la résolution (`ac`, `cover`, `name`).
 * @param {Actor} reactor            Celui qui force la relance.
 * @param {string} name              Le nom de la réaction (« Parade »).
 * @param {number} ac                La CA de la cible pour ce rejugement (abri compris).
 * @returns {Promise<object|null>}   Le nouveau jet (`AttackRoll` + `from`), ou null si le jet d'origine est introuvable.
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
