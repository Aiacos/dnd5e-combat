/**
 * O1 (SPEC §335): defects in the data of a premium item that the engine fixes — activity cost, charges, fixed DC, damage parts,
 * changes of a carried effect, missing effect. Content key `dataFixes`, by identifier:
 *   [{ path, value, from? }]                    a field of the item (`system.activities.<id>.activation.type` for an activity)
 *   [{ effect, path, value, from? }]            a field of an item effect (`system.changes`, `transfer`, `disabled`, `duration`)
 *   [{ effect, create }]                        the missing effect, created with this id (`create`: its data, without `_id`)
 * A fix applies only if its target exists (the activity, the effect), the field already differs from `value`, and, with `from`,
 * it still equals exactly `from`: hand-edited data does not move. An array is replaced whole.
 * Written by the active GM when the item is created (runtime/data-fixes.mjs) and by the diagnostic for what already exists.
 */

/** A field of an activity, which must exist (a whole activity, however, can be added: "Recharge"). */
const ACTIVITY_PATH = /^system\.activities\.([A-Za-z0-9]{16})\./;

/** Reads a dotted path in a plain object. */
export function getPath(object, path) {
  return String(path).split(".").reduce((o, k) => ((o === null) || (o === undefined)) ? undefined : o[k], object);
}

/** Equality of JSON values (object key order does not matter, array order counts). */
export function sameValue(a, b) {
  if ( a === b ) return true;
  if ( (a === null) || (b === null) || (typeof a !== "object") || (typeof b !== "object") ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  if ( Array.isArray(a) ) return (a.length === b.length) && a.every((v, i) => sameValue(v, b[i]));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => sameValue(a[k], b[k]));
}

/**
 * Does the data resemble the declared origin? An object is compared on only the keys that `from` declares (dnd5e fills the data
 * with default values at creation); an array, element by element and of the same length; anything else, identically.
 */
export function matchesFrom(current, from) {
  // A null field is not stored in the source data: absent means null.
  if ( from === null ) return (current === null) || (current === undefined);
  if ( typeof from !== "object" ) return sameValue(current, from);
  if ( Array.isArray(from) ) return Array.isArray(current) && (current.length === from.length) && from.every((v, i) => matchesFrom(current[i], v));
  if ( (current === null) || (typeof current !== "object") || Array.isArray(current) ) return false;
  return Object.entries(from).every(([k, v]) => matchesFrom(current[k], v));
}

/** Does the fix apply to this field? (different value, `from` respected) */
function wanted(current, fix) {
  if ( ("from" in fix) ? !matchesFrom(current, fix.from) : false ) return false;
  return !matchesFrom(current, fix.value);
}

/**
 * The fixes of a spell copy: those of the spell, then those that the item casting it declares for its activity
 * (`spellFixes`). Neither: null.
 */
export function castFixes(own, fromCaster) {
  const all = [...(own ?? []), ...(fromCaster ?? [])];
  return all.length ? all : null;
}

/**
 * The fix plan of an item, from its source data (`item.toObject()`: `system`, `effects` as an array) and its fixes.
 * @returns {{ item: object, effects: object[], create: object[], fields: string[] }}  `item`: dotted update; `effects`:
 *   effect updates (`{ _id, <chemin>: valeur }`); `create`: effects to create (with `_id`); `fields`: what changes, readable.
 */
export function dataFixPlan(source, fixes) {
  const plan = { item: {}, effects: [], create: [], fields: [] };
  if ( !Array.isArray(fixes) || !source ) return plan;
  const effects = new Map((source.effects ?? []).map(e => [e._id, e]));
  const effectUpdates = new Map();
  for ( const fix of fixes ) {
    if ( fix.effect ) {
      const effect = effects.get(fix.effect);
      if ( fix.create ) {
        // `unless`: the effect is not created if the data already carries that one — a module version that has added it since.
        if ( !effect && !effects.has(fix.unless) && !plan.create.some(e => e._id === fix.effect) ) {
          plan.create.push({ ...structuredClone(fix.create), _id: fix.effect });
          plan.fields.push(`effect ${fix.effect} (created)`);
        }
        continue;
      }
      if ( !effect || !wanted(getPath(effect, fix.path), fix) ) continue;
      const update = effectUpdates.get(fix.effect) ?? effectUpdates.set(fix.effect, { _id: fix.effect }).get(fix.effect);
      update[fix.path] = structuredClone(fix.value);
      plan.fields.push(`effect ${fix.effect}: ${fix.path}`);
      continue;
    }
    const activity = String(fix.path).match(ACTIVITY_PATH)?.[1];
    if ( activity && !source.system?.activities?.[activity] ) continue;
    if ( !wanted(getPath(source, fix.path), fix) ) continue;
    plan.item[fix.path] = structuredClone(fix.value);
    plan.fields.push(fix.path);
  }
  plan.effects = [...effectUpdates.values()];
  return plan;
}

/** Le plan change-t-il quelque chose ? */
export const planIsEmpty = plan => !plan || (!Object.keys(plan.item).length && !plan.effects.length && !plan.create.length);

/** Writes a value at a dotted path of a plain object, creating the intermediate objects. */
function setPath(object, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  let o = object;
  for ( const k of keys ) o = (o[k] && (typeof o[k] === "object")) ? o[k] : (o[k] = {});
  o[last] = value;
}

/**
 * §456: the data as the engine renders it — a copy of `source` (`system`, `effects` as an array) where the plan of its fixes
 * is applied (fixed fields, fixed effects, created effects). Used to compare with the fixed reference (`phb3-items`
 * diagnostic, which otherwise would see every fixed item as "different from the Handbook" and replace it endlessly) and
 * for the ATLAS. `fields`: what changed.
 * @returns {{ data: object, fields: string[] }}
 */
export function withDataFixes(source, fixes) {
  const plan = dataFixPlan(source, fixes);
  if ( !plan.fields.length ) return { data: source, fields: [] };
  const data = structuredClone(source);
  for ( const [path, value] of Object.entries(plan.item) ) setPath(data, path, value);
  data.effects = (data.effects ?? []).map(e => ({ ...e }));
  for ( const { _id, ...update } of plan.effects ) {
    const effect = data.effects.find(e => e._id === _id);
    if ( effect ) for ( const [path, value] of Object.entries(update) ) setPath(effect, path, value);
  }
  data.effects.push(...plan.create);
  return { data, fields: plan.fields };
}

/** Validation of the `dataFixes` key of an entry: one message per defect found. */
export function validateDataFixes(fixes, at="") {
  const ok = Array.isArray(fixes) && fixes.length && fixes.every(f => {
    if ( !f || (typeof f !== "object") || Array.isArray(f) ) return false;
    const keys = Object.keys(f);
    if ( "create" in f ) {
      return (typeof f.effect === "string") && /^[A-Za-z0-9]{16}$/.test(f.effect) && f.create && (typeof f.create === "object")
        && !Array.isArray(f.create) && (!("unless" in f) || ((typeof f.unless === "string") && /^[A-Za-z0-9]{16}$/.test(f.unless)))
        && keys.every(k => ["effect", "create", "unless"].includes(k));
    }
    if ( ("effect" in f) && !((typeof f.effect === "string") && /^[A-Za-z0-9]{16}$/.test(f.effect)) ) return false;
    return (typeof f.path === "string") && /^[\w.]+$/.test(f.path) && ("value" in f) && (f.effect || /^(system|name)\b/.test(f.path))
      && keys.every(k => ["effect", "path", "value", "from"].includes(k));
  });
  return ok ? [] : [`${at}dataFixes: [{ path, value, from? } | { effect, path, value, from? } | { effect, create, unless? }]`];
}
