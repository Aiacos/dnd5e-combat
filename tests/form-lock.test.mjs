/** B09 (§488): form lock carried by an item (`formLock: { worn: true }`) and suspended traits (`suspends`). Synthetic examples. */
import { describe, it, expect } from "vitest";
import { validateFormLock, validateSuspends, wornFormLock, isWorn, isFormAttempt } from "../module/scripts/core/form-lock.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { actionSound, CORE_SOUNDS } from "../module/scripts/core/action-feedback.mjs";

// An invented collar: it prevents its bearer from changing form and from regenerating.
const COLLAR = {
  formLock: { worn: true, forms: ["shape-shift"], onAttempt: [{ type: "damage", to: "bearer", formula: "1", damageType: "piercing" }] },
  suspends: ["regeneration"]
};

describe("Worn form lock (B09)", () => {
  it("validates the entry of a worn item, and keeps the area of §403", () => {
    expect(validateEntry(COLLAR)).toEqual([]);
    expect(validateEntry({ formLock: true })).toEqual([]);
    expect(validateEntry({ formLock: { worn: true } })).toEqual([]);
    expect(validateEntry({ formLock: { worn: true, onAttempt: [{ type: "damage", activity: "abcdefghijklmnop" }] } })).toEqual([]);
  });

  it("refuses a badly written form", () => {
    expect(validateFormLock(false).length).toBe(1);
    expect(validateFormLock({ onAttempt: [] }).length).toBeGreaterThan(0);   // worn manquant, liste vide
    expect(validateFormLock({ worn: true, forms: [] })).toEqual(["formLock.forms: non-empty list of item identifiers"]);
    expect(validateFormLock({ worn: true, onAttempt: [{ type: "status", status: "prone" }] }).some(e => e.includes(".type"))).toBe(true);
    expect(validateFormLock({ worn: true, onAttempt: [{ type: "damage", to: "source", formula: "1", damageType: "piercing" }] }).some(e => e.includes(".to"))).toBe(true);
    expect(validateFormLock({ worn: true, onAttempt: [{ type: "damage", formula: "1", damageType: "silvery" }] }, ["piercing"]).some(e => e.includes("unknown"))).toBe(true);
    expect(validateFormLock({ worn: true, lock: 1 }).some(e => e.includes("unknown key"))).toBe(true);
    expect(validateEntry({ formLock: "yes" }).length).toBe(1);
  });

  it("validates `suspends`: a list of known traits, without duplicates", () => {
    expect(validateSuspends(["regeneration"])).toEqual([]);
    expect(validateSuspends([]).length).toBe(1);
    expect(validateSuspends(["flight"]).length).toBe(1);
    expect(validateSuspends(["regeneration", "regeneration"]).length).toBe(1);
    expect(validateEntry({ suspends: "regeneration" }).length).toBe(1);
  });

  it("normalizes the worn lock; the area is not one", () => {
    expect(wornFormLock(COLLAR)).toEqual({ onAttempt: COLLAR.formLock.onAttempt, forms: ["shape-shift"] });
    expect(wornFormLock({ formLock: { worn: true } })).toEqual({ onAttempt: [], forms: [] });
    expect(wornFormLock({ formLock: true })).toBeNull();
    expect(wornFormLock({})).toBeNull();
    expect(wornFormLock(null)).toBeNull();
  });

  it("worn: equipped if it can be equipped, present otherwise", () => {
    expect(isWorn({ equippable: true, equipped: true })).toBe(true);
    expect(isWorn({ equippable: true, equipped: false })).toBe(false);
    expect(isWorn({ equippable: false })).toBe(true);
  });

  it("recognizes an attempt to change form", () => {
    expect(isFormAttempt({ type: "transform" })).toBe(true);
    expect(isFormAttempt({ type: "utility", declaredChange: true })).toBe(true);
    expect(isFormAttempt({ type: "utility", identifier: "shape-shift" }, ["shape-shift"])).toBe(true);
    expect(isFormAttempt({ type: "utility", identifier: "shape-shift" })).toBe(false);
    expect(isFormAttempt({ type: "attack", identifier: "bite" }, ["shape-shift"])).toBe(false);
  });

  it("la table entend le collier se serrer", () => {
    expect(actionSound("formLock", "failure")).toBe(CORE_SOUNDS.rattle);
  });
});
