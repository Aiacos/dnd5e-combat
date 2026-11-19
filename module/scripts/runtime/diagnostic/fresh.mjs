/**
 * Le document d'une tâche, tel qu'il est au moment de réparer. Une tâche garde le document de l'analyse ; entre-temps, une autre
 * réparation de la même passe a pu :
 *  - faire recréer par le cœur l'acteur propre d'un token (vu : réparer l'acteur de base, puis son token non lié, échouait) ;
 *  - le retirer. dnd5e supprime avec un objet les sorts qu'il donnait (activité « lancer », `flags.dnd5e.cachedFor`) et les recrée
 *    sous un autre id avec l'objet neuf : le nettoyage de Midi-QOL qui remplace l'objet laisse donc, pour ces sorts, des tâches
 *    sans document (#110). Rendre alors le document de l'analyse envoyait l'écriture à un parent que la base n'a plus.
 */

/** Le document d'une tâche n'existe plus : rien à réparer, et rien d'anormal (index.mjs le rend comme une tâche passée). */
export class VanishedError extends Error {
  constructor(uuid) {
    super(`document ${uuid} no longer exists`);
    this.name = "VanishedError";
    this.vanished = true;
  }
}

/** Le document relu, ou `null` s'il n'existe plus. */
function reread(doc) {
  // L'acteur propre d'un token se relit par son token (son uuid seul ne rend pas l'acteur propre, vu en jeu) ; ses objets, par lui.
  if ( (doc?.documentName === "Actor") && doc.isToken ) return fromUuidSync(doc.token.uuid, { strict: false })?.actor ?? null;
  if ( (doc?.parent?.documentName === "Actor") && doc.parent.isToken ) {
    return reread(doc.parent)?.[doc.collectionName]?.get(doc.id) ?? null;
  }
  return fromUuidSync(doc.uuid, { strict: false }) ?? null;
}

/** Le document tel qu'il est maintenant. Lève `VanishedError` s'il n'existe plus. */
export function fresh(doc) {
  const now = reread(doc);
  if ( !now ) throw new VanishedError(doc?.uuid);
  return now;
}
