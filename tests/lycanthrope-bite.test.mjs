import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../module/scripts/content/sources.mjs";

/** La malédiction d'un lycanthrope ne vise qu'un Humanoïde, et une sauvegarde réussie en immunise pour 24 heures. */
describe("Lycanthropes — la malédiction : un Humanoïde, et l'immunité de 24 heures après une sauvegarde réussie", () => {
  const BITES = { mmWerebear000000: "werebear", mmWererat0000000: "wererat", mmWeretiger00000: "weretiger",
    mmWerewolf000000: "werewolf" };
  const facts = { "target.creatureType": () => true, "target.hasMark": () => true };

  it("la Morsure de chaque lycanthrope a son identifiant propre, hors de « bite »", () => {
    for ( const [actor, kind] of Object.entries(BITES) ) {
      expect(SOURCE_IDENTIFIERS[`${actor}.mmBite0000000000`], actor).toBe(`mm-${kind}-bite`);
    }
    expect(SOURCE_IDENTIFIERS["mmWereboar000000.mmGore0000000000"]).toBe("mm-wereboar-gore");
  });

  it("l'entrée : les effets pour un Humanoïde sans la marque, la marque de 24 heures sur une sauvegarde réussie", () => {
    const entries = { ...Object.fromEntries(Object.values(BITES).map(k => [k, CONTENT[`mm-${k}-bite`]])),
      wereboar: CONTENT["mm-wereboar-gore"] };
    for ( const [kind, entry] of Object.entries(entries) ) {
      const mark = `immune:${kind}-curse`;
      expect(entry.effectsIf, kind).toEqual({ "target.creatureType": "humanoid", not: { "target.hasMark": mark } });
      expect(entry.triggers, kind).toEqual([{ on: "savedSave",
        do: [{ type: "mark", mark, label: "Marque.Immunite", seconds: 86400 }] }]);
      expect(validateEntry(entry, { facts }), kind).toEqual([]);
    }
  });

  it("une marque par espèce : réussir contre un Loup-garou n'immunise pas contre un Ours-garou", () => {
    const marks = ["werebear", "wererat", "weretiger", "werewolf"].map(k => CONTENT[`mm-${k}-bite`].triggers[0].do[0].mark);
    expect(new Set([...marks, CONTENT["mm-wereboar-gore"].triggers[0].do[0].mark]).size).toBe(5);
  });

  it("elle ne porte pas le drain de l'identifiant « bite » (aucun lycanthrope ne réduit le maximum de points de vie)", () => {
    expect(CONTENT.bite?.drain).toBe(true);
    for ( const kind of Object.values(BITES) ) expect(CONTENT[`mm-${kind}-bite`].drain).toBeUndefined();
  });
});
