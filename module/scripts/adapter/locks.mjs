/**
 * §244: a door's lock, read on the wall (flags `lock` and `lockTries`), and the key, searched in the actor's items.
 * A key is just an item: the engine does not know where it comes from.
 */

import { MODULE_ID } from "../constants.mjs";
import { normalizeLock, normalizeTries, isKey } from "../core/locks.mjs";

export const LOCK_FLAG = "lock";
export const LOCK_TRIES_FLAG = "lockTries";

const docOf = wall => wall?.document ?? wall;

/** A wall's lock (placeable or document). */
export function lockOf(wall) {
  return normalizeLock(docOf(wall)?.getFlag?.(MODULE_ID, LOCK_FLAG));
}

/** The attempts already made on this lock. */
export function triesOf(wall) {
  return normalizeTries(docOf(wall)?.getFlag?.(MODULE_ID, LOCK_TRIES_FLAG));
}

/** The actor's item that is the key to this lock, or null. */
export function keyItemFor(actor, lock) {
  if ( !lock?.key || !actor?.items ) return null;
  return actor.items.find(i => isKey({ name: i.name, identifier: i.system?.identifier }, lock.key)) ?? null;
}

/** The middle of a door, in scene coordinates (for the noise). */
export function doorPoint(wall) {
  const c = docOf(wall)?.c ?? [0, 0, 0, 0];
  return { x: (c[0] + c[2]) / 2, y: (c[1] + c[3]) / 2 };
}
