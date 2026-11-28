/**
 * §187: objects that are scattered on the ground — Caltrops, Ball Bearings (Player's Handbook 2024, `scatter` in
 * content/gear.mjs). Their activity has no duration, but their area remains (runtime/engine-areas.mjs) and only acts on whoever
 * enters it (runtime/areas.mjs, replay `enter`). Here:
 *  - whoever enters stops on its first cell (`scatterStop`, called by `preMoveToken`): the save is played there, then it
 *    moves on if it can — Speed 0 (caltrops) or Prone (ball bearings) on a failure;
 *  - the object's image on the area (a tile, removed with it);
 *  - picking up, out of combat: "it takes 10 minutes to retrieve them" — the clock advances 10 minutes, the object returns to
 *    the picker's inventory (a use returned, otherwise one more, otherwise a copy of the scattered object).
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { readAreaState, lastingRegions, isInside } from "../adapter/areas.mjs";
import { positionOf, committedPosition } from "../adapter/turn.mjs";
import { continuedFlags, walkOptions } from "../adapter/movement.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { firstEntry, shouldTrigger, turnKeyOf } from "../core/area.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, viaActiveGM } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";

export const PICKUP_QUERY = `${MODULE_ID}.pickUp`;
/** "It takes 10 minutes to retrieve them." */
const RECOVER_SECONDS = 600;

const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/** Does the activity place a scattered object? */
export function scatterOf(activity) {
  return contentOf(activity?.item).entry?.scatter === true;
}

/** This scene's scattered-object areas. */
export function scatterZones(scene) {
  return lastingRegions(scene).filter(r => readAreaState(r)?.scatter);
}

/* -------------------------------------------- */
/*  Pose                                        */
/* -------------------------------------------- */

/** The rectangle that contains a region's shapes (pixels). */
function boundsOf(region) {
  const xs = [];
  const ys = [];
  for ( const shape of region._source.shapes ?? [] ) {
    if ( Array.isArray(shape.points) ) shape.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
    else if ( Number.isFinite(shape.width) ) { xs.push(shape.x, shape.x + shape.width); ys.push(shape.y, shape.y + shape.height); }
  }
  if ( !xs.length ) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** §187, §188: the image of an object placed on the ground (caltrops, oil puddle), a tile on the area, removed with it. Active GM. */
export async function groundTile(region, img) {
  const box = boundsOf(region);
  if ( !box || !img ) return null;
  const [tile] = await region.parent.createEmbeddedDocuments("Tile", [{
    ...box, texture: { src: img }, alpha: 0.9, elevation: Number.isFinite(region.elevation?.bottom) ? region.elevation.bottom : 0,
    flags: { [MODULE_ID]: { ground: region.id } }
  }]).catch(err => { console.warn(`${MODULE_ID} | ground item: no tile`, err); return []; });
  return tile ?? null;
}

/**
 * What the area keeps of the scattered object: its copy (the object may have disappeared, caltrops "autoDestroy"), taken at
 * the time of use on the message, and the tile that shows it on the ground. Active GM (placing the area).
 */
export async function scatterState(region, message, activity) {
  const item = message?.getFlag(MODULE_ID, "scatterItem") ?? activity?.item?.toObject?.() ?? null;
  const tile = await groundTile(region, item?.img);
  log(`${item?.name ?? region.name}: scattered on the ground, stays until picked up`);
  return { item, tile: tile?.id ?? null };
}

/* -------------------------------------------- */
/*  Entering the area                           */
/* -------------------------------------------- */

/**
 * The path cell by cell: a core drag has only its placed points (start, end), the engine's A* one cell per point. Each
 * segment is split by the grid (`getDirectPath`, common/grid/base.mjs:490), on the center of the top-left corner's cell.
 */
function cellSteps(token, path) {
  const grid = token.parent.grid;
  if ( grid.isGridless || (path.length < 2) ) return path;
  const half = p => ({ x: p.x + (grid.sizeX / 2), y: p.y + (grid.sizeY / 2) });
  const out = [path[0]];
  for ( let n = 1; n < path.length; n++ ) {
    for ( const offset of grid.getDirectPath([half(path[n - 1]), half(path[n])]).slice(1) ) {
      const { x, y } = grid.getTopLeftPoint(offset);
      out.push({ ...path[n], x, y });
    }
  }
  return out;
}

/**
 * `preMoveToken`: a path that enters a scattered-object area (for the first time this turn) stops on its first
 * cell — the rest of the path is not played; the area replays its save on arrival (runtime/areas.mjs). True: the move
 * passes as is. A teleportation does not enter "by walking"; a path that ends on this cell passes too.
 */
export function scatterStop(token, movement, operation) {
  if ( !token?.actor || isObjectToken(token) || !levelAtLeast("full") ) return true;
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement) ?? null;
  if ( flags?.scatterChecked ) return true;
  // Out of combat, each entry counts (runtime/areas.mjs); in combat, the first of this turn.
  const turnKey = currentTurnKey();
  const zones = scatterZones(token.parent)
    .filter(r => !game.combat?.started || shouldTrigger(readAreaState(r), { event: "enter", token: token.uuid, turnKey }));
  if ( !zones.length ) return true;
  // The whole path of this move, like the Opportunity Attacks (runtime/move-gate.mjs): at `preMoveToken`, a move
  // with no intermediate steps is entirely in `passed`.
  const waypoints = [...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])];
  if ( !waypoints.length || waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace")) ) return true;
  const start = positionOf(movement.origin);
  const path = cellSteps(token, token.getCompleteMovementPath([start, ...waypoints.map(positionOf)]).map(positionOf));
  const k = firstEntry(path.map(p => zones.map(r => isInside(token, r, p))));
  if ( (k < 0) || (k >= path.length - 1) ) return true;
  const zone = zones.find(r => isInside(token, r, path[k]));
  const action = waypoints[0].action;
  const cut = path.slice(1, k + 1).map(p => ({ ...p, action }));
  log(`${token.name}: steps onto ${zone?.name ?? "a scattered item"}, stops there`);
  token.move(cut, { ...walkOptions(movement), [MODULE_ID]: { ...(flags ?? {}), scatterChecked: true } })
    .catch(err => console.error(`${MODULE_ID} | scattered item: stop on entry`, err));
  return false;
}

/* -------------------------------------------- */
/*  Ramasser                                    */
/* -------------------------------------------- */

/** The scattered-object areas this token can pick up: out of combat, on the area or in contact. */
export function pickableNear(token) {
  if ( !token?.actor || isObjectToken(token) || game.combat?.started || !levelAtLeast("full") ) return [];
  const grid = token.parent.grid;
  const at = committedPosition(token);
  const around = [];
  for ( const dx of [-1, 0, 1] ) for ( const dy of [-1, 0, 1] ) around.push({ ...at, x: at.x + (dx * grid.sizeX), y: at.y + (dy * grid.sizeY) });
  return scatterZones(token.parent).filter(r => around.some(p => isInside(token, r, p)));
}

/** The entries of its own token's menu: "Pick up: Caltrops". */
export function pickUpEntries(token) {
  if ( !token?.isOwner ) return [];
  return pickableNear(token).map(region => ({
    icon: "fa-solid fa-hand-holding",
    label: loc("Dispersion.Ramasser", { item: readAreaState(region).scatter.item?.name ?? region.name }),
    run: () => pickUp(token, region)
  }));
}

/** Picking up: by the active GM (the region and the world clock are theirs). */
export async function pickUp(token, region) {
  // §412 (issue #44, batch 5): in combat (one minute of picking up), the legality window on the picker's side; forced, the
  // active GM picks up anyway.
  const forced = !!game.combat?.started;
  if ( forced && !(await askAnyway(`${region.name ?? ""} — ${token.name}`, [loc("Dispersion.EnCombat")], { actor: token.actor, token })) ) return false;
  return viaActiveGM(PICKUP_QUERY, handlePickUp, { token: token.uuid, region: region.uuid, forced },
    { noGm: "Dispersion.SansMJ", fallback: false, timeout: 15000, label: "scattered item: pick up" });
}

/** The object returns: a use returned (ball bearings emptied), otherwise one more (same identifier), otherwise a copy. */
async function giveBack(actor, data) {
  const id = identifierOf(data).id;
  const same = actor.items.find(i => (i.type === data.type) && (identifierOf(i).id === id));
  if ( same ) {
    const spent = Number(same.system.uses?.spent) || 0;
    if ( spent > 0 ) return same.update({ "system.uses.spent": spent - 1 });
    return same.update({ "system.quantity": (Number(same.system.quantity) || 0) + 1 });
  }
  const copy = foundry.utils.deepClone(data);
  delete copy._id;
  foundry.utils.setProperty(copy, "system.quantity", 1);
  if ( copy.system?.uses ) copy.system.uses.spent = 0;
  return actor.createEmbeddedDocuments("Item", [copy]);
}

export async function handlePickUp({ token: tokenUuid, region: regionUuid, forced=false }, { user=null }={}) {
  const token = await fromUuid(tokenUuid);
  // §472: from a player, only their own token (safety refusal, not forceable; `forced` remains the game's forceable refusal).
  if ( !actsFor(user, token?.actor) ) { console.warn(`${MODULE_ID} | pickUp query from ${user.name} refused: ${token?.name ?? tokenUuid} is not theirs`); return false; }
  const region = await fromUuid(regionUuid);
  const scatter = region ? readAreaState(region)?.scatter : null;
  if ( !token?.actor || !scatter?.item ) return false;
  if ( game.combat?.started && !forced ) {
    ui.notifications.warn(loc("Dispersion.EnCombat"));
    return false;
  }
  await giveBack(token.actor, scatter.item);
  await region.delete();
  await game.time.advance(RECOVER_SECONDS);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token }),
    content: `<p>${loc("Dispersion.Ramasse", { name: token.name, item: scatter.item.name })}</p>`
  });
  log(`${token.name} picks up ${scatter.item.name} (10 minutes)`);
  return true;
}

export function registerScatter() {
  // The copy of the object, taken before dnd5e spends it (caltrops disappear from the inventory on use). §188:
  // the cell is placed on use — the Player's Handbook oil flask spread has a false `target.prompt`: dnd5e then sets
  // `measuredTemplate` to false before the hook (documents/activity/mixin.mjs:451) and opens no placement, only a button on the
  // card. A caller that places the area itself says so (`areaPlaced`: test tools) — its `false` is indistinguishable from dnd5e's.
  route("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
    const scatter = scatterOf(activity);
    const ground = contentOf(activity?.item).entry?.flammable?.ground === true;
    if ( !(scatter || ground) ) return;
    if ( activity.target?.template?.type && !activity.target.prompt && usageConfig?.create && !usageConfig[MODULE_ID]?.areaPlaced ) {
      usageConfig.create.measuredTemplate = true;
    }
    if ( scatter && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.scatterItem`, activity.item.toObject());
  }, { label: "ground item: area placed on use, copy kept" });
  // The tile goes with its area (picked up, burned, or removed by hand by the GM).
  route("deleteRegion", async region => {
    const tile = region.parent?.tiles.find(t => t.getFlag(MODULE_ID, "ground") === region.id);
    if ( tile ) await tile.delete();
  }, { executor: true, label: "ground item: tile not removed" });
  CONFIG.queries[PICKUP_QUERY] = handlePickUp;
}
