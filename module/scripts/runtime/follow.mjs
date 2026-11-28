/**
 * Follow (SPEC §41.3): a token follows another — a character follows an ally, a familiar or summon follows its
 * master. The order is given from the context menu (ui/pointer.mjs); it lives in a flag of the following token
 * (`flags["dnd5e-combat"].follow = { leader: id du token suivi, by: id de l'utilisateur qui a donné l'ordre }`), so it
 * survives an F5 and everyone reads it.
 *
 * Who makes it walk: the client of user `by`, and only it (several owners — the player and the GM — must not
 * walk twice).
 *
 * How: **the follower retraces the leader's path**. Each movement of the leader (hook `moveToken`: its departure and its
 * steps, level changes included) is noted in the follower's trail; after a short delay, the follower walks this
 * trail except its last step — the cell where the leader stands —, then takes the last step through the engine's A* (`joinToken`,
 * a few cells: in contact, on the right level). Without a trail (the order has just been given, the leader was teleported), it
 * joins through A* alone. Retracing the path rather than searching for a path from one end of the map to the other: that is what
 * "follow" means, it costs nothing, and the search for a path to a distant target, from one level to another,
 * ran out half the time (seen on 2026-10-01 on Restored Keep: 6,000 cells explored, up to 0.8 s, for nothing).
 * A queue forms by itself: each retraces the path of the one it follows.
 *
 * What stops it: "Stop following"; a movement of the follower that does not come from here (its player takes it in hand, the
 * GM moves it) — the follow steps are recognized by the `follow` mark that their movement operation carries; the
 * followed token disappearing. In combat, we do not follow — each plays their turn — and following resumes afterwards, at the
 * leader's next movement.
 */

import { MODULE_ID } from "../constants.mjs";
import { footprintDistance } from "../core/orders.mjs";
import { footprintOf, continuedFlags } from "../adapter/movement.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { joinToken, followTrail } from "./actions.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";

const FLAG = "follow";
/** Delay before setting off: the leader has finished giving its movement orders. */
const DELAY_MS = 350;
/** Steps kept in a trail: beyond that (a follower stuck far behind), the beginning is forgotten and A* takes over. */
const MAX_TRAIL = 80;

const orderOf = token => token?.flags?.[MODULE_ID]?.[FLAG] ?? null;

/** The token this one follows, if it is still on its scene. */
export function leaderOf(token) {
  const order = orderOf(token);
  return order?.leader ? (token.parent?.tokens.get(order.leader) ?? null) : null;
}

/** The scene's tokens that follow this one. */
export function followersOf(leader) {
  return (leader?.parent?.tokens.contents ?? []).filter(t => orderOf(t)?.leader === leader.id);
}

/**
 * Can this token start following that one? It must be owned, on the same scene, and not close a loop
 * (A follows B who follows A).
 */
export function canFollow(follower, leader) {
  if ( !follower?.isOwner || !leader || (follower === leader) || (follower.parent !== leader.parent) || !follower.actor ) return false;
  for ( let t = leader, n = 0; t && (n < 50); t = leaderOf(t), n++ ) if ( t === follower ) return false;
  return true;
}

export async function follow(follower, leader) {
  if ( !canFollow(follower, leader) ) return false;
  trails.delete(follower.id);
  await follower.setFlag(MODULE_ID, FLAG, { leader: leader.id, by: game.user.id });
  notice(follower, loc("Suivi.Debut", { name: leader.name }), "prompt");
  log(`${follower.name} follows ${leader.name}`);
  schedule(follower);
  return true;
}

export async function unfollow(follower, { silent=false }={}) {
  const order = orderOf(follower);
  if ( !order || !follower.isOwner ) return false;
  const leader = leaderOf(follower);
  clearTimeout(timers.get(follower.id));
  timers.delete(follower.id);
  trails.delete(follower.id);
  await follower.unsetFlag(MODULE_ID, FLAG);
  if ( !silent ) notice(follower, loc("Suivi.Fin", { name: leader?.name ?? "" }), "prompt");
  log(`${follower.name} no longer follows ${leader?.name ?? "anyone"}`);
  return true;
}

/** The tokens that following is currently walking: one step at a time per follower. */
const walking = new Set();
/** Those whose leader moved again while they were walking: one more step afterwards. */
const again = new Set();
const timers = new Map();
/** Each follower's trail: the leader's steps it has not yet retraced (`{ x, y, elevation, level, action }`). */
const trails = new Map();

function schedule(follower) {
  clearTimeout(timers.get(follower.id));
  timers.set(follower.id, setTimeout(() => {
    timers.delete(follower.id);
    step(follower).catch(err => console.warn(`${MODULE_ID} | following ${follower.name}`, err));
  }, DELAY_MS));
}

const touching = (follower, leader) => ((follower._source.level ?? null) === (leader._source.level ?? null))
  && (footprintDistance(footprintOf(follower), footprintOf(leader)) <= 0);

async function step(follower) {
  const order = orderOf(follower);
  if ( !order || (order.by !== game.user.id) || !follower.parent ) return;
  const leader = leaderOf(follower);
  if ( !leader ) return unfollow(follower, { silent: true });
  // In combat, each plays their turn: following waits (and the earlier trail is no longer valid).
  if ( game.combat?.started && follower.actor && combatantFor(follower.actor) ) { trails.delete(follower.id); return; }
  if ( walking.has(follower.id) ) { again.add(follower.id); return; }
  if ( touching(follower, leader) ) { trails.delete(follower.id); return; }
  walking.add(follower.id);
  try {
    // The leader's trail, minus its last step (the cell where it stands); the last step is for A*.
    const trail = trails.get(follower.id) ?? [];
    trails.delete(follower.id);
    if ( trail.length > 1 ) await followTrail(follower, trail.slice(0, -1), { follow: true });
    if ( !orderOf(follower) ) return;
    const result = await joinToken(follower, leader, { follow: true });
    // "exhausted": arrived where the leader was, who has moved again — the next step (below) resumes.
    if ( !result.arrived && (result.reason !== "exhausted") ) {
      const at = t => { const f = footprintOf(t); return `${f.i},${f.j}@${t._source.level ?? ""}`; };
      log(`${follower.name} does not reach ${leader.name} (${result.reason}): at ${at(follower)}, leader at ${at(leader)}`);
    }
  }
  finally {
    walking.delete(follower.id);
    if ( (again.delete(follower.id) || trails.has(follower.id)) && orderOf(follower) ) schedule(follower);
  }
}

/** What is kept of a leader's step to retrace it: where, at what height, on which level, by which action. */
const stepOf = ({ x, y, elevation, level, action }) => ({ x, y, snapped: true, ...(Number.isFinite(elevation) ? { elevation } : {}),
  ...(level ? { level } : {}), ...(action ? { action } : {}) });

/** The leader has just moved: its path is added to its followers' trail (on the client of whoever gave the order). */
function onMoveToken(token, movement) {
  const followers = followersOf(token).filter(f => orderOf(f).by === game.user.id);
  if ( !followers.length ) return;
  const steps = (movement?.passed?.waypoints ?? []).map(stepOf);
  if ( !steps.length ) return;
  for ( const follower of followers ) {
    const trail = trails.get(follower.id) ?? [];
    // Empty trail: it starts from where the leader departs — the follower, in contact, is one step away.
    if ( !trail.length && movement.origin ) trail.push(stepOf({ ...movement.origin, action: null }));
    trail.push(...steps);
    trails.set(follower.id, trail.slice(-MAX_TRAIL));
    schedule(follower);
  }
}

const MOVED = ["x", "y", "elevation", "level"];

function onUpdateToken(token, changes, options) {
  if ( !MOVED.some(k => k in changes) ) return;
  // The follower moved by something other than following: it is taken in hand, the order drops (on the client of whoever gave it).
  const own = orderOf(token);
  // §99: a piece of following walk that the core chains itself no longer has the engine's options — it is still the following.
  const flags = options?.[MODULE_ID] ?? continuedFlags(token, options?._movement?.[token.id]);
  if ( own && (own.by === game.user.id) && !flags?.follow ) {
    unfollow(token).catch(err => console.warn(`${MODULE_ID} | stopping follow of ${token.name}`, err));
  }
  // A leader moved without a path (teleported, placed elsewhere): no trail, the follower joins through A*.
  for ( const follower of followersOf(token) ) {
    if ( orderOf(follower).by === game.user.id ) schedule(follower);
  }
}

/** The leader removed from the scene: its followers' order drops (on the client of whoever gave it). */
function onDeleteToken(token) {
  for ( const follower of followersOf(token) ) {
    if ( orderOf(follower).by === game.user.id ) unfollow(follower, { silent: true }).catch(() => {});
  }
}

export function registerFollow() {
  route("moveToken", onMoveToken, { label: "follow: the leader's path" });
  route("updateToken", onUpdateToken, { label: "follow: the leader moved" });
  route("deleteToken", onDeleteToken, { label: "follow: the leader is gone" });
}
