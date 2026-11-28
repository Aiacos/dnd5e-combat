/**
 * §264: teleportation with a passenger (`teleport.passengers`, CAT / CPR audit) — Dimension Door: "you can also teleport one
 * willing creature; it must be within 1.50 m of you and teleports to a space within 1.50 m of your destination".
 *  - Before the jump, on the caster's client: the non-hostile creatures in range (`within`); those they already target are taken
 *    automatically, otherwise a window asks them which ones (at most `count`), or nobody.
 *  - After the jump, by the active GM (the caster does not necessarily own their ally's token): each is placed in contact with
 *    the caster, at the same relative place if the cell is free, otherwise at the nearest (`dragDestination`, like a dragged
 *    victim). Floating text for the whole table.
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
/** §472: at most as many passengers as requested by a player (Dimension Door takes one along). */
const MAX_PASSENGERS = 8;

/** The creatures a teleportation can take along: non-hostile, alive, in range of the caster. */
function candidates(token, rule) {
  const limit = lengthIn(rule.within ?? 5, rule.units ?? "ft", token.parent.grid.units);
  return token.parent.tokens.filter(t => (t !== token) && t.actor && !isObjectToken(t) && !t.hidden
    && ((t.actor.system?.attributes?.hp?.value ?? 1) > 0) && !areEnemies(token, t)
    && (distanceBetween(token, t).value <= limit + 1e-6));
}

/**
 * Who leaves with the caster? Returns the chosen tokens (at most `count`), with their position relative to the caster before
 * the jump.
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

/** Active GM: places each passenger in contact with the caster who has arrived. */
async function handleCarry({ caster, passengers }, { user=null }={}) {
  const casterDoc = fromUuidSync(caster ?? "", { strict: false });
  if ( !casterDoc ) return 0;
  // §472: from a player, only their own caster, and passengers the rule allows (non-hostile, alive, who left from beside them).
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

/** After the jump: the passengers join the caster (by the active GM). */
export async function carryPassengers(token, chosen) {
  if ( !chosen?.length ) return 0;
  return viaActiveGM(PASSENGERS_QUERY, handleCarry,
    { caster: token.uuid, passengers: chosen.map(c => ({ token: c.token.uuid, dx: c.dx, dy: c.dy })) },
    { noGm: "Passagers.SansMJ", fallback: 0, label: "teleport passengers" });
}

export function registerPassengers() {
  CONFIG.queries[PASSENGERS_QUERY] = handleCarry;
}

