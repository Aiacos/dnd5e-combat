import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

const pull = extra => ({ triggers: [{ on: "hit", do: [{ type: "move", mode: "pull", distance: 30, units: "ft", ...extra }] }] });

describe("§502 (B22): pull toward the summon, a single grappled creature", () => {
  it("move { mode: \"pull\", toward: \"summon\" }", () => {
    expect(validateEntry(pull({ toward: "summon" }))).toEqual([]);
    expect(validateEntry(pull({ toward: "area" }))).toEqual([]);
    expect(validateEntry(pull({ toward: "caster" }))).toEqual([expect.stringContaining("toward")]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "move", mode: "push", distance: 10, units: "ft", toward: "summon" }] }] }))
      .toEqual([expect.stringContaining("toward")]);
  });
  it("grapples: { one?: true, by?: \"summon\" }", () => {
    expect(validateEntry({ grapples: { one: true } })).toEqual([]);
    expect(validateEntry({ grapples: { one: true, by: "summon" } })).toEqual([]);
    expect(validateEntry({ grapples: {} })).toEqual([expect.stringContaining("grapples")]);
    expect(validateEntry({ grapples: { one: false } })).toEqual([expect.stringContaining("grapples.one")]);
    expect(validateEntry({ grapples: { by: "caster" } })).toEqual([expect.stringContaining("grapples.by")]);
    expect(validateEntry({ grapples: { one: true, max: 2 } })).toEqual([expect.stringContaining("unknown key")]);
    expect(mergeEntries([{ grapples: { one: true } }, { grapples: { by: "summon" } }]).grapples).toEqual({ one: true, by: "summon" });
  });
  it("the released creature is heard", () => {
    expect(actionSound("grappleReleased", "success")).toBeTruthy();
  });
});
