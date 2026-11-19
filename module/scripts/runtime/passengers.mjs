/**
 * §264 : téléportation avec passager (`teleport.passengers`, audit CAT / CPR) — Porte dimensionnelle : « vous pouvez aussi téléporter une
 * créature consentante ; elle doit se trouver à 1,50 m de vous et se téléporte dans un espace à 1,50 m de votre destination ».
 *  - Avant le saut, sur le client du lanceur : les créatures non hostiles à portée (`within`) ; celles qu'il cible déjà sont prises
 *    d'office, sinon une fenêtre lui demande lesquelles (au plus `count`), ou personne.
 *  - Après le saut, par le MJ actif (le lanceur ne possède pas forcément le token de son allié) : chacune est posée au contact du
 *    lanceur, à la même place relative si la case est libre, sinon à la plus proche (`dragDestination`, comme une victime traînée).
 *    Texte flottant chez toute la table.
 */

import { MODULE_ID } from "../constants.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { dragDestination } from "../adapter/movement.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { loc, log, notice, viaActiveGM } from "./shared.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";

export const PASSENGERS_QUERY = `${MODULE_ID}.teleportPassengers`;
/** §472 : au plus autant de passagers demandés par un joueur (Porte dimensionnelle en emmène un). */
const MAX_PASSENGERS = 8;

/** Les créatures qu'une téléportation peut emmener : non hostiles, vivantes, à portée du lanceur. */
function candidates(token, rule) {
  const limit = lengthIn(rule.within ?? 5, rule.units ?? "ft", token.parent.grid.units);
  return token.parent.tokens.filter(t => (t !== token) && t.actor && !isObjectToken(t) && !t.hidden
    && ((t.actor.system?.attributes?.hp?.value ?? 1) > 0) && !areEnemies(token, t)
    && (distanceBetween(token, t).value <= limit + 1e-6));
}

/**
 * Qui part avec le lanceur ? Rend les tokens choisis (au plus `count`), avec leur place relative au lanceur avant le saut.
 * @returns {Promise<{token: TokenDocument, dx: number, dy: number}[]>}
 */
export async function choosePassengers(token, rule) {
  if ( !rule?.count || !token?.parent ) return [];
  const near = candidates(token, rule);
  if ( !near.length ) return [];
  const targeted = near.filter(t => game.user.targets.has(t.object));
  let chosen = targeted.slice(0, rule.count);
  if ( !chosen.length ) {
    const buttons = near.map(t => ({ action: t.id, label: t.name, icon: "fa-solid fa-user-group" }));
    buttons.push({ action: "none", label: loc("Passagers.Personne"), icon: "fa-solid fa-xmark", default: true });
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: loc("Passagers.Titre") }, content: `<p>${loc("Passagers.Question", { max: rule.count })}</p>`, rejectClose: false, buttons
    }).catch(() => null);
    const picked = near.find(t => t.id === answer);
    chosen = picked ? [picked] : [];
  }
  const from = token._source;
  return chosen.map(t => ({ token: t, dx: t._source.x - from.x, dy: t._source.y - from.y }));
}

/** MJ actif : pose chaque passager au contact du lanceur arrivé. */
async function handleCarry({ caster, passengers }, { user=null }={}) {
  const casterDoc = fromUuidSync(caster ?? "", { strict: false });
  if ( !casterDoc ) return 0;
  // §472 : d'un joueur, seulement son propre lanceur, et des passagers que la règle permet (non hostiles, vivants, partis d'à côté de lui).
  const untrusted = needsCheck(user);
  if ( untrusted && !actsFor(user, casterDoc.actor) ) {
    console.warn(`${MODULE_ID} | teleportPassengers query from ${user.name} refused: ${casterDoc.name} is not theirs`);
    return 0;
  }
  const near = 2 * (casterDoc.parent?.grid?.size ?? 100);
  let moved = 0;
  for ( const p of (Array.isArray(passengers) ? passengers : []).slice(0, untrusted ? MAX_PASSENGERS : Infinity) ) {
    const doc = fromUuidSync(p.token ?? "", { strict: false });
    if ( !doc || (doc.parent !== casterDoc.parent) ) continue;
    if ( !Number.isFinite(p.dx) || !Number.isFinite(p.dy) ) continue;
    if ( untrusted && ((doc === casterDoc) || !doc.actor || isObjectToken(doc) || areEnemies(casterDoc, doc)
      || ((doc.actor.system?.attributes?.hp?.value ?? 1) <= 0) || (Math.abs(p.dx) > near) || (Math.abs(p.dy) > near)) ) {
      console.warn(`${MODULE_ID} | teleportPassengers query from ${user.name}: ${doc.name} cannot be carried, stays`);
      continue;
    }
    const at = dragDestination(doc, casterDoc, { x: casterDoc._source.x + p.dx, y: casterDoc._source.y + p.dy });
    if ( !at ) { log(`${doc.name}: no free space next to ${casterDoc.name}, stays`); continue; }
    await doc.move([{ x: at.x, y: at.y, elevation: casterDoc._source.elevation ?? 0, action: "blink", snapped: true }], { [MODULE_ID]: { cleared: true } });
    notice(doc, { key: "Retour.Teleporte" }, "gain", { all: true });
    log(`${doc.name}: teleported along with ${casterDoc.name}`);
    moved++;
  }
  return moved;
}

/** Après le saut : les passagers rejoignent le lanceur (par le MJ actif). */
export async function carryPassengers(token, chosen) {
  if ( !chosen?.length ) return 0;
  return viaActiveGM(PASSENGERS_QUERY, handleCarry,
    { caster: token.uuid, passengers: chosen.map(c => ({ token: c.token.uuid, dx: c.dx, dy: c.dy })) },
    { noGm: "Passagers.SansMJ", fallback: 0, label: "teleport passengers" });
}

export function registerPassengers() {
  CONFIG.queries[PASSENGERS_QUERY] = handleCarry;
}

