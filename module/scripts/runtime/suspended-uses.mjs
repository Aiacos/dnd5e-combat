/**
 * Les utilisations qu'une porte a suspendues pour poser ses questions (runtime/gates.mjs : Sanctuaire, Contresort, réactions
 * d'avant l'attaque, Présage) et qu'elle relancera elle-même. `dnd5e.preUseActivity` rend alors `false` : l'appelant de
 * `activity.use()` ne reçoit rien, alors que l'utilisation n'est pas refusée. Qui enchaîne plusieurs utilisations (les projectiles
 * d'un sort) lit ici la promesse de la relance au lieu de conclure que rien n'est parti. Sans dépendance à Foundry.
 */

const pending = new Map();
/** Une relance tranchée reste lisible ce temps-là : l'appelant la lit juste après le retour de `activity.use()`. */
const KEEP_MS = 2000;

/**
 * Inscrit la relance d'une utilisation suspendue.
 * @param {string} key                 l'uuid de l'activité
 * @param {Promise<{message?: object}|null|undefined>} relaunch  ce que rend la relance, ou rien si l'utilisation ne part pas
 * @returns {Promise<{message: object}|null>}  la même, ramenée à « un résultat avec sa carte » ou null
 */
export function suspendUse(key, relaunch) {
  const settled = Promise.resolve(relaunch).then(used => (used?.message ? used : null), () => null);
  pending.set(key, settled);
  settled.then(() => setTimeout(() => { if ( pending.get(key) === settled ) pending.delete(key); }, KEEP_MS));
  return settled;
}

/** La relance en cours (ou tout juste tranchée) de cette activité, ou null si aucune porte ne l'a suspendue. */
export function suspendedUse(key) {
  return pending.get(key) ?? null;
}
