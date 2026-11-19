/**
 * Le champ de vue d'un sens (core/light.mjs `fieldOfView`) : la carte se voit jusqu'à la portée de la vision véritable, de la
 * vision aveugle ou de la Vision du diable, quand ce sens porte au moins aussi loin que la vision dans le noir projetée par dnd5e.
 */
import { describe, it, expect } from "vitest";
import { fieldOfView, FIELD_MODES } from "../module/scripts/core/light.mjs";

describe("fieldOfView — quel sens fait le champ de vue", () => {
  it("aucun de ces sens : rien à changer", () => {
    expect(fieldOfView({})).toBe(null);
    expect(fieldOfView({ darkvision: 60 })).toBe(null);
    expect(fieldOfView()).toBe(null);
  });
  it("vision aveugle seule : son champ, sans couleur, à sa portée", () => {
    expect(fieldOfView({ blindsight: 30 })).toMatchObject({ sense: "blindsight", range: 30, visionMode: "dasBlindsight",
      saturation: -1 });
  });
  it("vision véritable : en couleur ; dnd5e l'a projetée comme une vision dans le noir de même portée", () => {
    expect(fieldOfView({ darkvision: 30, seeAll: 30 })).toMatchObject({ sense: "seeAll", range: 30, visionMode: "dasTruesight",
      saturation: 0, brightness: 1 });
  });
  it("Vision du diable : en couleur, à 120 ft, devant une vision dans le noir plus courte", () => {
    expect(fieldOfView({ darkvision: 60, devilsSight: 120 })).toMatchObject({ sense: "devilsSight", range: 120,
      visionMode: "dasDevilsSight" });
  });
  it("la vision dans le noir porte plus loin : c'est elle, rien n'est changé", () => {
    expect(fieldOfView({ darkvision: 120, blindsight: 10 })).toBe(null);
    expect(fieldOfView({ darkvision: 120, seeAll: 30 })).toBe(null);
  });
  it("plusieurs sens : la plus grande portée ; à égalité, vision véritable, puis vision aveugle, puis Vision du diable", () => {
    expect(fieldOfView({ seeAll: 30, blindsight: 60 }).sense).toBe("blindsight");
    expect(fieldOfView({ seeAll: 60, blindsight: 60, devilsSight: 60 }).sense).toBe("seeAll");
    expect(fieldOfView({ blindsight: 120, devilsSight: 120 }).sense).toBe("blindsight");
  });
  it("une portée illimitée reste illimitée (l'adaptateur la borne à la scène)", () => {
    expect(fieldOfView({ seeAll: Infinity }).range).toBe(Infinity);
  });
  it("chaque mode a son id, son libellé et son image", () => {
    for ( const mode of Object.values(FIELD_MODES) ) {
      expect(mode.id).toMatch(/^das[A-Z]/);
      expect(typeof mode.label).toBe("string");
      for ( const key of ["contrast", "saturation", "brightness"] ) {
        expect(Number.isFinite(mode[key]), `${mode.id}.${key}`).toBe(true);
      }
    }
  });
});
