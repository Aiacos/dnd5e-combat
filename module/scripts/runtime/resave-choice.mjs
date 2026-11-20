/**
 * §485 : rejouer la sauvegarde d'un effet porté, en réaction (Indomptable : « à la fin du tour d'une créature hostile, refait le jet
 * de sauvegarde contre un effet ou un état qui l'affecte »). La réaction (étape `use`) est déjà prise par la fenêtre `enemyTurnEnd`
 * (runtime/reactions.mjs) ; ici, l'effet est choisi par celui qui joue la créature — son joueur, à défaut le MJ (adapter/choices.mjs,
 * même circuit que le choix d'un effet exclusif) — puis sa sauvegarde est rejouée par la carte habituelle (adapter/areas.mjs,
 * `resaveAgainst`, moment « reaction ») : réussie, l'effet tombe. Un seul effet : pas de question. MJ actif uniquement.
 */

import { savableEffectsOf } from "../adapter/facts.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Le libellé d'un effet à rejouer : son nom, l'item qui l'a posé, le DD de la sauvegarde. */
function optionOf({ effect, activity }) {
  const dc = Number(activity.save?.dc?.value);
  return { id: effect.uuid, label: loc("Resave.Option", { effect: effect.name, item: activity.item?.name ?? "", dc: Number.isFinite(dc) ? dc : "?" }),
    icon: "fa-solid fa-rotate" };
}

/**
 * @param {Actor} actor                 Le réacteur.
 * @param {TokenDocument} token         Son token.
 * @param {{own: string, advantage?: boolean}} rule  L'étape `resave` de la réaction prise.
 * @param {string} name                 Le nom de la réaction (titre de la question).
 * @returns {Promise<boolean>}  Une sauvegarde a-t-elle été rejouée ?
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
    // Fenêtre fermée sans choisir : la réaction est prise, l'effet le premier de la liste (comme un choix laissé au délai).
    picked = candidates.find(c => c.effect.uuid === answer?.id) ?? candidates[0];
  }
  log(`${name}: ${actor.name} repeats the saving throw against "${picked.effect.name}" (${picked.activity.item?.name ?? "?"})`);
  await resaveAgainst(picked.effect, picked.activity, token, "reaction", { advantage: rule.advantage === true });
  return true;
}
