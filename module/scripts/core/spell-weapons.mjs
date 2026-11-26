/**
 * §554: a spell weapon (a trace that offers an attack, §16.41: Flame Blade, Produce Flame) in the character sheet's favorites.
 * Pure rules (tested by Vitest): which favorite id the attack has, whether DAS adds it when the trace is placed, and whether it
 * removes it when the trace ends. DAS only removes the favorite it added itself (marked on the trace, `traceFavorite`): a
 * favorite the player had put there stays.
 */

/**
 * The favorite id of an activity, as dnd5e writes it when an activity is dropped on the favorites
 * (`ActorSheet5e#_onDropActivity`: `${buildRelativeUuid(item, actor)}.Activity.${id}` — an item owned by the actor gives
 * `.Item.<id>`).
 * @param {string} itemId
 * @param {string} activityId
 * @returns {string}
 */
export function favoriteIdOf(itemId, activityId) {
  return `.Item.${itemId}.Activity.${activityId}`;
}

/**
 * What to do with the favorites when a trace with an attack is placed.
 * @param {object} data
 * @param {boolean} data.supported   The actor has favorites (dnd5e: characters only).
 * @param {string[]} data.favorites  The favorite ids already there.
 * @param {string} data.id           The attack's favorite id.
 * @param {boolean} [data.inherited] The trace replaces one whose favorite DAS had added (cast again): it keeps the mark.
 * @returns {{add: boolean, mark: boolean}}  `add`: write the favorite; `mark`: note on the trace that DAS owns it.
 */
export function favoritePlan({ supported, favorites=[], id, inherited=false }) {
  if ( !supported || !id ) return { add: false, mark: false };
  const present = favorites.includes(id);
  if ( inherited ) return { add: !present, mark: true };
  return present ? { add: false, mark: false } : { add: true, mark: true };
}

/**
 * Whether the favorite goes when a trace ends.
 * @param {object} data
 * @param {string|null} data.marked  The favorite id DAS noted on the trace (`traceFavorite`), or null.
 * @param {string[]} data.favorites  The favorite ids now.
 * @param {boolean} [data.replaced]  The trace is deleted because the spell is cast again: the new trace takes the favorite over.
 * @returns {boolean}
 */
export function favoriteRemoval({ marked, favorites=[], replaced=false }) {
  return !!marked && !replaced && favorites.includes(marked);
}
