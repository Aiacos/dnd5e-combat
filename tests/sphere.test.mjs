import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Otiluke's Resilient Sphere (§232)", () => {
  it("encloses and willingFails: true or absent, kept by the layer merge", () => {
    expect(validateEntry({ encloses: true, willingFails: true })).toEqual([]);
    expect(validateEntry({ encloses: 1 }).length).toBe(1);
    expect(validateEntry({ willingFails: "oui" }).length).toBe(1);
    expect(mergeEntries([{ encloses: true }, { willingFails: true }])).toEqual({ encloses: true, willingFails: true });
  });
  it("the shipped spell declares them", () => {
    expect(CONTENT["otilukes-resilient-sphere"]).toMatchObject({ encloses: true, willingFails: true });
  });
});
