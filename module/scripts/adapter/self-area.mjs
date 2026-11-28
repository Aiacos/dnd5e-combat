/**
 * A "self" area, placed on the caster without a click (SPEC §47) — the region that dnd5e would have created had one clicked
 * its token, built like `TemplatePlacement.fromActivity` (canvas/template-placement.mjs:86-189):
 *  - Emanation (type `radius`): `emanation` shape based on the `token` (template-placement.mjs:60-66), attached to the token
 *    (`attachment.token`, except for a `stationary` area), with the token's dimensions (template-placement.mjs:124-127);
 *  - Sphere, circle: `circle` shape at the token's center, not attached (dnd5e only attaches the Emanation);
 *  - same `dnd5e` flags (activity, dimensions, item, origin, spellLevel), same restriction, visibility, level.
 * The system's hooks are emitted as it does (`dnd5e.createMeasuredTemplate` before creation — the engine's elevation
 * slice is set there, runtime/space.mjs —, `dnd5e.postCreateMeasuredTemplate` after): whoever listens to them sees
 * the same thing as with placement by mouse. The rest (region behaviors, area resolution, Concentration) follows
 * `createRegion` as usual.
 */

import { MODULE_ID } from "../constants.mjs";
import { selfAreaShape, aimedAreaShape, aimFrom, cubeBeside, departureAreaShape } from "../core/self-area.mjs";
import { committedPosition, usageTokenOf, tokenCenter } from "./turn.mjs";
import { templateOf } from "./template.mjs";
import { contentOf } from "./content.mjs";
import { clampPolyline, wallLineShapes, orthogonalize, cellWallShapes } from "../core/wall.mjs";
import { lengthIn } from "./units.mjs";
import { carriedLightOf } from "./carried-lights.mjs";
import { clearPathTo } from "./cover.mjs";
import { contiguousRects, rectOfShape } from "../core/space.mjs";

/**
 * The shape and token of an area to place automatically, or null (dnd5e places as usual): personal range, centered
 * area (core/self-area.mjs), caster on the displayed scene, right to create a region.
 * @param {Activity} activity
 * @returns {{shape: "emanation"|"circle", token: TokenDocument}|null}
 */
export function selfAreaOf(activity) {
  // §254: the radius of a carried light source (Hooded Lantern: "Light", 60 ft on self) is its light, which the engine places
  // on the token (§121) — not an area: the region followed the bearer everywhere.
  if ( carriedLightOf(activity?.item) ) return null;
  const template = templateOf(activity);   // §86: or the one the content provides
  // §462: a teleportation whose area hits the space left behind — fixed Emanation around the caster, placed before they leave.
  const left = leavesArea(activity);
  const shape = left ? departureAreaShape({ type: template?.type, count: template?.count, size: template?.size })
    : selfAreaShape({ rangeUnits: activity?.range?.units, type: template?.type, count: template?.count, size: template?.size });
  if ( !shape ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  return left ? { shape, token, stationary: true } : { shape, token };
}

/**
 * §462: the activity teleports its user and its area hits the space they leave (`teleport.area: "left"`, content or text layer
 * of the creatures: "Arcane Teleportation", "Deadly Teleportation", "Chilling Step").
 * @param {Activity} activity
 */
export function leavesArea(activity) {
  return teleportAreaOf(activity) === "left";
}

/**
 * §462 / §463: where the area of a declared self-teleportation hits — `"left"` (the space left), `"arrival"` (the arrival space),
 * or null.
 * @param {Activity} activity
 * @returns {"left"|"arrival"|null}
 */
export function teleportAreaOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  if ( !rule?.area || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return rule.area;
}

/**
 * §463: places the area of an "on arrival" teleportation around the token, where it is (after the jump) — fixed Emanation, like the
 * departure one. Returns the regions created, or null (unreadable shape, no right to create a region).
 * @param {Activity} activity
 * @param {TokenDocument} token
 */
export function placeArrivalArea(activity, token) {
  const template = templateOf(activity);
  const shape = departureAreaShape({ type: template?.type, count: template?.count, size: template?.size });
  if ( !shape || !token?.parent || !game.user.can("REGION_CREATE") ) return Promise.resolve(null);
  return createAreaRegions(activity, token, [selfAreaRegionData(activity, token, shape, { stationary: true })]);
}

/** A length of the activity, in the grid's unit (undefined if absent). */
function toGrid(value, units, scene) {
  const n = Number(value);
  if ( !(n > 0) ) return undefined;
  return lengthIn(n, units, scene.grid.units);
}

/** The dimensions of the activity's area, in the grid's unit. */
function dimensionsOf(activity, scene) {
  const target = templateOf(activity) ?? {};
  return {
    size: toGrid(target.size, target.units, scene),
    width: toGrid(target.width, target.units, scene),
    height: toGrid(target.height, target.units, scene)
  };
}

/**
 * An activity area region, as `TemplatePlacement.fromActivity` builds it (template-placement.mjs:136-171).
 * @param {Activity} activity
 * @param {TokenDocument} token   The caster (origin).
 * @param {object} shapeData      The shape, in pixels.
 * @param {boolean} attached      Attached to the caster (non-`stationary` Emanation).
 * @returns {object}
 */
function regionData(activity, token, shapeData, attached) {
  const scene = token.parent;
  const level = committedPosition(token).level ?? canvas.level?.id ?? null;
  return {
    name: `${activity.item.name} [${game.user.name}]`,
    color: game.user.color,
    shapes: [shapeData],
    ...(level ? { levels: [level] } : {}),
    restriction: { enabled: true, type: "move" },
    attachment: { token: attached ? token.id : undefined },
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      dnd5e: {
        activity: activity.uuid,
        dimensions: { ...dimensionsOf(activity, scene), units: scene.grid.units },
        item: activity.item.uuid,
        origin: token.uuid,
        spellLevel: activity.getRollData().item?.level
      },
      // §190: placed by the engine (aimed Cone, area on self, bead of Delayed Blast Fireball), not by dnd5e's placement — the
      // range check (ui/pointer.mjs) does not apply to it.
      [MODULE_ID]: { enginePlaced: true }
    }
  };
}

/** Creates the regions, emitting dnd5e's hooks around the creation, like its placement (template-placement.mjs:173-187). */
async function createAreaRegions(activity, token, data) {
  if ( Hooks.call("dnd5e.createMeasuredTemplate", activity, data) === false ) return null;
  const created = await token.parent.createEmbeddedDocuments("Region", data);
  Hooks.callAll("dnd5e.postCreateMeasuredTemplate", activity, created);
  return created;
}

/**
 * The region's data, as dnd5e builds it.
 * @param {Activity} activity
 * @param {TokenDocument} token
 * @param {"emanation"|"circle"} shape
 * @returns {object}
 */
export function selfAreaRegionData(activity, token, shape, { stationary=false }={}) {
  const scene = token.parent;
  const radius = dimensionsOf(activity, scene).size * (scene.grid.size / scene.grid.distance);
  const pos = committedPosition(token);
  const attached = (shape === "emanation") && !stationary && !templateOf(activity)?.stationary;
  const shapeData = (shape === "emanation")
    ? { type: "emanation", radius,
      base: { type: "token", x: pos.x, y: pos.y, width: pos.width, height: pos.height, shape: pos.shape ?? token._source.shape } }
    : { type: "circle", radius,
      x: pos.x + ((pos.width * scene.grid.sizeX) / 2), y: pos.y + ((pos.height * scene.grid.sizeY) / 2) };
  return regionData(activity, token, shapeData, attached);
}

/**
 * §91: places the activity's area (Sphere, circle) centered on a point, without a click — the bead of Delayed Blast Fireball that
 * explodes where it is. Same data and same hooks as dnd5e's placement.
 * @param {Activity} activity
 * @param {TokenDocument} token      The caster (origin).
 * @param {{x: number, y: number}} point
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeAreaAt(activity, token, point) {
  const scene = token.parent;
  const radius = dimensionsOf(activity, scene).size * (scene.grid.size / scene.grid.distance);
  return createAreaRegions(activity, token, [regionData(activity, token, { type: "circle", radius, x: point.x, y: point.y }, false)]);
}

/**
 * Places the area on the caster, emitting dnd5e's hooks around the creation.
 * @param {Activity} activity
 * @param {{shape: "emanation"|"circle", token: TokenDocument}} area  What `selfAreaOf` returned.
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeSelfArea(activity, { shape, token, stationary=false }) {
  return createAreaRegions(activity, token, [selfAreaRegionData(activity, token, shape, { stationary })]);
}

/* -------------------------------------------- */
/*  Areas cast at a distance (§190)             */
/* -------------------------------------------- */

/** The range units that are lengths (not "personal", "touch", "unlimited"…). */
const LENGTH_UNITS = new Set(["ft", "m", "km", "mi"]);

/**
 * §190: a Sphere, cylinder, Cube or square cast "at a point within range" (Acid Splash, Fireball) — what is needed
 * to place it with the mouse with its range: `{ token, shape: "circle"|"rectangle", side (px : rayon ou côté), range (unités de la
 * grille), max, units, count, contiguous }`, or null (personal or touch range, caster absent from the displayed
 * scene). Shapes and dimensions as in `TemplatePlacement#createShapeData` (template-placement.mjs:52-71).
 * @param {Activity} activity
 */
export function rangedAreaOf(activity) {
  const template = activity?.target?.template;
  const kind = CONFIG.DND5E?.areaTargetTypes?.[template?.type]?.template;
  if ( !["circle", "rect", "rectangle"].includes(kind) ) return null;
  // §286: several templates (Meteor Swarm, Fire Storm) — each within range; `contiguous`: Cubes that touch each other.
  const count = Math.max(1, Number(template.count) || 1);
  const value = Number(activity.range?.value);
  if ( !(value > 0) || !LENGTH_UNITS.has(activity.range?.units) ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  const scene = token.parent;
  const { size } = dimensionsOf(activity, scene);
  if ( !(size > 0) ) return null;
  return { token, shape: (kind === "circle") ? "circle" : "rectangle", side: size * (scene.grid.size / scene.grid.distance),
    range: lengthIn(value, activity.range.units, scene.grid.units), max: value, units: activity.range.units,
    count, contiguous: (count > 1) && (template.contiguous === true) };
}


/** §190: the center of a placed shape — §200: its point of origin. */
export function rangedCenter(shapeData) {
  if ( shapeData.type === "rectangle" ) return { x: shapeData.x + (shapeData.width / 2), y: shapeData.y + (shapeData.height / 2) };
  return { x: shapeData.x, y: shapeData.y };
}

/**
 * §190: is the shape out of range? Distance from the edge of the caster's space (its center, minus its half-width) to the point
 * of origin — the center of a Sphere, a cylinder; for a Cube, a face (the center, minus half the side).
 */
export function rangedTooFar(area, shapeData) {
  const grid = area.token.parent.grid;
  const from = tokenCenter(area.token);
  const distance = grid.measurePath([{ x: from.x, y: from.y }, rangedCenter(shapeData)]).distance;
  const body = ((committedPosition(area.token).width || 1) * grid.distance) / 2;
  const slack = (shapeData.type === "rectangle") ? (area.side / 2) * (grid.distance / grid.size) : 0;
  return (distance - body) > (area.range + slack + 1e-6);
}

/**
 * What refuses the placement of these shapes (`rangedAreaOf`): `"far"` (§190, a shape out of range), `"hidden"` (§200, no clear
 * path to its point), `"apart"` (§286, `contiguous` Cubes that do not touch: Fire Storm), or null.
 * @param {object} area  `rangedAreaOf`.
 * @param {object[]} shapes  The shapes of the regions to create.
 */
export function rangedPlacementProblem(area, shapes) {
  if ( shapes.some(shape => rangedTooFar(area, shape)) ) return "far";
  if ( shapes.some(shape => clearPathTo(area.token, rangedCenter(shape)) === false) ) return "hidden";
  if ( area.contiguous && !contiguousRects(shapes.map(rectOfShape).filter(r => r)) ) return "apart";
  return null;
}



/* -------------------------------------------- */
/*  Cones and Lines aimed from the caster       */
/* -------------------------------------------- */

/**
 * The Cone, Line or Cube to aim around the caster (SPEC §59), or null (dnd5e's placement): personal range, an area
 * (core/self-area.mjs), caster on the displayed scene, right to create a region.
 * @param {Activity} activity
 * @returns {{shape: "cone"|"line"|"cube", token: TokenDocument}|null}
 */
export function aimedAreaOf(activity) {
  // §254: likewise the Cone of a Bullseye Lantern.
  if ( carriedLightOf(activity?.item) ) return null;
  const template = activity?.target?.template;
  const shape = aimedAreaShape({ rangeUnits: activity?.range?.units, type: template?.type, count: template?.count, size: template?.size });
  if ( !shape ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  return { shape, token };
}

/**
 * The shape aimed toward this point: apex on the edge of the caster's space, pivot at its center (`aimFrom`); a Cube, flush
 * against the caster on the aimed side (`cubeBeside`).
 * Dimensions as in `TemplatePlacement#createShapeData` (template-placement.mjs:52-71): Cone angle defaulting to the core's,
 * Line width read from the activity (one cell if it says nothing).
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {{x: number, y: number}} point         Aimed point, in pixels.
 * @param {{x: number, y: number}|null} [fallback]  Direction if the point is at the caster's center.
 * @returns {object}  Region shape data.
 */
export function aimedShapeData(activity, { shape, token }, point, fallback=null) {
  const scene = token.parent;
  const perUnit = scene.grid.size / scene.grid.distance;
  const pos = committedPosition(token);
  const body = { x: pos.x, y: pos.y, width: pos.width * scene.grid.sizeX, height: pos.height * scene.grid.sizeY };
  const ellipse = [CONST.TOKEN_SHAPES.ELLIPSE_1, CONST.TOKEN_SHAPES.ELLIPSE_2].includes(pos.shape ?? token._source.shape);
  const { size, width } = dimensionsOf(activity, scene);
  if ( shape === "cube" ) {
    const side = size * perUnit;
    const step = scene.grid.type === CONST.GRID_TYPES.GRIDLESS ? 0 : scene.grid.size;
    return { type: "rectangle", ...cubeBeside(body, point, side, { step, fallback }), width: side, height: side, rotation: 0 };
  }
  const { x, y, rotation } = aimFrom(body, point, { ellipse, fallback });
  if ( shape === "cone" ) return { type: "cone", x, y, rotation, radius: size * perUnit, angle: CONFIG.MeasuredTemplate.defaults.angle };
  return { type: "line", x, y, rotation, length: size * perUnit, width: (width ?? scene.grid.distance) * perUnit };
}

/**
 * The aimed region's data (aiming preview, then creation).
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {object} shapeData  `aimedShapeData`.
 * @returns {object}
 */
export function aimedRegionData(activity, { token }, shapeData) {
  return regionData(activity, token, shapeData, false);
}

/**
 * Places the aimed area, emitting dnd5e's hooks around the creation.
 * @param {Activity} activity
 * @param {{shape: "cone"|"line"|"cube", token: TokenDocument}} area
 * @param {object} shapeData
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeAimedArea(activity, area, shapeData) {
  return createAreaRegions(activity, area.token, [aimedRegionData(activity, area, shapeData)]);
}

/* -------------------------------------------- */
/*  Walls placed by points (§162)               */
/* -------------------------------------------- */

/**
 * §162: a spell with a "wall" template (Wall of Fire, paneled Wall of Force, Blade Barrier…) is placed by points: the broken line
 * they draw, at most the spell's total length (the template's size, times the number of panels), of its thickness. Returns
 * what is needed for aiming (length and thickness in pixels), or null: not a wall, caster absent from the displayed scene, no
 * right to create a region.
 * @param {Activity} activity
 * @returns {{shape: "wall", token: TokenDocument, length: number, width: number, orthogonal: boolean, cells: boolean, half: number,
 *   lineLength: number}|null}
 */
export function wallAreaOf(activity) {
  const template = activity?.target?.template;
  if ( template?.type !== "wall" ) return null;
  // Gates and doors (Arcane Gate, Gate, Demiplane, Mansion): not walls.
  if ( contentOf(activity.item).entry?.pointWall === false ) return null;
  const token = usageTokenOf(activity);
  if ( !token?.parent || (token.parent !== canvas?.scene) ) return null;
  if ( !game.user.can("REGION_CREATE") ) return null;
  const scene = token.parent;
  const perUnit = scene.grid.size / scene.grid.distance;
  const { size, width } = dimensionsOf(activity, scene);
  const count = Math.max(1, Number(template.count) || 1);
  // §169: a wall with a burning face (Wall of Fire) is placed without a diagonal; §172: a thick wall (Wall of Thorns, Blade
  // Barrier), on a row of cells — points at the centers of the cells, the line of centers one cell shorter than the wall.
  const entry = contentOf(activity.item).entry;
  const cells = entry?.cellWall === true;
  const length = (size || 0) * count * perUnit;
  return { shape: "wall", token, length, width: Math.max(1, (width || 1) * perUnit), orthogonal: cells || !!entry?.wallSide || (entry?.thinWall === true),
    cells, half: scene.grid.size / 2, lineLength: cells ? Math.max(0, length - scene.grid.size) : length };
}

/**
 * Places the wall along the points, emitting dnd5e's hooks around the creation: one region, one "line" shape per segment.
 * @param {Activity} activity
 * @param {{token: TokenDocument, length: number, width: number}} area  `wallAreaOf`.
 * @param {Array<{x: number, y: number}>} points
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeWallArea(activity, area, points) {
  const shapes = area.cells ? cellWallShapes(points, area.length || Infinity, area.width, area.half)
    : wallLineShapes(clampPolyline(area.orthogonal ? orthogonalize(points) : points, area.length || Infinity), area.width);
  if ( !shapes.length ) return Promise.resolve(null);
  return createAreaRegions(activity, area.token, [{ ...regionData(activity, area.token, shapes[0], false), shapes }]);
}
