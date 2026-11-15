/**
 * §456 : `leavesEffects: [ids d'effets]` — quand l'item quitte la fiche (supprimé de l'acteur), ces effets de l'item sont posés sur
 * l'ancien porteur. Marque du sacrifice (Ravenloft) : « si cette Bénédiction est retirée, … Désavantage aux sauvegardes de Sagesse
 * pendant 24 heures » — la donnée porte l'effet « (Removed) » et demande au MJ de le poser à la main.
 *
 * Pas lors d'un remplacement par le diagnostic (supprimer puis recréer le même objet, option `{ [MODULE_ID]: { replacing: true } }`).
 * Retour pour toute la table (règle DAS) : texte au-dessus du token et son chez chacun, carte de chat (vue même sans token sur la scène).
 * MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { CORE_SOUNDS } from "../core/action-feedback.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { esc, locEsc, log, notice, say } from "./shared.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

async function onDeleteItem(item, options) {
  const actor = item?.parent;
  if ( (actor?.documentName !== "Actor") || options?.[MODULE_ID]?.replacing ) return;
  const ids = contentOf(item).entry?.leavesEffects;
  if ( !ids?.length ) return;
  const data = ids.map(id => item.effects.get(id)).filter(Boolean).map(effect => {
    const d = effect.toObject();
    delete d._id;
    d.transfer = false;
    d.disabled = false;
    d.origin = item._stats?.compendiumSource ?? item.uuid;
    foundry.utils.setProperty(d, `flags.${MODULE_ID}.leftBy`, { item: item.name, identifier: item.system?.identifier ?? "" });
    return d;
  });
  if ( !data.length ) return;
  const created = await actor.createEmbeddedDocuments("ActiveEffect", data);
  const names = created.map(e => e.name).join(", ");
  notice(tokenOfActor(actor), { key: "Retour.Laisse", data: { item: item.name, effect: names } }, "loss",
    { all: true, sound: CORE_SOUNDS.fade });
  await say({ actor }, [locEsc("Retour.LaisseCarte", { actor: actor.name, item: item.name, effect: names })]);
  log(`${actor.name}: ${esc(item.name)} removed, ${names} applied`);
}

export function registerLeaves() {
  route("deleteItem", onDeleteItem, { executor: true, label: "effect left by a removed item not applied" });
}
