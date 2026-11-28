/**
 * §220: the "Theater of the Mind" state — all of the engine's automations switched off (runtime/theater.mjs). In a separate file,
 * without imports: the router reads it on every hook (runtime/router.mjs), and the router is imported by almost all the engine.
 */

let active = false;

/** Is Theater of the Mind active (automations switched off)? */
export const theaterActive = () => active;

/** Held by runtime/theater.mjs, from the world setting. */
export function setTheaterState(on) {
  active = !!on;
}
