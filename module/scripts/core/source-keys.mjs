/**
 * §334: the keys under which an item is looked up in the sources (content/sources.mjs and those a module registers), from
 * the most precise to the broadest. Pure function.
 *
 * A creature item id is shared between creatures ("mmBite0000000000"): the key "actor id.item id" targets the feature
 * of a single one. The actor is read from the uuid of the item's source when it goes through it ("….Actor.<a>.Item.<i>"),
 * and otherwise from the actor that carries the item: the source of an embedded item most often designates the features compendium
 * ("….features.Item.<i>"), which says nothing about the creature — the actor, for its part, keeps the id of its sheet (its own
 * compendium source for a copy in the world or a token, its id in the compendium).
 *
 * @param {object} o
 * @param {string|null} [o.itemSource]   Uuid of the item's compendium source.
 * @param {string|null} [o.itemId]       Id of the item.
 * @param {string|null} [o.actorSource]  Uuid of the compendium source of the actor that carries the item.
 * @param {string|null} [o.actorId]      Id of that actor.
 * @returns {string[]}  The keys to try, in order, without duplicates.
 */
export function sourceKeys({ itemSource=null, itemId=null, actorSource=null, actorId=null }={}) {
  const parts = String(itemSource ?? "").split(".").filter(Boolean);
  const sourceItem = parts.at(-1) ?? null;
  const item = sourceItem ?? itemId;
  const keys = [];
  if ( parts.length > 3 ) keys.push(`${parts.at(-3)}.${sourceItem}`);
  const actor = String(actorSource ?? "").split(".").filter(Boolean).at(-1) ?? actorId;
  if ( actor && item ) keys.push(`${actor}.${item}`);
  if ( actorId && item && (actorId !== actor) ) keys.push(`${actorId}.${item}`);
  if ( sourceItem ) keys.push(sourceItem);
  if ( itemId ) keys.push(itemId);
  return [...new Set(keys)];
}
