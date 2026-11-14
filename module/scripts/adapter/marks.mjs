/**
 * Marques locales au client qui joue une réaction (SPEC §19.6) : ce que la réaction choisie promet au jet qui la suit, le temps
 * de ce jet. Par exemple une riposte : une attaque contre cet ennemi, avec l'avantage. L'activité de la
 * réaction est utilisée juste après (adapter/reactions.mjs, `handleReactionQuery`) et son jet d'attaque s'enchaîne sur ce même
 * client ; l'avantage y est déclaré (adapter/triggers.mjs, `declaredAttackModifiers`). La marque tombe au jet, ou d'elle-même.
 */

/** Durée de vie d'une marque sans jet (réaction annulée, fenêtre fermée). */
const LIFETIME_MS = 30000;

/**
 * §438 suite : pose une marque et son minuteur. Une nouvelle marque sur la même activité remplace l'ancienne ET son minuteur —
 * sans quoi le minuteur d'une Riposte ratée effaçait la marque d'une Riposte suivante (le dé de supériorité perdu, vu au banc).
 */
const timers = new WeakMap();
function put(map, key, value, ms) {
  clearTimeout(timers.get(map)?.get(key));
  map.set(key, value);
  if ( !timers.has(map) ) timers.set(map, new Map());
  timers.get(map).set(key, setTimeout(() => { map.delete(key); timers.get(map)?.delete(key); }, ms));
}
function take(map, key) {
  const value = map.get(key) ?? null;
  map.delete(key);
  clearTimeout(timers.get(map)?.get(key));
  timers.get(map)?.delete(key);
  return value;
}

const advantaged = new Map();

/** L'activité `uuid`, utilisée en réaction, attaque avec l'avantage (au nom de `name`). */
export function markReactionAdvantage(uuid, name) {
  put(advantaged, uuid, name, LIFETIME_MS);
}

/** Le nom de la réaction qui donne l'avantage à ce jet de l'activité `uuid`, ou null ; la marque est consommée. */
export function takeReactionAdvantage(uuid) {
  return take(advantaged, uuid);
}

/** Sans la consommer : l'activité a-t-elle une marque d'avantage ? */
export const hasReactionAdvantage = uuid => advantaged.has(uuid);

/** §134 : le pendant — une réaction jouée avec le Désavantage (attaque d'opportunité contre un porteur de Rapide). */
const hampered = new Map();
export function markReactionDisadvantage(uuid, name) {
  put(hampered, uuid, name, LIFETIME_MS);
}
export const hasReactionDisadvantage = uuid => hampered.has(uuid);
export function takeReactionDisadvantage(uuid) {
  return take(hampered, uuid);
}

/* -------------------------------------------- */

/**
 * §88 : Riposte du Maître de guerre — « si vous touchez, ajoutez le dé de supériorité aux dégâts de l'attaque » : la formule (déjà
 * lancée avec les données de l'acteur, « 1d8 ») promise au jet de dégâts de l'activité `uuid`, sur ce client ; consommée au jet.
 */
const damaged = new Map();

export function markReactionDamage(uuid, formula, name) {
  put(damaged, uuid, { formula, name }, LIFETIME_MS * 2);
}

/** La formule promise au jet de dégâts de l'activité `uuid`, ou null ; la marque est consommée. */
export function takeReactionDamage(uuid) {
  return take(damaged, uuid);
}
