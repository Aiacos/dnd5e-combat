/**
 * Sens déclarés par du contenu (clé `sense`) et ce qui en protège (clé `wardsDetection`). Règle pure.
 *
 * Un sens qui n'est pas une vue donne la position d'une créature sans la faire voir : la cible reste non vue pour l'attaque et
 * pour ce qui exige de la voir. Un sens de genre `sight` compte comme une vue. Certains ne donnent que la présence
 * (`reveals: "presence"`), sans la position.
 *
 * L'adaptateur (adapter/senses.mjs) lit la scène : distance, mur entre les deux, faits sur la cible, protections qu'elle porte.
 */

import { holds } from "./triggers.mjs";

/** Les verdicts d'un sens, du plus faible au plus fort. */
export const SENSE_VERDICTS = Object.freeze(["aura", "presence", "locate", "sight"]);

/**
 * Ce qu'un sens peut révéler au lieu de la position (`reveals`) : `presence` — la présence est sue, pas la position ; `aura` — rien
 * de plus que ce qui est déjà vu : la créature visible qui porte ce que le sens détecte est marquée (Détection de la magie).
 */
export const SENSE_REVEALS = Object.freeze(["presence", "aura"]);

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

/** Ce qu'une vue déclarée peut percer (`through`) : des ténèbres. Jamais une brume, qui arrête toute vue. */
export const SENSE_THROUGH = Object.freeze(["darkness"]);

/** Ce dont un sens peut dépendre (`needs`) : il s'éteint tant que son porteur est Aveuglé (`sight`) ou Assourdi (`hearing`). */
export const SENSE_NEEDS = Object.freeze(["sight", "hearing"]);

/**
 * Ce qu'un sens dit d'une cible : `"sight"`, `"locate"`, `"presence"`, `"aura"`, ou null.
 *
 * Un sens qui localise ne dépend ni de la lumière ni de l'état Invisible. Une vue (`kind: "sight"`), si : elle ne voit pas une
 * cible Invisible, une brume l'arrête toujours, et des ténèbres aussi, sauf si elle les perce (`through: ["darkness"]`).
 * @param {{kind: string, range: number, walls?: false, reveals?: "presence", magic?: string|true, through?: string[],
 *   needs?: "sight"|"hearing"}} sense  `range` : dans l'unité de `distance`.
 * @param {{distance: number, walled: boolean, matches: boolean, wards: string[], blind?: boolean, deaf?: boolean,
 *   invisible?: boolean, fog?: boolean, darkness?: boolean}} facts  `walled` : un mur les sépare ; `matches` : la cible est de
 *   celles que le sens détecte ; `wards` : ce dont la cible est protégée ; `blind`, `deaf` : le porteur est Aveuglé, Assourdi ;
 *   `invisible` : la cible est Invisible pour lui ; `fog`, `darkness` : une zone qui bloque la vue entre eux, ou autour de l'un.
 */
export function senseVerdict(sense, { distance, walled, matches, wards, blind=false, deaf=false, invisible=false, fog=false,
  darkness=false }) {
  if ( !sense || !matches ) return null;
  if ( !(distance <= sense.range) ) return null;
  if ( ((sense.needs === "sight") && blind) || ((sense.needs === "hearing") && deaf) ) return null;
  if ( walled && (sense.walls !== false) ) return null;
  if ( wardedAgainst(sense, wards) ) return null;
  if ( SENSE_REVEALS.includes(sense.reveals) ) return sense.reveals;
  if ( sense.kind === "sight" ) {
    if ( invisible || fog ) return null;
    if ( darkness && !sense.through?.includes("darkness") ) return null;
  }
  return sense.kind;
}

/** Le plus fort de plusieurs verdicts, ou null. */
export function bestVerdict(verdicts) {
  let best = -1;
  for ( const verdict of verdicts ) best = Math.max(best, SENSE_VERDICTS.indexOf(verdict));
  return (best < 0) ? null : SENSE_VERDICTS[best];
}

/**
 * `detectedAs` : pour les sens, une créature peut compter aussi comme d'autres types que le sien (elle « est perçue comme » un
 * mort-vivant). Ce que le sens détecte (`detects`) tient-il pour la cible telle qu'elle est, ou comme l'un de ces types ? Jamais
 * pour autre chose que les sens : ni l'attaque ni la sauvegarde ne lisent ces types.
 * @param {object|null} detects  La condition du sens (core/triggers.mjs `holds`) ; absente : toute créature.
 * @param {object} facts  Les faits sur la cible.
 * @param {string[]} [alsoTypes]  Les types sous lesquels elle est aussi perçue.
 */
export function detectsTarget(detects, facts, alsoTypes=[]) {
  if ( holds(detects, facts) ) return true;
  return alsoTypes.some(type => holds(detects, { ...facts, "target.creatureType": type }));
}

/**
 * `senseNeeds` : les sens de la fiche (modes de détection : `blindsight`…) éteints en ce moment, parce qu'ils dépendent de la vue
 * ou de l'ouïe de leur porteur et qu'il est Aveuglé ou Assourdi — une vision aveugle par écholocalisation.
 * @param {Array<Record<string, "sight"|"hearing">>} needs  Les `senseNeeds` des items du porteur.
 * @param {{blind?: boolean, deaf?: boolean}} state
 * @returns {string[]}  Les ids des modes éteints.
 */
export function mutedSenses(needs, { blind=false, deaf=false }={}) {
  const muted = new Set();
  for ( const declared of needs ?? [] ) {
    for ( const [mode, need] of Object.entries(declared ?? {}) ) {
      if ( ((need === "sight") && blind) || ((need === "hearing") && deaf) ) muted.add(mode);
    }
  }
  return Array.from(muted);
}

/**
 * Réglage `anonymousLocated` : une créature perçue sans être vue — entendue (`heard`) ou localisée par un sens (`located`) —
 * est-elle montrée sans son image ni son nom ? Sa position est connue, pas son identité. Une aura (`aura`) se pose sur ce qui
 * est vu : jamais.
 * @param {"heard"|"located"|"aura"|null} kind  Ce pour quoi le token est affiché sur ce client.
 * @param {boolean} rule  Le réglage du monde.
 */
export function hidesIdentity(kind, rule) {
  return !!rule && ((kind === "heard") || (kind === "located"));
}

/**
 * Une créature affichée par un sens déclaré porte-t-elle la marque « localisée, pas vue » ? Oui si aucun des observateurs de ce
 * client ne la VOIT par un sens déclaré (`sight` : une vue à travers les murs) — vue, elle garde le contour, sans la marque ni
 * le Désavantage qu'elle annonce.
 * @param {Array<"sight"|"locate"|"presence"|"aura"|null>} verdicts  Ce que les sens déclarés de chaque observateur disent d'elle.
 */
export function onlyLocated(verdicts) {
  return !(verdicts ?? []).includes("sight");
}

/**
 * Issue #107: does the observer know where the target is? `located`: it sees the target or locates it (`canLocate`, which rules
 * out a creature Hidden from it). A sense that locates without sight (Tremorsense, a declared `locate` sense) still pinpoints a
 * Hidden creature's square (`sensed`): the creature stays unseen and keeps its Hidden state — attacks against it keep the
 * Disadvantage of an unseen target, and nothing reveals it. Sight never finds a Hidden creature here: that is the Search action.
 * @param {{located: boolean|null, hidden: boolean, sensed: boolean|null}} facts  `hidden`: Hidden from this observer.
 * @returns {boolean|null}  null: the vision cannot tell.
 */
export function pinpoints({ located, hidden, sensed }) {
  if ( (located !== false) || !hidden ) return located;
  return sensed;
}

/**
 * Issue #107: is a creature drawn for a declared sense's verdict? A sense that locates draws it, Hidden or not (its square is
 * known); a declared sight draws it unless it is Hidden from the observer.
 * @param {"sight"|"locate"|"presence"|"aura"|null} verdict
 * @param {boolean} hidden  Hidden from this observer.
 */
export function drawsSensed(verdict, hidden) {
  return (verdict === "locate") || ((verdict === "sight") && !hidden);
}
