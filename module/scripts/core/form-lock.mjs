/**
 * B09 (§488): the form lock carried by an item and the traits a worn item suspends. Pure functions, no dependency on Foundry.
 *
 * - `formLock: true` (§403): the area that lasts from the item forbids changing form in it (Moonbeam) — adapter/areas.mjs.
 * - `formLock: { worn: true, onAttempt?, forms? }`: while the item is worn, its bearer cannot change form; each
 *   attempt is refused (forceable) and inflicts the `onAttempt` steps on them (damage, `to: "bearer"`). An attempt: a dnd5e
 *   "transform" activity, the activity of a declared change of form (`changesForm`), any activity of an item whose identifier
 *   is in `forms`, or the manual activation of an effect carried by such an item (the forms of a sheet made of effects to
 *   switch on).
 * - `suspends: [clé, …]`: while the item is worn, these traits of its bearer do not work (an entry key: `regeneration`).
 */

/** The traits a worn item can suspend: those the engine rereads taking `suspends` into account (adapter/form-lock.mjs). */
export const SUSPENDABLE = Object.freeze(["regeneration"]);

/** The errors of `formLock` (empty = valid). `damageTypes`: the known damage types, or null to skip checking them. */
export function validateFormLock(value, damageTypes=null) {
  if ( value === true ) return [];
  if ( !value || (typeof value !== "object") || Array.isArray(value) ) return ["formLock: true (zone) or { worn: true, onAttempt?, forms? }"];
  const errors = [];
  for ( const key of Object.keys(value) ) if ( !["worn", "onAttempt", "forms"].includes(key) ) errors.push(`formLock.${key}: unknown key`);
  if ( value.worn !== true ) errors.push("formLock.worn: true (the only mode besides the zone's formLock: true)");
  if ( "forms" in value ) {
    const ok = Array.isArray(value.forms) && value.forms.length && value.forms.every(f => (typeof f === "string") && f.trim());
    if ( !ok ) errors.push("formLock.forms: non-empty list of item identifiers");
  }
  if ( "onAttempt" in value ) {
    if ( !Array.isArray(value.onAttempt) || !value.onAttempt.length ) errors.push("formLock.onAttempt: non-empty list of steps");
    else value.onAttempt.forEach((step, i) => {
      const at = `formLock.onAttempt[${i}]`;
      if ( !step || (typeof step !== "object") ) return errors.push(`${at}: a step is an object`);
      if ( step.type !== "damage" ) errors.push(`${at}.type: "damage" (the only step a worn form lock plays)`);
      if ( ("to" in step) && (step.to !== "bearer") ) errors.push(`${at}.to: "bearer" or absent`);
      for ( const key of Object.keys(step) ) if ( !["type", "to", "formula", "damageType", "activity"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
      if ( "activity" in step ) {
        if ( !/^[A-Za-z0-9]{16}$/.test(step.activity ?? "") ) errors.push(`${at}.activity: activity id (16 characters) expected`);
        return;
      }
      if ( (typeof step.formula !== "string") || !step.formula.trim() ) errors.push(`${at}.formula: formula required`);
      if ( (typeof step.damageType !== "string") || !step.damageType ) errors.push(`${at}.damageType: damage type required`);
      else if ( damageTypes && !damageTypes.includes(step.damageType) ) errors.push(`${at}.damageType: unknown "${step.damageType}"`);
    });
  }
  return errors;
}

/** Les erreurs de `suspends` (vide = valide). */
export function validateSuspends(value) {
  const ok = Array.isArray(value) && value.length && value.every(k => SUSPENDABLE.includes(k)) && (new Set(value).size === value.length);
  return ok ? [] : [`suspends: non-empty list among ${SUSPENDABLE.join(", ")}`];
}

/** The lock carried by an entry, normalized — `{ onAttempt, forms }` —, or null (no lock, or that of an area). */
export function wornFormLock(entry) {
  const lock = entry?.formLock;
  if ( !lock || (lock === true) || (lock.worn !== true) ) return null;
  return { onAttempt: Array.isArray(lock.onAttempt) ? lock.onAttempt : [], forms: Array.isArray(lock.forms) ? lock.forms : [] };
}

/**
 * Is an item "worn"? An item that is equipped (weapon, equipment, consumable…) is worn if equipped; an item that is not
 * equipped (a feature on the sheet that stands for the item) is worn as long as it is on the sheet.
 */
export const isWorn = ({ equippable, equipped }) => !equippable || (equipped === true);

/**
 * Is an activity an attempt to change form? `type`: that of the activity; `identifier`: that of its item;
 * `declaredChange`: the item declares `changesForm` for this activity; `forms`: the identifiers the lock names.
 */
export function isFormAttempt({ type, identifier=null, declaredChange=false }, forms=[]) {
  if ( (type === "transform") || declaredChange ) return true;
  return !!identifier && forms.includes(identifier);
}
