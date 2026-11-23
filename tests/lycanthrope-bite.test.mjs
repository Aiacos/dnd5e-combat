import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../module/scripts/content/sources.mjs";

/** La malédiction d'un lycanthrope ne vise qu'un Humanoïde : la Morsure des quatre autres, comme la Défense du Sanglier-garou. */
describe("Morsure des lycanthropes — la malédiction ne vise qu'un Humanoïde", () => {
  const BITES = ["mmWerebear000000", "mmWererat0000000", "mmWeretiger00000", "mmWerewolf000000"];

  it("la Morsure de chaque lycanthrope a son identifiant propre, hors de « bite »", () => {
    for ( const actor of BITES ) expect(SOURCE_IDENTIFIERS[`${actor}.mmBite0000000000`], actor).toBe("mm-lycanthrope-bite");
  });

  it("l'entrée : les effets seulement pour un Humanoïde, comme celle du Sanglier-garou", () => {
    expect(CONTENT["mm-lycanthrope-bite"]).toEqual({ effectsIf: { "target.creatureType": "humanoid" } });
    expect(CONTENT["mm-lycanthrope-bite"]).toEqual(CONTENT["mm-wereboar-gore"]);
    expect(validateEntry(CONTENT["mm-lycanthrope-bite"], { facts: { "target.creatureType": () => true } })).toEqual([]);
  });

  it("elle ne porte pas le drain de l'identifiant « bite » (aucun lycanthrope ne réduit le maximum de points de vie)", () => {
    expect(CONTENT.bite?.drain).toBe(true);
    expect(CONTENT["mm-lycanthrope-bite"].drain).toBeUndefined();
  });
});
