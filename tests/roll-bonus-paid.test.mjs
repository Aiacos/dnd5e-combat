import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

const v = entry => validateEntry(entry, { facts: {} });

describe("§280: reroll paid for by an activity, refund of a check that is still missed", () => {
  it("reroll of a failed save, paid for by the activity (optional bonus)", () => {
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: {} } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: { bonus: "2" }, abilities: ["str", "dex", "con"] } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: { bonus: "2", during: "rage" } } })[0]).toMatch(/rollBonus/);
  });

  it("the form without an activity stays that of Fanatical Focus", () => {
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } } })).toEqual([]);
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "2" } } })[0]).toMatch(/rollBonus/);
  });

  it("failRefund: only with an activity, neither reroll nor luck", () => {
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["check"], abilities: ["str", "cha"], failRefund: true } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["check"], luck: true, failRefund: true } })[0]).toMatch(/rollBonus/);
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "2", during: "rage" }, failRefund: true } })[0]).toMatch(/rollBonus/);
  });
});
