/**
 * Test functions (api.mcp): vision (issue #42). For each observer → target pair, what the rules judge (`canSee`, what
 * decides a "not in view" issue and the Advantage / Disadvantage reasons) and its ingredients (area that blocks sight, distance,
 * Devil's Sight, hearing, line of sight), then what the screen shows through the observer's eyes (`Token#isVisible` and the
 * detection filter: outline of hearing or of a special mode). Nothing is written to a document (except
 * `screenAfterUpdate`: a flag set then removed).
 *
 *  - `visionMatrix`: on the GM's client (each observer's control is taken for the time of the read, then returned);
 *  - `screenHere`: on ANY client (a player in the embedded browser) — what this client sees, with the tokens it
 *    controls, without changing anything.
 */

import { MODULE_ID } from "../constants.mjs";
import { canSee, canLocate, pinpointsTarget, blockedBetween, devilsSightRange, isVisionAvailable, hasLineOfSight } from "../adapter/vision.mjs";
import { canHear } from "../adapter/hearing.mjs";
import { perceivedOnToken } from "../adapter/illumination.mjs";
import { sightRequired } from "../adapter/conditions.mjs";
import { committedPosition, distanceBetween, tokenCenter } from "../adapter/turn.mjs";
import { sleep } from "./shared.mjs";
import { rangeStatus } from "./actions.mjs";
import { gmOnly, viewedToken } from "./testing-shared.mjs";
import { DEVILS_SIGHT_OUTLINE, drawnUnderVeil } from "../core/light.mjs";

const HEARING = [0.55, 0.8, 1, 1];   // ui/perception.mjs, hearing outline

/**
 * The detection filter of a displayed token: null, "hearing" (engine outline), "Devil's Sight" (its fringe, whole token), or the
 * colors of another outline.
 */
function filterOf(token) {
  const filter = token.detectionFilter;
  if ( !filter ) return null;
  const color = filter.uniforms?.outlineColor;
  if ( !color ) return "other";
  const rounded = Array.from(color).map(c => Math.round(c * 100) / 100);
  const same = ref => rounded.every((c, i) => c === ref[i]);
  if ( same(HEARING) ) return "hearing";
  return same(DEVILS_SIGHT_OUTLINE.outlineColor) ? "devilsSight" : rounded;
}

/**
 * Issue #42, continued (0.281.1): is the token's center inside the area that an active vision source of this client sees (its
 * sight polygon)? Outside all of them, a token displayed without a filter is drawn under the core's vision veil:
 * invisible to the player.
 */
function inSightOfClient(token) {
  const { x, y } = token.center;
  return canvas.effects.visionSources.some(s => s.active && s.los?.contains?.(x, y));
}

/**
 * What this client shows of a target: not displayed, displayed sharp (Devil's Sight included: whole token, dark red fringe),
 * displayed through an outline — or "veiled": judged visible but drawn under the veil (display defect, issue #42 continued).
 */
function shownAs(token) {
  if ( !token?.isVisible ) return "hidden";
  const filter = filterOf(token);
  if ( drawnUnderVeil({ visible: true, filtered: !!filter, ownVision: !!token.vision?.active, inSight: inSightOfClient(token) }) ) return "veiled";
  if ( !filter || (filter === "devilsSight") ) return "seen";
  return (filter === "hearing") ? "heard" : "outline";
}

/**
 * Waits until this client's view is the observer's: vision sources rebuilt right away (without an image, GM window in the
 * background, `isVisible` still read those of the previous observer), then its ACTIVE source — as long as none is, a GM sees
 * everything (`Token#isVisible`, placeables/token.mjs:639), and an observer without a view counted as "seeing" each target.
 * 3 s at most.
 */
async function settleVision(token) {
  for ( const until = Date.now() + 3000; Date.now() < until; ) {
    canvas.perception.update({ initializeVision: true });
    canvas.perception.applyRenderFlags();
    const active = canvas.effects.visionSources.some(s => s.active && (s.object === token));
    if ( active ) break;
    await sleep(100);
  }
  await sleep(300);
}

/** The rules' ingredients for a pair (validated positions). */
function rulesFor(observer, target) {
  const blocked = blockedBetween(observer, target);
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenCenter(observer);
  const level = canvas.scene.levels?.get?.(observer.level);
  const devil = devilsSightRange(observer);
  return {
    sees: canSee(observer, target),
    locates: canLocate(observer, target),   // position known: seen, or located (Tremorsense, #118)
    pinpoints: pinpointsTarget(observer, target),   // issue #107: the same, and a locating sense also finds a Hidden creature's square
    blocked: Object.keys(blocked).filter(k => blocked[k]),   // mist, Darkness, silence
    distance: Math.round(distanceBetween(observer, target).value * 10) / 10,
    units: observer.parent?.grid?.units ?? null,
    lineOfSight: hasLineOfSight(eye, target, level),
    lineOfSightThroughDarkness: hasLineOfSight(eye, target, level, { throughDarkness: true }),
    devilsSight: devil || null,
    hears: canHear(observer, target),
    darkvision: observer.actor?.system.attributes?.senses?.ranges?.darkvision ?? null,
    // The light on the target, as the observer perceives it (Darkness 0, Dim Light 1, Bright Light 2)
    // and the Disadvantage on Perception.
    light: (({ level, perceived, perceptionDisadvantage } = {}) => ({ level, perceived, perceptionDisadvantage }))(perceivedOnToken(observer, target) ?? {}),
    modes: Object.keys(observer.detectionModes ?? {})
  };
}

/**
 * The vision of each pair: rules and screen.
 * @param {{observerIds: string[], targetIds: string[], screen?: boolean}} args
 * @returns {{vision: boolean, rows: Array<{observer: string, target: string, rules: object, screen: string|null}>}}
 */
export async function visionMatrix({ observerIds=[], targetIds=[], screen=true }) {
  gmOnly();
  const observers = observerIds.map(id => viewedToken({ tokenId: id }));
  const targets = targetIds.map(id => viewedToken({ tokenId: id }));
  const rows = [];
  const before = canvas.tokens.controlled.map(t => t.id);
  try {
    for ( const observer of observers ) {
      let shown = null;
      let filters = null;
      if ( screen ) {
        observer.object.control({ releaseOthers: true });
        await settleVision(observer.object);
        shown = Object.fromEntries(targets.map(t => [t.id, shownAs(t.object)]));
        filters = Object.fromEntries(targets.map(t => [t.id, t.object?.isVisible ? filterOf(t.object) : null]));
      }
      for ( const target of targets ) {
        if ( target === observer ) continue;
        rows.push({ observer: observer.name, observerId: observer.id, target: target.name, targetId: target.id,
          rules: rulesFor(observer, target), screen: shown?.[target.id] ?? null, filter: filters?.[target.id] ?? null });
      }
    }
  }
  finally {
    if ( screen ) {
      canvas.tokens.releaseAll();
      for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
      canvas.perception.update({ initializeVision: true });
    }
  }
  return { vision: isVisionAvailable(), rows };
}

/**
 * What THIS client shows of the displayed scene's tokens, with the tokens it controls (or all those it owns when it controls
 * none: a player's view). No GM required, for a player client. Empty `targetIds`: all tokens.
 */
export function screenHere({ targetIds=[] }={}) {
  if ( !canvas?.ready ) throw new Error("no scene displayed");
  const tokens = targetIds.length ? targetIds.map(id => canvas.tokens.get(id)).filter(Boolean) : canvas.tokens.placeables;
  return {
    user: game.user.name, isGM: game.user.isGM, vision: isVisionAvailable(), scene: canvas.scene.name,
    controlled: canvas.tokens.controlled.map(t => t.name),
    tokens: tokens.map(t => ({ name: t.name, id: t.id, shown: shownAs(t), filter: t.isVisible ? filterOf(t) : null }))
  };
}

/**
 * Gives a world actor to players (owners), by their names — the connector ignores `ownership` when creating and updating an
 * actor. For arenas (tools/arene-vision.mjs: the observers at `claude player`). The other rights do not change.
 * @param {{actorId: string, users: string[], level?: number}} args
 */
export async function setOwners({ actorId, users=[], level=3 }) {
  gmOnly();
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`actor ${actorId} not found`);
  const ids = users.map(name => game.users.getName(name)?.id ?? null);
  const missing = users.filter((_, i) => !ids[i]);
  if ( missing.length ) throw new Error(`unknown users: ${missing.join(", ")}`);
  await actor.update({ ownership: Object.fromEntries(ids.map(id => [id, level])) });
  return { actor: actor.name, ownership: actor.ownership };
}

/**
 * Issue #42: the "{name} is not in view: this spell targets a creature you can see" issue of an aim, without opening the
 * legality window — the same computation as runtime/turn.mjs (the activity's `sightRequired`,
 * then the author's `canSee` toward each target).
 * @param {{tokenId: string, identifier: string, targetIds: string[]}} args
 * @returns {{requiresSight: boolean, unseen: string[]}}
 */
export function sightIssues({ tokenId, identifier, targetIds=[] }) {
  const origin = viewedToken({ tokenId });
  const item = origin.actor?.items.find(i => i.system?.identifier === identifier);
  const activity = item?.system.activities.contents[0];
  if ( !activity ) throw new Error(`no activity for ${identifier}`);
  const requires = sightRequired(activity);
  const targets = targetIds.map(id => viewedToken({ tokenId: id }));
  // Issue #42, continued: the aiming cursor's verdict (`rangeStatus`, ui/pointer-mouse.mjs)
  // — it refused "not in view" what the rules saw.
  const cursorRefused = targets.filter(t => { const s = rangeStatus(origin, t, activity); return !!(s?.out || s?.blind); }).map(t => t.name);
  return { requiresSight: requires, unseen: requires ? targets.filter(t => canSee(origin, t) === false).map(t => t.name) : [], cursorRefused };
}

/**
 * Issue #42, continued (Archibald): the observer's screen AFTER an update of their actor, without resetting all the sources —
 * token data preparation wiped the in-memory modes (Devil's Sight, a Blinded creature's hearing). `visionMatrix`, which redoes
 * all the vision, did not see it. The observer is selected, their view set, then a flag of their actor is set and removed
 * (an update with no game effect: returning Temporary Hit Points would count as damage, Concentration check included).
 */
export async function screenAfterUpdate({ observerId, targetIds=[] }) {
  gmOnly();
  const observer = viewedToken({ tokenId: observerId });
  const targets = targetIds.map(id => viewedToken({ tokenId: id }));
  observer.object.control({ releaseOthers: true });
  await settleVision(observer.object);
  const before = Object.fromEntries(targets.map(t => [t.name, shownAs(t.object)]));
  try {
    await observer.actor.setFlag(MODULE_ID, "visionProbe", Date.now());
    await sleep(800);
    canvas.perception.applyRenderFlags();
    const after = Object.fromEntries(targets.map(t => [t.name, shownAs(t.object)]));
    return { before, after, modes: Object.keys(observer.detectionModes ?? {}) };
  }
  finally {
    await observer.actor.unsetFlag(MODULE_ID, "visionProbe");
    canvas.tokens.releaseAll();
  }
}

/**
 * Issue #42: selects a token on the GM's client (its vision becomes the screen's), or releases everything (`tokenId` null) — to
 * replay a GM's gesture: the token already selected, then a state placed, without resetting all the sources (`screenHere`).
 */
export function control({ tokenId=null }={}) {
  gmOnly();
  if ( !tokenId ) { canvas.tokens.releaseAll(); return { controlled: [] }; }
  viewedToken({ tokenId }).object.control({ releaseOthers: true });
  return { controlled: canvas.tokens.controlled.map(t => t.name) };
}
