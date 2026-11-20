/**
 * §37.2 : Dissipation de la magie (Manuel des joueurs 2024) — les sorts actifs sur la cible jusqu'au niveau 3 sont dissipés sans
 * jet ; au-delà, chacun demande un test de la caractéristique d'incantation contre un DD de 10 + son niveau. Lancée avec un
 * emplacement de niveau 4 ou plus, elle dissipe aussi sans jet tout sort dont le niveau ne dépasse pas celui de l'emplacement.
 * §496 (brique B16) : une dissipation bornée — `dispel: { upTo, beyond: "none" | "check", keepBySlot? }` : jusqu'au niveau `upTo`
 * (quel que soit l'emplacement) les sorts cessent ; au-delà, rien (`none`, pas de test) ou le test de 2024 (`check`).
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Jusqu'à quel niveau un sort cesse d'office, pour une Dissipation lancée à ce niveau (3 au moins). */
export function autoDispelLevel(slotLevel) {
  return Math.max(3, Number(slotLevel) || 3);
}

/**
 * §496 : la règle déclarée, sous une forme unique. `true` : la Dissipation de 2024 (plafond = l'emplacement, test au-delà).
 * @param {true|{upTo?: number, beyond?: "none"|"check", keepBySlot?: true}} value
 * @returns {{upTo: number|null, beyond: "none"|"check", keepBySlot: boolean}|null}  null si l'item ne dissipe rien.
 */
export function dispelRule(value) {
  if ( value === true ) return { upTo: null, beyond: "check", keepBySlot: false };
  if ( !value || (typeof value !== "object") ) return null;
  return {
    upTo: Number.isInteger(value.upTo) ? value.upTo : null,
    beyond: (value.beyond === "none") ? "none" : "check",
    keepBySlot: value.keepBySlot === true
  };
}

/**
 * Ce qui arrive à chaque sort en cours : `auto` (il cesse), un test contre `dc`, ou rien (`none` : hors de portée de la règle).
 * @param {Array<{key: string, level: number}>} spells  Un par sort lancé (niveau de lancement).
 * @param {number} slotLevel                            Niveau auquel la Dissipation est lancée.
 * @param {{upTo?: number|null, beyond?: "none"|"check"}} [rule]  §496 : plafond fixe et ce qui se passe au-delà.
 * @returns {Array<{key: string, level: number, auto: boolean, dc: number|null, none?: true}>}
 */
export function dispelPlan(spells, slotLevel, { upTo=null, beyond="check" }={}) {
  const ceiling = Number.isInteger(upTo) ? upTo : autoDispelLevel(slotLevel);
  return spells.map(({ key, level }) => {
    const lvl = Math.max(0, Number(level) || 0);
    if ( lvl <= ceiling ) return { key, level: lvl, auto: true, dc: null };
    return (beyond === "none") ? { key, level: lvl, auto: false, dc: null, none: true } : { key, level: lvl, auto: false, dc: 10 + lvl };
  });
}
