/**
 * §458 : `onUsesSpent: { activity?, effects }` — quand les utilisations de l'item sont épuisées, ces effets de l'item sont posés sur son
 * porteur, une fois. Les six livres du Guide (Manuels de vitalité, d'exercices physiques, de vivacité ; Traités de perspicacité,
 * d'autorité, de compréhension) : « Read » (`activity`, pour mémoire) coche une heure de lecture (48 utilisations) ; le +2 à la
 * caractéristique vient au bout des 48 heures, pas à chaque heure (la donnée l'oubliait, ou le posait à chaque lecture).
 *
 * Sur la mise à jour du compteur (`updateItem`, `system.uses.spent`), MJ actif : au `dnd5e.postUseActivity`, l'item ne montre pas encore
 * l'utilisation qui vient d'être décomptée (vu au banc : 47 / 48 au moment du hook de la 48e lecture). « Reset Progress » remet le
 * compteur à zéro : il ne déclenche rien. Une seule fois : un effet déjà posé par ce livre (marque `usesSpent`) n'est pas reposé.
 * Retour pour toute la table : texte et son, carte de chat.
 */

import { MODULE_ID } from "../constants.mjs";
import { CORE_SOUNDS } from "../core/action-feedback.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { locEsc, log, notice, say } from "./shared.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

async function onUpdateItem(item, changes) {
  if ( !foundry.utils.hasProperty(changes, "system.uses.spent") ) return;
  const actor = item?.actor;
  if ( !actor ) return;
  const rule = contentOf(item).entry?.onUsesSpent;
  if ( !rule ) return;
  const uses = item.system?.uses;
  if ( !(Number(uses?.max) > 0) || (Number(uses.value) > 0) ) return;
  const source = item._stats?.compendiumSource ?? item.uuid;
  const already = actor.effects.filter(e => e.getFlag(MODULE_ID, "usesSpent")?.source === source).map(e => e.getFlag(MODULE_ID, "usesSpent").effect);
  const data = rule.effects.filter(id => !already.includes(id)).map(id => item.effects.get(id)).filter(Boolean).map(effect => {
    const d = effect.toObject();
    delete d._id;
    d.transfer = false;
    d.disabled = false;
    d.origin = source;
    foundry.utils.setProperty(d, `flags.${MODULE_ID}.usesSpent`, { source, effect: effect.id });
    return d;
  });
  if ( !data.length ) return;
  const created = await actor.createEmbeddedDocuments("ActiveEffect", data);
  const names = created.map(e => e.name).join(", ");
  notice(tokenOfActor(actor), { key: "Retour.Acheve", data: { item: item.name, effect: names } }, "gain", { all: true, sound: CORE_SOUNDS.chime });
  await say({ actor }, [locEsc("Retour.AcheveCarte", { actor: actor.name, item: item.name, effect: names })]);
  log(`${actor.name}: ${item.name} completed, ${names} applied`);
}

export function registerUsesSpent() {
  route("updateItem", onUpdateItem, { executor: true, label: "effect of a completed item not applied" });
}
