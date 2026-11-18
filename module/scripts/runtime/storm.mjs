/**
 * §70 : l'orage d'Appel de la foudre — les intentions (adapter/storm.mjs fait les écritures, ui/pointer.mjs la visée).
 *
 *  - `dressStorm` : le nuage que dnd5e vient de poser est habillé en orage, « déjà là » noté (+1d10) ;
 *  - `strike` : l'éclair est posé au point visé, ramené sous le nuage ;
 *  - `dnd5e.preRollDamageV2` : les dégâts d'un éclair tiré d'un orage déjà là reçoivent le dé en plus (`storm.bonus`) ;
 *  - `launchStrike` (§469) : quand l'incantation ne fait que poser le nuage (Manuel 3.0.0), l'activité de l'éclair est utilisée à sa
 *    suite, sans rien dépenser ni poser — c'est elle que l'éclair visé résout.
 * La visée en cours (`boltAim`) est notée ici pour que les fonctions de test (runtime/testing.mjs) puissent jouer le clic.
 */

import { MODULE_ID } from "../constants.mjs";
import { stormOf, cloudOf, cloudCircle, dressCloud, placeBolt, isBoltRegion } from "../adapter/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

let aiming = null;

/** La visée d'un éclair en cours sur ce client (`{ activity, cloud }`), ou null. */
export const boltAim = () => aiming;
export function setBoltAim(value) { aiming = value; }

/** Le nuage que la dernière incantation vient de poser (la région de l'item, ni éclair ni déjà habillée), ou null. */
export function freshCloudOf(item, scene=canvas?.scene) {
  const regions = scene?.regions.filter(r => (r.getFlag("dnd5e", "item") === item.uuid) && !isBoltRegion(r) && !r.getFlag(MODULE_ID, "cloud")) ?? [];
  return regions.at(-1) ?? null;
}

/** L'incantation, une fois la question de l'orage répondue (ui/pointer.mjs) : la même utilisation, la réponse notée. */
export function castStorm(activity, [usageConfig, dialogConfig, messageConfig], stormy) {
  return relaunchUse(activity, { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), stormy: !!stormy } }, dialogConfig, messageConfig);
}

/** Habille le nuage tout juste posé. */
export async function dressStorm(activity, cloud, { stormy=false }={}) {
  const { fx } = await dressCloud(cloud, { stormy });
  log(`${activity.item.name}: storm placed (${fx ? "FXMaster: rain and lightning" : "dark area"})${stormy ? ", storm already there: +" + (stormOf(activity.item)?.bonus ?? "") : ""}`);
}

/**
 * §469 : l'activité qui porte l'éclair. Une activité qui a sa sauvegarde ou ses dégâts le porte elle-même (Manuel 2.2.0, ou l'activité
 * « Lightning Strike » utilisée directement) ; sinon (« Cast Spell » du Manuel 3.0.0, qui ne pose que le nuage) celle que la règle nomme
 * (`storm.strike`), à défaut la première sauvegarde de l'item qui n'est pas la variante « orage » (`storm.stormStrike`).
 */
export function strikeActivityOf(activity) {
  if ( !activity?.item ) return null;
  if ( (activity.type === "save") || activity.damage?.parts?.length ) return activity;
  const rule = stormOf(activity.item);
  const activities = activity.item.system.activities;
  return activities?.get(rule?.strike ?? "") ?? activities?.find(a => (a.type === "save") && (a.id !== rule?.stormStrike)) ?? null;
}

/**
 * §469 : l'éclair d'une incantation qui ne fait que poser le nuage — l'activité de l'éclair, utilisée comme une relance (§16.21) : pas
 * d'emplacement, pas de nouvelle concentration, pas de zone à poser (l'éclair se vise sous le nuage à la fin de cette utilisation),
 * au niveau de l'incantation.
 */
export function launchStrike(cast, strikeActivity, usageConfig) {
  const scaling = Number(usageConfig?.scaling) || 0;
  log(`${cast.item.name}: the cast only placed the cloud, the lightning uses "${strikeActivity.name}"`);
  return relaunchUse(strikeActivity, {
    consume: { spellSlot: false, resources: false },
    concentration: { begin: false },
    create: { measuredTemplate: false },
    scaling,
    ...(scaling > 0 ? { spell: { slot: `spell${(cast.item.system.level ?? 0) + scaling}` } } : {}),
    [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), recast: true, strikeOf: cast.id }
  }, { configure: false }, {});
}

/** L'éclair au point visé (pixels), ramené sous le nuage. */
export async function strike(activity, cloud, point) {
  const circle = cloudCircle(cloud);
  const at = circle ? clampToCircle(point, circle.center, circle.radius) : point;
  const region = await placeBolt(activity, cloud, at);
  if ( region ) log(`${activity.item.name}: lightning bolt at (${Math.round(at.x)}, ${Math.round(at.y)})`);
  return region;
}

/** Les dégâts d'un éclair, quand l'orage était déjà là : le dé en plus. */
function onPreRollDamage(config) {
  const item = config?.subject?.item;
  const rule = stormOf(item);
  if ( !rule?.bonus || !cloudOf(item)?.getFlag(MODULE_ID, "stormy") ) return true;
  // §469 : la variante « orage déjà là » du Manuel 3.0.0 porte déjà le dé en plus.
  if ( rule.stormStrike && (config.subject?.id === rule.stormStrike) ) return true;
  const roll = config.rolls?.[0];
  if ( !roll ) return true;
  roll.parts = [...(roll.parts ?? []), rule.bonus];
  log(`${item.name}: storm already there, +${rule.bonus}`);
  return true;
}

/**
 * La région du nuage reste invisible (`LAYER`) : à l'essai du 2026-10-04, une mise à jour venue d'ailleurs la repassait « MJ »
 * après l'habillage (source non trouvée). Toute mise à jour de sa visibilité est ramenée là, sur le client qui la fait.
 */
function onPreUpdateRegion(region, changes) {
  const cloud = region.getFlag(MODULE_ID, "cloud") || foundry.utils.getProperty(changes, `flags.${MODULE_ID}.cloud`);
  if ( !cloud || !("visibility" in changes) || (changes.visibility === CONST.REGION_VISIBILITY.LAYER) ) return;
  changes.visibility = CONST.REGION_VISIBILITY.LAYER;
  log(`storm: cloud visibility kept hidden`);
}

export function registerStorm() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "storm: extra die not added" });
  route("preUpdateRegion", onPreUpdateRegion, { label: "storm: cloud made visible" });
}
