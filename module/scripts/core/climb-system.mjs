/**
 * §224: the state of the climbing and falling system — on, the engine aligns each move with the ground, makes creatures climb
 * and fall; off (GM button, world setting `climbSystem`), creatures move freely in height and each keeps its elevation
 * (runtime/climb-system.mjs). In a file with no imports, in the core: the A* (adapter/path-world.mjs), altitude, climbing and
 * falls read it.
 *
 * Pure: no dependency on Foundry.
 */

let on = true;

/** Is the climbing and falling system on? */
export const climbSystemOn = () => on;

/** Held by runtime/climb-system.mjs, from the world setting. */
export function setClimbSystemState(value) {
  on = value !== false;
}

/** What the system offers (menu entries, ledges): `make()` when on, nothing (without computing it) when it is off. */
export const whileClimbSystem = (make, active=on) => (active ? make() : []);
