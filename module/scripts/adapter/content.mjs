/**
 * Ce qu'un item déclare au moteur, toutes couches confondues (SPEC §13.4) :
 *
 *   flag de l'item  >  surcouche du monde (réglage, MJ)  >  contenu du module  >  texte d'une capacité de PNJ (K1)  >  rien = natif
 *
 * L'identifiant est celui de dnd5e (`system.identifier`, gardé par les copies faites depuis un
 * compendium — vérifié : Spellbook crée le sort avec `toObject()` du sort du compendium). À
 * défaut : l'identifiant de la source de compendium (`_stats.compendiumSource`, que le cœur
 * remplit à la création, client-document.mjs:990), puis le nom en kebab-case.
 */

import { MODULE_ID } from "../constants.mjs";
import { mergeEntries, validateEntry, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { CONTENT, SOURCES } from "../content/index.mjs";
import { ENCHANTMENT_SOURCES } from "../content/sources.mjs";
import { BASIC_ACTIONS } from "../content/actions.mjs";
import { factsFor } from "./facts.mjs";
import { scrollSpellOf } from "./scrolls.mjs";
import { isObjectToken } from "./bodies.mjs";
import { monsterTextLayer } from "../core/monster-layer.mjs";

export const OVERRIDES_SETTING = "contentOverrides";

/**
 * §117 : le contenu par objet ne s'applique qu'au niveau Intégral (runtime/levels.mjs). Fermé, `contentOf` ne rend rien : chaque
 * objet garde le comportement de dnd5e et les règles générales du moteur.
 */
/** §416 : les identifiants des actions de base du moteur (content/actions.mjs) — leur entrée reste lue quand le contenu est fermé. */
const GENERAL_RULES = new Set(Object.values(BASIC_ACTIONS).map(a => a.identifier).filter(Boolean));
let contentEnabled = true;
export function setContentEnabled(enabled) {
  contentEnabled = !!enabled;
}

/** Les clés de faits que le cœur des conditions connaît (pour valider une entrée). */
export const KNOWN_FACTS = factsFor();

/** Un nom en identifiant, comme dnd5e le forme (utils.mjs:112, `formatIdentifier`). */
const kebab = name => String(name ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3").slugify({ strict: true });

/**
 * L'identifiant sous lequel un item est reconnu, et d'où il vient.
 *
 * §19.9 : un item premium sans identifiant (Ravenloft) en reçoit un à sa création sur une fiche — dnd5e 6 l'écrit d'après le nom
 * (documents/item.mjs:1146, `_preCreate`), donc d'après le nom TRADUIT par Babele : « morsure-vampirique ». On le reconnaît par
 * l'id de sa source (content/sources.mjs), sinon par son nom anglais, que Babele garde (`flags.babele.originalName`, 2.9.1).
 */
export function identifierOf(item) {
  // §48 : un parchemin est reconnu sous l'identifiant du sort qu'il contient.
  const scroll = scrollSpellOf(item);
  if ( scroll ) return { id: scroll.identifier, from: "scroll" };
  const sourceUuid = item?._stats?.compendiumSource ?? item?.flags?.dnd5e?.sourceId ?? null;
  // §277 : les sources livrées (content/sources.mjs) et celles qu'un autre module enregistre avec sa table.
  // §334 : d'abord « acteur.item » — un id d'item du Monster Manual est partagé entre créatures (« mmBite0000000000 ») ; la clé
  // « mmHomunculus0000.mmBite0000000000 » vise la morsure de l'Homoncule seule.
  const parts = String(sourceUuid ?? "").split(".");
  const known = ((parts.length > 3) ? SOURCES[`${parts.at(-3)}.${parts.at(-1)}`] : null) ?? SOURCES[parts.at(-1)] ?? SOURCES[item?.id ?? ""];
  if ( known ) return { id: known, from: "source" };
  const own = item?.system?.identifier;
  const original = item?.flags?.babele?.originalName;
  const translated = !!own && !!original && (own === kebab(item.name)) && (kebab(original) !== own);
  if ( own && !translated ) return { id: own, from: "item" };
  const source = sourceUuid ? fromUuidSync(sourceUuid, { strict: false }) : null;
  if ( source?.system?.identifier ) return { id: source.system.identifier, from: "compendium" };
  if ( original ) return { id: kebab(original), from: "name" };
  if ( own ) return { id: own, from: "item" };
  if ( item?.name ) return { id: kebab(item.name), from: "name" };
  return { id: null, from: null };
}

/**
 * §431 : la classe d'une aptitude, quand plusieurs classes partagent son identifiant — le SRD de dnd5e 6.1 donne `potent-spellcasting`
 * à l'option du Clerc (`phbClcPotentSpel`) comme à celle du Druide (`phbFuryPotentSpe`). D'abord `system.classIdentifier` (dnd5e 6.1,
 * data/item/feat.mjs:177, la classe qui a donné l'aptitude par avancement), puis l'item racine de l'avancement (dnd5e 6.0,
 * data/abstract/item-data-model.mjs:62), enfin le texte `requirements` (« Cleric », « Druid ») s'il nomme une classe de l'acteur, ou si
 * l'acteur n'a aucune classe (§433).
 * Rien de sûr : null.
 */
export function featureClassOf(item) {
  const own = item?.system?.classIdentifier;
  if ( own ) return own;
  const root = item?.system?.advancementRootItem;
  if ( root?.type === "class" ) return root.identifier ?? root.system?.identifier ?? null;
  if ( root?.type === "subclass" ) return root.system?.classIdentifier || null;
  const written = String(item?.system?.requirements ?? "").trim().toLowerCase();
  if ( !written ) return null;
  const classes = item?.actor?.classes ?? {};
  if ( classes[written] ) return written;
  // §433 : un acteur sans aucune classe (PNJ qui porte l'aptitude) — le texte seul fait foi, s'il tient en un mot (« Druid »).
  return (!Object.keys(classes).length && /^[a-z]+$/.test(written)) ? written : null;
}

/**
 * §431 : l'acteur a-t-il une aptitude de cet identifiant (ou de l'un d'eux) pour cette classe ? Une aptitude dont la classe est connue
 * et différente ne compte pas ; dont la classe est inconnue, compte si l'acteur a des niveaux dans la classe demandée.
 */
export function hasClassFeature(actor, ids, cls) {
  const wanted = [ids].flat();
  return Array.from(actor?.items ?? []).some(i => {
    if ( !wanted.includes(identifierOf(i).id) ) return false;
    const of = featureClassOf(i);
    return of ? (of === cls) : !!actor?.classes?.[cls];
  });
}

/**
 * O5b (§340) : les identifiants des objets dont un enchantement actif est posé sur cet item — par l'id de l'effet d'enchantement
 * (content/sources.mjs, `ENCHANTMENT_SOURCES` : il reste celui de l'effet d'origine), sinon par l'objet qui l'a posé
 * (`system.origin.activity`, activity/enchant.mjs), quand il existe encore.
 */
export function enchantmentSourcesOf(item) {
  const out = [];
  const effects = item?.effects;
  if ( !effects || (typeof effects[Symbol.iterator] !== "function") ) return out;
  for ( const effect of effects ) {
    // O9h (§363) : un profil de l'objet activé à la place d'un enchantement de soi (runtime/enchant.mjs) porte sa propre marque de profil —
    // dnd5e ne le compte pas comme appliqué.
    const ownProfile = effect?.flags?.dnd5e?.enchantmentProfile === effect?.id;
    if ( (effect?.type !== "enchantment") || effect.disabled || ((effect.isAppliedEnchantment === false) && !ownProfile) ) continue;
    let id = ENCHANTMENT_SOURCES[effect.id] ?? null;
    if ( !id ) {
      const activity = effect.system?.origin?.activity ?? effect.origin ?? "";
      const itemUuid = String(activity).replace(/\.Activity\.[^.]+$/, "");
      const source = itemUuid ? fromUuidSync(itemUuid, { strict: false }) : null;
      if ( source && (source !== item) && (source.documentName === "Item") ) id = identifierOf(source).id;
    }
    if ( id && !out.includes(id) ) out.push(id);
  }
  return out;
}

/**
 * O5b (§340) : ce que les enchantements d'un item lui apportent — l'entrée `<identifiant>-enchanted` de l'objet qui l'enchante (Tueuse
 * de dragons, Vengeresse sacrée…). Un nom à part : l'objet qui pose l'enchantement, s'il reste sur la fiche, ne déclenche rien lui-même.
 */
function enchantmentLayer(item) {
  const entries = enchantmentSourcesOf(item).map(id => CONTENT[`${id}-enchanted`]).filter(Boolean);
  return entries.length ? mergeEntries(entries) : null;
}

/** La surcouche du monde : `{ identifiant: entrée }`, tenue par le MJ. */
export function worldOverrides() {
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  if ( !stored || (typeof stored !== "object") ) return {};
  if ( stored.v !== CONTENT_VERSION ) return {};
  return stored.entries ?? {};
}

/** Écrit (ou retire, avec `null`) l'entrée d'un identifiant dans la surcouche du monde. MJ uniquement. */
export async function setWorldOverride(identifier, entry) {
  const entries = { ...worldOverrides() };
  if ( entry === null ) delete entries[identifier];
  else {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS });
    if ( errors.length ) throw new Error(`${identifier}: ${errors.join("; ")}`);
    entries[identifier] = entry;
  }
  await game.settings.set(MODULE_ID, OVERRIDES_SETTING, { v: CONTENT_VERSION, entries });
  return entries[identifier] ?? null;
}

/** Ce qu'un item porte lui-même, validé ; une entrée fausse est ignorée (et signalée). */
function itemLayer(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  const layer = {};
  for ( const key of ENTRY_KEYS ) if ( key in flags ) layer[key] = flags[key];
  if ( !Object.keys(layer).length ) return null;
  const errors = validateEntry(layer, { facts: KNOWN_FACTS });
  if ( errors.length ) {
    console.warn(`${MODULE_ID} | ${item.name}: flags ignored — ${errors.join("; ")}`);
    return null;
  }
  return layer;
}

/**
 * L'entrée effective d'un item, couches combinées. `null` si rien n'est déclaré nulle part.
 * @returns {{entry: object|null, identifier: string|null, layers: {module: boolean, world: boolean, item: boolean}}}
 */
export function contentOf(item) {
  const { id } = identifierOf(item);
  if ( !contentEnabled ) {
    // §416 : une action de base du moteur est une règle générale (niveau Assisté), pas le contenu d'un objet — sans le choix exclusif de
    // l'Attaque à mains nues, une Lutte ratée posait À terre ET Agrippé à ce niveau.
    const general = (id && GENERAL_RULES.has(id)) ? (CONTENT[id] ?? null) : null;
    return { identifier: id, entry: general ? mergeEntries([general]) : null, layers: { text: false, module: !!general, world: false, item: false } };
  }
  const layers = { text: textLayer(item), enchant: enchantmentLayer(item), module: id ? CONTENT[id] ?? null : null, world: id ? worldOverrides()[id] ?? null : null, item: itemLayer(item) };
  return {
    identifier: id,
    entry: mergeEntries([layers.text, layers.enchant, layers.module, layers.world, layers.item]),
    layers: { text: !!layers.text, enchant: !!layers.enchant, module: !!layers.module, world: !!layers.world, item: !!layers.item }
  };
}

/** Une couche (objet) porte-t-elle cette clé ? Le test de `mergeEntries` (core/content/merge.mjs). */
const carries = (layer, key) => !!layer && (typeof layer === "object") && (key in layer);

/**
 * Une des couches de l'item porte-t-elle la clé `key` ? Les mêmes couches que `contentOf`, sans les fusionner : l'entrée composée
 * n'a que des clés qu'une couche porte, donc « non » ici veut dire `contentOf(item).entry?.[key] === undefined`. Pour qui cherche
 * une clé rare sur tous les objets d'une fiche (la vue, à chaque rafraîchissement) : la fusion n'est faite que pour l'objet qui la
 * déclare. Rien n'est gardé : l'item, ses effets, la surcouche et les tables sont relus à chaque appel.
 * @param {Item} item
 * @param {string} key                 Une clé d'entrée (`ENTRY_KEYS`).
 * @param {object} [overrides]         `worldOverrides()` déjà lu par l'appelant, pour une suite d'items.
 * @returns {boolean}
 */
export function declaresKey(item, key, overrides=worldOverrides()) {
  const { id } = identifierOf(item);
  if ( id && (carries(CONTENT[id], key) || carries(overrides[id], key)) ) return true;
  if ( carries(item?.flags?.[MODULE_ID], key) ) return true;
  if ( enchantmentSourcesOf(item).some(source => carries(CONTENT[`${source}-enchanted`], key)) ) return true;
  return carries(textLayer(item), key);
}

/**
 * K1 (SPEC §322) : la couche la plus basse, lue dans le texte anglais d'origine d'une capacité de PNJ (`core/monster-text.mjs`) —
 * sauvegarde répétée à la fin de ses tours, second échec, fin sur dégâts ; K2 (§323) : mort à 0 PV, paliers de PV ; K3 (§324) : un seul effet. Le contenu livré, la surcouche du monde ou le flag de
 * l'item la remplacent dès qu'ils déclarent leurs propres `triggers`. Pas pour un sort (sa copie suit les règles du sort) ni pour un
 * personnage. Mise en cache par item et texte.
 */
const textCache = new Map();

/** §461 : portée, gabarit et cible d'une activité, tels que la donnée les écrit (la source : pas de portée préparée ni de formule). */
const activityShape = a => ({ range: { value: a.range?.value ?? null, units: a.range?.units ?? "", special: a.range?.special ?? "" },
  template: a.target?.template?.type ? { type: a.target.template.type, size: a.target.template.size ?? "", units: a.target.template.units ?? "",
    count: a.target.template.count ?? "" } : false,
  target: { type: a.target?.affects?.type ?? "", count: a.target?.affects?.count ?? "", special: a.target?.affects?.special ?? "" } });

function textLayer(item) {
  if ( (item?.actor?.type !== "npc") || (item.type === "spell") ) return null;
  const html = item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "";
  if ( !html ) return null;
  const key = `${item.uuid}|${html.length}|${item.effects?.size ?? 0}`;
  if ( textCache.has(key) ) return textCache.get(key);
  // §460 : le calcul est pur (core/monster-layer.mjs), partagé avec l'ATLAS.
  const layer = monsterTextLayer({ html, identifier: identifierOf(item).id, swallow: !!CONTENT[identifierOf(item).id]?.swallow,
    effects: (item.effects?.contents ?? []).map(e => ({ id: e.id, statuses: [...(e.statuses ?? [])], changes: e.changes ?? [] })),
    activities: Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, name: a.name ?? "", type: a.type,
      activation: { type: a.activation?.type, condition: a.activation?.condition ?? "" }, effects: (a.effects ?? []).map(e => e._id ?? e.id),
      onSave: a.damage?.onSave ?? null, ...activityShape(a._source ?? a) })) });
  if ( textCache.size > 2000 ) textCache.clear();
  textCache.set(key, layer);
  return layer;
}

/** §53 : l'entrée d'un identifiant sans item (une potion détruite en étant bue) : contenu du module < surcouche du monde. */
export function entryOfIdentifier(id) {
  if ( !contentEnabled ) return null;
  return id ? mergeEntries([CONTENT[id] ?? null, worldOverrides()[id] ?? null]) : null;
}

/**
 * L'item qui a lancé une copie de sort (`flags.dnd5e.cachedFor` = uuid relatif de son activité d'incantation,
 * activity/cast.mjs:118-145), ou null. Une créature qui « lance Immobilisation de personne » par une capacité
 * (une créature d'un module tiers) y déclare ce que SA version ajoute au sort : les étapes d'issue du sort
 * lisent aussi celles de cet item (adapter/usage.mjs, `outcomeStepsOf`).
 */
export function castItemOf(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item.([A-Za-z0-9]{16}).Activity.[A-Za-z0-9]{16}$/) : null;
  return m ? (item.actor?.items?.get(m[1]) ?? null) : null;
}

/**
 * §438 : la règle d'invocation (`summon`) d'un item, et celle de l'item qui l'a lancé quand c'est une copie de sort (`castItemOf`), la
 * seconde l'emportant. Le Compagnon sauvage du Manuel des joueurs 3.0.0 n'invoque plus lui-même : son activité « cast » lance Appel de
 * familier, et le familier a pour origine (`flags.dnd5e.summon.origin`) la copie du sort — ce que déclare `wild-companion` (part au
 * Repos long) doit encore s'appliquer. Null si aucun des deux ne déclare rien.
 */
export function summonRuleOf(item) {
  if ( !item ) return null;
  const own = contentOf(item).entry?.summon ?? null;
  const caster = castItemOf(item);
  const from = caster ? (contentOf(caster).entry?.summon ?? null) : null;
  return (own || from) ? { ...(own ?? {}), ...(from ?? {}) } : null;
}

/** Pour l'inspection en jeu : ce que chaque item d'un acteur déclare, et d'où. */
export function inspect(actor) {
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    const { entry, layers } = contentOf(item);
    return { item: item.name, identifier: id, identifierFrom: from, layers, entry };
  }).filter(r => r.entry);
}

/**
 * §123 : l'unité de portée d'une activité, corrigée par le contenu quand les données se trompent (`ranges`, §16.43) — Imposition des
 * mains et la trousse de soins sont « personnelles » dans le Manuel des joueurs alors qu'elles touchent une créature. Ce qui décide
 * « sur soi » (visée au clic, plan de la carte) lit ceci, pas `activity.range.units`.
 */
export function rangeUnitsOf(activity) {
  const fixed = activity?.item ? contentOf(activity.item).entry?.ranges?.[activity.id] : null;
  if ( fixed?.units ) return fixed.units;
  const units = activity?.range?.units ?? null;
  // Règle générale : un SOIN « personnel » qui vise une créature — une seule, sans zone — vise en fait une autre créature (ou soi).
  // Relevé du Manuel des joueurs (2026-10-10) : Imposition des mains, Main guérisseuse, Ultime miséricorde, Toucher du médecin,
  // Ralliement, Champ protecteur, Éclat protecteur amélioré, Interception — toutes soignaient le lanceur, quelle que soit la cible.
  // Sans portée connue (null) : la visée s'ouvre (soi compris), sans contrôle de distance — `ranges` la précise quand le texte la donne.
  const affects = activity?.target?.affects;
  const one = !activity?.target?.template?.type && ["", "1"].includes(String(affects?.count ?? "").trim());
  if ( (units !== "self") || !one ) return units;
  if ( (activity?.type === "heal") && HEAL_TARGETS.includes(affects?.type) ) return null;
  // §124 : de même une capacité qu'un joueur lance lui-même (action, action Bonus), hors soin et hors attaque (une attaque se vise
  // déjà), dont le moteur n'a pas de règle — Paume vibratoire (fin des vibrations), Toucher restaurateur, Bastion de la loi, Nimbe
  // sacré, Champion ancestral, ordre au compagnon du Rôdeur, Murmures psychiques : sans cible désignée, rien ne se passait. Celles que
  // le moteur prend en charge (Déluge de coups, Transposition du filou, Prêtre de guerre…) gardent leur propre circuit.
  if ( (activity?.type !== "attack") && PLAYER_ACTIVATIONS.includes(activity?.activation?.type)
    && TARGETS.includes(affects?.type) && !contentOf(activity.item).entry ) return null;
  // §253 : un piège (PNJ au type de créature « Trap » des pièges du DMG 2024, ou token objet du moteur) a une portée « personnelle »
  // dans les données mais frappe une créature : lancé à la main sans cible désignée, la visée s'ouvre (rien ne se passait).
  if ( TARGETS.includes(affects?.type) && trapLike(activity?.actor) ) return null;
  return units;
}

const TRAP_TYPE = /^(traps?|pièges?)$/i;

/** §253 : un acteur piège — type de créature personnalisé « Trap » (DMG 2024), ou le token d'un objet du moteur. */
export function trapLike(actor) {
  const type = actor?.system?.details?.type;
  if ( (type?.value === "custom") && TRAP_TYPE.test(String(type.custom ?? "").trim()) ) return true;
  return isObjectToken(actor?.token);
}

/** §124 : les activations qu'un joueur déclenche lui-même (pas une réaction, pas un supplément au coup). */
const PLAYER_ACTIVATIONS = ["action", "bonus"];
/** §124 : les cibles qui désignent une créature (ou un objet) autre que le lanceur. */
const TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any", "enemy", "object"];

/** Les cibles d'un soin qui désignent une autre créature que le lanceur. */
const HEAL_TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any"];
