/**
 * Cape de déplacement (Guide du Maître 2024, SRD 5.2) : la propriété est suspendue tant que la Vitesse du porteur est de 0. L'entrée
 * ne regardait que l'état Neutralisé (le texte de 2014) : vu en jeu, un porteur Agrippé gardait le Désavantage des attaquants.
 */
import { describe, it, expect } from "vitest";
import { speedIsZero } from "../module/scripts/core/movement.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("speedIsZero", () => {
  it("toutes les vitesses à 0 : oui (le saut ne compte pas)", () => {
    expect(speedIsZero({ walk: 0, burrow: 0, climb: 0, fly: 0, swim: 0, jump: 8 })).toBe(true);
    expect(speedIsZero({})).toBe(true);
  });
  it("une vitesse qui reste : non", () => {
    expect(speedIsZero({ walk: 30, burrow: 0, climb: 0, fly: 0, swim: 0 })).toBe(false);
    expect(speedIsZero({ walk: 0, fly: 60 })).toBe(false);
    expect(speedIsZero({ walk: "30" })).toBe(false);
  });
  it("sans données de déplacement : non", () => {
    expect(speedIsZero(null)).toBe(false);
    expect(speedIsZero(undefined)).toBe(false);
  });
});

describe("Cape de déplacement : quand les attaquants ont le Désavantage", () => {
  const condition = CONTENT["cloak-of-displacement"].triggers[0].if;
  const wearer = ({ suppressed=false, speedZero=false, incapacitated=false }={}) => ({
    "target.hasEffect": id => suppressed && (id === "cloak-of-displacement"),
    "target.speedZero": want => speedZero === want,
    "target.hasStatus": id => incapacitated && (id === "incapacitated") });

  it("porteur libre : oui", () => expect(holds(condition, wearer())).toBe(true));
  it("Vitesse de 0 (Agrippé, Entravé) : non", () => expect(holds(condition, wearer({ speedZero: true }))).toBe(false));
  it("propriété suspendue après des dégâts : non", () => expect(holds(condition, wearer({ suppressed: true }))).toBe(false));
  it("Neutralisé (texte de 2014, même identifiant) : non", () => expect(holds(condition, wearer({ incapacitated: true }))).toBe(false));
});
