/**
 * Les sorts en double d'une fiche (vérification `spell-duplicates` du diagnostic, demande de l'utilisateur 2026-11-15).
 *
 * Un module de préparation des sorts qui reconnaît un sort par l'uuid de son compendium d'origine (`_stats.compendiumSource`) ne
 * reconnaît pas le même sort venu d'un autre compendium (SRD 5.2 `dnd5e.spells24` contre Manuel des joueurs) : il en ajoute une seconde
 * copie, et la fiche porte deux fois le même sort. Vu au banc le 2026-11-15 : Guiding Bolt du SRD non préparé + copie du Manuel préparée.
 *
 * Un doublon : même identifiant dnd5e, même origine (classe — `classIdentifier`, ou « class:<id> » de `system.sourceItem` —, ou l'objet
 * qui l'a donné), même méthode. Ne sont jamais des doublons : les sorts innés, à volonté ou « rituel seulement » (méthodes `innate`,
 * `atwill`, `ritual`, qui existent légitimement à côté du sort de classe) et la copie qu'un objet lance (`flags.dnd5e.cachedFor`).
 * Le sort gardé : celui du compendium préféré (ordre de `preferred`), puis le plus préparé, puis celui qui porte le plus de réglages de
 * modules, puis le premier de la fiche. Il prend l'état de préparation le plus élevé du groupe et les portées de flags que seuls les
 * sorts retirés portaient (hors `skipFlags`).
 *
 * Pur : reçoit des descriptions simples, sans document Foundry.
 */

/** Méthodes dont un sort peut exister en plus du sort de classe. */
export const SIDE_METHODS = Object.freeze(["innate", "atwill", "ritual"]);

/** Portées de flags qui ne passent pas d'un sort retiré au sort gardé (propres à chaque copie, ou au système). */
export const SKIP_FLAGS = Object.freeze(["core", "dnd5e", "babele", "exportSource"]);

/**
 * L'origine d'un sort pour le regroupement : « class:<id> », une autre origine écrite (« subclass:life », un objet), ou, sans rien,
 * la seule classe de lanceur de la fiche (`casterClasses`), sinon "".
 * @param {{classIdentifier?: string, sourceItem?: string}} spell
 * @param {string[]} [casterClasses]
 */
export function originKey({ classIdentifier="", sourceItem="" }={}, casterClasses=[]) {
  const written = String(sourceItem ?? "");
  const cls = classIdentifier || (written.startsWith("class:") ? written.slice(6) : "");
  if ( cls ) return `class:${cls}`;
  if ( written ) return written;
  return (casterClasses.length === 1) ? `class:${casterClasses[0]}` : "";
}

/** Rang d'un uuid d'origine dans la liste des compendiums préférés (préfixes) ; au-delà : aucun. */
function sourceRank(source, preferred) {
  const i = preferred.findIndex(p => String(source ?? "").startsWith(p));
  return (i < 0) ? preferred.length : i;
}

/**
 * Les groupes de doublons d'une fiche.
 * @param {Array<{id: string, name?: string, identifier?: string, method?: string, prepared?: number, classIdentifier?: string,
 *   sourceItem?: string, source?: string, cachedFor?: string|null, flagScopes?: string[], sort?: number}>} spells
 * @param {{casterClasses?: string[], preferred?: string[], skipFlags?: string[]}} [options]
 * @returns {Array<{keep: object, remove: object[], prepared: number, raisePrepared: boolean, flagScopes: string[]}>}
 *   `flagScopes` : les portées de flags à recopier d'un sort retiré vers le gardé, avec l'id du sort qui les donne
 *   (`[{ scope, from }]`).
 */
export function spellDuplicates(spells, { casterClasses=[], preferred=[], skipFlags=SKIP_FLAGS }={}) {
  const groups = new Map();
  for ( const spell of spells ?? [] ) {
    if ( SIDE_METHODS.includes(spell.method) || spell.cachedFor ) continue;
    const identifier = spell.identifier || String(spell.name ?? "").toLowerCase();
    if ( !identifier ) continue;
    const key = `${identifier}|${originKey(spell, casterClasses)}|${spell.method ?? ""}`;
    if ( !groups.has(key) ) groups.set(key, []);
    groups.get(key).push(spell);
  }
  const out = [];
  for ( const group of groups.values() ) {
    if ( group.length < 2 ) continue;
    const ranked = [...group].sort((a, b) => (sourceRank(a.source, preferred) - sourceRank(b.source, preferred))
      || ((Number(b.prepared) || 0) - (Number(a.prepared) || 0))
      || ((b.flagScopes?.length ?? 0) - (a.flagScopes?.length ?? 0))
      || ((a.sort ?? 0) - (b.sort ?? 0)));
    const [keep, ...remove] = ranked;
    const prepared = Math.max(...group.map(s => Number(s.prepared) || 0));
    const kept = new Set(keep.flagScopes ?? []);
    const flagScopes = [];
    for ( const r of remove ) for ( const scope of r.flagScopes ?? [] ) {
      if ( skipFlags.includes(scope) || kept.has(scope) ) continue;
      kept.add(scope);
      flagScopes.push({ scope, from: r.id });
    }
    out.push({ keep, remove, prepared, raisePrepared: prepared > (Number(keep.prepared) || 0), flagScopes });
  }
  return out;
}
