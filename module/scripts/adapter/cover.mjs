/**
 * L'abri lu dans Foundry pour le cœur (core/cover.mjs) : espaces des tokens aux positions
 * VALIDÉES, murs par le lancer de rayon natif de type `move` (un obstacle physique donne l'abri —
 * une fenêtre bloque le déplacement, pas la vue ; un brouillard, l'inverse ; une porte ouverte ne
 * bloque rien : c'est le polygone du cœur qui le sait, `source-polygon.mjs:326`), corps des
 * autres créatures dessinées, non cachées — un mort ne couvre que s'il est Grand ou plus (core/cover.mjs, `bodyGivesCover`).
 *
 * P2 (§14.2) : les rayons sont tirés **dans le niveau de l'attaquant** (`level` du polygone —
 * sans lui le cœur prend le niveau affiché, source-polygon.mjs:187) et, en plus des murs, contre
 * les **surfaces** (planchers, plafonds : régions à comportement `defineSurface`), par le lancer
 * de rayon 3D de la scène (`Scene#testSurfaceCollision`, client/documents/scene.mjs:810) entre la
 * hauteur des yeux de l'attaquant et celle de la cible (origine de déplacement du cœur :
 * pieds + moitié de la hauteur). Un plancher plein entre deux créatures est un abri total.
 *
 * Calculé sur le MJ actif, au moment du verdict (runtime/engine.mjs, enrich) : une paire par cible.
 * Un état d'abri posé à la main par le MJ (`coverHalf`…) l'emporte : dnd5e l'a déjà compté dans
 * la CA, on ne recalcule pas.
 */

import { MODULE_ID } from "../constants.mjs";
import { coverBetween, bodyGivesCover, strongerCover, pullBack, COVER, GRATE_MODES, grateOf, windowOpen } from "../core/cover.mjs";
import { crossesWall } from "../core/wall.mjs";
import { contentOf } from "./content.mjs";
import { grappleRulesOf } from "./grapple-rules.mjs";
import { victimsOf } from "./grapple.mjs";
import { wallGeometryOf } from "./wall-side.mjs";
import { committedPosition } from "./turn.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";

const COVER_STATUSES = ["coverHalf", "coverThreeQuarters", "coverTotal"];
/** Retrait des coins, en fraction d'une case : une ligne qui longe un mur ne compte pas. */
const INSET_FRACTION = 0.1;

let available = false;
export function setCoverAvailable(value) { available = !!value; }
export function isCoverAvailable() { return available; }

/** Ce que ce fichier demande au cœur, contrôlé une fois à `ready`. */
export function checkCoverApi() {
  return (typeof CONFIG.Canvas?.polygonBackends?.move?.testCollision === "function") ? [] : ["CONFIG.Canvas.polygonBackends.move.testCollision"];
}

/**
 * Le canevas de ce client peut-il juger l'abri sur cette scène ? Il faut qu'il soit prêt ET qu'il
 * affiche cette scène : les murs viennent des arêtes du canevas (le polygone `move`), les corps des
 * tokens dessinés. Pendant un changement de niveau, le cœur V14 redessine tout le canevas
 * (`Canvas#draw` → `tearDown`, client/canvas/board.mjs:1122-1151) : `canvas.ready` est faux le temps
 * du redessin — vu le 2026-09-23, une attaque à travers un plancher jugée « sans abri » pendant ce temps.
 */
export function canJudgeCover(scene) {
  return available && !!canvas?.ready && !!scene && (canvas.scene === scene) && !checkCoverApi().length;
}

/** L'espace d'un token en pixels, à sa position validée (ou à `pos`). */
export function rectOf(doc, pos=committedPosition(doc)) {
  const grid = doc.parent.grid;
  return { x: pos.x, y: pos.y, width: Math.max(pos.width ?? 1, 0.5) * grid.sizeX, height: Math.max(pos.height ?? 1, 0.5) * grid.sizeY };
}

/** Hauteur des yeux d'un token à une position : pieds + moitié de sa hauteur (comme `getMovementOrigin` du cœur). */
export function eyeElevation(doc, pos=committedPosition(doc)) {
  return (pos.elevation ?? 0) + ((pos.depth ?? 1) * doc.parent.grid.distance / 2);
}

/** §468 : l'ancien drapeau d'un mur « grille » (case cochée en 0.284–0.286) — `true` vaut le choix « grate ». */
export const GRATE_FLAG = "grate";
/** §476 : le choix du mur — « auto » (selon le réglage de monde), « grate » (grille), « solid » (mur plein). */
export const GRATE_MODE_FLAG = "grateMode";
/** §476 : réglage de monde — tout mur qui arrête le déplacement sans bloquer la vue est une grille (éteint par défaut). */
export const GRATE_SETTING = "grateWalls";

/** §476 : le choix « grille » de ce WallDocument ; un mur coché avant la §476 (`grate: true`) reste une grille. */
export function grateModeOf(doc) {
  const mode = doc?.getFlag?.(MODULE_ID, GRATE_MODE_FLAG);
  if ( GRATE_MODES.includes(mode) ) return mode;
  return (doc?.getFlag?.(MODULE_ID, GRATE_FLAG) === true) ? "grate" : "auto";
}

/** §476 : le réglage de monde « Murs grilles ». */
export function grateWallsAuto() {
  try { return game.settings.get(MODULE_ID, GRATE_SETTING) === true; } catch { return false; }
}

/**
 * §468, §476 : ce mur est-il une grille ? (un WallDocument, ou le Wall dessiné ; autre chose — bord de scène — : non)
 * @param {object} wall
 * @param {{auto?: boolean, mode?: string}} [opts]  `auto` : la valeur du réglage de monde (lue sinon) ; `mode` : un choix à essayer.
 */
export function isGrate(wall, { auto=grateWallsAuto(), mode }={}) {
  const doc = wall?.document ?? wall;
  if ( typeof doc?.getFlag !== "function" ) return false;
  const none = CONST.EDGE_SENSE_TYPES?.NONE ?? 0;
  return grateOf({ mode: mode ?? grateModeOf(doc), auto, blocksSight: (doc.sight ?? none) !== none,
    spellWall: !!(doc.getFlag(MODULE_ID, "zone") || doc.getFlag(MODULE_ID, "ethereal")) });
}

/**
 * §468 : ce qui coupe le segment `from` → `to` dans le polygone de déplacement : `"wall"` (au moins un obstacle plein), `"grate"`
 * (seulement des grilles), ou false. Le mode « all » du cœur rend chaque point de contact avec ses arêtes
 * (clockwise-sweep.mjs:759-787) ; l'objet d'une arête de mur est son WallDocument (documents/wall.mjs:166). Une arête qui n'est
 * pas un mur (bord de scène…) compte comme pleine.
 */
export function wallKindBetween(from, to, level, { observer=null }={}) {
  const hits = CONFIG.Canvas.polygonBackends.move.testCollision(from, to, { type: "move", mode: "all", level }) ?? [];
  if ( !Array.isArray(hits) || !hits.length ) return false;
  const auto = grateWallsAuto();
  // §518 : vu de `observer` (l'attaquant), une fenêtre dont il est assez près pour voir au travers est ouverte : elle ne coupe rien.
  const edges = hits.map(v => (v.edges?.size ? [...v.edges].filter(e => !(observer && isOpenWindow(e, observer))) : null));
  if ( edges.every(list => list && !list.length) ) return false;
  const solid = edges.some(list => !list || list.some(e => !isGrate(e.object, { auto })));
  return solid ? "wall" : (edges.some(list => list.length) ? "grate" : false);
}

/**
 * §518 : cette arête (de mur) est-elle une fenêtre ouverte pour cet observateur ? Le seuil de vue du cœur (`Edge#applyThreshold`,
 * canvas/geometry/edges/edge.mjs:220 : vue « proximité » à moins du seuil, ou « distance » au-delà), mesuré comme la vision d'un token
 * (`useThreshold`, sources/point-vision-source.mjs:293) : depuis son centre, moins son rayon (`Token#externalRadius`, token.mjs:3928).
 * @param {Edge} edge
 * @param {{x: number, y: number, externalRadius?: number}} observer
 */
export function isOpenWindow(edge, observer) {
  const doc = edge?.object?.document ?? edge?.object;
  if ( (typeof doc?.getFlag !== "function") || (typeof edge.applyThreshold !== "function") ) return false;
  return windowOpen({ mode: grateModeOf(doc), spellWall: !!(doc.getFlag(MODULE_ID, "zone") || doc.getFlag(MODULE_ID, "ethereal")),
    seenThrough: edge.applyThreshold("sight", observer, observer.externalRadius ?? 0) === true });
}

/** §518 : le point d'où un token voit, pour le seuil des fenêtres — le centre de son espace et son rayon (`Token#externalRadius`). */
export function observerOf(doc, pos=committedPosition(doc)) {
  const r = rectOf(doc, pos);
  return { x: r.x + (r.width / 2), y: r.y + (r.height / 2), externalRadius: Math.min(r.width, r.height) / 2 };
}

/**
 * Le prédicat « la ligne de a à b est coupée » entre deux tokens : murs du niveau de `from`, à sa
 * hauteur d'yeux, et surfaces entre les hauteurs d'yeux des deux.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB` : positions hypothétiques ; `windows` (§518) : une fenêtre que `from` voit au travers
 *                              (seuil de vue atteint) ne coupe pas la ligne — l'abri d'une attaque, pas la ligne d'effet.
 * @returns {(a: {x: number, y: number}, b: {x: number, y: number}) => false|"wall"|"surface"}  #33 : ce qui coupe la ligne.
 */
export function rayBlocker(from, to, { posA, posB, windows=false }={}) {
  const scene = from.parent;
  const pa = posA ? { ...committedPosition(from), ...posA } : committedPosition(from);
  const pb = posB ? { ...committedPosition(to), ...posB } : committedPosition(to);
  const eyeA = eyeElevation(from, pa);
  const eyeB = eyeElevation(to, pb);
  const level = scene.levels?.get?.(pa.level ?? from._source.level) ?? undefined;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  const observer = windows ? observerOf(from, pa) : null;   // §518 : l'attaquant tire par une fenêtre ouverte pour lui
  return (a, b) => {
    const wall = wallKindBetween({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeA }, level, { observer });
    if ( wall === "wall" ) return "wall";
    if ( surfaces && (scene.testSurfaceCollision({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeB }, { type: "move", mode: "any" }) === true) ) return "surface";
    return wall;   // §468 : "grate" ou false
  };
}

/**
 * §239 : ramène un coin de l'espace d'un token devant le premier mur qui le sépare de son centre (niveau du token, hauteur de ses
 * yeux), à `margin` pixels du point de contact — l'espace réel d'une créature dont la case est coupée par un mur de grotte.
 * @param {TokenDocument} doc
 * @param {object} [pos]      Position (défaut : la position validée).
 * @param {number} margin
 * @returns {(centre: {x: number, y: number}, corner: {x: number, y: number}) => {x: number, y: number}}
 */
export function spaceClipper(doc, pos, margin) {
  const p = pos ?? committedPosition(doc);
  const eye = eyeElevation(doc, p);
  const level = doc.parent.levels?.get?.(p.level ?? doc._source.level) ?? undefined;
  const backend = CONFIG.Canvas.polygonBackends.move;
  return (centre, corner) => {
    const hit = backend.testCollision({ x: centre.x, y: centre.y, elevation: eye }, { x: corner.x, y: corner.y, elevation: eye },
      { type: "move", mode: "closest", level });
    return pullBack(centre, corner, hit ?? null, margin);
  };
}

/**
 * Les autres créatures qui peuvent s'interposer.
 * @param {boolean} [seenOnly]  #33 : seulement celles que ce client voit (aperçu d'un joueur : une créature invisible ou cachée
 *                              ne doit pas se trahir par l'abri qu'elle donne).
 */
function bodiesAround(attacker, target, seenOnly=false) {
  return coverBodies(attacker, target, seenOnly).map(t => rectOf(t));
}

/** #33 : les tokens des créatures qui peuvent s'interposer entre l'attaquant et la cible (voir `bodiesAround`). */
export function coverBodies(attacker, target, seenOnly=false) {
  return attacker.parent.tokens
    .filter(t => (t !== attacker) && (t !== target) && t.actor && !t.hidden && t.object && !isObjectToken(t)
      && (!seenOnly || (t.object.isVisible === true))
      && bodyGivesCover({ dead: isDeadActor(t.actor), size: t.actor.system?.traits?.size }));
}

/** Une attaque à distance avec une arme (tir, ou arme lancée) ? */
export function isRangedWeaponAttack(activity, attackMode) {
  if ( (activity?.type !== "attack") || (activity.item?.type !== "weapon") ) return false;
  // O8d (§347) : une arbalète (Deux mains) porte un mode « twoHanded » : le mode ne compte que s'il lance l'arme.
  if ( /ranged|thrown/.test(attackMode ?? "") ) return true;
  return activity.attack?.type?.value === "ranged";
}

/**
 * §172 : l'abri que donne une zone de sort `coverThrough` (Barrière de lames : trois quarts) quand la ligne d'un centre à l'autre la
 * traverse, ni l'attaquant ni la cible dedans ; le plus fort de ces zones avec le nom de son sort (#33), `{degree, name}`, ou null.
 */
function zoneCoverDetail(attacker, target, posA, activity=null, attackMode=null) {
  const a = rectOf(attacker, posA ? { ...committedPosition(attacker), ...posA } : undefined);
  const b = rectOf(target);
  const path = [{ x: a.x + (a.width / 2), y: a.y + (a.height / 2) }, { x: b.x + (b.width / 2), y: b.y + (b.height / 2) }];
  let best = null;
  for ( const region of attacker.parent.regions ) {
    const uuid = region.getFlag("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    const rule = item ? contentOf(item).entry?.coverThrough : null;
    if ( !rule ) continue;
    // §173 : contre les seules attaques à distance avec une arme (Mur de vent : flèches, carreaux, armes lancées).
    if ( (rule.against === "rangedWeapon") && !isRangedWeaponAttack(activity, attackMode) ) continue;
    const degree = rule.degree ?? rule;
    if ( attacker.testInsideRegion(region, posA ? { ...committedPosition(attacker), ...posA } : committedPosition(attacker))
      || target.testInsideRegion(region, committedPosition(target)) ) continue;
    const geometry = wallGeometryOf(region);
    if ( geometry && crossesWall(geometry, path) && (!best || (strongerCover(best.degree, degree) !== best.degree)) ) best = { degree, name: item.name };
  }
  return best;
}

/**
 * L'abri de la cible contre l'attaquant, ou null s'il n'y a rien à ajouter (pas d'abri, abri déjà
 * posé à la main, calcul impossible).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {object} [options]
 * @param {object} [options.posA]     Position hypothétique de l'attaquant (au bout d'une approche).
 * @param {boolean} [options.quiet]   Pas de trace en console (calcul au survol).
 * @param {Activity} [options.activity]   §173 : l'attaque (un abri de zone peut ne valoir que contre les armes à distance).
 * @param {string} [options.attackMode]
 * @param {boolean} [options.seenOnly]  #33 : ne compter que les créatures que ce client voit (aperçu côté joueur).
 * @returns {{degree: string, bonus: number|null, byCreature: boolean, sources: string[], zone: string|null}|null}
 *          #33 : `sources` — « wall », « surface », « creature », « zone » (`zone` : le nom du sort), « grapple ».
 */
export function coverFor(attacker, target, { posA, quiet=false, activity=null, attackMode=null, seenOnly=false }={}) {
  if ( !attacker?.parent || (attacker.parent !== target?.parent) || !canJudgeCover(attacker.parent) ) return null;
  if ( COVER_STATUSES.some(s => target.actor?.statuses.has(s)) ) return null;
  const grid = attacker.parent.grid;
  const inset = grid.size * INSET_FRACTION;
  const pa = posA ? { ...committedPosition(attacker), ...posA } : undefined;
  const cover = coverBetween({
    attacker: rectOf(attacker, pa), target: rectOf(target), bodies: bodiesAround(attacker, target, seenOnly),
    blocked: rayBlocker(attacker, target, { posA, windows: true }), inset,
    clipAttacker: spaceClipper(attacker, pa, inset), clipTarget: spaceClipper(target, undefined, inset)
  });
  // §172 : une zone qui donne un abri à qui est derrière (Barrière de lames) — la ligne entre les deux la traverse.
  let zone = null;
  const behind = zoneCoverDetail(attacker, target, posA, activity, attackMode);
  if ( behind && (strongerCover(cover.degree, behind.degree) !== cover.degree) ) {
    Object.assign(cover, { degree: behind.degree, bonus: COVER[behind.degree].bonus, byCreature: false, sources: ["zone"] });
    zone = behind.name;
  }
  // §281 : Bouclier de chair — qui agrippe une créature a cet abri contre les attaques des créatures qu'il n'agrippe pas.
  const held = grappleRulesOf(target.actor).cover;
  if ( held && (strongerCover(cover.degree, held) !== cover.degree) ) {
    const victims = victimsOf(target);
    if ( victims.length && !victims.includes(attacker) ) {
      Object.assign(cover, { degree: held, bonus: COVER[held].bonus, byCreature: true, sources: ["grapple"] });
      zone = null;
    }
  }
  if ( cover.degree === "none" ) return null;
  if ( !quiet ) console.log(`${MODULE_ID} | cover: ${target.name} against ${attacker.name} — ${cover.degree}${cover.byCreature ? " (creature in between)" : ""}`);
  return { degree: cover.degree, bonus: cover.bonus, byCreature: cover.byCreature, sources: cover.sources ?? [], zone };
}

/** #33 : l'état d'abri posé à la main sur la cible (`coverHalf`…), en degré, ou null. Le plus fort s'il y en a plusieurs. */
export function manualCoverOf(target) {
  const statuses = target?.actor?.statuses;
  if ( !statuses ) return null;
  if ( statuses.has("coverTotal") ) return "total";
  if ( statuses.has("coverThreeQuarters") ) return "threeQuarters";
  return statuses.has("coverHalf") ? "half" : null;
}

/**
 * §200 : « Chemin dégagé vers la cible » (Manuel des joueurs 2024) — le point d'origine d'un sort ne peut pas être derrière un abri
 * total. Vrai si, depuis le centre ou un coin (rentré) de l'espace du lanceur, la ligne jusqu'au point ne traverse aucun mur qui
 * arrête le mouvement (une fenêtre fermée aussi : abri total) dans son niveau, à hauteur de ses yeux, ni plancher ou plafond (Surface).
 * §468 : un mur coché « grille » (barreaux, herse) n'arrête pas ce chemin — il n'est pas un abri total (retour de Fanarie, 2026-11-17).
 * null : impossible à dire (canevas absent ou sur une autre scène).
 * @param {TokenDocument} token
 * @param {{x: number, y: number}} point
 * @returns {boolean|null}
 */
export function clearPathTo(token, point) {
  const scene = token?.parent;
  if ( !point || !canJudgeCover(scene) ) return null;
  const pos = committedPosition(token);
  const eye = eyeElevation(token, pos);
  const level = scene.levels?.get?.(pos.level ?? token._source.level) ?? undefined;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  const rect = rectOf(token, pos);
  const inset = scene.grid.size * INSET_FRACTION;
  const starts = [
    { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) },
    { x: rect.x + inset, y: rect.y + inset }, { x: rect.x + rect.width - inset, y: rect.y + inset },
    { x: rect.x + inset, y: rect.y + rect.height - inset }, { x: rect.x + rect.width - inset, y: rect.y + rect.height - inset }
  ];
  const to = { x: point.x, y: point.y, elevation: eye };
  return starts.some(a => {
    const from = { x: a.x, y: a.y, elevation: eye };
    if ( wallKindBetween(from, to, level) === "wall" ) return false;
    return !(surfaces && (scene.testSurfaceCollision(from, to, { type: "move", mode: "any" }) === true));
  });
}

/**
 * Ligne d'effet entre deux tokens (P2) : existe tant que l'un n'a pas un abri **total** vis-à-vis de
 * l'autre — murs et surfaces, sans les créatures (elles ne donnent jamais plus qu'un abri partiel).
 * C'est ce qui arrête une émanation (aura), une attaque d'opportunité à travers une trappe.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB` : positions hypothétiques.
 * @returns {boolean|null}  null : impossible à dire (canevas absent, scènes différentes).
 */
export function hasLineOfEffect(from, to, positions={}) {
  if ( !canvas?.ready || !from?.parent || (from.parent !== to?.parent) || (canvas.scene !== from.parent) || checkCoverApi().length ) return null;
  const grid = from.parent.grid;
  const posA = positions.posA;
  const posB = positions.posB;
  const inset = grid.size * INSET_FRACTION;
  const pa = posA ? { ...committedPosition(from), ...posA } : undefined;
  const pb = posB ? { ...committedPosition(to), ...posB } : undefined;
  const cover = coverBetween({
    attacker: rectOf(from, pa), target: rectOf(to, pb),
    bodies: [], blocked: rayBlocker(from, to, positions), inset,
    clipAttacker: spaceClipper(from, pa, inset), clipTarget: spaceClipper(to, pb, inset)
  });
  return cover.degree !== "total";
}
