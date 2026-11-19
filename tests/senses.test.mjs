/**
 * Bloc générique `sense` (core/senses.mjs) : un sens déclaré par du contenu — il localise une créature sans la voir, ou compte
 * comme une vue — et `wardsDetection`, ce qui en protège. Règle pure : portée, murs, cible détectée ou non, protection.
 */
import { describe, it, expect } from "vitest";
import { senseVerdict, bestVerdict, wardedAgainst, sensesIn, SENSE_VERDICTS } from "../module/scripts/core/senses.mjs";
import { validateEntry } from "../module/scripts/core/content/entry.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

const near = { distance: 20, walled: false, matches: true, wards: [] };

describe("sens déclaré : le verdict sur une cible", () => {
  const locate = { kind: "locate", range: 30 };
  it("dans la portée, sans mur, cible détectée : localisée ; « sight » : vue", () => {
    expect(senseVerdict(locate, near)).toBe("locate");
    expect(senseVerdict({ kind: "sight", range: 30 }, near)).toBe("sight");
  });
  it("au-delà de la portée, ou la cible n'est pas de celles que le sens détecte : rien", () => {
    expect(senseVerdict(locate, { ...near, distance: 31 })).toBe(null);
    expect(senseVerdict(locate, { ...near, distance: 30 })).toBe("locate");
    expect(senseVerdict(locate, { ...near, matches: false })).toBe(null);
  });
  it("un mur l'arrête, sauf le sens qui les traverse (`walls: false`)", () => {
    expect(senseVerdict(locate, { ...near, walled: true })).toBe(null);
    expect(senseVerdict({ ...locate, walls: false }, { ...near, walled: true })).toBe("locate");
  });
  it("`reveals: \"presence\"` : la présence est sue, pas la position", () => {
    expect(senseVerdict({ ...locate, reveals: "presence" }, near)).toBe("presence");
  });
  it("le meilleur verdict de plusieurs sens l'emporte", () => {
    expect(SENSE_VERDICTS).toEqual(["presence", "locate", "sight"]);
    expect(bestVerdict(["presence", null, "locate"])).toBe("locate");
    expect(bestVerdict([null, "sight", "locate"])).toBe("sight");
    expect(bestVerdict([null, undefined])).toBe(null);
    expect(bestVerdict([])).toBe(null);
  });
});

describe("protection contre la détection (`wardsDetection`)", () => {
  it("une protection contre une école n'arrête que les sens de cette école", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["div"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 30, magic: true }, ["div"])).toBe(false);
    expect(wardedAgainst({ kind: "locate", range: 30 }, ["div"])).toBe(false);
  });
  it("une protection contre la magie arrête tout sens magique, d'une école ou non, pas un sens naturel", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60, magic: true }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60 }, ["magic"])).toBe(false);
  });
  it("la cible protégée n'est pas perçue par ce sens", () => {
    expect(senseVerdict({ kind: "locate", range: 30, magic: "div" }, { ...near, wards: ["div"] })).toBe(null);
    expect(senseVerdict({ kind: "locate", range: 30 }, { ...near, wards: ["div", "magic"] })).toBe("locate");
  });
});

describe("déclaration dans le contenu", () => {
  it("les deux clés sont au schéma", () => {
    expect(ENTRY_KEYS).toContain("sense");
    expect(ENTRY_KEYS).toContain("wardsDetection");
  });
  it("une entrée porte un sens ou une liste de sens", () => {
    const one = { kind: "locate", range: 30 };
    expect(sensesIn({ sense: one })).toEqual([one]);
    expect(sensesIn({ sense: [one, { kind: "sight", range: 10 }] })).toHaveLength(2);
    expect(sensesIn({})).toEqual([]);
    expect(sensesIn(null)).toEqual([]);
  });
  it("valide : genre, portée, et les options connues", () => {
    const facts = { "target.creatureType": null };
    const ok = { sense: { kind: "locate", range: 30, units: "ft", via: "effect", fromEffect: "abcdefghij012345", walls: false,
      magic: "div", reveals: "presence", detects: { "target.creatureType": ["undead"] } } };
    expect(validateEntry(ok, { facts })).toEqual([]);
    const two = { sense: [{ kind: "sight", range: 10 }, { kind: "locate", range: 60, magic: true }] };
    expect(validateEntry(two, { facts })).toEqual([]);
    expect(validateEntry({ wardsDetection: ["div", "magic"] }, { facts })).toEqual([]);
  });
  it("refuse : genre inconnu, portée absente, option ou fait inconnus, protection vide", () => {
    const facts = { "target.creatureType": null };
    const bad = [{ sense: { kind: "smell", range: 30 } }, { sense: { kind: "locate" } }, { sense: { kind: "locate", range: 0 } },
      { sense: { kind: "locate", range: 30, colour: "red" } }, { sense: { kind: "locate", range: 30, walls: true } },
      { sense: { kind: "locate", range: 30, fromEffect: "abcdefghij012345" } },
      { sense: { kind: "locate", range: 30, reveals: "name" } },
      { sense: { kind: "locate", range: 30, detects: { "target.unknownFact": true } } }, { sense: [] },
      { wardsDetection: [] }, { wardsDetection: "div" }, { wardsDetection: [""] }];
    for ( const entry of bad ) expect(validateEntry(entry, { facts }).length, JSON.stringify(entry)).toBeGreaterThan(0);
  });
});
