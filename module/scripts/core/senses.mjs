/**
 * Sens déclarés par du contenu (clé `sense`) et ce qui en protège (clé `wardsDetection`). Règle pure.
 *
 * Un sens qui n'est pas une vue donne la position d'une créature sans la faire voir : la cible reste non vue pour l'attaque et
 * pour ce qui exige de la voir. Un sens de genre `sight` compte comme une vue. Certains ne donnent que la présence
 * (`reveals: "presence"`), sans la position.
 *
 * L'adaptateur (adapter/senses.mjs) lit la scène : distance, mur entre les deux, faits sur la cible, protections qu'elle porte.
 */

/** Les verdicts d'un sens, du plus faible au plus fort. */
export const SENSE_VERDICTS = Object.freeze(["presence", "locate", "sight"]);

/** Les genres de sens : `locate` — position connue, pas une vue ; `sight` — compte comme une vue. */
export const SENSE_KINDS = Object.freeze(["locate", "sight"]);

/** Les sens que porte une entrée de contenu : `sense` est un sens ou une liste. */
export function sensesIn(entry) {
  const declared = entry?.sense;
  if ( !declared ) return [];
  return Array.isArray(declared) ? declared : [declared];
}

/**
 * La cible est-elle protégée contre ce sens ? `wards` : ce que ses protections arrêtent — une école de magie (les sorts de cette
 * école ne la trouvent pas), ou `magic` (aucune détection magique ne la trouve). Un sens sans `magic` est naturel : rien ne
 * l'arrête.
 * @param {{magic?: string|true}} sense  `magic` : l'école du sort qui le donne, ou true pour un effet magique sans école.
 * @param {string[]} wards
 */
export function wardedAgainst(sense, wards) {
  if ( !sense?.magic || !wards?.length ) return false;
  return wards.includes("magic") || ((typeof sense.magic === "string") && wards.includes(sense.magic));
}

/**
 * Ce qu'un sens dit d'une cible : `"sight"`, `"locate"`, `"presence"`, ou null.
 * @param {{kind: string, range: number, walls?: false, reveals?: "presence", magic?: string|true}} sense  `range` : dans l'unité de
 *   `distance`.
 * @param {{distance: number, walled: boolean, matches: boolean, wards: string[]}} facts  `walled` : un mur les sépare ; `matches` :
 *   la cible est de celles que le sens détecte ; `wards` : ce dont la cible est protégée.
 */
export function senseVerdict(sense, { distance, walled, matches, wards }) {
  if ( !sense || !matches ) return null;
  if ( !(distance <= sense.range) ) return null;
  if ( walled && (sense.walls !== false) ) return null;
  if ( wardedAgainst(sense, wards) ) return null;
  return (sense.reveals === "presence") ? "presence" : sense.kind;
}

/** Le plus fort de plusieurs verdicts, ou null. */
export function bestVerdict(verdicts) {
  let best = -1;
  for ( const verdict of verdicts ) best = Math.max(best, SENSE_VERDICTS.indexOf(verdict));
  return (best < 0) ? null : SENSE_VERDICTS[best];
}
