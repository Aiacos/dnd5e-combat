/**
 * Three-dimensional space, read in Foundry for the core (core/space.mjs) — P2, SPEC §14.2.
 *
 *  - **Elevation slice of a spell area.** dnd5e 6 places a spell's region without a height
 *    (`// TODO: Set elevation based on shape's height`, canvas/template-placement.mjs:138): a
 *    20 ft Sphere is an infinite column. The engine gives it one based on the shape and size
 *    of the activity, at placement (hook `dnd5e.createMeasuredTemplate`, in the creation data:
 *    the region is born with it, and BLFX — which does not touch a region whose `bottom` and `top` are finite,
 *    helperFunctions.js:1200 — leaves it alone), or after the fact for a region created without one (connector).
 *    Once `elevation.bottom/top` are written, the core does the rest: `TokenDocument#testInsideRegion`
 *    filters by the slice (client/documents/token.mjs:3246-3258).
 *  - **Line of effect of an area.** A floor is a **Surface** (region with a
 *    `defineSurface` behavior): an explosion on the upper floor does not reach below if the floor stops
 *    movement. Tested by the scene's 3D ray cast (`Scene#testSurfaceCollision`,
 *    client/documents/scene.mjs:810, type `move`: what stops a body stops an effect) between the
 *    area's point of origin, at mid-height of its slice, and the creature's eyes.
 *
 * Verified in core 14.368: `Region.elevation.bottom/top` nullable (null = infinite,
 * common/documents/region.mjs:56-59); `Scene#getSurfaces` without `level` returns all the surfaces
 * (scene.mjs:793) — a floor is a floor, whatever level it is displayed on.
 */

import { regionElevationFor, originPointOfShapes, withinSphere, rectOfShape, pointInRect, anyShapeTakes } from "../core/space.mjs";
import { committedPosition, tokenCenter } from "./turn.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";
import { eyeElevation } from "./cover.mjs";
import { templateOf } from "./template.mjs";

let available = false;
export function setSpaceAvailable(value) { available = !!value; }
export function isSpaceAvailable() { return available; }

/** What this file asks of the core, checked once at `ready`. */
export function checkSpaceApi() {
  const missing = [];
  if ( typeof CONFIG.Scene?.documentClass?.prototype?.testSurfaceCollision !== "function" ) missing.push("Scene#testSurfaceCollision");
  if ( typeof CONFIG.Region?.documentClass?.prototype?.includedInLevel !== "function" ) missing.push("Region#includedInLevel");
  return missing;
}

/**
 * Shape and dimensions of an activity's area, grid unit. The dimensions written by
 * dnd5e in the region's flags (`flags.dnd5e.dimensions`, already converted) are preferred;
 * otherwise we read the activity (`target.template`, values prepared as numbers, data/shared/target-field.mjs:145)
 * and convert its unit to the grid's.
 * @param {Activity} activity
 * @param {Scene} scene
 * @param {{size?: number, width?: number, height?: number, units?: string}|null} [dimensions]
 * @returns {{type: string, size?: number, width?: number, height?: number}|null}
 */
export function areaOf(activity, scene, dimensions=null) {
  const template = templateOf(activity);   // §86: or the one the content provides
  const type = template?.type;
  if ( !type ) return null;
  const units = scene.grid.units;
  if ( dimensions && (dimensions.units === units) ) return { type, size: dimensions.size, width: dimensions.width, height: dimensions.height };
  const factors = readUnitFactors();
  const to = v => {
    const n = Number(v);
    if ( !Number.isFinite(n) ) return undefined;
    if ( !template.units ) return n;
    return lengthIn(n, template.units, units, factors);
  };
  return { type, size: to(template.size), width: to(template.width), height: to(template.height) };
}

/**
 * The elevation slice that an activity's area must receive, or null if unknown.
 * @param {Activity} activity
 * @param {object} context
 * @param {Scene} context.scene
 * @param {TokenDocument|null} [context.originToken]  The caster: its elevation is the area's.
 * @param {object|null} [context.dimensions]          The region's `flags.dnd5e.dimensions`, if they exist.
 * @returns {{bottom: number, top: number, topInclusive: boolean}|null}
 */
export function elevationSliceFor(activity, { scene, originToken=null, dimensions=null }) {
  const area = areaOf(activity, scene, dimensions);
  if ( !area ) return null;
  const origin = originToken ? committedPosition(originToken) : { elevation: 0, depth: 1 };
  const slice = regionElevationFor(area, origin, scene.grid.distance);
  return slice ? { ...slice, topInclusive: false } : null;
}

/** Does the region already have a slice (set by us, by BLFX, by the GM)? Read at the source: preparation sets ±Infinity. */
export function hasElevationSlice(region) {
  const { bottom, top } = region._source.elevation ?? {};
  return (bottom !== null && bottom !== undefined) || (top !== null && top !== undefined);
}

/**
 * For a region already created without a slice (connector, macro): computes and writes it, if the region
 * comes from an activity. Returns the slice written, or null.
 * @param {RegionDocument} region
 */
export async function ensureRegionElevation(region) {
  if ( !available || hasElevationSlice(region) ) return null;
  const uuid = region.getFlag("dnd5e", "activity");
  if ( !uuid ) return null;
  const activity = await fromUuid(uuid);
  const originUuid = region.getFlag("dnd5e", "origin");
  const originToken = originUuid ? await fromUuid(originUuid) : null;
  const slice = elevationSliceFor(activity, { scene: region.parent, originToken, dimensions: region.getFlag("dnd5e", "dimensions") ?? null });
  if ( !slice ) return null;
  // Like dnd5e at placement (template-placement.mjs:139): the area is limited to the caster's level. A
  // region created without `levels` (connector) is "on all levels", and BLFX then comes to write the
  // caster's level on it through a socket, sometimes after the engine has removed it ("does not exist in the
  // EmbeddedCollection", seen on 2026-09-23): so we do it first.
  const update = { elevation: slice };
  const level = originToken?._source?.level;
  if ( !region.levels.size && level && region.parent.levels?.has?.(level) ) update.levels = [level];
  await region.update(update);
  return slice;
}

/**
 * An area's elevated point of origin: the center of its shape (the caster for an Emanation or
 * a Cone without its own origin), at mid-height of its slice — without a slice, at the caster's eyes.
 * @param {RegionDocument} region
 * @param {TokenDocument|null} originToken
 * @returns {{x: number, y: number, elevation: number}|null}
 */
export function areaOriginOf(region, originToken=null) {
  return originOfShapes(region, region.shapes.map(s => s.toObject?.() ?? s), originToken);
}

/** The elevated point of origin of these region shapes (the first; §286: only one, for an area of several shapes). */
function originOfShapes(region, shapes, originToken) {
  const attached = region.attachment?.token ? region.parent.tokens.get(region.attachment.token) : null;
  const anchor = attached ?? originToken;
  const fallback = anchor ? tokenCenter(anchor) : null;
  const point = originPointOfShapes(shapes, fallback);
  if ( !point ) return null;
  const { bottom, top } = region.elevation;
  const elevation = (Number.isFinite(bottom) && Number.isFinite(top)) ? (bottom + top) / 2
    : (anchor ? eyeElevation(anchor) : (Number.isFinite(bottom) ? bottom : 0));
  return { x: point.x, y: point.y, elevation };
}

/**
 * An area's Sphere (dnd5e Sphere or circle), in pixels: center of the shape, caster's elevation
 * (at mid-height of the slice), radius. null for any other shape, or without a slice.
 * @param {RegionDocument} region
 * @param {Activity} activity
 * @param {TokenDocument|null} originToken
 * @returns {{x: number, y: number, z: number, radius: number}|null}
 */
export function sphereOf(region, activity, originToken=null) {
  if ( !available ) return null;
  const type = templateOf(activity)?.type;
  if ( (type !== "sphere") && (type !== "circle") ) return null;
  return sphereAt(region, activity, areaOriginOf(region, originToken));
}

/** The area's Sphere around this elevated point of origin. */
function sphereAt(region, activity, origin) {
  const scene = region.parent;
  const area = areaOf(activity, scene, region.getFlag("dnd5e", "dimensions") ?? null);
  if ( !area?.size || !origin ) return null;
  const pxPerUnit = scene.grid.size / scene.grid.distance;
  return { x: origin.x, y: origin.y, z: origin.elevation * pxPerUnit, radius: area.size * pxPerUnit };
}

/**
 * §286: an area of several shapes (Meteor Swarm, Fire Storm — dnd5e places the `count` templates in ONE region,
 * canvas/template-placement.mjs:104,132) — each shape has its origin and its Sphere: the creature is caught if a shape contains it
 * and reaches it, only once (`anyShapeTakes`). `{ inVolume, lineOfEffect }`, as for a single shape.
 * @param {RegionDocument} region
 * @param {Activity} activity
 * @param {TokenDocument|null} originToken
 * @param {TokenDocument} token
 */
export function shapesReach(region, activity, originToken, token) {
  const round = (templateOf(activity)?.type === "sphere") || (templateOf(activity)?.type === "circle");
  const center = tokenCenter(token);
  // 14.370: a "hole" shape (spared cells) catches nobody — the core has already removed it from the membership.
  return anyShapeTakes(region.shapes.map(s => s.toObject?.() ?? s).filter(s => !s.hole).map(shape => {
    const origin = originOfShapes(region, [shape], originToken);
    const sphere = (available && round) ? sphereAt(region, activity, origin) : null;
    const rect = rectOfShape(shape);
    const inShape = sphere ? insideSphere(sphere, token) : (rect ? pointInRect(center, rect) : null);
    return { inShape, lineOfEffect: reachesFromPoint(origin, token) };
  }));
}

/** Is the creature in the Sphere (and not only in the region's cylinder)? null without a Sphere. */
export function insideSphere(sphere, token) {
  if ( !sphere || !token?.parent ) return null;
  const grid = token.parent.grid;
  const pos = committedPosition(token);
  const pxPerUnit = grid.size / grid.distance;
  const box = {
    x0: pos.x, x1: pos.x + (Math.max(pos.width ?? 1, 0.5) * grid.sizeX),
    y0: pos.y, y1: pos.y + (Math.max(pos.height ?? 1, 0.5) * grid.sizeY),
    z0: (pos.elevation ?? 0) * pxPerUnit, z1: ((pos.elevation ?? 0) + ((pos.depth ?? 1) * grid.distance)) * pxPerUnit
  };
  return withinSphere(sphere, box);
}

/**
 * Does the area reach this creature: no surface (floor, ceiling) between its point
 * of origin and the creature's eyes? null if we cannot tell (asleep, without origin).
 * @param {{x: number, y: number, elevation: number}|null} origin
 * @param {TokenDocument} token
 * @returns {boolean|null}
 */
export function reachesFromPoint(origin, token) {
  if ( !available || !origin || !token?.parent || (typeof token.parent.testSurfaceCollision !== "function") ) return null;
  const pos = committedPosition(token);
  const c = tokenCenter(token);
  const eyes = { x: c.x, y: c.y, elevation: eyeElevation(token, pos) };
  return token.parent.testSurfaceCollision(origin, eyes, { type: "move", mode: "any" }) !== true;
}
