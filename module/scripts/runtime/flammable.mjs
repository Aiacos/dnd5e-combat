/**
 * §188: flammable areas (`flammable`, content/) — Oil spread on the ground, Spider Web. An area ignites:
 *  a. when a creature standing in it takes fire damage;
 *  b. when a fire area (an activity that deals fire damage) is placed over it;
 *  c. through the "Light" entry of its own token's menu, in contact, with a lit carried light source or a
 *     tinderbox.
 * Ignited, it deals its fire damage at the stated moments (once per turn; out of combat, on each entry), gives light, and
 * disappears at the end of the same turn `rounds` rounds later (`seconds` out of combat). The Web then frees those it restrained.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { contentOf } from "../adapter/content.mjs";
import { readAreaState, writeAreaState, lastingRegions, isInside } from "../adapter/areas.mjs";
import { committedPosition, tokenCenter } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { carriedLightsOf, carriedLightEffect } from "../adapter/carried-lights.mjs";
import { burnedOut } from "../core/area.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, say, viaActiveGM, waitForDice } from "./shared.mjs";
import { groundTile } from "./scatter.mjs";
import { catchFireFromZone } from "./burning.mjs";
import { relaunchUse } from "./relaunch.mjs";

export const IGNITE_QUERY = `${MODULE_ID}.ignite`;
/** Light of a burning puddle: that of a campfire (Bright 3 m, Dim 6 m more), flickering. */
const FIRE_LIGHT = { bright: 10, dim: 20, color: "#ff9329", alpha: 0.5, animation: { type: "torch", speed: 3, intensity: 3 } };

/** The flammability rule of an activity's item, or null. */
export function flammableOf(activity) {
  return contentOf(activity?.item).entry?.flammable ?? null;
}

/** The rule of an area placed by a flammable item (the area's state, else the region's item). */
function ruleOfRegion(region) {
  const state = readAreaState(region);
  if ( state?.flammable ) return state.flammable;
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  return contentOf(item).entry?.flammable ?? null;
}

/** This scene's flammable areas not yet on fire. */
export function unlitZones(scene) {
  return lastingRegions(scene).filter(r => ruleOfRegion(r) && !readAreaState(r)?.burning);
}

/** Does an activity deal fire damage (fire area, §188 b)? */
function dealsFire(activity) {
  // The oil spread carries "5 fire" in its data (the burning puddle): placing a puddle does not light another.
  if ( contentOf(activity?.item).entry?.flammable ) return false;
  return (activity?.damage?.parts ?? []).some(p => Array.from(p.types ?? []).includes("fire"));
}

/* -------------------------------------------- */
/*  Embrasement                                 */
/* -------------------------------------------- */

/** A region's center (pixels), from the rectangle of its shapes. */
function centerOf(region) {
  const xs = [];
  const ys = [];
  for ( const shape of region._source.shapes ?? [] ) {
    if ( Array.isArray(shape.points) ) shape.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
    else if ( Number.isFinite(shape.width) ) { xs.push(shape.x, shape.x + shape.width); ys.push(shape.y, shape.y + shape.height); }
    else if ( Number.isFinite(shape.radius) ) { xs.push(shape.x - shape.radius, shape.x + shape.radius); ys.push(shape.y - shape.radius, shape.y + shape.radius); }
  }
  if ( !xs.length ) return null;
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * The area ignites. Active GM. In combat, it goes out at the end of the same turn `rounds` rounds later; out of combat,
 * after `seconds` (timer, and world time as a safety net: `expiresAt`, runtime/areas.mjs).
 */
export async function ignite(region, cause="") {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    const rule = ruleOfRegion(region);
    if ( !state || !rule || state.burning || !region.parent ) return false;
    const combat = game.combat?.started ? game.combat : null;
    const until = combat ? { round: combat.round + rule.rounds, turn: combat.turn ?? 0 } : null;
    const center = centerOf(region);
    const [light] = center ? await region.parent.createEmbeddedDocuments("AmbientLight", [{
      x: Math.round(center.x), y: Math.round(center.y), walls: true, vision: false,
      levels: Array.from(region.levels ?? []), config: { ...FIRE_LIGHT },
      flags: { [MODULE_ID]: { burning: region.id } }
    }]).catch(() => []) : [];
    await writeAreaState(region, {
      ...state, on: [...rule.on], turnKey: null, hit: [], activities: null,
      burning: { damage: rule.damage, type: rule.type, until, frees: rule.frees ?? null, light: light?.id ?? null }
    });
    if ( !combat ) {
      await region.setFlag(MODULE_ID, "expiresAt", game.time.worldTime + rule.seconds);
      setTimeout(() => { if ( region.parent?.regions.get(region.id) ) region.delete().catch(() => {}); }, rule.seconds * 1000);
    }
    const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
    const name = item?.name ?? region.name;
    log(`${name}: ignited${cause ? ` (${cause})` : ""}, burns ${combat ? `until the end of round ${until.round}, turn ${until.turn}` : `${rule.seconds} s`}`);
    await say({ alias: name }, loc("Embrase.Prend", { item: name }), { ignited: { region: region.uuid } });
    return true;
  });
}

/** Ignite through a request to the active GM (a player cannot modify a region). */
export function igniteViaGM(region, cause="") {
  return viaActiveGM(IGNITE_QUERY, handleIgnite, { region: region.uuid, cause }, { noGm: "Embrase.SansMJ", fallback: false, label: "flammable: ignite" });
}

async function handleIgnite({ region: uuid, cause }, { user=null }={}) {
  const region = await fromUuid(uuid);
  // §472: from a player, it needs a creature on the area's scene (contact, carried flame, fire spell in range).
  if ( region && needsCheck(user) && !region.parent?.tokens.some(t => t.actor && actsFor(user, t.actor)) ) {
    console.warn(`${MODULE_ID} | ignite query from ${user.name} refused: no creature of theirs on the scene of ${region.name}`);
    return false;
  }
  return region ? ignite(region, cause) : false;
}

/**
 * §188 b: a fire area has just been placed — it ignites the flammable areas it covers (a point of a cell of the
 * flammable area inside the fire area). Active GM (area placement).
 */
export async function igniteUnder(fireRegion, activity) {
  if ( !levelAtLeast("full") || !dealsFire(activity) ) return 0;
  let n = 0;
  for ( const zone of unlitZones(fireRegion.parent) ) {
    if ( zone === fireRegion ) continue;
    if ( overlaps(zone, fireRegion) && await ignite(zone, activity.item?.name ?? "fire") ) n++;
  }
  return n;
}

/** Do two regions overlap? The centers of the first one's cells, tested in the second. */
function overlaps(zone, other) {
  const grid = zone.parent.grid;
  const center = centerOf(zone);
  if ( !center ) return false;
  const elevation = Number.isFinite(zone.elevation?.bottom) ? zone.elevation.bottom : 0;
  const points = [center];
  const bounds = zone.object?.bounds ?? null;
  if ( bounds ) {
    for ( let x = bounds.x + (grid.sizeX / 2); x < bounds.right; x += grid.sizeX ) {
      for ( let y = bounds.y + (grid.sizeY / 2); y < bounds.bottom; y += grid.sizeY ) if ( zone.testPoint({ x, y, elevation }) ) points.push({ x, y });
    }
  }
  return points.some(p => other.testPoint({ ...p, elevation }));
}

/* -------------------------------------------- */
/*  Burn                                        */
/* -------------------------------------------- */

/**
 * The burning area acts on a token (runtime/areas.mjs, in place of the replay): its damage rolled, shown, applied (dnd5e
 * Resistances; an oiled creature takes its extra 5, runtime/oil.mjs). Active GM.
 */
export async function burnTick(region, token, burning) {
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  const name = item?.name ?? region.name;
  const roll = await new Roll(burning.damage).evaluate();
  const message = await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ token }),
    flavor: loc("Embrase.Brule", { name: token.name, item: name, amount: roll.total })
  });
  await waitForDice(message);
  await token.actor?.applyDamage([{ value: roll.total, type: burning.type }]);
  log(`${name}: ${token.name} burns, ${roll.total} ${burning.type}`);
  // §212: house propagation — burned by the area, the creature catches fire (setting `fireSpread`).
  await catchFireFromZone(token, name);
}

/** The turn has just changed: areas whose fire reaches its end go out (after end-of-turn burns, same queue). */
function onTurnChange(combat, prior) {
  const scene = combat.scene ?? canvas.scene;
  if ( !prior || !Number.isFinite(prior.round) ) return;
  for ( const region of lastingRegions(scene) ) {
    const until = readAreaState(region)?.burning?.until;
    if ( !burnedOut(until, prior) ) continue;
    enqueue(`area:${region.id}`, async () => {
      if ( !region.parent?.regions.get(region.id) ) return;
      log(`${region.name}: burnt out`);
      await region.delete();
    }).catch(err => console.error(`${MODULE_ID} | flammable: burn out`, err));
  }
}

/** Combat ends: a fire that counted in turns goes out with it. */
async function onCombatEnd(combat) {
  const scene = combat.scene ?? canvas.scene;
  for ( const region of lastingRegions(scene) ) {
    if ( readAreaState(region)?.burning?.until ) await region.delete().catch(() => {});
  }
}

/** The area leaves (extinguished, burned, removed): its light too; the Web frees those it restrained (`frees`). */
async function onRegionDeleted(region) {
  const burning = readAreaState(region)?.burning;
  if ( !burning ) return;
  const light = region.parent?.lights.find(l => l.getFlag(MODULE_ID, "burning") === region.id);
  if ( light ) await light.delete();
  const activity = region.getFlag("dnd5e", "activity");
  if ( !burning.frees || !activity ) return;
  for ( const token of region.parent?.tokens ?? [] ) {
    const held = (token.actor?.effects ?? []).filter(e => (e.origin === activity) && e.statuses?.has(burning.frees));
    if ( held.length ) {
      await token.actor.deleteEmbeddedDocuments("ActiveEffect", held.map(e => e.id));
      log(`${token.name}: freed, the web burnt away`);
    }
  }
}

/* -------------------------------------------- */
/*  Light: fire damage taken, flame             */
/* -------------------------------------------- */

const lastFire = new WeakMap();

/** §188 a: a creature in a flammable area takes fire damage — the area ignites. */
async function onFireApplied(actor, amount) {
  const fire = lastFire.get(actor);
  lastFire.delete(actor);
  if ( !fire || !(amount > 0) || !canvas?.scene || !levelAtLeast("full") ) return;
  const zones = unlitZones(canvas.scene);
  if ( !zones.length ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    for ( const zone of zones ) if ( isInside(token, zone) ) await igniteViaGM(zone, `${token.name} takes fire damage`);
  }
}

/** Does this token have something to light with: a lit carried source (torch, lamp…), or a tinderbox? */
function hasFlame(actor) {
  return carriedLightsOf(actor).some(i => { const e = carriedLightEffect(i); return e && !e.disabled; })
    || (actor?.items ?? []).some(i => contentOf(i).entry?.kindles === true);
}

/** §188 c: the flammable areas this token can light — on the area or in contact, with a flame. */
export function ignitableNear(token) {
  if ( !token?.actor || isObjectToken(token) || !levelAtLeast("full") || !hasFlame(token.actor) ) return [];
  const grid = token.parent.grid;
  const at = committedPosition(token);
  const around = [];
  for ( const dx of [-1, 0, 1] ) for ( const dy of [-1, 0, 1] ) around.push({ ...at, x: at.x + (dx * grid.sizeX), y: at.y + (dy * grid.sizeY) });
  return unlitZones(token.parent).filter(r => around.some(p => isInside(token, r, p)));
}

/** The entries of its own token's menu: "Light: Oil". */
export function igniteEntries(token) {
  if ( !token?.isOwner ) return [];
  return ignitableNear(token).map(region => {
    const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
    return { icon: "fa-solid fa-fire", label: loc("Embrase.Allumer", { item: item?.name ?? region.name }), run: () => igniteViaGM(region, `lit by ${token.name}`) };
  });
}

/* -------------------------------------------- */
/*  Viser une zone (§189)                       */
/* -------------------------------------------- */

/**
 * §189: when aiming a single-target fire action (Fire Bolt), the flammable area not yet on fire under this point — `{ zone }`,
 * `{ zone, refused: "outOfRange" }` beyond range (the long one, if any; "contact": 1.5 m), or null. Called
 * only when no creature is under the mouse: a token on the area stays the target.
 */
export function fireTargetAt(token, activity, point) {
  if ( !token?.parent || !point || !levelAtLeast("full") || !dealsFire(activity) ) return null;
  const zone = unlitZones(token.parent).find(r => r.testPoint({ x: point.x, y: point.y,
    elevation: Number.isFinite(r.elevation?.bottom) ? r.elevation.bottom : 0 }));
  if ( !zone ) return null;
  const range = activity.range ?? {};
  const touch = range.units === "touch";
  const max = touch ? 5 : (Number(range.long) || Number(range.value) || 0);
  const units = touch ? "ft" : range.units;
  if ( max && units && (units !== "self") && (units !== "any") ) {
    const grid = token.parent.grid;
    const limit = lengthIn(max, units, grid.units);
    const center = centerOf(zone);
    const from = tokenCenter(token);
    const distance = center ? grid.measurePath([{ x: from.x, y: from.y }, center]).distance : 0;
    // From the edge of the caster's space to the nearest cell of the area: their half-widths are subtracted
    // from the distance between centers.
    const half = (grid.distance ?? 5) / 2;
    const body = ((committedPosition(token).width || 1) * (grid.distance ?? 5)) / 2;
    if ( (distance - half - body) > limit + 1e-6 ) return { zone, refused: "outOfRange" };
  }
  return { zone };
}

/**
 * §189: the fire action goes off on the targeted area — its use (cost, slot, card), with no targeted creature or chained roll,
 * then the area ignites. `usage`: the configurations suspended by targeting.
 */
export async function igniteWithActivity(token, activity, usage, zone) {
  const [config={}, dialog={}, message={}] = usage ?? [];
  // No targeted creature: the action goes off on the area alone.
  for ( const t of [...(game.user.targets ?? [])] ) t.setTarget(false, { releaseOthers: false });
  const results = await relaunchUse(activity, { ...config, subsequentActions: false, [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), igniteZone: zone.uuid } },
    { ...dialog, configure: false }, message);
  if ( !results ) return false;
  log(`${activity.item?.name}: aimed at ${zone.name}`);
  return igniteViaGM(zone, activity.item?.name ?? "fire");
}

/* -------------------------------------------- */
/*  Pose                                        */
/* -------------------------------------------- */

/** §188: what a flammable area placed on the ground keeps (Oil): its rule and the object's image. Active GM. */
export async function groundFlammableState(region, activity) {
  const rule = flammableOf(activity);
  const tile = await groundTile(region, activity?.item?.img);
  log(`${activity?.item?.name ?? region.name}: spread on the ground, flammable`);
  return { flammable: rule, ground: { tile: tile?.id ?? null } };
}

export function registerFlammable() {
  route("dnd5e.calculateDamage", (actor, damages) => {
    lastFire.set(actor, Array.from(damages ?? []).some(d => (d.type === "fire") && (Number(d.value) > 0)));
  }, { label: "flammable: fire damage not noted" });
  route("dnd5e.applyDamage", (actor, amount) => { onFireApplied(actor, amount).catch(err => console.error(`${MODULE_ID} | flammable`, err)); },
    { label: "flammable: not ignited by fire damage" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "flammable: not burnt out" });
  route("deleteCombat", onCombatEnd, { executor: true, label: "flammable: fire not put out with the combat" });
  route("deleteRegion", onRegionDeleted, { executor: true, label: "flammable: light or held creatures left behind" });
  CONFIG.queries[IGNITE_QUERY] = handleIgnite;
}

