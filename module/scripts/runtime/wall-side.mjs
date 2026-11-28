/**
 * §169: the burning-face wall (adapter/wall-side.mjs) — at placement, its side (opposite the caster) and, for a ring, the disc of
 * dnd5e changed into a thin ring; as soon as the area is retained (its use message), the burning face: a second region, replayed
 * at end of turn, without a saving throw; flipped at the caster's request (menu of its token); removed with the wall. Active GM.
 * §172: the ring of a thick wall, as an inner band. §173: the globe of a thin wall as a thin ring;
 * the `wallAura` area around the wall.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { readAreaState } from "../adapter/areas.mjs";
import { wallSideRuleOf, wallGeometryOf, sideDepthOf, sideRegionOf, isCellWall, isThinWall, wallAuraRuleOf, auraRegionOf } from "../adapter/wall-side.mjs";
import { defaultSide, sideShapes, ringShapes, innerRingShapes, auraShapes } from "../core/wall.mjs";
import { route } from "./router.mjs";
import { log, loc, viaActiveGM } from "./shared.mjs";
import { enqueue } from "./queue.mjs";

export const FLIP_WALL_QUERY = `${MODULE_ID}.flipWallSide`;

/** The center of the caster who placed the region, or null. */
function casterCenter(region) {
  const token = fromUuidSync(region.getFlag("dnd5e", "origin") ?? "", { strict: false });
  // §406: the validated position (`_source`) — `object.center` follows the animation (V14 trap,
  // adapter/turn.mjs `committedPosition`).
  return token?.getCenterPoint ? token.getCenterPoint(token._source) : null;
}

/** At placement: the burning side (unless already chosen, §171), and the thin ring in place of the disc. */
function onCreate(region) {
  if ( isCellWall(region) ) return ringify(region);
  if ( wallSideRuleOf(region) ) return enqueue(`wallSide:${region.id}`, () => setUp(region));
  if ( isThinWall(region) ) return thinRing(region);
}

/** §173 : le globe d'un mur fin (Mur de force, de glace, prismatique) : le disque devient un anneau fin. */
async function thinRing(region) {
  const geometry = wallGeometryOf(region);
  if ( !geometry?.ring || region.shapes.some(s => s.type === "ring") ) return;
  const scene = region.parent;
  const width = (Number(region.getFlag("dnd5e", "dimensions")?.width) || 1) * (scene.grid.size / scene.grid.distance);
  await region.update({ shapes: ringShapes(geometry.ring, width) });
}

/** §172: the ring of a thick wall (Wall of Thorns, Blade Barrier) that the Handbook places as a disc — a band inside the circle. */
async function ringify(region) {
  const geometry = wallGeometryOf(region);
  if ( !geometry?.ring || region.shapes.some(s => s.type === "ring") ) return;
  const scene = region.parent;
  const width = (Number(region.getFlag("dnd5e", "dimensions")?.width) || 5) * (scene.grid.size / scene.grid.distance);
  await region.update({ shapes: innerRingShapes(geometry.ring, width) });
  log(`area "${region.name}": ring of ${Math.round(width)} px inside the circle`);
}

async function setUp(region) {
  const geometry = wallGeometryOf(region);
  if ( !geometry ) return;
  const side = region.getFlag(MODULE_ID, "wallSide")?.side ?? defaultSide(geometry, casterCenter(region));
  const update = { [`flags.${MODULE_ID}.wallSide`]: { side } };
  // The disc of a "cylinder" template (Player's Handbook) becomes a thin ring; a "ring" template (dnd5e) already is one.
  if ( geometry.ring && !region.shapes.some(s => s.type === "ring") ) {
    const scene = region.parent;
    const width = (Number(region.getFlag("dnd5e", "dimensions")?.width) || 1) * (scene.grid.size / scene.grid.distance);
    update.shapes = ringShapes(geometry.ring, width);
  }
  await region.update(update);
  log(`area "${region.name}": burning side ${side > 0 ? (geometry.ring ? "inside" : "left") : (geometry.ring ? "outside" : "right")}`);
}

/** The data of a wall's burning face. */
function sideData(wall, side) {
  const rule = wallSideRuleOf(wall);
  const state = readAreaState(wall);
  const shapes = sideShapes(wallGeometryOf(wall), side, sideDepthOf(wall.parent, rule));
  const source = wall.toObject();
  return {
    name: `${wall.name} — ${loc("MurFace.Nom")}`,
    color: "#ff5a1f",
    shapes,
    levels: source.levels ?? [],
    elevation: source.elevation,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      [MODULE_ID]: {
        sideOf: wall.id,
        // Replayed at end of turn only: whoever ends their turn there takes the damage (no saving throw: runtime/areas.mjs).
        area: { on: ["turnEnd"], turnKey: state.turnKey, hit: [], usage: state.usage, activity: state.activity ?? null,
          exclude: state.exclude ?? null, source: state.source ?? null, affects: state.affects ?? "", originDisposition: state.originDisposition ?? null, originSide: state.originSide ?? null }
      }
    }
  };
}

/** §173: the area around a thin wall (`wallAura`), on both sides — it replays the sibling activity at the declared moments. */
function auraData(wall, rule) {
  const state = readAreaState(wall);
  const source = wall.toObject();
  return {
    name: `${wall.name} — ${loc("MurAura.Nom")}`,
    color: "#d8c8ff",
    shapes: auraShapes(wallGeometryOf(wall), sideDepthOf(wall.parent, rule)),
    levels: source.levels ?? [],
    elevation: source.elevation,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      [MODULE_ID]: {
        auraOf: wall.id,
        area: { on: [...rule.on], turnKey: state.turnKey, hit: [], usage: state.usage, activity: rule.activity,
          exclude: state.exclude ?? null, source: state.source ?? null, affects: state.affects ?? "", originDisposition: state.originDisposition ?? null, originSide: state.originSide ?? null }
      }
    }
  };
}

/** As soon as the area is retained: its burning face (§169), its blinding zone (§173). */
function onUpdate(region, changes) {
  if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
  const aura = wallAuraRuleOf(region);
  if ( aura ) enqueue(`wallAura:${region.id}`, async () => {
    if ( !readAreaState(region)?.usage || auraRegionOf(region) ) return;
    const [created] = await region.parent.createEmbeddedDocuments("Region", [auraData(region, aura)]);
    if ( created ) log(`area "${region.name}": ${aura.distance} ${aura.units} zone placed around it`);
  });
  if ( !wallSideRuleOf(region) ) return;
  return enqueue(`wallSide:${region.id}`, async () => {
    const side = region.getFlag(MODULE_ID, "wallSide")?.side;
    if ( !side || !readAreaState(region)?.usage || sideRegionOf(region) ) return;
    const [created] = await region.parent.createEmbeddedDocuments("Region", [sideData(region, side)]);
    if ( created ) log(`area "${region.name}": burning side placed (${created.shapes.length} shape(s))`);
  });
}

/** With the wall gone, its burning face goes too. */
async function onDelete(region) {
  for ( const linked of region.parent?.regions.filter(r => [r.getFlag(MODULE_ID, "sideOf"), r.getFlag(MODULE_ID, "auraOf")].includes(region.id)) ?? [] ) {
    await linked.delete();
  }
}

/**
 * Active GM side: flip the burning face, or put it on a given side (`side`: +1 on the left of the path or inside the ring,
 * -1 on the other side). Queued with the face placement: a choice made while it is being placed is not lost.
 */
export function handleFlipWallSide({ region: uuid, side: wanted=null }, { user=null }={}) {
  const wall = fromUuidSync(uuid, { strict: false });
  if ( !wall || !wallSideRuleOf(wall) ) return false;
  // §472: from a player, only the wall they placed (the spell's activity is theirs).
  if ( needsCheck(user) && !actsFor(user, fromUuidSync(wall.getFlag("dnd5e", "activity") ?? "", { strict: false })?.actor) ) {
    console.warn(`${MODULE_ID} | flipWallSide query from ${user.name} refused: ${wall.name} is not theirs`);
    return false;
  }
  return enqueue(`wallSide:${wall.id}`, async () => {
    const current = wall.getFlag(MODULE_ID, "wallSide")?.side ?? 1;
    const side = [1, -1].includes(wanted) ? wanted : -current;
    if ( side === current ) return true;
    await wall.setFlag(MODULE_ID, "wallSide", { side });
    const burning = sideRegionOf(wall);
    if ( burning ) await burning.update({ shapes: sideShapes(wallGeometryOf(wall), side, sideDepthOf(wall.parent, wallSideRuleOf(wall))) });
    log(`area "${wall.name}": burning side ${wanted ? "set" : "flipped"}`);
    return true;
  });
}

/** Intent "flip this wall's burning face" or "put it on this side" (the acting client; the active GM writes). */
export async function flipWallSide(wall, side=null) {
  const payload = { region: wall.uuid, ...(side ? { side } : {}) };
  const done = await viaActiveGM(FLIP_WALL_QUERY, handleFlipWallSide, payload, { noGm: "Zone.SansMJ", fallback: false, label: "wall side" });
  if ( done && !side ) ui.notifications.info(loc("MurFace.Retournee", { item: wall.name.replace(/\s*\[.*\]$/, "") }));
  return done;
}

export function registerWallSide() {
  CONFIG.queries[FLIP_WALL_QUERY] = handleFlipWallSide;
  route("createRegion", onCreate, { executor: true, label: "wall: burning side not chosen" });
  route("updateRegion", onUpdate, { executor: true, label: "wall: burning side not placed" });
  route("deleteRegion", onDelete, { executor: true, label: "wall: burning side not removed" });
}
