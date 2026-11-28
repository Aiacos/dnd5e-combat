import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Sense Magic (Chuul, SRD 5.2): the sense of Detect Magic, permanent, at 36 m", () => {
  it("same sense as the spell, without an effect to carry or school of magic", () => {
    const { sense } = CONTENT["sense-magic"];
    const spell = CONTENT["detect-magic"].sense;
    expect(sense).toEqual({ kind: "locate", range: 120, units: "ft", reveals: "aura", detects: { "target.carriesMagic": true } });
    expect(sense.detects).toEqual(spell.detects);
    expect(sense.reveals).toBe(spell.reveals);
    expect(sense.via).toBeUndefined();
    expect(sense.magic).toBeUndefined();
    expect(validateEntry(CONTENT["sense-magic"], { facts: { "target.carriesMagic": true } })).toEqual([]);
  });
});
