import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan, planIsEmpty } from "../module/scripts/core/data-fixes.mjs";

const plan = (ident, system) => dataFixPlan({ system, effects: [] }, CONTENT[ident].dataFixes);

describe("Player's Handbook spell data corrected (dataFixes)", () => {
  it("Summon Celestial: Healing Light adds the spellcasting modifier", () => {
    const id = "ke8eykrnAdAq5nfZ";
    const heal = bonus => ({ activities: { [id]: { _id: id, healing: { number: 4, denomination: "12", bonus } } } });
    expect(plan("conjure-celestial", heal("")).item).toEqual({ "system.activities.ke8eykrnAdAq5nfZ.healing.bonus": "@mod" });
    expect(planIsEmpty(plan("conjure-celestial", heal("@mod")))).toBe(true);
    // A hand-entered bonus is not overwritten; nor is a spell from another source (not this activity).
    expect(planIsEmpty(plan("conjure-celestial", heal("5")))).toBe(true);
    expect(planIsEmpty(plan("conjure-celestial", { activities: {} }))).toBe(true);
  });

  it("Raise Dead: range \"Touch\", not \"Self\"", () => {
    expect(plan("raise-dead", { range: { units: "self", special: "" } }).item).toEqual({ "system.range.units": "touch" });
    expect(planIsEmpty(plan("raise-dead", { range: { units: "touch", special: "" } }))).toBe(true);
    expect(planIsEmpty(plan("raise-dead", { range: { units: "ft", value: "30" } }))).toBe(true);
  });

  it("Forbiddance: the \"ritual\" property", () => {
    expect(plan("forbiddance", { properties: ["vocal", "somatic", "material"] }).item)
      .toEqual({ "system.properties": ["vocal", "somatic", "material", "ritual"] });
    expect(planIsEmpty(plan("forbiddance", { properties: ["vocal", "somatic", "material", "ritual"] }))).toBe(true);
    // A list already modified (a spell made without a material component, for example) stays as is.
    expect(planIsEmpty(plan("forbiddance", { properties: ["vocal", "somatic"] }))).toBe(true);
  });
  // Seen in play: the SRD's "Resilient Sphere" was cast without Concentration (its data does not have the property; the
  // Player's Handbook's does).
  it("Resilient Sphere: the \"concentration\" property, for the SRD data only", () => {
    for ( const ident of ["otilukes-resilient-sphere", "resilient-sphere"] ) {
      expect(plan(ident, { properties: ["vocal", "somatic", "material"] }).item, ident)
        .toEqual({ "system.properties": ["vocal", "somatic", "material", "concentration"] });
      expect(planIsEmpty(plan(ident, { properties: ["vocal", "somatic", "material", "concentration"] })), ident).toBe(true);
    }
  });
  /** A damaging save activity, as the data carries it: `damage.onSave` and its parts. */
  const save = (id, onSave) => ({ activities: {
    [id]: { _id: id, type: "save", damage: { onSave, parts: [{ number: 3, denomination: 6 }] } } } });
  for ( const [ident, id] of [["conjure-animals", "dnd5eactivity100"], ["dream", "dnd5eactivity000"]] ) {
    it(`${ident} : aucun dégât sur une sauvegarde réussie`, () => {
      expect(plan(ident, save(id, "half")).item).toEqual({ [`system.activities.${id}.damage.onSave`]: "none" });
      // Already right, set by hand to "full", or a spell from another source (not this activity): nothing moves.
      expect(planIsEmpty(plan(ident, save(id, "none")))).toBe(true);
      expect(planIsEmpty(plan(ident, save(id, "full")))).toBe(true);
      expect(planIsEmpty(plan(ident, save("autreActivite000", "half")))).toBe(true);
    });
  }
});
