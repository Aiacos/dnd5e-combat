import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Antipathy/Sympathy (SRD 5.2): one or the other, at the caster's choice", () => {
  it("the two marks of the \"Cast\" activity are mutually exclusive", () => {
    expect(CONTENT["antipathy-sympathy"].choice).toEqual({ effects: "one" });
    expect(validateEntry(CONTENT["antipathy-sympathy"])).toEqual([]);
  });
});
