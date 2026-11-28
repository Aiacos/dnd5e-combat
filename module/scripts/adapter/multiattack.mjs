/**
 * A monster's Multiattack as seen from the sheet (SPEC §18.6, M1): the plan is read in the original ENGLISH text
 * of the item, which Babele keeps in `flags.babele.originalPayload.description` when it translates (seen on the
 * `ravenloft` world's sheets, Babele 2.9.1, `script/actor/actor-translation.js:150-163`); without Babele, the description itself.
 *
 * The keys of a use (core/multiattack.mjs):
 *  - the item: `id:<id>`, `name:<nom anglais>` (`flags.babele.originalName`, otherwise the name);
 *  - the dnd5e identifier: `identifier:<id>` (a plan declared by `multiattackPlan` thus cites the abilities of a creature module);
 *  - the activity: `activity:<id>`; an attack activity also carries `kind:attack` (`ANY_ATTACK`, "makes two attacks"), and
 *    `kind:melee` or `kind:ranged` depending on `attack.type.value` ("makes two melee attacks", B01);
 *  - a spell cast through "Spellcasting": dnd5e creates a copy on the actor, marked `flags.dnd5e.cachedFor` =
 *    relative uuid of the casting activity, and `_stats.compendiumSource` = the original spell (activity/cast.mjs:118-145).
 *    From it we read the parent item (`id:`), the casting activity (`activity:`) and the spell (`spell:`).
 */

import { parseMultiattack, expandPlan, multiattackStatus, isMultiattackId, declaredPlan, ANY_ATTACK, MELEE_ATTACK, RANGED_ATTACK } from "../core/multiattack.mjs";
import { identifierOf, contentOf } from "./content.mjs";

/** The item's resolved identifier, as a plan key (`identifier:<id>`), or nothing. */
const identifierKey = item => { const { id } = identifierOf(item); return id ? [`identifier:${id}`] : []; };

const englishName = item => String(item?.flags?.babele?.originalName ?? item?.name ?? "").toLowerCase();

/** The parent of a spell copy: ".mmSpellcasting00.Activity.NdueMCpXRc7fLDFa". */
function castOrigin(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = typeof cached === "string" ? cached.match(/([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  return m ? { item: m[1], activity: m[2] } : null;
}

/** The keys of a use of this activity. */
export function useKeysOf(activity) {
  const item = activity?.item;
  if ( !item ) return null;
  const keys = [`id:${item.id}`, `name:${englishName(item)}`, ...identifierKey(item), `activity:${activity.id}`];
  const origin = castOrigin(item);
  if ( origin ) keys.push(`id:${origin.item}`, `activity:${origin.activity}`);
  const source = item._stats?.compendiumSource;
  if ( (item.type === "spell") && source ) keys.push(`spell:${source}`);
  // Any attack whatever: "makes two attacks" from a translated text that does not say which.
  if ( activity.type === "attack" ) keys.push(ANY_ATTACK);
  // "makes two melee attacks": the activity's kind of attack (dnd5e 6: `attack.type.value`, "melee" or "ranged").
  const reach = (activity.type === "attack") ? activity.attack?.type?.value : null;
  if ( reach === "melee" ) keys.push(MELEE_ATTACK);
  else if ( reach === "ranged" ) keys.push(RANGED_ATTACK);
  return [...new Set(keys)];
}

/**
 * The sheet's catalog: the keys that designate the same item (id and name), and each casting activity with
 * its spell. The "Spellcasting" parent is NOT mixed in with its spells: "replace with a specific spell" does not admit the others.
 */
function catalogOf(actor) {
  const catalog = [];
  for ( const item of actor.items ) {
    catalog.push([`id:${item.id}`, `name:${englishName(item)}`, ...identifierKey(item)]);
    for ( const activity of item.system.activities?.values?.() ?? [] ) {
      if ( (activity.type === "cast") && activity.spell?.uuid ) catalog.push([`activity:${activity.id}`, `spell:${activity.spell.uuid}`]);
    }
  }
  return catalog;
}

/** Le texte anglais d'un item : celui d'avant Babele s'il y en a un. */
export function englishDescription(item) {
  return item?.flags?.babele?.originalPayload?.description ?? item?.system?.description?.value ?? "";
}

/** L'item est-il des Attaques multiples ? */
export function isMultiattackItem(item) {
  return isMultiattackId(identifierOf(item).id);
}

/**
 * An NPC's Multiattack plan, or null (not an NPC, no Multiattack, unreadable text).
 * @param {Actor5e} actor
 */
export function multiattackOf(actor) {
  if ( actor?.type !== "npc" ) return null;
  // The resolved identifier (source, original English name, name): a sheet imported without an identifier or translated counts too.
  const item = actor.items.find(isMultiattackItem);
  if ( !item ) return null;
  // B01: a plan declared in the content (`multiattackPlan`, creature module, world overlay) overrides reading the text.
  const declared = declaredPlan(contentOf(item).entry?.multiattackPlan);
  if ( declared ) return expandPlan(declared, catalogOf(actor));
  // The sheet's names: a translated text without [[/item]] cites its abilities in plain text ("three attacks with its
  // blades A and/or B"). The displayed name and, under Babele, the original English name
  // (the original text says "Thorn", the sheet "Épine").
  const names = actor.items.filter(i => i !== item).flatMap(i => [[i.name, `id:${i.id}`],
    ...(i.flags?.babele?.originalName ? [[i.flags.babele.originalName, `id:${i.id}`]] : [])]);
  return expandPlan(parseMultiattack(englishDescription(item), { names }), catalogOf(actor));
}

/**
 * §18.19: what remains of the Multiattack open this turn (`budget.multi`), item by item — uuids of items still
 * playable (`left`), of those in the plan with nothing left (`spent`), and the names of the first ones. null without an open plan.
 * @param {Actor5e} actor
 * @param {{plan: object, used: string[][]}|null} multi
 */
export function multiattackLeft(actor, multi) {
  if ( !actor || !multi?.plan ) return null;
  const candidates = actor.items.map(item => ({
    id: item.uuid, name: item.name,
    uses: Array.from(item.system.activities?.values?.() ?? []).map(useKeysOf).filter(Boolean)
  })).filter(c => c.uses.length);
  const { left, spent } = multiattackStatus(multi.plan, multi.used ?? [], candidates);
  return { left: new Set(left), spent: new Set(spent), names: candidates.filter(c => left.includes(c.id)).map(c => c.name) };
}
