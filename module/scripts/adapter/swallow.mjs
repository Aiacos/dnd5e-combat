/**
 * M8 (SPEC §18.17): Swallow / Engulf as seen from Foundry. The item (`swallow` content, by identifier) carries in the Monster
 * Manual the "swallowed" effect (Blinded, Restrained and Total Cover — or Grappled for the Shambling Mound) that one of its
 * activities applies; a creature is swallowed as long as it bears this effect. Its activities: the damage each turn (`damage`),
 * and the save to avoid being regurgitated (a `save` that does not apply the "swallowed" effect).
 */

import { MODULE_ID } from "../constants.mjs";
import { readSwallow, sizeLimit } from "../core/swallow.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { actorOfEffect } from "./grapple.mjs";
import { dragDestination } from "./movement.mjs";
import { englishDescription } from "./multiattack.mjs";
import { committedPosition } from "./turn.mjs";
import { effectOfProfile } from "./usage.mjs";

/** The "swallowed" effect of an item: the one that carries Total Cover, or the Grappled condition (Shambling Mound). */
const isSwallowedEffectData = e => e.statuses?.has?.("coverTotal") || e.statuses?.has?.("grappled");

/**
 * @returns {{item: Item5e, entry: Activity|null, damage: Activity|null, regurgitate: Activity|null, escape: Activity|null,
 *   effectIds: Set<string>, damageAt: string|null, threshold: number|null, capacity: number|null, grappling: boolean,
 *   forbids: string|null, repeatsSave: boolean, moving: boolean, maxSize: string|null}|null}
 *   `entry`: the activity that applies the "swallowed" effect; `escape`: the escape check (`check`, Gelatinous Cube).
 *   §45: `entryPoses` — false when no Monster Manual activity applies the effect (Giant Toad): `entry` is then
 *   the item's action ("Expend Use"), and the engine itself applies the `effectId` effect to the grappled creature
 *   (runtime/swallow.mjs); `targetMaxSize`: the size of what it swallows.
 */
export function swallowOf(item) {
  if ( !item || (contentOf(item).entry?.swallow !== true) ) return null;
  const effectIds = new Set(item.effects.filter(isSwallowedEffectData).map(e => e.id));
  if ( !effectIds.size ) return null;
  const activities = item.system.activities?.contents ?? [];
  const posesSwallow = a => (a.effects ?? []).some(ref => effectIds.has(ref._id ?? effectOfProfile(ref, item)?.id));
  const poses = activities.find(posesSwallow) ?? null;
  // Giant Toad (MM 2.x): its three activities are "Damage: Swallowed", "Escape Corpse" and "Expend Use" — none
  // links the "swallowed" effect. The item's effectless action stands in as the entry.
  const entry = poses ?? activities.find(a => (a.type === "utility") && ["action", "bonus"].includes(a.activation?.type)
    && !(a.effects ?? []).length) ?? null;
  const text = readSwallow(englishDescription(item));
  return {
    item, effectIds, entry, entryPoses: !!poses, effectId: Array.from(effectIds)[0],
    damage: activities.find(a => (a.type === "damage") && !posesSwallow(a)) ?? null,
    regurgitate: activities.find(a => (a.type === "save") && !posesSwallow(a) && a.save?.dc?.value) ?? null,
    escape: activities.find(a => a.type === "check") ?? null,
    ...text,
    // The size of what it swallows: the text (Toad), otherwise the activity's target ("Small or smaller", translated by Babele).
    targetMaxSize: text.targetMaxSize ?? sizeLimit(entry?.target?.affects?.special),
    // §18.21: "one Large or smaller creature Grappled by the behir" — the activity's target says it, not the text.
    // Translated by Babele in a French world ("… agrippée par le béhir").
    grappling: text.grappling || /\bGrappled\b|agripp/i.test(entry?.target?.affects?.special ?? "")
  };
}

/** L'item d'avalement d'un acteur, s'il en a un. */
export function swallowItemOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = swallowOf(item);
    if ( rule ) return rule;
  }
  return null;
}

/** Does this effect make its creature swallowed? Returns the item and the swallowing actor, or null. */
export function swallowedBy(effect) {
  if ( !effect?.active ) return null;
  const item = originItemOf(effect);
  const rule = swallowOf(item);
  if ( !rule || !isSwallowedEffectData(effect) ) return null;
  return { rule, swallower: item.actor ?? null };
}


/**
 * The swallowing token of a "swallowed" effect: the one named by the effect's origin ("Scene.<id>.Token.<id>.Actor…" — several
 * unlinked tokens share one base actor: three Zombies in `dnd-6`), otherwise the first token of the actor in the scene.
 */
export function swallowerTokenFor(effect, by, scene) {
  const origin = String(effect.system?.origin?.activity ?? effect.system?.origin?.item ?? effect.origin ?? "");
  const m = origin.match(/Scene\.([A-Za-z0-9]{16})\.Token\.([A-Za-z0-9]{16})/);
  const named = m ? game.scenes.get(m[1])?.tokens.get(m[2]) : null;
  if ( named ) return named;
  return by?.swallower?.getActiveTokens?.(false, true)?.find(t => t.parent === scene) ?? null;
}

/** The creatures a swallowing token has in its belly: [{ token, effect }]. */
export function swallowedIn(swallowerToken) {
  const out = [];
  for ( const token of swallowerToken?.parent?.tokens ?? [] ) {
    if ( token === swallowerToken ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      const by = swallowedBy(effect);
      if ( by && (swallowerTokenFor(effect, by, token.parent) === swallowerToken) ) out.push({ token, effect });
    }
  }
  return out;
}

/** The swallower of a swallowed token, in its scene: { token, effect, rule } or null. */
export function swallowerOf(token) {
  for ( const effect of token?.actor?.effects ?? [] ) {
    const by = swallowedBy(effect);
    if ( !by?.swallower ) continue;
    const swallowerToken = swallowerTokenFor(effect, by, token.parent);
    if ( swallowerToken ) return { token: swallowerToken, effect, rule: by.rule };
  }
  return null;
}

/** The swallowed token and its effect, for an effect that has just been applied. */
export function swallowedTokenOf(effect) {
  const actor = actorOfEffect(effect);
  if ( !actor ) return null;
  return effect.parent?.documentName === "ActorDelta" ? effect.parent.parent : (actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null);
}

/**
 * Places the swallowed creature at the center of the swallower's space (a `displace` step: no Opportunity Attack either).
 * The cell is occupied by the swallower: dnd5e, with "full" movement automation, refuses to end there when they are enemies —
 * `ignoreTokens`, a dnd5e constraint option (canvas/token.mjs:92)
 * that the core passes on (`constrainOptions`, documents/token.mjs:1723).
 */
export async function placeInside(token, swallowerToken) {
  const grid = token.parent.grid;
  const s = committedPosition(swallowerToken);
  const x = s.x + (((swallowerToken.width - token.width) / 2) * grid.sizeX);
  const y = s.y + (((swallowerToken.height - token.height) / 2) * grid.sizeY);
  await token.move([{ x, y, elevation: s.elevation ?? 0, level: s.level, snapped: false, action: "displace" }],
    { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true, dragged: true } });
}

/** Makes the swallowed follow when the swallower walks (same offset). */
export async function carrySwallowed(swallowerToken, dx, dy, dz) {
  for ( const { token } of swallowedIn(swallowerToken) ) {
    const p = committedPosition(token);
    await token.move([{ x: p.x + dx, y: p.y + dy, elevation: (p.elevation ?? 0) + dz, level: committedPosition(swallowerToken).level,
      snapped: false, action: "displace" }], { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true, dragged: true } });
  }
}

/** Releases a swallowed creature: "swallowed" effect removed, placed on a free cell in contact with the swallower, Prone. */
/** The "swallowed" effects the engine removes itself (release): their removal does not trigger the exit again. */
export const releasing = new Set();

/**
 * Releases a swallowed creature: "swallowed" effect removed, placed on a free cell in contact with the swallower; Prone after a
 * regurgitation, a death or a spitting out, not after an escape ("escapes and enters the nearest unoccupied space").
 */
export async function release(token, effect, swallowerToken, { prone=true }={}) {
  if ( effect ) releasing.add(effect.uuid);
  try { if ( effect?.parent?.effects?.has?.(effect.id) ) await effect.delete(); }
  finally { if ( effect ) releasing.delete(effect.uuid); }
  await moveOut(token, swallowerToken);
  if ( prone ) await token.actor?.toggleStatusEffect("prone", { active: true });
}

/** Moves a token out of the swallower's space, onto the nearest free cell in contact (if it is still there). */
export async function moveOut(token, swallowerToken) {
  if ( !swallowerToken || !overlaps(token, swallowerToken) ) return;
  const spot = swallowerToken ? dragDestination(token, swallowerToken, { x: committedPosition(swallowerToken).x - (token.width * token.parent.grid.sizeX), y: committedPosition(swallowerToken).y }) : null;
  if ( spot ) {
    await token.move([{ x: spot.x, y: spot.y, elevation: committedPosition(swallowerToken).elevation ?? 0, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true, dragged: true } });
  }
}

/** Pixel rectangle of a token at its validated position. */
export function footprint(token, position=committedPosition(token)) {
  const grid = token.parent.grid;
  return { x: position.x, y: position.y, w: token.width * grid.sizeX, h: token.height * grid.sizeY };
}

function overlaps(a, b) {
  const p = footprint(a), q = footprint(b);
  return (p.x < q.x + q.w - 1e-6) && (q.x < p.x + p.w - 1e-6) && (p.y < q.y + q.h - 1e-6) && (q.y < p.y + p.h - 1e-6);
}

/** Le nom anglais d'un item (Babele garde l'original). */
export const englishNameOf = item => String(item?.flags?.babele?.originalName ?? item?.name ?? "");
