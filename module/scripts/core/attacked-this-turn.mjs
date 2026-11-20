/**
 * §492 : qui a attaqué qui, pendant le tour de combat en cours — règle pure. Le registre vit sur le Combat (adapter/attacked-this-turn.mjs) ;
 * il ne garde qu'un tour : la première attaque d'un autre tour repart d'un registre vide.
 *
 * Registre : `{ turn: "<combat>.<round>.<turn>", attacks: [{ source, target, kinds: ["melee"?, "ranged"?] }] }` (uuids d'acteurs : un token
 * non lié a le sien). Une liste, pas un objet par paire : `setFlag` fusionne les objets, une liste se remplace entière.
 * Le fait `source.attackedSelfThisTurn` le lit : « quand une créature hostile termine son tour après l'avoir attaquée au corps à corps ».
 */

export const ATTACK_KINDS = Object.freeze(["melee", "ranged"]);

/**
 * Le genre d'une attaque : « melee » pour une attaque d'activité de type mêlée qui n'est ni lancée ni tirée (même règle que dnd5e,
 * data/activity/attack-data.mjs, `getRollData` : `roll.attack.type`, et que le fait `activity.isMelee`), « ranged » sinon ; null hors attaque.
 */
export function attackKindOf({ activityType=null, attackType=null, attackMode=null }={}) {
  if ( activityType !== "attack" ) return null;
  const thrownOrRanged = !!attackMode && (String(attackMode).includes("thrown") || (attackMode === "ranged"));
  return ((attackType === "melee") && !thrownOrRanged) ? "melee" : "ranged";
}

/**
 * Le registre après une attaque. Un autre tour efface le précédent ; une paire garde chaque genre une fois.
 * @returns {object|null}  Le nouveau registre, ou null s'il n'y a rien à noter (tour, source, cible ou genre inconnus).
 */
export function recordAttack(log, { turn, source, targets=[], kind }) {
  if ( !turn || !source || !ATTACK_KINDS.includes(kind) ) return null;
  const list = [targets].flat().filter(t => t && (t !== source));
  if ( !list.length ) return null;
  const attacks = (log?.turn === turn) ? (log.attacks ?? []).map(a => ({ ...a, kinds: [...(a.kinds ?? [])] })) : [];
  for ( const target of list ) {
    let entry = attacks.find(a => (a.source === source) && (a.target === target));
    if ( !entry ) attacks.push(entry = { source, target, kinds: [] });
    const kinds = new Set([...entry.kinds, kind]);
    entry.kinds = ATTACK_KINDS.filter(k => kinds.has(k));
  }
  return { turn, attacks };
}

/** Les genres d'attaque de `source` contre `target` pendant ce tour (`[]` : aucune, ou registre d'un autre tour). */
export function attacksDuring(log, { turn, source, target }) {
  if ( !turn || !source || !target || (log?.turn !== turn) ) return [];
  return [...((log.attacks ?? []).find(a => (a.source === source) && (a.target === target))?.kinds ?? [])];
}

/**
 * La condition : `true` (une attaque, quel qu'en soit le genre), `false` (aucune), `"melee"` / `"ranged"` ou une liste de genres (l'un
 * d'eux au moins).
 */
export function attackedMatches(kinds, want) {
  if ( !validAttackedArg(want) ) return false;
  if ( (want === true) || (want === false) ) return (kinds.length > 0) === want;
  const wanted = [want].flat();
  return kinds.some(k => wanted.includes(k));
}

/** La valeur de la condition est-elle valable ? (Validation du contenu.) */
export function validAttackedArg(want) {
  if ( typeof want === "boolean" ) return true;
  const list = [want].flat();
  return list.length > 0 && list.every(k => ATTACK_KINDS.includes(k));
}
