/**
 * Forme corrosive du Pouding noir (SRD 5.2) : qui le touche avec un jet d'attaque au corps à corps subit
 * 1d8 dégâts d'acide — sans clause de distance (celle de 2014, « à 1,50 m ou moins », n'est plus dans le texte). Vu en jeu : un
 * coup de Coutille (allonge) porté à 3 m ne déclenchait rien, le même coup porté au contact oui.
 */
import { describe, it, expect } from "vitest";
import { normalize, select } from "../module/scripts/core/triggers.mjs";
import { TRIGGERS } from "../module/scripts/content/triggers.mjs";

const declared = TRIGGERS["corrosive-form"].map(d => normalize(d, { name: "Corrosive Form" }));
const within = feet => rule => feet <= rule.distance;

describe("Forme corrosive", () => {
  it("un coup au corps à corps à 3 m (arme à allonge) déclenche les dégâts d'acide, comme au contact", () => {
    for ( const feet of [5, 10] ) {
      const facts = { "activity.isMelee": true, "activity.isAttack": true, "target.within": within(feet) };
      expect(select(declared, "isHit", facts).map(d => d.do[0]), `${feet} ft`)
        .toEqual([{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }]);
    }
  });
  it("une attaque à distance ne déclenche rien", () => {
    const facts = { "activity.isMelee": false, "activity.isAttack": true, "target.within": within(5) };
    expect(select(declared, "isHit", facts)).toEqual([]);
  });
  it("l'entrée ne porte pas de condition de distance", () => {
    expect(Object.keys(TRIGGERS["corrosive-form"][0].if)).toEqual(["activity.isMelee"]);
  });
});
