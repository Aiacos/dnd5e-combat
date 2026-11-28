import { describe, it, expect } from "vitest";
import { validateEntry, METAMAGIC_KINDS } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§32 Sorcerer: schema and content", () => {
  it("the metamagic key", () => {
    expect(validateEntry({ metamagic: { activity: "leFbHb9SZwDix2TU", kind: "quickened" } })).toEqual([]);
    expect(validateEntry({ metamagic: { activity: "leFbHb9SZwDix2TU", kind: "empowered" } }))
      .toEqual([`metamagic: { activity, kind: ${METAMAGIC_KINDS.join(" | ")} }`]);
  });
  it("the shipped Metamagic options", () => {
    expect(["quickened-spell", "careful-spell", "heightened-spell", "distant-spell", "subtle-spell"].map(id => CONTENT[id].metamagic.kind))
      .toEqual(["quickened", "careful", "heightened", "distant", "subtle"]);
  });
  it("Innate Sorcery, Elemental Affinity, Psychic Defenses", () => {
    expect(CONTENT["innate-sorcery"].triggers[0].if).toMatchObject({ "source.hasEffect": "innate-sorcery", "activity.classSpell": "sorcerer" });
    expect(CONTENT["elemental-affinity"].triggers.map(t => t.if["source.resists"])).toEqual(["acid", "cold", "fire", "lightning", "poison"]);
    expect(CONTENT["psychic-defenses"].saveAdvantage).toEqual(["charmed", "frightened"]);
  });
});
