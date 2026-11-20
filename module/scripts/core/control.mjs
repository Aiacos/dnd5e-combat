/**
 * §285 : sorts de contrôle (lot 3 des chantiers du 2026-10-30). Pur : ce que la table de Confusion impose, et la direction tirée
 * pour l'errance.
 *
 * Confusion (PHB 2024), 1d10 au début de chacun de ses tours :
 *   1     elle n'entreprend aucune action et dépense tout son déplacement dans une direction aléatoire (1d8 pour la direction) ;
 *   2–6   elle ne se déplace pas et n'entreprend aucune action ;
 *   7–8   elle fait une attaque au corps à corps contre une créature au hasard à son allonge, sinon elle n'entreprend aucune action ;
 *   9–10  elle choisit son comportement.
 */

/**
 * @param {number} d10
 * @returns {{ kind: "wander"|"idle"|"lash"|"free", move: boolean, action: boolean }}
 *   `move` : elle garde son déplacement ; `action` : elle garde son action.
 */
export function confusionBehavior(d10) {
  if ( d10 <= 1 ) return { kind: "wander", move: true, action: false };
  if ( d10 <= 6 ) return { kind: "idle", move: false, action: false };
  if ( d10 <= 8 ) return { kind: "lash", move: false, action: true };
  return { kind: "free", move: true, action: true };
}

import { MOVE_DIRECTIONS as COMPASS } from "./content/enums.mjs";

/** Les huit directions de la grille, dans l'ordre d'un 1d8 (nord, puis dans le sens des aiguilles d'une montre). `di` : ligne. */
export const DIRECTIONS = Object.freeze([
  { di: -1, dj: 0 }, { di: -1, dj: 1 }, { di: 0, dj: 1 }, { di: 1, dj: 1 },
  { di: 1, dj: 0 }, { di: 1, dj: -1 }, { di: 0, dj: -1 }, { di: -1, dj: -1 }
]);

/**
 * §497 : la direction d'un déplacement aléatoire (étape `move`, mode `random` : Infestation). `directions` : les directions permises
 * (`MOVE_DIRECTIONS`, n, ne, e, se, s, sw, w, nw ; les huit par défaut), dans l'ordre du dé ; `face` : le résultat du 1dN, N = leur nombre.
 * @param {string[]|null|undefined} directions
 * @param {number} face
 * @returns {{key: string, di: number, dj: number}|null}  null si la face ou une direction est inconnue.
 */
export function randomDirection(directions, face) {
  const keys = (Array.isArray(directions) && directions.length) ? directions : COMPASS;
  const key = keys[Math.round(face) - 1];
  const index = COMPASS.indexOf(key);
  if ( index < 0 ) return null;
  return { key, ...DIRECTIONS[index] };
}

/** §497 : le nombre de faces du dé d'un déplacement aléatoire. */
export function randomDie(directions) {
  return (Array.isArray(directions) && directions.length) ? directions.length : COMPASS.length;
}

/**
 * Les cases visées par l'errance : de la plus lointaine (`cells` pas dans la direction du d8) à la plus proche, bornées par la
 * scène (`bounds` : { i0, j0, i1, j1 }, coin haut-gauche de l'emprise `size` { w, h }). La marche prend la première joignable.
 */
export function wanderCells(from, d8, cells, size, bounds) {
  const dir = DIRECTIONS[(Math.max(1, Math.min(8, d8)) - 1)];
  const out = [];
  for ( let n = cells; n >= 1; n-- ) {
    const i = from.i + (dir.di * n), j = from.j + (dir.dj * n);
    if ( (i < bounds.i0) || (j < bounds.j0) || ((i + size.h - 1) > bounds.i1) || ((j + size.w - 1) > bounds.j1) ) continue;
    out.push({ i, j });
  }
  return out;
}
