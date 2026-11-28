import { describe, it, expect } from "vitest";
import { slotLeft, plainCost, resourceIssues, isShort } from "../module/scripts/core/resources.mjs";

// §410 (issue #44, batch 3): what a use is missing — judged before dnd5e, forceable.
const spells = {
  spell1: { value: 0, max: 2 }, spell2: { value: 0, max: 1 }, spell3: { value: 1, max: 1 },
  pact: { value: 0, max: 1, level: 2 }
};

describe("slotLeft", () => {
  it("un emplacement de ce niveau ou plus haut", () => {
    expect(slotLeft(spells, 1)).toBe(true);    // le 3e niveau reste
    expect(slotLeft(spells, 3)).toBe(true);
    expect(slotLeft(spells, 4)).toBe(false);
  });

  it("only the requested slot", () => {
    expect(slotLeft(spells, 1, "spell1")).toBe(false);
    expect(slotLeft(spells, 1, "spell3")).toBe(true);
  });

  it("the pact counts at its level", () => {
    const warlock = { spell1: { value: 0, max: 0 }, pact: { value: 1, max: 2, level: 3 } };
    expect(slotLeft(warlock, 1)).toBe(true);
    expect(slotLeft(warlock, 3)).toBe(true);
    expect(slotLeft(warlock, 4)).toBe(false);
    expect(slotLeft({ pact: { value: 0, max: 2, level: 3 } }, 1)).toBe(false);
  });

  it("sans fiche de sorts : rien", () => {
    expect(slotLeft(null, 1)).toBe(false);
  });
});

describe("costs and shortfalls", () => {
  it("a cost given as a formula counts as 1", () => {
    expect(plainCost("2")).toBe(2);
    expect(plainCost(3)).toBe(3);
    expect(plainCost("1d4")).toBe(1);
  });

  it("shortfall: positive cost above what remains", () => {
    expect(isShort({ cost: 1, available: 0 })).toBe(true);
    expect(isShort({ cost: 2, available: 1 })).toBe(true);
    expect(isShort({ cost: 1, available: 1 })).toBe(false);
    expect(isShort({ cost: 0, available: 0 })).toBe(false);
  });
});

describe("resourceIssues", () => {
  it("the reasons in order", () => {
    expect(resourceIssues({ slotMissing: true, usesShort: true, quantityShort: true, unprepared: true }))
      .toEqual(["noSlot", "noUses", "noQuantity", "unprepared"]);
    expect(resourceIssues({ usesShort: true })).toEqual(["noUses"]);
    expect(resourceIssues({})).toEqual([]);
  });
});

// Issue #144: unprepared smites were offered after a hit — the list (`smiteOptions`) did not look at the preparation,
// which the engine checked only at casting. A single rule for both.
describe("awaitsPreparation — a spell waiting to be prepared", () => {
  it("a method that is prepared, level 1 or more, not prepared: yes", async () => {
    const { awaitsPreparation } = await import("../module/scripts/core/resources.mjs");
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 0 })).toBe(true);
    expect(awaitsPreparation({ level: 3, prepares: true, prepared: false })).toBe(true);
  });
  it("prepared (1), always prepared (2), cantrip, a method that is not prepared: no", async () => {
    const { awaitsPreparation } = await import("../module/scripts/core/resources.mjs");
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 1 })).toBe(false);
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 2 })).toBe(false);
    expect(awaitsPreparation({ level: 0, prepares: true, prepared: 0 })).toBe(false);
    expect(awaitsPreparation({ level: 1, prepares: false, prepared: 0 })).toBe(false);
    expect(awaitsPreparation()).toBe(false);
  });
  it("the smite list and the casting use the same rule", async () => {
    const { readFileSync } = await import("node:fs");
    const read = path => readFileSync(new URL(`../module/scripts/adapter/${path}`, import.meta.url), "utf8");
    expect(read("smite.mjs")).toMatch(/if \( rule && unpreparedSpell\(item\) && [^\n]*cachedFor[^\n]* \) continue;/);
    expect(read("resources.mjs")).toContain("const unprepared = spell && !linked && unpreparedSpell(item) && !ritual;");
    // Issue #145: and what the sheet declares — the Reaction of an unprepared Shield was offered.
    expect(read("triggers.mjs")).toMatch(/if \( wornOrNotEquipment\(item\) && preparedOrNotSpell\(item\) \) out\.push\(/);
  });
});
