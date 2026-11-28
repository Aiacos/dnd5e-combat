/**
 * Familiars (SPEC §107), read and written in Foundry. A familiar is a summoned creature (dnd5e: `flags.dnd5e.summon.origin`
 * of its actor = uuid of the item that summoned it: summon.mjs:261-267, in an unlinked token's delta, :543) whose item
 * declares `summon.familiar` (content/summons.mjs). Its master is the actor of that item.
 *
 * The pocket dimension is a flag of the master: `flags["dnd5e-combat"].pocket = { token, name, img, scene, at }`, `token`
 * being `TokenDocument#toObject()` at the moment of dismissal (an unlinked token's delta included: HP, effects, items). Only one
 * familiar at a time ("Only one familiar").
 */

import { MODULE_ID } from "../constants.mjs";
import { RECALL_RANGE, recallProblem } from "../core/familiar.mjs";
import { summonRuleOf } from "./content.mjs";
import { summonItemOf } from "./summons.mjs";
import { distanceBetween, positionOf } from "./turn.mjs";
import { cellUnder, footprintOf } from "./movement.mjs";
import { isIntangible } from "./pilot.mjs";
import { sharesSpaceWith } from "./space-sharing.mjs";
import { footprintGap } from "../core/movement.mjs";
import { overlapsVertically } from "../core/space.mjs";
import { lengthIn } from "./units.mjs";

const POCKET = "pocket";

/** Cet item invoque-t-il un familier (`summon.familiar`) ? */
export const isFamiliarItem = item => !!item && (summonRuleOf(item)?.familiar === true);

/** The origin item of a summoned actor, if it declares a familiar. */
function familiarItemOfActor(actor) {
  const uuid = actor?.getFlag?.("dnd5e", "summon.origin");
  const item = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return isFamiliarItem(item) ? item : null;
}

/** Is this actor (a token's, synthetic or not) a familiar? */
export const isFamiliarActor = actor => !!familiarItemOfActor(actor);

/** Ce token est-il un familier ? */
export const isFamiliarToken = tokenDoc => isFamiliarItem(summonItemOf(tokenDoc));

/** A familiar's master (the summoning item's actor), or null. */
export function masterOf(tokenDoc) {
  return isFamiliarToken(tokenDoc) ? (summonItemOf(tokenDoc)?.actor ?? null) : null;
}

/** The familiar this master keeps in its pocket dimension, or null. */
export function pocketOf(actor) {
  const pocket = actor?.getFlag?.(MODULE_ID, POCKET);
  return pocket?.token ? pocket : null;
}

/** Writes (active GM) the dismissed familiar into its master's pocket. */
export async function storeInPocket(master, tokenDoc) {
  const data = tokenDoc.toObject();
  await master.unsetFlag(MODULE_ID, POCKET);
  await master.setFlag(MODULE_ID, POCKET, { token: data, name: tokenDoc.name, img: tokenDoc.texture?.src ?? null,
    scene: tokenDoc.parent?.id ?? null, at: game.time.worldTime });
  return data;
}

/** Empties (active GM) the master's pocket dimension. */
export function emptyPocket(master) {
  return pocketOf(master) ? master.unsetFlag(MODULE_ID, POCKET) : null;
}

/**
 * A provisional token (never created) of the kept familiar, at a position of the master's scene: to measure distance and
 * occupancy with the engine's functions. Linked to the base actor: a delta is useless here.
 */
function probeToken(pocket, scene, at={}) {
  const s = pocket.token;
  const data = { name: s.name, actorId: s.actorId, actorLink: true, width: s.width ?? 1, height: s.height ?? 1,
    x: at.x ?? 0, y: at.y ?? 0, elevation: at.elevation ?? 0, flags: s.flags ?? {}, ...(at.level ? { level: at.level } : {}) };
  return new CONFIG.Token.documentClass(data, { parent: scene });
}

/**
 * The cell (top-left corner, pixels) where the kept familiar would reappear under this point, at the master's level and
 * elevation, and what refuses it ("far", "occupied", or null).
 * @param {TokenDocument} masterToken
 * @param {{x: number, y: number}} point
 */
export function recallSpot(masterToken, point) {
  const pocket = pocketOf(masterToken?.actor);
  const scene = masterToken?.parent;
  if ( !pocket || !scene ) return null;
  const level = masterToken._source.level ?? null;
  const elevation = masterToken._source.elevation ?? 0;
  const probe = probeToken(pocket, scene, { level, elevation });
  const at = scene.grid.getTopLeftPoint(cellUnder(probe, point));
  probe.updateSource({ x: at.x, y: at.y });
  let limit = lengthIn(RECALL_RANGE.value, RECALL_RANGE.units, scene.grid.units);
  const distance = distanceBetween(masterToken, probe).value;
  const mine = footprintOf(probe);
  const slice = positionOf(probe._source);   // §192 : occupation en trois dimensions
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const occupied = scene.tokens.some(other => !other.hidden && !other.actor?.statuses?.has(defeated)
    && !isIntangible(other) && !sharesSpaceWith(probe, other) && (footprintGap(mine, footprintOf(other)) === 0)
    && overlapsVertically(slice, positionOf(other._source), scene.grid.distance));
  return { x: at.x, y: at.y, level, elevation, problem: recallProblem({ distance, limit, occupied }) };
}
