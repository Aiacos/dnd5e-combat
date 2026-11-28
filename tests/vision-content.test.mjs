import { describe, it, expect } from "vitest";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * Issue #42: the content declarations that sight and hearing depend on (adapter/vision.mjs `blockingRegions`,
 * adapter/hearing.mjs) — an area that obscures, magical Darkness, a silence. Changing one of them changes what each creature
 * sees and hears.
 */
describe("issue #42: areas that cut off sight or sound", () => {
  it("Fog Cloud obscures (mist), Darkness is magical Darkness", () => {
    expect(SHIPPED["fog-cloud"]?.obscures).toBe(true);
    expect(SHIPPED["darkness"]?.light?.darkness).toBe(true);
  });
  it("Silence makes silence and carries its effects in the area (Deafened)", () => {
    expect(SHIPPED["silence"]?.silences).toBe(true);
    expect(SHIPPED["silence"]?.zoneEffects).toBe(true);
  });
  it("an area that obscures does not make silence, nor does Darkness", () => {
    expect(SHIPPED["fog-cloud"]?.silences).toBeUndefined();
    expect(SHIPPED["darkness"]?.silences).toBeUndefined();
  });
});
