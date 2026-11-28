/**
 * Spell light and Darkness (SPEC §16.31), read and written in Foundry. Nothing is patched: the V14 core provides everything.
 *  - Area (`light.on: "area"`): an ambient light (AmbientLight) at the center of the region dnd5e placed, with its radii
 *    or, for Darkness, a negative source of the area's radius (`config.negative`, common/data/data.mjs:26: "darkness
 *    source") — the core then renders what is inside invisible to others and blinds whoever stands there
 *    (point-vision-source.mjs:186-190, detection-mode.mjs:109). It follows the region (a region attached to a token is
 *    moved with it by the core, documents/token.mjs:2486, hence an `updateRegion`) and disappears with it.
 *  - Effect (`on: "effect"`): the placed effect receives, at creation, `token.light.*` changes — applied to the token by
 *    the V14 core (client/documents/actor.mjs:248, TokenDocument#applyActiveEffects) and removed with the effect.
 *  - Wall (`on: "wall"`, §170): a row of ambient lights on each side of a wall placed by points, placed again if it is
 *    redrawn.
 *  - Summon (`on: "summon"`): the summoned object already carries its light (PHB "Light" actor: 20/40 ft). `carried`:
 *    at casting, the player chooses (ui/light.mjs) "on the ground" (the object is placed) or "on me" (the caster gets an
 *    effect that makes them glow with the same light), and the color. `single`: the previous lights of the same spell go out.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { summonItemOf } from "./summons.mjs";
import { shapeCenter } from "../core/area.mjs";
import { areaLightRadii, tokenLightChanges, dispelledBy } from "../core/light.mjs";
import { wallLightPoints } from "../core/wall.mjs";
import { wallGeometryOf } from "./wall-side.mjs";
import { lengthIn } from "./units.mjs";
export { burnLeftOf, burnOut, carriedLightEffect, carriedLightOf, carriedLightState, carriedLightsOf, carriedSourceOf, dropCarriedLight, fuelOf, heldItems, remainingOf, rememberBurn, setCarriedLight, setHood, hoodedDown } from "./carried-lights.mjs";

/** An item's light rule, or null. */
export function lightRuleOf(item) {
  return item ? (contentOf(item).entry?.light ?? null) : null;
}

/** The activity and light rule of a region placed by dnd5e (`on`: "area" by default, or "wall"), or null. */
function areaRuleOf(region, on="area") {
  const uuid = region.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const rule = lightRuleOf(activity?.item);
  return (rule?.on === on) ? { activity, rule } : null;
}

export function toGridUnits(value, units, grid) {
  if ( !units ) return value;
  return lengthIn(value, units, grid.units);
}

/** A region's center, in pixels: the origin of its first shape (circle, a token's Emanation…). */
function regionCenter(region) {
  const shape = region.shapes?.[0];
  const origin = shape?.origin;
  if ( Number.isFinite(origin?.x) && Number.isFinite(origin?.y) ) return { x: origin.x, y: origin.y };
  return shapeCenter(shape?.toObject?.() ?? region._source?.shapes?.[0] ?? null);
}

/**
 * An area's radius, grid unit: the dimensions that dnd5e noted at placement (template-placement.mjs:154); failing
 * that (region placed by a macro, the connector), the radius of its first round shape.
 */
function regionRadius(region) {
  const grid = region.parent.grid;
  const dims = region.getFlag?.("dnd5e", "dimensions");
  const size = Number(dims?.size);
  if ( Number.isFinite(size) && (size > 0) ) return toGridUnits(size, dims.units, grid);
  const shape = region.shapes?.[0]?.toObject?.() ?? region._source?.shapes?.[0] ?? {};
  const px = [shape.radius, shape.radiusX].find(Number.isFinite);
  return Number.isFinite(px) ? (px / grid.size) * grid.distance : 0;
}

/** The source's elevation: the middle of the area's slice, otherwise its bottom, otherwise the ground. */
function regionElevation(region) {
  const { bottom, top } = region.elevation ?? {};
  if ( Number.isFinite(bottom) && Number.isFinite(top) ) return (bottom + top) / 2;
  return Number.isFinite(bottom) ? bottom : 0;
}

/** The lights that the engine placed for this region. */
function lightsOf(region) {
  return region.parent.lights.filter(l => l.getFlag(MODULE_ID, "region") === region.id);
}

/**
 * An area has just been placed: its light (or Darkness), and what it dispels. Active GM.
 * @returns {Promise<{light: AmbientLightDocument, dispelled: number}|null>}
 */
export async function lightUpRegion(region) {
  const wall = areaRuleOf(region, "wall");
  if ( wall ) return lightUpWall(region, wall.rule);
  const found = areaRuleOf(region);
  if ( !found || lightsOf(region).length ) return null;
  const { rule } = found;
  const grid = region.parent.grid;
  const center = regionCenter(region);
  if ( !center ) return null;
  const radius = regionRadius(region);
  const radii = areaLightRadii({
    darkness: rule.darkness === true,
    bright: Number.isFinite(rule.bright) ? toGridUnits(rule.bright, rule.units, grid) : undefined,
    dim: Number.isFinite(rule.dim) ? toGridUnits(rule.dim, rule.units, grid) : undefined
  }, radius);
  const [light] = await region.parent.createEmbeddedDocuments("AmbientLight", [{
    x: Math.round(center.x), y: Math.round(center.y), elevation: regionElevation(region),
    levels: Array.from(region.levels ?? []), walls: true, vision: false,
    config: { bright: radii.bright, dim: radii.dim, negative: radii.negative },
    flags: { [MODULE_ID]: { region: region.id, darkness: radii.negative } }
  }]);
  // After placement: a failure while dispelling does not leave the area without its light.
  // §287: Darkness that dispels (Darkness) targets spell lights; a light (Daylight), Darkness.
  const lightsDispelled = (Number.isInteger(rule.dispels) && rule.darkness) ? await dispelLights(region, center, radius, rule.dispels) : [];
  const dispelled = (Number.isInteger(rule.dispels) && !rule.darkness) ? await dispelDarkness(region, center, radii.dim, rule.dispels) : lightsDispelled.length;
  return light ? { light, dispelled, lightsDispelled } : null;
}

/**
 * §170: a wall placed by points (Wall of Fire) — a row of sources on each side, every 10 ft (§173: half the radius for a
 * large light), at a tenth of a cell from the line
 * (the wall stops light: each row lights its side). Color and animation from the rule; reduced transparency, the sources
 * overlapping. Active GM.
 */
async function lightUpWall(region, rule) {
  if ( lightsOf(region).length ) return null;
  const geometry = wallGeometryOf(region);
  if ( !geometry ) return null;
  const grid = region.parent.grid;
  const perUnit = grid.size / grid.distance;
  // Every 10 ft; more spread out for a large light (Prismatic Wall: 100 ft) — half its shortest radius.
  const shortest = Math.min(...[rule.bright, rule.dim].filter(v => Number.isFinite(v) && (v > 0)));
  const step = toGridUnits(Math.max(10, shortest / 2), rule.units ?? "ft", grid) * perUnit;
  const points = wallLightPoints(geometry, step, grid.size / 10);
  const config = {
    bright: Number.isFinite(rule.bright) ? toGridUnits(rule.bright, rule.units, grid) : 0,
    dim: Number.isFinite(rule.dim) ? toGridUnits(rule.dim, rule.units, grid) : 0,
    ...(rule.color ? { color: rule.color, alpha: 0.25 } : {}),
    ...(rule.animation ? { animation: { ...rule.animation } } : {})
  };
  const created = await region.parent.createEmbeddedDocuments("AmbientLight", points.map(p => ({
    x: p.x, y: p.y, elevation: regionElevation(region), levels: Array.from(region.levels ?? []), walls: true, vision: false,
    config, flags: { [MODULE_ID]: { region: region.id } }
  })));
  return created.length ? { light: created[0], dispelled: 0, count: created.length } : null;
}

/** The area moved (displaced, or carried off by the token it is attached to): its light follows it. */
export async function followRegion(region) {
  // §170: a redrawn wall (the disk turned into a ring) — its lights are placed again.
  if ( areaRuleOf(region, "wall") ) {
    const n = await extinguishRegion(region);
    const done = await lightUpRegion(region);
    return (n || done) ? (done?.count ?? 0) : 0;
  }
  const lights = lightsOf(region);
  const center = regionCenter(region);
  if ( !lights.length || !center ) return 0;
  const updates = lights.filter(l => (Math.round(center.x) !== l.x) || (Math.round(center.y) !== l.y))
    .map(l => ({ _id: l.id, x: Math.round(center.x), y: Math.round(center.y), elevation: regionElevation(region) }));
  if ( updates.length ) await region.parent.updateEmbeddedDocuments("AmbientLight", updates);
  return updates.length;
}

/** The area disappeared: so does its light. */
export async function extinguishRegion(region) {
  const ids = lightsOf(region).map(l => l.id);
  if ( ids.length ) await region.parent.deleteEmbeddedDocuments("AmbientLight", ids);
  return ids.length;
}

/**
 * Daylight: the Darkness of level ≤ `maxLevel` that the area covers is dispelled — its spell ends (the
 * Concentration that holds it drops, runtime/concentration.mjs removes the region), otherwise the region is removed.
 */
async function dispelDarkness(region, center, radius, maxLevel) {
  const scene = region.parent;
  const darkness = [];
  for ( const other of scene.regions ) {
    if ( other === region ) continue;
    const found = areaRuleOf(other);
    if ( !found?.rule.darkness ) continue;
    const c = regionCenter(other);
    if ( !c ) continue;
    // Radii in pixels to compare them to the centers.
    const px = r => (r / scene.grid.distance) * scene.grid.size;
    const level = Number(other.getFlag("dnd5e", "spellLevel"));
    darkness.push({ id: other.id, x: c.x, y: c.y, radius: px(regionRadius(other)), level: Number.isFinite(level) ? level : null });
  }
  const ids = dispelledBy({ x: center.x, y: center.y, radius: (radius / scene.grid.distance) * scene.grid.size }, maxLevel, darkness);
  // The region first, then Concentration: deleting the effect also removes the region (runtime/concentration.mjs), and
  // the two deletions would cross (seen in play: "Region … does not exist").
  for ( const id of ids ) {
    const concentration = scene.regions.get(id)?.getFlag(MODULE_ID, "concentration");
    await scene.deleteEmbeddedDocuments("Region", [id]);
    const effect = concentration ? await fromUuid(concentration) : null;
    if ( effect ) await effect.delete();
  }
  return ids.length;
}

/** The level of the spell a light comes from: the one noted by dnd5e (upcast included), otherwise the item's. */
function spellLevelOf(doc, item) {
  const noted = Number(doc?.getFlag?.("dnd5e", "spellLevel"));
  if ( Number.isFinite(noted) ) return noted;
  return (item?.type === "spell") ? (Number(item.system.level) || 0) : null;
}

/**
 * The spell a light comes from ends: its Concentration drops if it has one (dnd5e removes what depends on it), otherwise its
 * lights go out (placed objects, light effects on the caster) and its light effects leave whoever carries them.
 */
async function endLightSpell(item, carrier=null) {
  const caster = item.actor;
  const concentration = caster?.effects.find(e => (e.getFlag("dnd5e", "item")?.id === item.id) && e.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING));
  if ( concentration ) return caster.endConcentration(concentration);
  await extinguishLights(item);
  const ids = (carrier?.effects ?? []).filter(e => originItemOf(e) === item).map(e => e.id);
  if ( ids.length ) await carrier.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * §287: Darkness — "if any part of the area covers a Bright or Dim Light created by a level 2 or lower spell, that spell
 * is dispelled". The scene's spell lights: a token glowing from a spell effect (Faerie Fire, Flame Blade, "Held Light",
 * Sunbeam…), a summoned light object (Light, Continual Flame), a light area; covered when the circles touch (`dispelledBy`).
 * Returns the dispelled spells: `{ item: nom, token }` (the token that was glowing, for the feedback).
 */
async function dispelLights(region, center, radius, maxLevel) {
  const scene = region.parent;
  const px = r => (r / scene.grid.distance) * scene.grid.size;
  const sources = [];
  for ( const token of scene.tokens ) {
    // §406: the validated position (`_source`), not the animation's (V14 trap, adapter/turn.mjs `committedPosition`).
    const c = { x: token._source.x + ((token._source.width * scene.grid.sizeX) / 2), y: token._source.y + ((token._source.height * scene.grid.sizeY) / 2) };
    const lit = px(Math.max(Number(token.light?.dim) || 0, Number(token.light?.bright) || 0));
    if ( !(lit > 0) ) continue;
    const summoned = summonItemOf(token);
    if ( summoned && (lightRuleOf(summoned)?.on === "summon") ) {
      sources.push({ id: `token:${token.id}`, x: c.x, y: c.y, radius: lit, level: spellLevelOf(null, summoned), item: summoned, carrier: null, token: null });
    }
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled ) continue;
      const lightOf = effect.getFlag(MODULE_ID, "lightOf");
      const item = lightOf ? fromUuidSync(lightOf, { strict: false }) : originItemOf(effect);
      if ( (item?.type !== "spell") || (!lightOf && !["effect", "caster"].includes(lightRuleOf(item)?.on)) ) continue;
      sources.push({ id: `effect:${effect.uuid}`, x: c.x, y: c.y, radius: lit, level: spellLevelOf(effect, item), item, carrier: token.actor, token });
    }
  }
  for ( const other of scene.regions ) {
    if ( other === region ) continue;
    const found = areaRuleOf(other);
    const oc = (found && !found.rule.darkness) ? regionCenter(other) : null;
    if ( !oc ) continue;
    const dim = Number.isFinite(found.rule.dim) ? toGridUnits(found.rule.dim, found.rule.units, scene.grid) : regionRadius(other);
    sources.push({ id: `region:${other.id}`, x: oc.x, y: oc.y, radius: px(dim), level: spellLevelOf(other, found.activity?.item),
      item: found.activity?.item ?? null, carrier: null, region: other });
  }
  const ids = new Set(dispelledBy({ x: center.x, y: center.y, radius: px(radius) }, maxLevel, sources.filter(s => Number.isFinite(s.level))));
  // A spell that lights several creatures (Faerie Fire) ends only once.
  const ended = new Map();
  for ( const source of sources.filter(s => ids.has(s.id)) ) {
    if ( !source.item || ended.has(source.item.uuid) ) continue;
    ended.set(source.item.uuid, { item: source.item.name, token: source.token ?? null });
    if ( source.region && !source.item.actor ) { await scene.deleteEmbeddedDocuments("Region", [source.region.id]); continue; }
    await endLightSpell(source.item, source.carrier);
  }
  return [...ended.values()];
}

/**
 * §287: Sunbeam — "a point of dazzling radiance shines above you" while the spell lasts: on the rule's activity
 * (`on: "caster"`, `activity`), a light effect on the caster, attached to their Concentration (`flags.dnd5e.dependents`: dnd5e
 * removes it with it, documents/active-effect.mjs:1105). Nothing if they already glow from this spell ("Create New Sunbeam").
 * @param {Activity} activity
 * @param {ActiveEffect|null} concentration  The Concentration opened by the use.
 */
export async function lightCasterFor(activity, concentration=null) {
  const item = activity?.item;
  const rule = lightRuleOf(item);
  if ( (rule?.on !== "caster") || (rule.activity && (rule.activity !== activity.id)) ) return null;
  const actor = activity.actor;
  if ( !actor || actor.effects.some(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid) ) return null;
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (Number.isFinite(v) && grid) ? toGridUnits(v, rule.units, grid) : (v ?? 0);
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base", duration: durationOf(item),
    system: { changes: tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim), color: rule.color ?? null, animation: rule.animation ?? null }) },
    flags: { [MODULE_ID]: { lightOf: item.uuid }, dnd5e: { spellLevel: item.system.level } }
  }]);
  if ( effect && concentration ) {
    await concentration.setFlag("dnd5e", "dependents", [...(concentration.getFlag("dnd5e", "dependents") ?? []), { uuid: effect.uuid }]);
  }
  return effect ?? null;
}

/* -------------------------------------------- */
/*  Effets qui font briller                     */
/* -------------------------------------------- */

/**
 * On an effect's creation (hook `preCreateActiveEffect`, on the client that writes it): if the item it comes from makes
 * its bearer glow, the effect receives its `token.light.*` changes. Returns true if the effect was completed.
 */
export function addEffectLight(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  const rule = lightRuleOf(originItemOf(effect));
  if ( rule?.on !== "effect" ) return false;
  const current = effect._source.system?.changes ?? [];
  if ( current.some(c => c.key?.startsWith("token.light.")) ) return false;
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (Number.isFinite(v) && grid) ? toGridUnits(v, rule.units, grid) : (v ?? 0);
  const changes = tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim) });
  effect.updateSource({ "system.changes": [...current, ...changes] });
  return true;
}

/* -------------------------------------------- */
/*  Summoned light objects                      */
/* -------------------------------------------- */

const SECONDS = { minute: 60, hour: 3600, day: 86400, round: 6, turn: 6 };

/** The item's duration, in seconds, for the effect (nothing for "until dispelled"). */
function durationOf(item) {
  const { value, units } = item.system?.duration ?? {};
  const n = Number(value);
  return (SECONDS[units] && Number.isFinite(n) && (n > 0)) ? { value: n * SECONDS[units], units: "seconds" } : {};
}

/** A summoning activity whose light object can also be held by the caster (Light, Continual Flame), or null. */
export function lightChoiceOf(activity) {
  if ( activity?.type !== "summon" ) return null;
  const rule = lightRuleOf(activity.item);
  return ((rule?.on === "summon") && rule.carried) ? rule : null;
}

/** The light of the object that the activity summons (first profile's actor: PHB "Light", 20/40 ft, orange). */
export async function summonedLightOf(activity) {
  const uuid = activity.profiles?.[0]?.uuid;
  const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
  const light = actor?.prototypeToken?.light ?? {};
  return { bright: light.bright ?? 20, dim: light.dim ?? 40, color: light.color ? String(light.color) : null,
    alpha: light.alpha ?? null, animation: light.animation ? { ...light.animation } : null };
}

/** The size of the summoned object: Tiny if the profile allows it ("no need to choose the size"), otherwise the first. */
export function summonSizeOf(activity) {
  const sizes = Array.from(activity.creatureSizes ?? []);
  return sizes.includes("tiny") ? "tiny" : (sizes[0] ?? null);
}

/**
 * "On me": the caster holds the object and glows with its light — an effect (name, image, spell duration) that carries its
 * `token.light.*` changes, in the chosen color. On the caster's client: their character is theirs.
 */
export async function lightCaster(activity, color=null) {
  const item = activity.item;
  const light = await summonedLightOf(activity);
  const [effect] = await activity.actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base", duration: durationOf(item),
    system: { changes: tokenLightChanges({ ...light, color: color ?? light.color }) },
    flags: { [MODULE_ID]: { lightOf: item.uuid } }
  }]);
  return effect ?? null;
}

/** "On the ground": the chosen color goes onto the object's token before its creation (hook `dnd5e.summonToken`). */
export function colorSummonedToken(activity, tokenData, options) {
  const color = options?.[MODULE_ID]?.lightColor;
  if ( !color || !lightChoiceOf(activity) ) return false;
  foundry.utils.setProperty(tokenData, "light.color", color);
  return true;
}

/** The lights turned on by this item: placed objects (all scenes) and light effects on its caster. */
export function lightsOfItem(item) {
  let n = 0;
  for ( const scene of game.scenes ) n += scene.tokens.filter(t => summonItemOf(t)?.uuid === item.uuid).length;
  return n + (item.actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid).length;
}

/**
 * Turns off an item's lights ("the spell ends if you cast it again"): its placed objects, on all
 * scenes, and the light effects it left on its caster. Active GM (a player does not delete tokens).
 * @param {Item} item
 * @param {{keep?: string}} [options]  Id of a token to keep (the one just placed).
 */
export async function extinguishLights(item, { keep=null }={}) {
  let n = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.tokens.filter(t => (t.id !== keep) && (summonItemOf(t)?.uuid === item.uuid)).map(t => t.id);
    if ( ids.length ) await scene.deleteEmbeddedDocuments("Token", ids);
    n += ids.length;
  }
  const caster = item.actor;
  const old = (caster?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "lightOf") === item.uuid).map(e => e.id);
  if ( old.length ) await caster.deleteEmbeddedDocuments("ActiveEffect", old);
  return n + old.length;
}

/**
 * A light object has just been summoned (active GM): with `single`, the lights of a previous casting that
 * would remain (cast without going through the choice: connector, card) go out.
 * @returns {Promise<{extinguished: number}|null>}
 */
export async function placeLightObject(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = lightRuleOf(item);
  if ( rule?.on !== "summon" ) return null;
  return { extinguished: rule.single ? await extinguishLights(item, { keep: tokenDoc.id }) : 0 };
}
