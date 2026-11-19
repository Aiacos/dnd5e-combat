import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan, planIsEmpty } from "../module/scripts/core/data-fixes.mjs";

const plan = (ident, system) => dataFixPlan({ system, effects: [] }, CONTENT[ident].dataFixes);

describe("données de sorts du Manuel des joueurs corrigées (dataFixes)", () => {
  it("Invocation de céleste : la Lumière curative ajoute le modificateur d'incantation", () => {
    const id = "ke8eykrnAdAq5nfZ";
    const heal = bonus => ({ activities: { [id]: { _id: id, healing: { number: 4, denomination: "12", bonus } } } });
    expect(plan("conjure-celestial", heal("")).item).toEqual({ "system.activities.ke8eykrnAdAq5nfZ.healing.bonus": "@mod" });
    expect(planIsEmpty(plan("conjure-celestial", heal("@mod")))).toBe(true);
    // Un bonus saisi à la main n'est pas écrasé ; un sort d'une autre source (pas cette activité) non plus.
    expect(planIsEmpty(plan("conjure-celestial", heal("5")))).toBe(true);
    expect(planIsEmpty(plan("conjure-celestial", { activities: {} }))).toBe(true);
  });

  it("Rappel à la vie : portée « contact », pas « soi-même »", () => {
    expect(plan("raise-dead", { range: { units: "self", special: "" } }).item).toEqual({ "system.range.units": "touch" });
    expect(planIsEmpty(plan("raise-dead", { range: { units: "touch", special: "" } }))).toBe(true);
    expect(planIsEmpty(plan("raise-dead", { range: { units: "ft", value: "30" } }))).toBe(true);
  });

  it("Interdiction : la propriété « rituel »", () => {
    expect(plan("forbiddance", { properties: ["vocal", "somatic", "material"] }).item)
      .toEqual({ "system.properties": ["vocal", "somatic", "material", "ritual"] });
    expect(planIsEmpty(plan("forbiddance", { properties: ["vocal", "somatic", "material", "ritual"] }))).toBe(true);
    // Une liste déjà modifiée (un sort rendu sans composante matérielle, par exemple) reste telle quelle.
    expect(planIsEmpty(plan("forbiddance", { properties: ["vocal", "somatic"] }))).toBe(true);
  });
  /** Une activité de sauvegarde à dégâts, comme la donnée la porte : `damage.onSave` et ses parts. */
  const save = (id, onSave) => ({ activities: {
    [id]: { _id: id, type: "save", damage: { onSave, parts: [{ number: 3, denomination: 6 }] } } } });
  for ( const [ident, id] of [["conjure-animals", "dnd5eactivity100"], ["dream", "dnd5eactivity000"]] ) {
    it(`${ident} : aucun dégât sur une sauvegarde réussie`, () => {
      expect(plan(ident, save(id, "half")).item).toEqual({ [`system.activities.${id}.damage.onSave`]: "none" });
      // Déjà juste, réglé à la main sur « full », ou un sort d'une autre source (pas cette activité) : rien ne bouge.
      expect(planIsEmpty(plan(ident, save(id, "none")))).toBe(true);
      expect(planIsEmpty(plan(ident, save(id, "full")))).toBe(true);
      expect(planIsEmpty(plan(ident, save("autreActivite000", "half")))).toBe(true);
    });
  }
});
