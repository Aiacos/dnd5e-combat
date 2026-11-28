/**
 * Step of the Wind (Monk, SRD 5.2): "Dash as a Bonus Action; or, for 1 Focus Point, Disengage and Dash, and the jump distance
 * is doubled". The activity `0MuRZ0Ur95xQTKFq` is the paid version in the Player's Handbook 2.2.0 and the free version in
 * the SRD 5.2: seen in play with the SRD item, the free version gave Dash, Disengage and the doubled jump.
 */
import { describe, it, expect } from "vitest";
import { basicKindsFor, hasPaidForm } from "../module/scripts/core/basic-kinds.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("basicKindsFor — the paid or free form of a declaration", () => {
  const step = { paid: ["dash", "disengage"], free: "dash" };
  it("paid if the activity spends, free otherwise", () => {
    expect(basicKindsFor(step, true)).toEqual(["dash", "disengage"]);
    expect(basicKindsFor(step, false)).toBe("dash");
  });
  it("an absent form: nothing for this use", () => {
    expect(basicKindsFor({ paid: "dash" }, false)).toBeNull();
    expect(basicKindsFor({ free: "dash" }, true)).toBeNull();
  });
  it("a declaration without these forms passes as is, whether it spends or not", () => {
    for ( const declared of ["hide", ["disengage", "dodge"], { choose: ["dash", "disengage"] }] ) {
      expect(basicKindsFor(declared, true)).toBe(declared);
      expect(basicKindsFor(declared, false)).toBe(declared);
      expect(hasPaidForm(declared)).toBe(false);
    }
    expect(basicKindsFor(undefined, true)).toBeNull();
    expect(hasPaidForm(step)).toBe(true);
  });
});

describe("the schema and the content", () => {
  const entry = kind => ({ basicActions: { "0MuRZ0Ur95xQTKFq": kind } });
  it("`{ paid, free }`: a kind or a list for each", () => {
    expect(validateEntry(entry({ paid: ["dash", "disengage"], free: "dash" }))).toEqual([]);
    expect(validateEntry(entry({ free: "dash" }))).toEqual([]);
    expect(validateEntry(entry({ paid: ["dash", "fly"] })).length).toBe(1);
    expect(validateEntry(entry({ paid: "dash", other: "hide" })).length).toBe(1);
  });
  it("Step of the Wind: paid, Dash and Disengage; free, Dash alone", () => {
    const declared = CONTENT["monks-focus"].basicActions["0MuRZ0Ur95xQTKFq"];
    expect(basicKindsFor(declared, true)).toEqual(["dash", "disengage"]);
    expect(basicKindsFor(declared, false)).toBe("dash");
    // The paid activity of the SRD 5.2 and of Handbook 3.0.0, distinct: unchanged.
    expect(CONTENT["monks-focus"].basicActions.Iv2YrISquTZWEjjN).toEqual(["dash", "disengage"]);
  });
});
