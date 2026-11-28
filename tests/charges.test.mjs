/**
 * Magic Item Use (Rogue, Thief 13 — SRD 5.2), Charges: 1d6 on each magic item property that spends
 * charges; on a 6, they are not spent.
 */
import { describe, it, expect } from "vitest";
import { spendsCharges, chargesKept } from "../module/scripts/core/charges.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("spendsCharges", () => {
  const use = (over={}) => ({ magical: true, consumable: false, usesMax: 3, recovers: true, itemId: "wand000000000000",
    targets: [{ type: "itemUses", target: "" }], ...over });
  it("a magic item whose activity consumes its own uses", () => {
    expect(spendsCharges(use())).toBe(true);
    expect(spendsCharges(use({ targets: [{ type: "itemUses", target: "wand000000000000" }] }))).toBe(true);
    expect(spendsCharges(use({ usesMax: 1 }))).toBe(true);
    expect(spendsCharges(use({ recovers: false }))).toBe(true);
  });
  it("not an ordinary item, not a consumable, not a single use without recovery", () => {
    expect(spendsCharges(use({ magical: false }))).toBe(false);
    expect(spendsCharges(use({ consumable: true }))).toBe(false);
    expect(spendsCharges(use({ usesMax: 1, recovers: false }))).toBe(false);
  });
  it("not when the activity consumes something else (a spell slot, the uses of another item)", () => {
    expect(spendsCharges(use({ targets: [] }))).toBe(false);
    expect(spendsCharges(use({ targets: [{ type: "itemUses", target: "other00000000000" }] }))).toBe(false);
    expect(spendsCharges(use({ targets: [{ type: "spellSlots", target: "1" }] }))).toBe(false);
  });
});

describe("chargesKept", () => {
  it("un 6 seulement", () => {
    const rule = { die: 6, on: 6 };
    expect(chargesKept(6, rule)).toBe(true);
    expect(chargesKept(5, rule)).toBe(false);
    expect(chargesKept(NaN, rule)).toBe(false);
  });
});

describe("the entry and the schema", () => {
  it("Utilisation d'objets magiques", () => {
    expect(CONTENT["use-magic-device"].savesCharges).toEqual({ die: 6, on: 6 });
    expect(validateEntry(CONTENT["use-magic-device"])).toEqual([]);
    expect(validateEntry({ savesCharges: { die: 6 } }).length).toBe(1);
    expect(validateEntry({ savesCharges: { die: 6, on: 7 } }).length).toBe(1);
  });
});
