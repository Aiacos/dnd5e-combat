import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Perception de la magie (Chuul, SRD 5.2) : le sens de Détection de la magie, permanent, à 36 m", () => {
  it("même sens que le sort, sans effet à porter ni école de magie", () => {
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
