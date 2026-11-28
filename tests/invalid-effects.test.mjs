/**
 * Issue #112: a sheet whose only problem is an effect that fails to initialize (a type from a module that is gone) was never
 * listed by the diagnostic, and the core kept logging the error. The condition that now lists it.
 */
import { describe, it, expect } from "vitest";
import { invalidEffectIds, hasInvalidEffects } from "../module/scripts/core/invalid-effects.mjs";

const effects = (...ids) => ({ invalidDocumentIds: new Set(ids) });

describe("effects that failed to initialize (issue #112)", () => {
  it("reads the invalid ids of a document, none when the collection has no such set", () => {
    expect(invalidEffectIds({ effects: effects("a", "b") })).toEqual(["a", "b"]);
    expect(invalidEffectIds({ effects: effects() })).toEqual([]);
    expect(invalidEffectIds({ effects: {} })).toEqual([]);
    expect(invalidEffectIds({})).toEqual([]);
    expect(invalidEffectIds(null)).toEqual([]);
  });

  it("lists a sheet for an invalid effect on the actor itself", () => {
    expect(hasInvalidEffects({ effects: effects("x"), items: [] })).toBe(true);
  });

  it("lists a sheet for an invalid effect on one of its items", () => {
    const items = [{ effects: effects() }, { effects: effects("y") }];
    expect(hasInvalidEffects({ effects: effects(), items })).toBe(true);
    expect(hasInvalidEffects({ effects: effects(), items: new Map([["i", items[1]]]).values() })).toBe(true);
  });

  it("does not list a sheet with no invalid effect, nor a missing one", () => {
    expect(hasInvalidEffects({ effects: effects(), items: [{ effects: effects() }, {}] })).toBe(false);
    expect(hasInvalidEffects({})).toBe(false);
    expect(hasInvalidEffects(null)).toBe(false);
  });
});
