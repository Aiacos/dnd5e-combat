/**
 * §251: the real-time clock — outside combat, world time advances one second per real second, so that the durations the
 * engine and its neighbors count in world time elapse (areas, summons, Wild Shape, torches, burning oil, search delays,
 * traps that reset…). Foundry's core only advances time in combat (6 s per round); outside combat, without a calendar
 * module, it stays frozen.
 *
 * Pure: no dependency on Foundry.
 */

/** The modules that already run the world clock: active, the engine's clock steps aside (otherwise time would advance twice). */
export const CLOCK_MODULES = Object.freeze([
  "simple-timekeeping", "foundryvtt-simple-calendar", "foundryvtt-simple-calendar-reborn", "calendaria", "about-time"
]);

/** The advance step, in seconds: one round. Finer, each step would be a server write and an `updateWorldTime` for everyone. */
export const CLOCK_STEP_SECONDS = 6;

/** Beyond it, a real gap is not play (sleeping tab, machine on standby): only one step is counted. */
export const CLOCK_MAX_GAP_SECONDS = 60;

/**
 * Why the clock is not running right now (null: it is running).
 * @param {{ enabled: boolean, executor: boolean, rival: string|null, paused: boolean, inCombat: boolean }} state
 * @returns {"off"|"notExecutor"|"rival"|"paused"|"combat"|null}
 */
export function clockHalt({ enabled, executor, rival, paused, inCombat }) {
  if ( !enabled ) return "off";
  if ( !executor ) return "notExecutor";
  if ( rival ) return "rival";
  if ( paused ) return "paused";
  if ( inCombat ) return "combat";
  return null;
}

/**
 * What to advance now, in seconds of world time, and the real time now counted.
 * @param {number|null} counted  Real milliseconds already counted (null: the clock has just restarted — we start from now).
 * @param {number} now           Real milliseconds.
 * @returns {{ advance: number, counted: number }}  `advance` is a whole multiple of seconds; the rest waits for the next step.
 */
export function clockTick(counted, now) {
  if ( !Number.isFinite(counted) || (now < counted) ) return { advance: 0, counted: now };
  const elapsed = Math.floor((now - counted) / 1000);
  if ( elapsed < CLOCK_STEP_SECONDS ) return { advance: 0, counted };
  if ( elapsed > CLOCK_MAX_GAP_SECONDS ) return { advance: CLOCK_STEP_SECONDS, counted: now };
  return { advance: elapsed, counted: counted + (elapsed * 1000) };
}

/** The first active clock module among the given ids (`isActive(id)`), or null. */
export const rivalClock = isActive => CLOCK_MODULES.find(id => isActive(id)) ?? null;
