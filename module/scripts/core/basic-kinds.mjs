/**
 * The basic actions an activity takes (`basicActions` of the content), when the declaration depends on what the activity spends.
 * The same activity — same id — is, depending on the data, the paid or the free version of a feature: the Monk's Step of the Wind
 * (`0MuRZ0Ur95xQTKFq`) spends 1 Focus Point in the Player's Handbook 2.2.0 (Dash and Disengage), and nothing in the
 * SRD 5.2 and the Handbook 3.0.0, where the point moves to another activity (Dash alone). Pure function.
 */

/** Does the declaration have both forms, `{ paid, free }`? */
export function hasPaidForm(declared) {
  return !!declared && (typeof declared === "object") && !Array.isArray(declared) && (("paid" in declared) || ("free" in declared));
}

/**
 * The declaration that applies to this use: `paid` if the activity spends a resource, `free` otherwise; a declaration without
 * these forms (a kind, a list, `{ choose }`) is returned as is.
 * @param {string|string[]|{choose: string[]}|{paid?: string|string[], free?: string|string[]}|null|undefined} declared
 * @param {boolean} spends  the activity spends something (its `consumption.targets`)
 */
export function basicKindsFor(declared, spends) {
  if ( !hasPaidForm(declared) ) return declared ?? null;
  return (spends ? declared.paid : declared.free) ?? null;
}
