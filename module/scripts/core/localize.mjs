/**
 * §202: the effects copied from a compendium by the world diagnostic (runtime/diagnostic/checks.mjs). A magic item's effect
 * usually bears the item's name ("Walloping Ammunition" on "Walloping Ammunition"); a translation that translates the item's name
 * without that of its effects left the copied effect in English (table feedback of 2026-10-18: "Projectile percutant",
 * enchantment "Walloping Ammunition"). An effect that bears the item's original (English) name takes its displayed name.
 *
 * Pure: no dependency on Foundry.
 */

/**
 * @param {object[]} effects        Effect data (`toObject()`), modified on a copy.
 * @param {string|null} originalName The original name of the reference item (`flags.babele.originalName`), or null.
 * @param {string} displayName       The item's name as shown (translated).
 * @returns {object[]}
 */
export function localizeEffectNames(effects, originalName, displayName) {
  if ( !originalName || !displayName || (originalName === displayName) ) return effects.map(e => ({ ...e }));
  return effects.map(e => ((e.name === originalName) ? { ...e, name: displayName } : { ...e }));
}

/* -------------------------------------------- */
/*  §203: texts left in the original language */
/* -------------------------------------------- */

/** A dotted path ("system.description.value") in plain data. */
function at(data, path) {
  return path.split(".").reduce((o, k) => ((o == null) ? undefined : o[k]), data);
}

/** The fields of an item that Babele translates: key of its original payload (`flags.babele.originalPayload`) → path. */
export const ITEM_FIELDS = Object.freeze([
  ["name", "name"], ["description", "system.description.value"], ["chat", "system.description.chat"],
  ["udescription", "system.unidentified.description"], ["condition", "system.activation.condition"]
]);
/** Those of an activity (dnd5e 6.0), inside `system.activities.<id>`. */
export const ACTIVITY_FIELDS = Object.freeze([["name", "name"], ["condition", "activation.condition"], ["chatFlavor", "description.chatFlavor"]]);
/** Ceux d'un acteur. */
export const ACTOR_FIELDS = Object.freeze([["name", "name"], ["biography", "system.details.biography.value"]]);

/**
 * A field left in the original language: its value is still exactly the original (non-empty), and the translated reference
 * gives another. A hand-edited text is never taken back.
 */
const stale = (now, original, translated) => (typeof original === "string") && (original !== "") && (now === original)
  && (typeof translated === "string") && (translated !== "") && (translated !== now);

/**
 * §203: what must be rewritten in an item to take back the current translation of its compendium reference.
 * @param {object} current     The data of the world item (`toObject()`).
 * @param {object} original    The original payload of the reference (`flags.babele.originalPayload`): the untranslated values.
 * @param {object} translated  The data of the translated reference (`toObject()`).
 * @returns {{ update: Object<string, string>, effects: object[], fields: string[] }}  `update`: paths → values; `effects`:
 *   effect updates ({ _id, name?, description? }); `fields`: the fields taken back (for the report).
 */
export function retranslateItem(current, original, translated) {
  const update = {};
  const fields = [];
  if ( !current || !original || !translated ) return { update, effects: [], fields };
  for ( const [key, path] of ITEM_FIELDS ) {
    const value = at(translated, path);
    if ( stale(at(current, path), original[key], value) ) { update[path] = value; fields.push(key); }
  }
  for ( const [id, activity] of Object.entries(current.system?.activities ?? {}) ) {
    const orig = original.activities?.[id];
    const tr = translated.system?.activities?.[id];
    if ( !orig || !tr ) continue;
    for ( const [key, path] of ACTIVITY_FIELDS ) {
      const value = at(tr, path);
      if ( stale(at(activity, path), orig[key], value) ) { update[`system.activities.${id}.${path}`] = value; fields.push(`activity.${key}`); }
    }
  }
  // The effects: Babele translates them by their original name. That of the reference with the same id, or the only one.
  const origEffects = Object.values(original.effects ?? {});
  const refEffects = translated.effects ?? [];
  const effects = [];
  for ( const effect of current.effects ?? [] ) {
    const orig = origEffects.find(o => o?.name === effect.name);
    if ( !orig ) continue;
    const ref = refEffects.find(e => e._id === effect._id) ?? (((refEffects.length === 1) && (origEffects.length === 1)) ? refEffects[0] : null);
    if ( !ref ) continue;
    const change = { _id: effect._id };
    if ( stale(effect.name, orig.name, ref.name) ) change.name = ref.name;
    if ( stale(effect.description, orig.description, ref.description) ) change.description = ref.description;
    if ( Object.keys(change).length > 1 ) { effects.push(change); fields.push("effect"); }
  }
  return { update, effects, fields };
}

/**
 * §203: the same for an actor (name, biography, name of its prototype token when it followed the original name). Its items
 * are taken back one by one (`retranslateItem`).
 */
export function retranslateActor(current, original, translated) {
  const update = {};
  const fields = [];
  if ( !current || !original || !translated ) return { update, fields };
  for ( const [key, path] of ACTOR_FIELDS ) {
    const value = at(translated, path);
    if ( stale(at(current, path), original[key], value) ) { update[path] = value; fields.push(key); }
  }
  // The prototype token only when the sheet bears its original or translated name: a sheet renamed by hand ("Gray Ooze
  // Glob", drawn from the Gray Ooze) keeps a token under its own name, not that of the original creature.
  const token = translated.prototypeToken?.name || translated.name;
  const named = [original.name, translated.name].includes(current.name);
  if ( named && stale(current.prototypeToken?.name, original.name, token) ) { update["prototypeToken.name"] = token; fields.push("token"); }
  return { update, fields };
}
