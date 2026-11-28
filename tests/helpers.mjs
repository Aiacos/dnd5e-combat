/** Data shared by several tests (not a test file: Vitest reads only the `*.test.mjs`). */

/** A minimal resolution: identifiers of the carrying message, the origin, the activity and the source. */
export const RESOLUTION_BASE = Object.freeze({ id: "r", carrier: "M", origin: "M", activity: "Act", source: "Src" });
