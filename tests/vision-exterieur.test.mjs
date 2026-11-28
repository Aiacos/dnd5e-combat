import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { grantInMemoryModes, DEVILS_SIGHT_MODE, HEARING_MODE, SENSE_MODE } from "../module/scripts/core/light.mjs";

/**
 * Issue #42, continued (Archibald, 0.281.0): from OUTSIDE the Darkness, the warlock with Devil's Sight saw only the
 * outline of hearing and their targeting was refused.
 */
describe("issue #42: modes given in memory after a token preparation", () => {
  it("puts them back when the preparation erased them, and reports it", () => {
    const modes = { basicSight: { enabled: true, range: 60 }, lightPerception: { enabled: true, range: null } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(modes[DEVILS_SIGHT_MODE]).toEqual({ enabled: true, range: 36 });
    expect(modes[HEARING_MODE]).toEqual({ enabled: true, range: Infinity });
  });

  it("repairs the mode left without \"enabled\" by a token.detectionModes.devilsSight.range effect", () => {
    const modes = { basicSight: { enabled: true, range: 18 }, devilsSight: { range: 36 } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(modes.devilsSight.enabled).toBe(true);
  });

  it("reports nothing when everything is already there (no view redone for nothing)", () => {
    const modes = { basicSight: { enabled: true }, [DEVILS_SIGHT_MODE]: { enabled: true, range: 36 }, [HEARING_MODE]: { enabled: true, range: Infinity } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(false);
  });

  it("hearing stays the last mode, after Devil's Sight", () => {
    const modes = { [HEARING_MODE]: { enabled: true, range: Infinity }, basicSight: { enabled: true } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(Object.keys(modes).at(-1)).toBe(HEARING_MODE);
  });

  it("the mode of declared senses: given to whoever has one, before hearing, removed when none remain", () => {
    const modes = { basicSight: { enabled: true }, [HEARING_MODE]: { enabled: true, range: Infinity } };
    expect(grantInMemoryModes(modes, { sense: true, hearing: true })).toBe(true);
    expect(modes[SENSE_MODE]).toEqual({ enabled: true, range: Infinity });
    expect(Object.keys(modes).at(-1)).toBe(HEARING_MODE);
    expect(grantInMemoryModes(modes, { sense: true, hearing: true })).toBe(false);
    expect(grantInMemoryModes(modes, { hearing: true })).toBe(true);
    expect(modes[SENSE_MODE]).toBeUndefined();
  });

  it("removes Devil's Sight when the summon is no longer there", () => {
    const modes = { [DEVILS_SIGHT_MODE]: { enabled: true, range: 36 } };
    expect(grantInMemoryModes(modes, { devilsSight: 0 })).toBe(true);
    expect(modes[DEVILS_SIGHT_MODE]).toBeUndefined();
  });
});

describe("issue #42: the targeting line of sight ignores the edges of the Darkness", () => {
  // Seeing the target is `canSee`'s business; these "line of sight" tests must count only walls and floors.
  const files = ["module/scripts/runtime/actions.mjs", "module/scripts/adapter/movement.mjs"];
  for ( const file of files ) {
    it(`${file} : chaque hasLineOfSight passe throughDarkness`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const calls = source.split("\n").filter(line => line.includes("hasLineOfSight(") && !line.trim().startsWith("import"));
      expect(calls.length).toBeGreaterThan(0);
      for ( const line of calls ) expect(line).toContain("throughDarkness: true");
    });
  }
});
