/**
 * Quel importeur a créé un objet, d'après ses flags : DDB Importer (`flags.ddbimporter`) ou Plutonium (`flags.plutonium`). L'un et
 * l'autre posent activités et effets sous d'autres ids que l'objet officiel — le diagnostic du monde les signale chacun dans sa
 * vérification. Un objet passé par les deux est à DDB Importer : sa synchronisation le recrée, sa réparation sait le verrouiller.
 * Fonction pure.
 * @param {object|null|undefined} flags  les flags de l'objet
 * @returns {"ddb"|"plutonium"|null}
 */
export function importerOf(flags) {
  if ( flags?.ddbimporter ) return "ddb";
  if ( flags?.plutonium ) return "plutonium";
  return null;
}
