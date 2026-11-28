/**
 * §70: the storm of Call Lightning (content key `storm`).
 *
 * The spell first places the CLOUD — the item's area (cylinder with an 18 m radius) that dnd5e has placed at casting: it
 * stays, attached to Concentration, resolving nothing itself, dressed up as a storm (FXMaster rain and lightning if it is
 * active, otherwise a dark area; the region itself is no longer shown). Then the BOLT: a 1.50 m circle (`bolt`)
 * aimed under the cloud, placed like an area of the activity — it is what the resolution reads (save, damage), then
 * removes. Each recast of the spell (Magic action, no slot, §16.21 `recast`) only aims a new bolt under the same
 * cloud. "Outdoors, in stormy weather" (+1d10) is asked at casting and noted on the cloud.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { shapeCenter } from "../core/area.mjs";
import { lengthIn } from "./units.mjs";

/** An item's storm rule (`{ bonus }`), or null. */
export const stormOf = item => (item ? contentOf(item).entry?.storm ?? null : null);

/** A region placed by a storm item: the cloud, or a bolt (`flags["dnd5e-combat"].bolt`). */
export const isBoltRegion = region => !!region?.getFlag?.(MODULE_ID, "bolt");

/** An item's cloud on the displayed scene (the region of its activity that is not a bolt), or null. */
export function cloudOf(item, scene=canvas?.scene) {
  if ( !item || !scene ) return null;
  return scene.regions.find(r => (r.getFlag("dnd5e", "item") === item.uuid) && !isBoltRegion(r) && r.getFlag(MODULE_ID, "cloud")) ?? null;
}

/** The cloud's center and radius (pixels). */
export function cloudCircle(cloud) {
  const shape = cloud?.shapes?.[0]?.toObject?.() ?? cloud?._source?.shapes?.[0];
  const center = shapeCenter(shape);
  if ( !center ) return null;
  const radius = Number(shape.radius ?? shape.radiusX ?? (shape.width ? shape.width / 2 : 0));
  return { center, radius };
}

/** The bolt's radius, in scene pixels (`bolt` rule: 5 ft), plus half a cell as at placement snapped to the grid. */
export function boltRadiusPx(item, scene) {
  const rule = contentOf(item).entry?.bolt ?? { radius: 5, units: "ft" };
  let radius = lengthIn(rule.radius, rule.units, scene.grid.units);
  return ((radius / scene.grid.distance) * scene.grid.size) + (scene.grid.size / 2);
}

/** FXMaster active: the rain (particles) and the lightning (filter), in the region only. */
function fxBehaviors(name) {
  if ( !game.modules.get("fxmaster")?.active ) return [];
  const rain = { density: 0.6, speed: 0.35, scale: 0.6, direction: 285, lifetime: 0.3, alpha: 0.9, splash: true, topDown: false,
    belowTokens: false, belowTiles: false, belowForeground: false, tint: { apply: false, value: "#FFFFFF" } };
  // Light, thin clouds (too dark tinted gray, seen by the user on 2026-10-04).
  const clouds = { density: 0.12, speed: 0.2, scale: 0.6, direction: 270, lifetime: 0.4, alpha: 0.35,
    belowTokens: false, belowTiles: false, belowForeground: false, tint: { apply: false, value: "#FFFFFF" } };
  const lightning = { frequency: 2500, spark_duration: 300, brightness: 1.4, belowTokens: false, belowTiles: false, belowForeground: false,
    color: { apply: false, value: "#ffffff" } };
  const flat = (prefix, options) => Object.fromEntries([[`${prefix}_enabled`, true],
    ...Object.entries(options).filter(([, v]) => (typeof v !== "object")).map(([k, v]) => [`${prefix}_${k}`, v])]);
  return [
    { type: "fxmaster.particleEffectsRegion", name: game.i18n.format("DND5ECOMBAT.Orage.ZonePluie", { name }), system: { ...flat("rain", rain), ...flat("clouds", clouds) },
      flags: { fxmaster: { particleEffects: { rain: { options: rain }, clouds: { options: clouds } } } } },
    { type: "fxmaster.filterEffectsRegion", name: game.i18n.format("DND5ECOMBAT.Orage.ZoneEclairs", { name }), system: flat("lightning", lightning),
      flags: { fxmaster: { filters: { lightning: { type: "lightning", options: lightning } } } } }
  ];
}

/**
 * Dresses up the cloud just placed: marked (`cloud`, and `stormy` — the storm was already there), carries FXMaster's storm, and the
 * region itself is shown to nobody (`LAYER`: only on the regions layer, to find it again) — placed AFTER
 * the behaviors are added, the 2026-10-04 trial having read it back as "GM" (`GAMEMASTER`); without FXMaster, a dark area visible
 * to all. By whoever placed it (owner).
 */
export async function dressCloud(cloud, { stormy=false }={}) {
  const item = fromUuidSync(cloud.getFlag("dnd5e", "item") ?? "", { strict: false });
  const fx = fxBehaviors(item?.name ?? cloud.name);
  await cloud.update({
    [`flags.${MODULE_ID}.cloud`]: true,
    [`flags.${MODULE_ID}.stormy`]: !!stormy,
    restriction: { enabled: false },
    ...(fx.length
      ? { visibility: CONST.REGION_VISIBILITY.LAYER }
      : { visibility: CONST.REGION_VISIBILITY.ALWAYS, color: "#1d2230", highlightMode: "coverage" })
  });
  if ( fx.length ) {
    await cloud.createEmbeddedDocuments("RegionBehavior", fx);
    if ( cloud.visibility !== CONST.REGION_VISIBILITY.LAYER ) await cloud.update({ visibility: CONST.REGION_VISIBILITY.LAYER });
  }
  return { fx: fx.length > 0 };
}

/**
 * Places the bolt at the aimed point (center, pixels): a circle of the activity, under the cloud, from the height of the
 * caster's floor to that of the cloud — the resolution reads it like any placed area (runtime/engine.mjs, `onRegionCreated`)
 * then removes it.
 */
export async function placeBolt(activity, cloud, center) {
  const scene = cloud.parent;
  const origin = fromUuidSync(cloud.getFlag("dnd5e", "origin") ?? "", { strict: false });
  const ground = Number(origin?._source?.elevation ?? cloud.elevation?.bottom ?? 0) || 0;
  const top = Number.isFinite(cloud.elevation?.top) ? cloud.elevation.top : ground + 100;
  const data = {
    name: game.i18n.format("DND5ECOMBAT.Orage.ZoneEclair", { name: activity.item.name, user: game.user.name }),
    color: "#e8f4ff",
    shapes: [{ type: "circle", x: center.x, y: center.y, radius: boltRadiusPx(activity.item, scene) }],
    ...(cloud.levels?.size ? { levels: [...cloud.levels] } : {}),
    elevation: { bottom: ground, top: Math.max(top, ground + 1) },
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      dnd5e: { ...(cloud.flags?.dnd5e ?? {}), activity: activity.uuid, item: activity.item.uuid },
      [MODULE_ID]: { bolt: true }
    }
  };
  if ( Hooks.call("dnd5e.createMeasuredTemplate", activity, [data]) === false ) return null;
  const created = await scene.createEmbeddedDocuments("Region", [data]);
  Hooks.callAll("dnd5e.postCreateMeasuredTemplate", activity, created);
  return created[0] ?? null;
}
