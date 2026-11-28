/**
 * Test functions (api.mcp): areas and walls placed, sides of a wall, summons at a point, storm, regions. Extracted from
 * runtime/testing.mjs.
 */

import { boltAim, setBoltAim, strike } from "./storm.mjs";
import { cloudOf, cloudCircle } from "../adapter/storm.mjs";
import { MODULE_ID } from "../constants.mjs";
import { currentTeleport } from "./actions.mjs";
import { flipWallSide } from "./wall-side.mjs";
import { sideRegionOf } from "../adapter/wall-side.mjs";
import { sleep } from "./shared.mjs";
import { gmOnly, viewedToken } from "./testing-shared.mjs";
import { move } from "./testing-moves.mjs";
import { rangedAreaOf, rangedPlacementProblem } from "../adapter/self-area.mjs";
import { chainOutliers } from "../adapter/chain.mjs";
import { damageTypeChoices } from "../adapter/messages.mjs";

/**
 * §162: a wall placed by points, as the interface's aiming would do after the clicks (ui/pointer.mjs, `aimWall`): the activity is
 * used with the points (`aimed: { type: "wall", points }`), the region and its walls follow `postUseActivity`. Returns the
 * region's id.
 */
export async function wall({ tokenId, itemId, activityId=null, points }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.target?.template?.type === "wall");
  if ( !activity ) throw new Error("wall activity not found");
  const before = new Set(canvas.scene.regions.map(r => r.id));
  await activity.use({ consume: false, create: { measuredTemplate: false },
    [MODULE_ID]: { confirmed: true, autoReact: "none", aimed: { type: "wall", points } } }, { configure: false });
  for ( let i = 0; i < 40; i++ ) {
    const region = canvas.scene.regions.find(r => !before.has(r.id));
    if ( region ) return { regionId: region.id, shapes: region.shapes.map(s => s.type) };
    await sleep(100);
  }
  return { regionId: null };
}

/**
 * §169: the state of a wall with a burning face — its side, its burning face (id, shapes), its core walls; `flip: true` flips it
 * first (like the caster menu entry).
 */
export async function wallSide({ regionId, flip=false }) {
  gmOnly();
  const region = canvas.scene?.regions.get(regionId);
  if ( !region ) throw new Error(`region ${regionId} not found`);
  if ( flip ) await flipWallSide(region);
  const burning = sideRegionOf(region);
  return {
    side: region.getFlag(MODULE_ID, "wallSide")?.side ?? null,
    shapes: region.shapes.map(s => s.toObject()),
    burning: burning ? { id: burning.id, shapes: burning.shapes.map(s => s.toObject()), area: burning.getFlag(MODULE_ID, "area") } : null,
    walls: canvas.scene.walls.filter(w => w.getFlag(MODULE_ID, "zone") === region.id).map(w => ({ c: w.c, move: w.move, sight: w.sight })),
    // §170: its lights; and the sounds that a neighbouring module would have placed on it (`flags.*.wall`).
    lights: canvas.scene.lights.filter(l => l.getFlag(MODULE_ID, "region") === region.id).map(l => ({ x: l.x, y: l.y, bright: l.config.bright, dim: l.config.dim })),
    sounds: canvas.scene.sounds.filter(s => Object.values(s.flags ?? {}).some(f => f?.wall === region.id)).length,
    // §172: its behaviors (Difficult Terrain, movement cost).
    behaviors: region.behaviors.map(b => ({ type: b.type, system: b.system?.toObject?.() ?? null }))
  };
}

/**
 * A summon placed on a fixed cell, for a scenario. The activity is used without summoning (`create.summons: false`:
 * card, Concentration, budget as in play), then `placeSummons` is called with the first profile (or `profile`); dnd5e's
 * interactive placement (`getPlacement`, a click on the canvas, dnd5e 6.0.3 dnd5e.mjs:40825-40843, called by
 * `placeSummons` :40494) is replaced by the given position, on THIS activity instance and for the time of the call.
 * Test tool only: the engine itself leaves the placement to the system.
 */
/** O8f (§349): a token's disposition and the players (non-GM, or "default") who have at least one permission on its world actor. */
export function owners({ tokenId }) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) throw new Error("token not found");
  const actor = (token.actorLink === false) ? (token.baseActor ?? game.actors.get(token.actorId)) : token.actor;
  const players = Object.entries(actor?.ownership ?? {}).filter(([id, level]) => (level >= 1) && ((id === "default") || !game.users.get(id)?.isGM))
    .map(([id]) => (id === "default") ? id : (game.users.get(id)?.name ?? id));
  return { disposition: token.disposition, players, gmOwned: Object.entries(actor?.ownership ?? {}).some(([id, level]) => (level >= 3) && game.users.get(id)?.isGM) };
}

/**
 * GM: uses the item's summon activity (`activityId`, otherwise the first) consuming nothing, then places the creatures of the
 * profile (`profile`, otherwise the first) at cell `x`, `y` → `{ messageId, tokens: [{ id, name, actorId }] }`. `actorUuid`: the
 * creature of a "by CR" summon (§107).
 */
export async function summonAt({ tokenId, itemId, activityId=null, profile=null, actorUuid=null, x, y }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "summon");
  if ( !activity || (activity.type !== "summon") ) throw new Error("summon activity not found");
  // §84: consuming nothing, like `use` by default — a caster with no slot opened "No more charge" on the GM (§77).
  // O8f (§349): a "rider" activity (Scroll of Titan Summoning: it only appears with the enchantment that names the titan) is
  // not used as it is — only the placement is done.
  const used = activity.isHidden ? null : await activity.use({ consume: false, create: { summons: false }, [MODULE_ID]: { confirmed: true, autoReact: "none", placeSummons: false } },
    { configure: false });
  activity.getPlacement = async () => [{ x, y, elevation: token.elevation ?? 0, rotation: 0 }];
  // §107: a "by CR" summon (Find Familiar) asks the player for the creature (summon.mjs, `queryActor`) — provided here.
  if ( actorUuid ) activity.queryActor = async () => actorUuid;
  try {
    const created = await activity.placeSummons({ profile: profile ?? activity.profiles[0]?._id });
    return { messageId: used?.message?.id ?? null, tokens: (created ?? []).map(t => ({ id: t.id, name: t.name, actorId: t.actorId })) };
  } finally {
    delete activity.getPlacement;
    delete activity.queryActor;
  }
}

/** The aiming of a teleportation in progress on this client: the engine's, and the core's planning (`_movementPlanningContext`). */
export function planning() {
  const ctx = canvas.tokens?._movementPlanningContext ?? null;
  return { teleporting: currentTeleport()?.token?.name ?? null, planning: ctx?.object?.name ?? null,
    controlled: canvas.tokens?.controlled.map(t => t.name) ?? [] };
}

/** §70: the click of the bolt's aiming (a point of the scene): the core's placement is closed, the bolt placed at the point. */
export async function stormStrike({ x, y }) {
  const aim = boltAim();
  if ( !aim ) return { struck: false };
  setBoltAim(null);
  canvas.regions._cancelPlacement?.();
  const region = await strike(aim.activity, aim.cloud, { x, y });
  return { struck: !!region, regionId: region?.id ?? null };
}

/**
 * §70: validates the region placement in progress (`RegionLayer#placeRegion`: dnd5e's for a spell's area, or the bolt's
 * aiming) at the scene point (x, y), like a click: the shape is centered there, then the end of `#nextPlacement` is replayed
 * (client/canvas/layers/regions.mjs:1146-1191: creation if `create`, otherwise the document returned). A single shape.
 */
export async function placeRegionAt({ x, y }) {
  const ctx = canvas.regions._placementContext;
  if ( !ctx ) return { placed: false };
  const { preview, resolve, create, createOptions, preCommit, destroyPreview, preConfirm, regionIndex, regionCount } = ctx;
  const document = preview.document;
  const shape = document.shapes[0]?.toObject?.() ?? null;
  if ( !shape ) return { placed: false };
  const center = shapeCenterOf(shape);
  const moved = (shape.type === "polygon")
    ? { ...shape, points: shape.points.map((v, i) => v + ((i % 2) ? (y - center.y) : (x - center.x))) }
    : (shape.type === "rectangle") ? { ...shape, x: x - (shape.width / 2), y: y - (shape.height / 2) } : { ...shape, x, y };
  document.updateSource({ shapes: [moved] });
  // Like `#confirmPlacement`: the requester's callback (dnd5e picks up the placed shape there, template-placement.mjs:36).
  if ( preConfirm && (preConfirm({ event: null, document, regionIndex, regionCount, shape: ctx.shape, shapeIndex: 0, shapeCount: 1 }) === false) ) return { placed: false };
  // `_cancelPlacement` destroys the preview (its document is the one we return): we leave it a dummy one, and finish like the core.
  ctx.resolve = () => {};
  ctx.preview = { destroyed: true };
  canvas.regions._cancelPlacement();
  let region = null;
  if ( !preCommit || ((await preCommit(Object.freeze([document]))) !== false) ) {
    if ( create ) region = await CONFIG.Region.documentClass.create(document.toObject(), { controlObject: true, ...(createOptions ?? {}), parent: document.parent });
    else {
      region = document;
      if ( destroyPreview ) { region._object = null; region._destroyed = false; }
    }
  }
  resolve(region);
  if ( (!region || destroyPreview) && !preview.destroyed ) preview.destroy({ children: true });
  return { placed: true, regionId: create ? region?.id ?? null : null, shape: moved.type };
}

const shapeCenterOf = shape => (Array.isArray(shape.points)
  ? { x: shape.points.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0) / (shape.points.length / 2),
      y: shape.points.filter((_, i) => i % 2).reduce((a, b) => a + b, 0) / (shape.points.length / 2) }
  : (shape.type === "rectangle") ? { x: shape.x + (shape.width / 2), y: shape.y + (shape.height / 2) } : { x: shape.x, y: shape.y });

/** §70: an item's storm on the scene (cloud, "already there", aiming in progress). */
export function storm({ tokenId, itemId }) {
  const item = viewedToken({ tokenId }).actor?.items.get(itemId);
  const cloud = cloudOf(item);
  return { cloud: cloud ? { id: cloud.id, stormy: !!cloud.getFlag(MODULE_ID, "stormy"), behaviors: cloud.behaviors.map(b => b.type),
    visibility: cloud.visibility, circle: cloudCircle(cloud) } : null, aiming: !!boltAim() };
}

/**
 * §286: what the placement would refuse for these shapes of the item's area activity (`far`, `hidden`, `apart` — non-contiguous
 * cubes), or null; without opening dnd5e's placement. `shapes`: region shapes in pixels (`circle` { x, y, radius }, `rectangle`
 * { x, y, width, height }).
 */
export function rangedPlacement({ tokenId, itemId, shapes }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => a.target?.template?.type);
  if ( !activity ) throw new Error("area activity not found");
  const area = rangedAreaOf(activity);
  return { area: area ? { count: area.count, contiguous: area.contiguous, range: area.range } : null, problem: area ? rangedPlacementProblem(area, shapes) : null };
}

/** §286: Chain Lightning — the targets (after the first) too far from the first, by name. */
export function chainCheck({ tokenId, itemId, targetIds }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.contents[0];
  if ( !activity ) throw new Error("activity not found");
  const targets = targetIds.map(id => canvas.scene.tokens.get(id)).filter(t => t);
  return { outliers: chainOutliers(activity, targets).map(t => t.name) };
}

/** §287: the token's light as its effects render it (`token.light.*` applied by the core), not that of its source. */
export function tokenLight({ tokenId }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const light = (token.document ?? token).light ?? {};
  return { bright: Number(light.bright) || 0, dim: Number(light.dim) || 0, color: light.color ? String(light.color) : null };
}

/** §288: the damage types at the choice of an item's attack ("Coup au but": the weapon's or radiant), as the roll will offer them. */
export function damageTypes({ tokenId, itemId }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const item = (token.document ?? token).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => a.type === "attack");
  if ( !activity ) throw new Error("attack activity not found");
  return { name: item.name, base: Array.from(item.system.damage?.base?.types ?? []), choices: damageTypeChoices(activity) };
}

/**
 * §383 (issue #38): cast a summon like the DAS · Combat UI action bar (`activity.use({ spell: { slot } },
 * { configure: false })`, without `confirmed`: the engine's "Choose the form" window must open), consuming nothing. The placement
 * that follows is noted and done at the given cell (dnd5e's interactive placement, `getPlacement`, is replaced on the activity
 * instance that `dnd5e.preSummon` receives — the scaled copy). Does not wait for the window: returns right away.
 * `sheet: true`: as from the sheet (see below).
 */
let summonWatch = null;
/**
 * GM: runs the `type` activity (summon by default) like the DAS · Combat UI bar, without waiting for the window or
 * consuming (unless `sheet: true`) → `{ started, profiles }`; what is placed is read through `summonCaptured`.
 */
export function castFromBar({ tokenId, itemId, slot=null, x, y, sheet=false, type="summon", targetIds=null }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  // §391: also an enchantment or transformation activity (`type`); the profile dnd5e receives is captured at `postUseActivity`.
  const activity = item?.system.activities.find(a => a.type === type);
  if ( !activity ) throw new Error(`${type} activity not found`);
  if ( summonWatch ) {
    Hooks.off("dnd5e.preSummon", summonWatch.hook);
    if ( summonWatch.useHook ) Hooks.off("dnd5e.postUseActivity", summonWatch.useHook);
  }
  const watch = summonWatch = { item: item.id, summoned: null, tokens: null, used: null };
  watch.useHook = Hooks.on("dnd5e.postUseActivity", (a, usage) => {
    if ( (a.item?.id !== watch.item) || (a.type !== type) ) return;
    watch.used = { enchantmentProfile: usage?.enchantmentProfile ?? null, transformProfile: usage?.transform?.profile ?? null,
      level: a.item?.system?.level ?? null };
    Hooks.off("dnd5e.postUseActivity", watch.useHook);
  });
  watch.hook = Hooks.on("dnd5e.preSummon", (a, profile, options) => {
    if ( a.item?.id !== watch.item ) return;
    watch.summoned = { profile: profile?._id ?? null, name: profile?.name ?? null, uuid: profile?.uuid ?? null,
      creatureSize: options?.creatureSize ?? null, creatureType: options?.creatureType ?? null,
      count: (() => { try { return new Roll(String(profile?.count || "1"), a.getRollData()).evaluateSync().total; } catch(err) { return null; } })(),
      level: a.getRollData?.()?.item?.level ?? null };
    // As many cells as creatures (`count` of the profile at the cast level, §385), in a row starting from the given cell.
    const n = Math.max(1, Number(watch.summoned.count) || 1);
    const step = canvas.grid?.size ?? 100;
    a.getPlacement = async () => Array.from({ length: n }, (_, i) => ({ x: x + (i * step), y, elevation: token.elevation ?? 0, rotation: 0 }));
    Hooks.off("dnd5e.preSummon", watch.hook);
  });
  watch.tokenHook = Hooks.on("dnd5e.postSummon", (a, profile, tokens) => {
    if ( a.item?.id !== watch.item ) return;
    watch.tokens = (tokens ?? []).map(t => ({ id: t.id, name: t.name, actorId: t.actorId }));
    Hooks.off("dnd5e.postSummon", watch.tokenHook);
  });
  // `sheet`: like a click in the sheet (ordinary `activity.use()`, dnd5e window, consumption) — with no slot, the GM gets
  // "No charge left" (§77), whose retry skips the dnd5e window.
  // §391: the targets designated before casting (True Polymorph targets a creature; without them, the engine waits for a click).
  if ( Array.isArray(targetIds) ) {
    for ( const t of game.user.targets ) t.setTarget(false, { releaseOthers: false });
    for ( const id of targetIds ) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
  }
  (sheet ? activity.use() : activity.use({ consume: false, ...(slot ? { spell: { slot } } : {}) }, { configure: false }))
    .catch(err => console.error(`${MODULE_ID} | castFromBar`, err));
  const list = (type === "enchant") ? activity.availableEnchantments : activity.availableProfiles;
  return { started: true, profiles: Array.from(list ?? []).map(p => ({ id: p._id, name: p.name || p.effect?.name || "" })) };
}

/** §383: what the last `castFromBar` summoned (profile received by dnd5e, tokens placed), or null while nothing has started. */
export function summonCaptured() {
  return summonWatch ? { summoned: summonWatch.summoned, tokens: summonWatch.tokens, used: summonWatch.used } : null;
}
