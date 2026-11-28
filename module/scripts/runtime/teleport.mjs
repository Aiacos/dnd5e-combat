/**
 * Self-teleportation (SPEC §16.10): validation of the destination (`dnd5e.teleport`), planning and the engine's click,
 * arrival activity. Extracted from runtime/actions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { distanceBetween, tokenCenter } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { cellUnder } from "../adapter/movement.mjs";
import { canSeePoint, isVisionAvailable } from "../adapter/vision.mjs";
import { lightAt, lightOnToken } from "../adapter/illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { teleportReach } from "../core/movement.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { carryPassengers, choosePassengers } from "./passengers.mjs";
import { loc, notice, log } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { occupiedAt } from "./actions.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";
import { antimagicAround, antimagicGlobeAt } from "../adapter/barriers.mjs";
import { antimagicRegionAt } from "../adapter/antimagic.mjs";
import { placeArrivalArea } from "../adapter/self-area.mjs";

/* -------------------------------------------- */
/*  Teleportation (§16.10)                      */
/* -------------------------------------------- */

/** Refusal of the last destination, per token: the intention asks whether to force, else resumes the aiming instead of giving up. */
const refusedTeleports = new Map();   // §411 : uuid du token → `{ to, lines }`, de quoi forcer

/**
 * The range of a teleportation, in the scene's unit: that of the native activity (`teleport.value`, prepared by
 * dnd5e, teleport-data.mjs), otherwise the one the content declares (`teleport`) — §461: or, with no declared distance, the range
 * of the activity used (monster abilities). null: no limit.
 */
function teleportLimit(activity, scene) {
  const rule = (activity?.type === "teleport") ? { distance: activity.teleport?.value, units: activity.teleport?.units }
    : (activity?.item ? teleportReach(contentOf(activity.item).entry?.teleport ?? null, activity.range) : null);
  if ( !rule || !Number.isFinite(Number(rule.distance)) ) return null;
  return lengthIn(Number(rule.distance), rule.units, scene.grid.units);
}

/**
 * `dnd5e.teleport` (dnd5e 6's native "teleport" activity, documents/activity/teleport.mjs): the destination must
 * be an unoccupied space that the creature sees (Misty Step, Dimension Door: "an unoccupied space…"). The
 * distance, for its part, is already bounded by the core's planning (`maxDistance`). On the client that plans.
 */
export function onTeleport(activity, plans) {
  for ( const { token, plan } of plans ?? [] ) {
    const doc = token?.document;
    const to = plan?.destination;
    if ( !doc || !to ) continue;
    const issues = teleportIssues(activity, doc, to);
    if ( !issues.length ) continue;
    // §411 (issue #44, batch 4): no more flat refusal. The move is cancelled (the hook is synchronous); the intention
    // (`teleportSelf`, `handleNearSpace`) then asks, and can force the same cell.
    notice(doc, loc(issues[0].notice));
    refusedTeleports.set(doc.uuid, { to: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 }, lines: issues.map(i => i.line) });
    return false;
  }
  return true;
}

/**
 * What is wrong with a teleportation destination: `[{ line, notice }]` (window sentence, floating text). "Up to 9 m"; an
 * unoccupied space; §367 "Marche dans l'ombre"; a cell that is seen (C12-b: except `teleport.unseen`, Dimension Door).
 * @param {Activity|null} activity
 * @param {TokenDocument} doc
 * @param {{x: number, y: number, elevation?: number}} to
 */
export function teleportIssues(activity, doc, to) {
  const issues = [];
  // "Up to 9 m" (Misty Step): the plan's destination is that of the click — the core does not always bound it.
  const limit = teleportLimit(activity, doc.parent);
  const travelled = (limit !== null) ? distanceBetween(doc, doc, { posB: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation } }).value : 0;
  if ( (limit !== null) && (travelled > limit + 1e-6) ) {
    issues.push({ line: loc("Teleport.TropLoin", { distance: limit, units: doc.parent.grid.units }), notice: "Retour.TropLoin" });
  }
  if ( occupiedAt(doc, to) ) issues.push({ line: loc("Teleport.CaseOccupee"), notice: "Retour.CaseOccupee" });
  // §465: "within 1.50 m of a creature it sees" ("Rêve éveillé"), "within 3 m of the creature that triggered it" ("Poursuite").
  const destination = activity?.item ? contentOf(activity.item).entry?.teleport?.destination : null;
  if ( (destination?.near === "creature") && !nearCreature(doc, to, destination) ) {
    const within = Math.round(lengthIn(destination.within, destination.units, doc.parent.grid.units) * 10) / 10;
    issues.push({ line: loc("Teleport.LoinCreature", { distance: within, units: doc.parent.grid.units }), notice: "Retour.TropLoin" });
  }
  // §436: Antimagic Field — neither into it, nor out of it (dnd5e 6.1 `antimagic` status at departure, `dnd5e.antimagic` region or
  // §163 globe at arrival).
  const position = { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 };
  const field = antimagicAround(doc)?.name ?? antimagicRegionAt(doc, position)?.name ?? antimagicGlobeAt(doc, position)?.item?.name ?? null;
  if ( field ) issues.push({ line: loc("Teleport.Antimagie", { item: field }), notice: "Retour.Antimagie" });
  const center = doc.getCenterPoint ? doc.getCenterPoint(to) : { x: to.x, y: to.y };
  // §367: "Marche dans l'ombre" — "in Dim Light or Darkness, to a space … also in Dim Light or Darkness".
  const lit = tooBrightFor(activity, doc, { ...center, elevation: to.elevation ?? doc._source.elevation ?? 0 });
  if ( lit ) issues.push({ line: loc(`Teleport.TropEclaire.${lit}`), notice: "Retour.TropEclaire" });
  const unseen = activity?.item ? contentOf(activity.item).entry?.teleport?.unseen === true : false;
  if ( !unseen && isVisionAvailable() && (canSeePoint(doc, { ...center, elevation: to.elevation ?? 0 }) === false) ) {
    issues.push({ line: loc("Teleport.NonVue"), notice: "Retour.NonVue" });
  }
  return issues;
}

/**
 * §465: is the arrival cell within `within` of a creature the token sees? `trigger`: first the designated targets (the creature
 * that triggered the Reaction), otherwise any creature of the scene, it excepted.
 */
function nearCreature(doc, to, { within, units, trigger=false }) {
  const scene = doc.parent;
  const reach = lengthIn(within, units, scene.grid.units);
  const at = { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 };
  const targeted = trigger ? Array.from(game.user.targets ?? []).map(t => t.document).filter(t => t && (t !== doc) && (t.parent === scene)) : [];
  const pool = targeted.length ? targeted : scene.tokens.filter(t => (t !== doc) && t.actor && !t.hidden);
  return pool.some(t => {
    if ( distanceBetween(doc, t, { posA: at }).value > reach + 1e-6 ) return false;
    if ( !isVisionAvailable() ) return true;
    const c = tokenCenter(t);
    return !c || (canSeePoint(doc, { ...c, elevation: t._source.elevation ?? 0 }) !== false);
  });
}

/**
 * §411: this token's last refused destination — "Do it anyway"? Forced: the token is teleported there (`blink`, without the
 * validation), the GM and the table warned. Returns true if it is done.
 */
async function forceRefusedTeleport(activity, doc) {
  const refused = refusedTeleports.get(doc.uuid);
  if ( !refused ) return false;
  refusedTeleports.delete(doc.uuid);
  const item = activity?.item ?? null;
  const go = await askAnyway(`${item?.name ?? loc("Teleport.Titre")} — ${doc.name}`, refused.lines, { actor: doc.actor, item, token: doc });
  if ( !go ) return false;
  const { x, y, elevation } = refused.to;
  // An occupied cell: dnd5e does not let a move end on another creature (canvas/token.mjs, `constrainMovementPath`) except
  // `ignoreTokens` — forcing is going there anyway.
  await doc.move([{ x, y, elevation, action: "blink", snapped: true }], { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true } });
  return true;
}

/**
 * §367: `teleport.maxLight` — the departure (`"from"`) or the arrival (`"to"`) more lit than the rule allows, or null. Without a
 * canvas or without readable light: nothing to say.
 * @param {Activity} activity
 * @param {TokenDocument} doc
 * @param {{x: number, y: number, elevation?: number}|null} [destination]
 */
export function tooBrightFor(activity, doc, destination=null) {
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  if ( !rule?.maxLight || (rule.activity && (rule.activity !== activity.id)) ) return null;
  const limit = (rule.maxLight === "dark") ? LIGHT.DARK : LIGHT.DIM;
  const here = lightOnToken(doc);
  if ( here && (here.level > limit) ) return "from";
  const there = destination ? lightAt(destination) : null;
  if ( there && (there.level > limit) ) return "to";
  return null;
}

/**
 * The self-teleportation that an activity triggers, or null: dnd5e's native "teleport" activity with a "self" range
 * (SRD spells), otherwise what the content declares for the item (`teleport`, content/teleports.mjs: the PHB).
 * @returns {{native: true}|{native: false, distance: number, units: string}|null}
 */
export function selfTeleportOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  // §264: the passengers that the content declares also apply to the native activity (SRD Dimension Door).
  if ( (activity?.type === "teleport") && (activity.range?.units === "self") && activity.canPlanTeleport ) return { native: true, passengers: rule?.passengers ?? null };
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  // §461: with no declared distance, the activity's range ("teleports up to [range]"); unreadable ("self", special): no
  // teleportation.
  // §465: except an arrival "near a creature it sees" ("Rêve éveillé"), which alone bounds the destination.
  const reach = teleportReach(rule, activity.range) ?? ((rule.destination?.near === "creature") ? { distance: null, units: null } : null);
  if ( !reach ) return null;
  return { native: false, distance: reach.distance, units: reach.units, then: rule.then ?? null, passengers: rule.passengers ?? null,
    area: rule.area ?? null, after: rule.after ?? null, destination: rule.destination ?? null };
}

/**
 * §67 quater: the activity that the teleportation declares for the arrival (`teleport.then`: "it can then force each
 * creature within 1.50 m of its new position…"), used right away from the new position — an area on self is placed
 * automatically (runtime/self-area.mjs).
 */
export async function afterTeleport(activity, rule) {
  // §463: the "at arrival" area ("Téléportation radieuse") — placed around the creature that arrived; its resolution
  // follows the region.
  if ( rule?.area === "arrival" ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
    const created = token ? await placeArrivalArea(activity, token).catch(err => { console.error(`${MODULE_ID} | arrival area`, err); return null; }) : null;
    if ( created?.length ) log(`${activity.item.name}: area placed around ${token.name} on arrival`);
  }
  const next = rule?.then ? activity.item?.system.activities?.get(rule.then) : null;
  if ( !next ) return;
  log(`${activity.item.name}: on arrival, ${next.name || next.item.name}`);
  await next.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: true } }, { configure: false })
    .catch(err => console.error(`${MODULE_ID} | teleport arrival activity`, err));
}

/** Plans a declared teleportation, as the native activity does (dnd5e teleport.mjs, `planTeleport`). */
async function planDeclaredTeleport(activity, object, { distance, units }) {
  // §465: with no distance ("Rêve éveillé"), the planning is not bounded — the validation requires a creature near the arrival.
  const bounded = Number.isFinite(distance) ? { maxDistance: lengthIn(distance, units, canvas.grid.units) } : {};
  const plan = await object.planMovement({ allowedActions: ["blink"], direct: true, ...bounded, preventDrop: true });
  if ( !plan ) return null;
  const plans = [{ token: object, plan }];
  // The same checkpoint as the native teleportation: our validation, and anyone who listens.
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return [];
  const moved = await object.document.startMovement(plan.id);
  return [{ token: object, plan, moved }];
}

let teleporting = null;

/** The teleportation whose destination is being chosen on this client (`{ token, limit }`, range in the scene's unit), or null. */
export const currentTeleport = () => teleporting;

/**
 * §67 ter: the core's planning (`Token#planMovement`) is only validated by DRAGGING the token to the destination
 * (canvas/placeables/token.mjs, `_prepareDragLeftDropUpdates`: only the planned token is interactive) — a click on the ground does
 * nothing there. The engine's click (ui/pointer.mjs) therefore chooses the cell under the mouse: the core's planning is closed, and
 * `teleportSelf` teleports the token after the same validation (`dnd5e.teleport`). The core's drag remains possible.
 */
export function teleportClick(point) {
  const tp = teleporting;
  if ( !tp?.token?.parent ) return false;
  const at = tp.token.parent.grid.getTopLeftPoint(cellUnder(tp.token, point));
  tp.chosen = { x: at.x, y: at.y };
  canvas.tokens._cancelMovementPlanning();
  return true;
}

/** Teleport to the cell chosen by a click: the validation of `onTeleport` (and of anyone who listens), then a `blink`. */
export async function teleportTo(activity, token, { x, y }) {
  const elevation = token._source.elevation ?? 0;
  const plans = [{ token: token.object, plan: { destination: { x, y, elevation } } }];
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return false;
  await token.move([{ x, y, elevation, action: "blink", snapped: true }], { [MODULE_ID]: { cleared: true } });
  return true;
}

/**
 * "Teleport self" intention (Misty Step): the creature's token is controlled, and the core's planning
 * opens right away — that of the native activity (`planTeleport`, "Teleport" button of its card), or the same for an
 * item that declares it. BG3: the cell is chosen right away. A refused destination (occupied cell, not in view)
 * reopens the aiming; Escape abandons it.
 * @param {Activity} activity
 * @returns {Promise<boolean>}  true if the creature teleported.
 */
export async function teleportSelf(activity) {
  const rule = selfTeleportOf(activity);
  const token = activity?.getUsageToken?.() ?? activity?.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const object = token?.object ?? null;
  if ( !rule || !object ) return false;
  // Its own aiming, kept here: another teleportation launched during this one replaces `teleporting`, and the end of the first
  // set it back to null under the second (issue #108: "Cannot read properties of null (reading 'chosen')").
  const own = teleporting = { token, limit: teleportLimit(activity, token.parent) };
  // §465: an arrival near a plant (Tree Stride) — trees are not objects of the scene: the reminder, the GM judges it.
  if ( rule.destination?.near === "plant" ) {
    const within = Math.round(lengthIn(rule.destination.within, rule.destination.units, token.parent.grid.units) * 10) / 10;
    ui.notifications.info(loc("Teleport.Plante", { item: activity.item.name, distance: within, units: token.parent.grid.units }));
  }
  // §92: the cell left, for the options of the Steps of the Fey (creatures within 1.50 m of the space left).
  const from = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  // §264: who leaves with it (Dimension Door), chosen before the jump; placed next to it on arrival.
  const passengers = await choosePassengers(token, rule.passengers);
  const done = async () => {
    // §461: the table sees and hears the teleportation (DAS rule: visible feedback and sound on all clients).
    notice(token, { key: "Retour.Teleporte" }, "gain", { all: true, action: "teleport", outcome: "success" });
    await carryPassengers(token, passengers);
    await afterTeleport(activity, rule); await afterTeleportOptions(activity, token, from); return true;
  };
  try {
    for ( let attempt = 0; attempt < 5; attempt++ ) {
      object.control({ releaseOthers: true });
      refusedTeleports.delete(token.uuid);
      const results = rule.native ? await activity.planTeleport() : await planDeclaredTeleport(activity, object, rule);
      if ( results?.some(r => r.moved) ) return done();
      // §67 ter: a destination chosen by a click (`teleportClick`) — the core's planning, for its part, closed with nothing.
      const chosen = own.chosen;
      if ( chosen ) {
        own.chosen = null;
        if ( await teleportTo(activity, token, chosen) ) return done();
      }
      if ( !refusedTeleports.has(token.uuid) ) {
        if ( chosen ) continue;
        return false;   // abandoned (Escape), not refused
      }
      // §411: refused (occupied cell, out of view, too far) — force, otherwise the aiming reopens.
      if ( await forceRefusedTeleport(activity, token) ) return done();
    }
    return false;
  } finally { if ( teleporting === own ) teleporting = null; }
}

/* -------------------------------------------- */
/*  §401: a space of your choice, very close     */
/* -------------------------------------------- */

export const NEAR_SPACE_QUERY = `${MODULE_ID}.nearSpace`;

/** Beyond that, the planning closes by itself (the token stays where it is, or the active GM shifts it). */
const NEAR_SPACE_MS = 30000;

/**
 * §401: Blink — "you return to an unoccupied space of your choice that you can see within 3 m of the space you left". On the
 * client of whoever chooses (the token's player, otherwise the GM): stay there (if the space is free) or choose the cell, through
 * the core's planning or a click (like Misty Step), validated like a teleportation (free cell, in view, in range). Returns the
 * chosen cell `{ x, y }` (the token is there), or null (it stays where it is).
 * @param {{token: string, distance: number, units: string, mustMove?: boolean, item?: string}} payload
 */
export async function handleNearSpace({ token: uuid, distance, units, mustMove=false, item="", near=null }) {
  const doc = await fromUuid(uuid);
  const object = doc?.object;
  if ( !object ) return null;
  // §402: `near` (token uuids) — the cell is within `distance` of one of those creatures, not of the token's position (Steel Wind
  // Strike: "within 1.50 m of one of the targets"); the path is not bounded.
  const anchors = (near ?? []).map(u => fromUuidSync(u, { strict: false })).filter(Boolean);
  const reach = lengthIn(distance, units, doc.parent.grid.units);
  const limit = anchors.length ? Infinity : reach;
  const label = `${Math.round(reach * 10) / 10} ${doc.parent.grid.units}`;
  if ( !mustMove ) {
    const answer = await timedWait({
      window: { title: item || doc.name, icon: "fa-solid fa-person-rays" },
      content: `<p>${foundry.utils.escapeHTML(loc(anchors.length ? "EspaceProche.QuestionCibles" : "EspaceProche.Question", { name: doc.name, distance: label }))}</p>`,
      buttons: [{ action: "stay", label: loc("EspaceProche.Rester"), icon: "fa-solid fa-location-dot", default: true },
        { action: "move", label: loc("EspaceProche.Choisir", { distance: label }), icon: "fa-solid fa-arrows-to-dot" }]
    }, { fallback: "stay", awaiting: { actor: doc.actor, kind: "choice" } });
    if ( answer !== "move" ) return null;
  } else ui.notifications.info(loc("EspaceProche.Occupe", { name: doc.name, distance: label }));
  return whileAwaiting(doc.actor, "choice", async () => {
    const own = teleporting = { token: doc, limit };
    try {
      for ( let attempt = 0; attempt < 5; attempt++ ) {
        object.control({ releaseOthers: true });
        let timer = null;
        const timeout = new Promise(resolve => { timer = setTimeout(() => { canvas.tokens._cancelMovementPlanning?.(); resolve(null); }, NEAR_SPACE_MS); });
        const plan = await Promise.race([object.planMovement({ allowedActions: ["blink"], direct: true, ...(Number.isFinite(limit) ? { maxDistance: limit } : {}), preventDrop: true }), timeout]);
        clearTimeout(timer);
        const chosen = own.chosen;
        own.chosen = null;
        const to = plan?.destination ?? (chosen ? { ...chosen, elevation: doc._source.elevation ?? 0 } : null);
        if ( !to ) return null;
        // A click is not bounded by the core's planning: the range is read again here.
        const travelled = distanceBetween(doc, doc, { posB: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation } }).value;
        // §411: what is wrong (too far, occupied cell, out of view) is told in a window — force, otherwise choose another cell.
        const at = { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 };
        const lines = [];
        if ( travelled > limit + 1e-6 ) lines.push(loc("Teleport.TropLoin", { distance: Math.round(limit * 10) / 10, units: doc.parent.grid.units }));
        if ( anchors.length && !anchors.some(a => distanceBetween(doc, a, { posA: at }).value <= reach + 1e-6) ) {
          lines.push(loc("EspaceProche.TropLoinCibles", { distance: label }));
        }
        lines.push(...teleportIssues(null, doc, to).map(i => i.line));
        if ( lines.length && !(await askAnyway(`${item || doc.name} — ${doc.name}`, [...new Set(lines)], { actor: doc.actor, token: doc })) ) continue;
        await doc.move([{ x: to.x, y: to.y, elevation: doc._source.elevation ?? 0, action: "blink", snapped: true }],
          { ...(lines.length ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { cleared: true } });
        log(`${doc.name}: comes back in the chosen space (${Math.round(travelled * 10) / 10} ${doc.parent.grid.units})`);
        return { x: to.x, y: to.y };
      }
      return null;
    } finally { if ( teleporting === own ) teleporting = null; }
  });
}
