/**
 * What, in an area, only applies from a turn of its caster (`fromPulse`). Storm of Vengeance (SRD 5.2): Difficult Terrain and
 * no visibility are "turns 5 to 10", like the ban on ranged attacks — they applied from placement.
 */
import { describe, it, expect } from "vitest";
import { fromPulseReached } from "../module/scripts/core/area.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("fromPulseReached", () => {
  it("no rule: no; without `fromPulse`: from placement", () => {
    expect(fromPulseReached(undefined, 3)).toBe(false);
    expect(fromPulseReached(null, 3)).toBe(false);
    expect(fromPulseReached(true, 0)).toBe(true);
    expect(fromPulseReached({}, undefined)).toBe(true);
    expect(fromPulseReached({ types: ["plants"] }, 0)).toBe(true);
  });
  it("`fromPulse: 4`: not on the first three replays, then yes", () => {
    for ( const pulses of [undefined, 0, 1, 2, 3] ) expect(fromPulseReached({ fromPulse: 4 }, pulses), String(pulses)).toBe(false);
    for ( const pulses of [4, 5, 9] ) expect(fromPulseReached({ fromPulse: 4 }, pulses), String(pulses)).toBe(true);
  });
});

describe("the schema", () => {
  it("`obscures` : true ou { fromPulse }", () => {
    expect(validateEntry({ obscures: true })).toEqual([]);
    expect(validateEntry({ obscures: { fromPulse: 4 } })).toEqual([]);
    for ( const bad of [false, {}, { fromPulse: 0 }, { fromPulse: 1.5 }, { fromPulse: 4, extra: 1 }] ) {
      expect(validateEntry({ obscures: bad }), JSON.stringify(bad)).toEqual(["obscures: true or { fromPulse }"]);
    }
  });
  it("`difficultTerrain.fromPulse` : un entier positif", () => {
    expect(validateEntry({ difficultTerrain: { fromPulse: 4 } })).toEqual([]);
    expect(validateEntry({ difficultTerrain: { fromPulse: 0 } })).toEqual(["difficultTerrain.fromPulse: a positive integer"]);
  });
});
