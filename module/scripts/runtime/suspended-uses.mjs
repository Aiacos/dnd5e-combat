/**
 * The uses that a gate has suspended to ask its questions (runtime/gates.mjs: Sanctuary, Counterspell, pre-attack Reactions,
 * Portent) and that it will relaunch itself. `dnd5e.preUseActivity` then returns `false`: the caller of
 * `activity.use()` receives nothing, although the use is not refused. Whoever chains several uses (a spell's projectiles)
 * reads here the promise of the relaunch instead of concluding that nothing went out. No dependency on Foundry.
 */

const pending = new Map();
/** A decided relaunch stays readable for that long: the caller reads it just after `activity.use()` returns. */
const KEEP_MS = 2000;

/**
 * Registers the relaunch of a suspended use.
 * @param {string} key                 the activity's uuid
 * @param {Promise<{message?: object}|null|undefined>} relaunch  what the relaunch returns, or nothing if the use does not go out
 * @returns {Promise<{message: object}|null>}  the same, brought back to "a result with its card" or null
 */
export function suspendUse(key, relaunch) {
  const settled = Promise.resolve(relaunch).then(used => (used?.message ? used : null), () => null);
  pending.set(key, settled);
  settled.then(() => setTimeout(() => { if ( pending.get(key) === settled ) pending.delete(key); }, KEEP_MS));
  return settled;
}

/** This activity's relaunch in progress (or just decided), or null if no gate has suspended it. */
export function suspendedUse(key) {
  return pending.get(key) ?? null;
}
