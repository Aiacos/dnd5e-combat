/**
 * Light level read from the canvas (SPEC §16.48): the core's sources passed to the pure computation of core/illumination.mjs.
 *
 * - Global light: `canvas.environment.globalLightSource`, active, and only if the darkness at the point is within its range
 *   `data.darkness` (same test as `EffectsCanvasGroup#testInsideLight`, client/canvas/groups/effects.mjs:331-337; the darkness
 *   of an "Adjust Darkness" region included, read like `getDarknessLevel`, effects.mjs:383, but without depending on
 *   rendering: `darknessLevelAt`). Bright if `data.bright > 0`: a "dim" global light has `bright: 0, dim: maxR`
 *   (client/canvas/groups/environment.mjs:320-331). Twilight (§16.52): a bright global light counts as dim beyond the
 *   world's darkness threshold `twilightDarkness`.
 * - Lights: `canvas.effects.lightSources`, active (neither turned off nor suppressed by the Darkness they start in,
 *   sources/base-effect-source.mjs:160), not previews; `testPoint` for the lit area (polygon, walls, surfaces and height
 *   included, base-effect-source.mjs:365; a magical light, `priority > 0`, has no vertical bound,
 *   point-light-source.mjs:94-103). Bright light: within `data.bright` px of the center, as a cylinder like the core's test.
 * - Darkness: `canvas.effects.darknessSources`, active, not previews, `testPoint` (point-darkness-source.mjs:114) — same
 *   filter as `testInsideDarkness` (effects.mjs:367-372).
 *
 * The points are VALIDATED positions (`_source`), never the animated position.
 */

import { tokenCenter } from "./turn.mjs";
import { MODULE_ID } from "../constants.mjs";
import { globalLightLevel, lightLevel, perceivedLight, obscurement } from "../core/illumination.mjs";
import { devilsSightRange, inOwnDarkness } from "./vision.mjs";
import { lengthIn } from "./units.mjs";

/**
 * The light level at a point of the displayed scene.
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {{level: number, darkened: boolean}|null}  null: no canvas.
 */
export function lightAt(point) {
  if ( !canvas?.ready ) return null;
  const p = { x: point.x, y: point.y, elevation: point.elevation ?? 0 };
  const effects = canvas.effects;
  const globalSource = canvas.environment.globalLightSource;

  // Global light, twilight included (§16.52, `twilightDarkness` setting: beyond this darkness threshold, bright → dim).
  const global = globalSource ? globalLightLevel(
    { active: globalSource.active, bright: globalSource.data.bright, darkness: globalSource.data.darkness },
    darknessLevelAt(p), twilightThreshold()) : null;

  const lights = [];
  for ( const source of effects.lightSources ) {
    if ( (source === globalSource) || (source instanceof foundry.canvas.sources.GlobalLightSource) ) continue;
    if ( !source.active || source.isPreview || !source.testPoint(p) ) continue;
    lights.push({ priority: source.data.priority ?? 0, bright: inBright(source, p) });
  }

  const darkness = [];
  for ( const source of effects.darknessSources ) {
    if ( !source.active || source.isPreview || !source.testPoint(p) ) continue;
    darkness.push({ priority: source.data.priority ?? 0 });
  }

  return lightLevel({ global, lights, darkness });
}

/**
 * The darkness at a point, "Adjust Darkness" regions included (§221). Same walk as the core's `getDarknessLevel`
 * (client/canvas/groups/effects.mjs:383-398), but the value is read on the shader's `darknessLevel` getter (mode, modifier,
 * scene darkness: client/canvas/rendering/shaders/region/adjust-darkness-level.mjs) and not on its uniform, which is only
 * filled at render time (`_preRender`): a region that has not been drawn yet — window in the background, region off
 * screen — is worth 0 there, and the core reads it that way.
 */
function darknessLevelAt(p) {
  const meshes = canvas.effects.illumination?.darknessLevelMeshes?.children ?? [];
  for ( let i = meshes.length - 1; i >= 0; i-- ) {
    const mesh = meshes[i];
    if ( !mesh.region?.document?.testPoint(p) ) continue;
    const level = mesh.shader?.darknessLevel;
    return Number.isFinite(level) ? level : mesh.shader.uniforms.darknessLevel;
  }
  return canvas.environment.darknessLevel;
}

/**
 * The level that the global light gives to the darkness of the displayed scene (not at a point: without the "Adjust
 * Darkness" regions), twilight included — for a scene display (§40.2).
 * @returns {number|null}  `LIGHT.BRIGHT`, `LIGHT.DIM`, or null (no canvas, global light inactive or out of its range).
 */
export function globalLight() {
  const source = canvas?.ready ? canvas.environment.globalLightSource : null;
  if ( !source ) return null;
  return globalLightLevel({ active: source.active, bright: source.data.bright, darkness: source.data.darkness },
    canvas.environment.darknessLevel, twilightThreshold());
}

/** The world's twilight threshold (1: never), setting of runtime/illumination.mjs. */
function twilightThreshold() {
  try {
    const value = Number(game.settings.get(MODULE_ID, "twilightDarkness"));
    return Number.isFinite(value) ? value : 1;
  } catch { return 1; }
}

/** Within the source's bright light radius (px), as a cylinder; a magical light has no vertical bound. */
function inBright(source, p) {
  const r = source.data.bright ?? 0;
  if ( !(r > 0) ) return false;
  if ( !((source.data.priority ?? 0) > 0) ) {
    const dz = Math.abs(p.elevation - (source.data.elevation ?? 0)) * canvas.dimensions.distancePixels;
    if ( dz > r ) return false;
  }
  return Math.hypot(p.x - source.data.x, p.y - source.data.y) <= r;
}

/** A token's center at its validated position, at the height of its feet (`tokenCenter`). */
export const tokenPoint = doc => tokenCenter(doc);

/**
 * §334: is this token in sunlight? The scene's global light (daylight) brightly lights where it stands — "Adjust
 * Darkness" regions and twilight included; a torch or a light spell is not the sun (Sunlight Sensitivity, vampire weaknesses).
 */
export function inSunlight(doc) {
  const globalSource = canvas?.ready ? canvas.environment.globalLightSource : null;
  if ( !doc?.parent || !globalSource ) return false;
  const p = tokenPoint(doc);
  return globalLightLevel({ active: globalSource.active, bright: globalSource.data.bright, darkness: globalSource.data.darkness },
    darknessLevelAt({ x: p.x, y: p.y, elevation: p.elevation ?? 0 }), twilightThreshold()) === 2;
}

/** The light level where this token stands. */
export function lightOnToken(doc) {
  return doc?.parent ? lightAt(tokenPoint(doc)) : null;
}

/** A sense range from the sheet (`senses.ranges`, dnd5e data/shared/senses-field.mjs:15), grid unit, or 0. */
function senseRange(actor, key, grid) {
  const senses = actor?.system?.attributes?.senses;
  const value = Number(senses?.ranges?.[key]);
  if ( !(value > 0) ) return 0;
  return lengthIn(value, senses.units ?? "ft", grid.units);
}

/**
 * The observer's senses that reach the point: Darkvision, Truesight, Devil's Sight. 3D grid distance
 * from the observer's center (like `canSeePoint`, adapter/vision.mjs).
 */
export function sensesToward(observer, point) {
  const grid = observer.parent.grid;
  const from = tokenPoint(observer);
  const distance = grid.measurePath([from, { x: point.x, y: point.y, elevation: point.elevation ?? from.elevation }]).distance;
  const reaches = range => (range > 0) && (distance <= range);
  return {
    darkvision: reaches(senseRange(observer.actor, "darkvision", grid)),
    truesight: reaches(senseRange(observer.actor, "truesight", grid)),
    // §447: in the Darkness of their own spell (`seesThroughOwnDarkness`), they see normally, like Devil's Sight.
    devilsSight: reaches(devilsSightRange(observer)) || inOwnDarkness(observer, point)
  };
}

/**
 * What the observer perceives at this point: actual level, perceived level, and what it imposes (Disadvantage on Perception in
 * a lightly obscured area, Blinded to see in a heavily obscured area).
 * @param {TokenDocument} observer
 * @param {{x: number, y: number, elevation?: number}} point
 * @returns {{level: number, darkened: boolean, perceived: number, obscured: string, perceptionDisadvantage: boolean,
 *            blinded: boolean}|null}  null: no canvas.
 */
export function perceivedAt(observer, point) {
  const light = lightAt(point);
  if ( !light || !observer?.parent ) return null;
  const perceived = perceivedLight(light, sensesToward(observer, point));
  return { ...light, perceived, ...obscurement(perceived) };
}

/** What the observer perceives where the target stands. */
export function perceivedOnToken(observer, target) {
  return target?.parent ? perceivedAt(observer, tokenPoint(target)) : null;
}
