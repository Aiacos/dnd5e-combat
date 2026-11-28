/**
 * K1 à K12 (SPEC §322–§334) : la couche « texte » d'une capacité de PNJ, assemblée à partir des lecteurs de `core/monster-text.mjs`.
 * Sortie de `adapter/content.mjs` (`textLayer`) le 2026-11-15 (§460) pour que l'ATLAS (`tools/atlas.mjs`) calcule exactement ce que le
 * moteur joue sur une créature, sans Foundry : l'adaptateur lui donne l'item vivant, l'ATLAS la donnée brute du compendium.
 *
 * Pur : des chaînes et des objets simples.
 */

import { monsterChoice, monsterDeaths, monsterEndings, monsterPushes, monsterReactions, monsterRecurring, monsterTypeGate, monsterAdvantage,
  monsterSaveDamage, monsterMissingStatus, monsterNoOpportunity, monsterBasicActions, monsterSightGate, monsterImmunity, monsterEffectDurations,
  monsterReactionWindow, monsterActivationAdvantage, monsterDefense, monsterChargeGate, monsterLightSensitivity, monsterSelfTeleport,
  monsterBreaksOn, monsterLightChecks, monsterBloodiedSaves,
  monsterTeleportChoice } from "./monster-text.mjs";
import { readDrain, drains } from "./drain.mjs";

/**
 * La couche texte d'une capacité de PNJ, ou null si le texte n'en dit rien.
 * @param {object} input
 * @param {string} input.html                 Le texte anglais d'origine (HTML brut, enrichers compris).
 * @param {string|null} [input.identifier]    L'identifiant du moteur.
 * @param {Array<{id: string, name?: string, type?: string, activation?: {type?: string, condition?: string}, effects?: string[],
 *   onSave?: string|null, range?: {value?: *, units?: string, special?: string}, template?: boolean,
 *   target?: {type?: string, count?: *, special?: string}}>} [input.activities]  Les activités, dans l'ordre de l'item.
 * @param {Array<{id: string, statuses?: string[], changes?: Array<{key: string, value: *}>}>} [input.effects]  Les effets de l'item.
 * @param {boolean} [input.swallow]           Le contenu livré déclare la brique Avaler (ses dégâts récurrents ne se relisent pas ici).
 * @returns {object|null}
 */
export function monsterTextLayer({ html, identifier=null, activities=[], effects=[], swallow=false }) {
  if ( !html ) return null;
  const fx = effects.map(e => ({ id: e.id, statuses: [...(e.statuses ?? [])] }));
  const named = activities.map(a => ({ id: a.id, name: a.name ?? "" }));
  const triggers = monsterEndings(html, fx);
  // K2 (§323) : la mort à 0 PV et les paliers de PV que le texte promet.
  const deaths = monsterDeaths(html, { activities: named, effects: fx });
  // K3 (§324) : un seul des effets — tiré au dé ou au choix de la créature.
  const choice = monsterChoice(html, fx);
  // K6 (§327) : parade (« adds N to its AC »), Réactions perdues, action OU action Bonus.
  const acEffect = effects.flatMap(e => e.changes ?? []).find(c => c.key === "system.attributes.ac.bonus" && /^\+?\d+$/.test(String(c.value).trim()));
  const reacts = monsterReactions(html, { reaction: activities.some(a => a.activation?.type === "reaction"),
    acEffect: acEffect ? Number(String(acEffect.value).replace("+", "")) : null });
  // K7 (§328) : dégâts récurrents au porteur, soins bloqués, absorption — pas pour une capacité que la brique Avaler joue déjà.
  const recurring = monsterRecurring(html, fx, activities.map(a => ({ id: a.id, type: a.type })));
  if ( swallow ) delete recurring.triggers;
  // K8 (§329) : poussées et tractions lues dans le texte.
  const pushes = monsterPushes(html, { save: activities.some(a => a.type === "save"), attack: activities.some(a => a.type === "attack"),
    area: activities.some(a => a.template) });
  // K10 (§331) : Avantage conditionnel lu dans le texte ; §334 : celui que donne la condition d'activation d'une attaque.
  const advantage = monsterAdvantage(html, identifier);
  advantage.push(...monsterActivationAdvantage(activities.filter(a => a.type === "attack").map(a => a.activation?.condition ?? ""), identifier));
  // K12 (§333) : l'état que la donnée oublie de poser ; §334 : un état lu avec sa durée d'un tour la reçoit par `effectEnds` « status:<état> ».
  const acts = activities.map(a => ({ id: a.id, type: a.type, effects: a.effects ?? [] }));
  const missing = monsterMissingStatus(html, { activities: acts, effects: fx }).map(({ ends, ...t }) => {
    if ( ends ) (recurring.effectEnds ??= {})[`status:${t.do[0].status}`] = ends;
    return t;
  });
  // K1 (§334) : immunité temporaire après une réussite.
  const immunity = monsterImmunity(html, identifier, acts);
  if ( immunity ) missing.push(immunity.trigger);
  // §334 : la fenêtre d'une Réaction de monstre d'après son déclencheur, quand la parade de K6 n'en donne pas.
  const reactive = activities.filter(a => a.activation?.type === "reaction");
  const reactionConditions = reactive.map(a => a.activation?.condition ?? "");
  const outward = reactive.some(a => ["save", "attack", "damage"].includes(a.type));
  const window = (reactionConditions.length && !reacts.triggers?.length) ? monsterReactionWindow(html, reactionConditions, outward, reactive[0]?.id ?? null) : [];
  const allTriggers = [...triggers, ...monsterDefense(html), ...monsterLightSensitivity(html), ...(reacts.triggers ?? []), ...window, ...(recurring.triggers ?? []),
    ...pushes, ...advantage, ...missing];
  // §334 : les durées en tours que le texte donne aux effets, Réactions perdues et soins bloqués par effet.
  const durations = monsterEffectDurations(html, { activities: acts, effects: fx });
  if ( durations.effectEnds ) recurring.effectEnds = { ...durations.effectEnds, ...(recurring.effectEnds ?? {}) };
  if ( durations.noReactions && !reacts.noReactions ) recurring.noReactions = durations.noReactions;
  if ( durations.blocksHealing && !recurring.blocksHealing ) recurring.blocksHealing = durations.blocksHealing;
  const { triggers: _r, ...recurringRest } = recurring;
  const { triggers: _t, ...restrictions } = reacts;
  // K11 (§332) : pas de moitié des dégâts sur une réussite quand le texte n'en donne pas.
  const saveDamage = monsterSaveDamage(html, activities.map(a => ({ id: a.id, type: a.type, onSave: a.onSave ?? null })));
  if ( saveDamage ) recurringRest.saveDamage = saveDamage;
  // §334 : l'état de l'attaque ne vient qu'après une charge (« moved 20+ feet straight toward it immediately before the hit »).
  const charge = monsterChargeGate(html, acts);
  if ( charge ) recurringRest.effectsIf = charge;
  // K12 (§333) : plus d'attaque d'opportunité, Foncer / Se désengager / Se cacher, drain du maximum de PV dit par le texte.
  if ( monsterNoOpportunity(html, fx) ) recurringRest.noOpportunityAttacks = true;
  // §334 : « moves up to (half) its Speed without provoking Opportunity Attacks » — le reste du tour sans attaque d'opportunité.
  if ( /\bmoves? up to (?:half )?its (?:\w+ )?Speed without provoking\b/i.test(html.replace(/<[^>]+>/g, " ").replace(/&Reference\[([^\]]*)\]/g, "$1")) ) recurringRest.noOpportunity = "afterUse";
  // Les effets de la capacité cessent quand son porteur fait un jet d'attaque, si son texte le dit (Disparition du Feu follet).
  const breaks = monsterBreaksOn(html);
  if ( breaks && fx.length ) recurringRest.breaksOn = breaks;
  // §484 : « au soleil, Désavantage aux tests de caractéristique » — la moitié de la phrase que les déclencheurs ne portent pas.
  const lightChecks = monsterLightChecks(html);
  if ( lightChecks ) recurringRest.rollDisadvantage = lightChecks;
  // « tant qu'elle est En sang, Avantage aux jets d'attaque et aux sauvegardes » — la moitié que les déclencheurs ne portent pas.
  const bloodiedSaves = monsterBloodiedSaves(html);
  if ( bloodiedSaves ) recurringRest.rollAdvantage = bloodiedSaves;
  const basics = monsterBasicActions(html, acts);
  if ( basics ) recurringRest.basicActions = basics;
  if ( drains(readDrain(html)) ) recurringRest.drain = true;
  // K9 (§330) : porte de type (« Constructs and Undead succeed automatically ») ; K12 (§333) : « that can see the X ».
  const typeGate = monsterTypeGate(html);
  const sight = monsterSightGate(html, acts);
  const gates = [typeGate?.unaffectedIf, sight, immunity?.gate].filter(Boolean);
  const gate = gates.length ? { unaffectedIf: (gates.length > 1) ? { any: gates } : gates[0] } : null;
  // §461 : la téléportation de soi, à la portée de l'activité (Téléportation des démons, Foulée féerique des esprits…).
  const teleport = monsterSelfTeleport(html, activities);
  if ( teleport ) recurringRest.teleport = teleport;
  // §463 : une zone d'arrivée « de son choix » — la créature épargne qui elle veut (ennemis cochés d'avance).
  if ( (teleport?.area === "arrival") && monsterTeleportChoice(html) ) recurringRest.zoneAffects = "enemy";
  return (allTriggers.length || Object.keys(deaths).length || choice || Object.keys(restrictions).length || Object.keys(recurringRest).length || gate)
    ? { ...(allTriggers.length ? { triggers: allTriggers } : {}), ...deaths, ...restrictions, ...recurringRest, ...(choice ? { choice } : {}), ...(gate ? { targets: gate } : {}) } : null;
}
