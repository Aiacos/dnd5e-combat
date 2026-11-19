import { describe, it, expect } from "vitest";
import { slotLeft, plainCost, resourceIssues, isShort } from "../module/scripts/core/resources.mjs";

// §410 (issue #44, lot 3) : ce qui manque à une utilisation — jugé avant dnd5e, forçable.
const spells = {
  spell1: { value: 0, max: 2 }, spell2: { value: 0, max: 1 }, spell3: { value: 1, max: 1 },
  pact: { value: 0, max: 1, level: 2 }
};

describe("slotLeft", () => {
  it("un emplacement de ce niveau ou plus haut", () => {
    expect(slotLeft(spells, 1)).toBe(true);    // le 3e niveau reste
    expect(slotLeft(spells, 3)).toBe(true);
    expect(slotLeft(spells, 4)).toBe(false);
  });

  it("l'emplacement demandé seulement", () => {
    expect(slotLeft(spells, 1, "spell1")).toBe(false);
    expect(slotLeft(spells, 1, "spell3")).toBe(true);
  });

  it("le pacte compte à son niveau", () => {
    const warlock = { spell1: { value: 0, max: 0 }, pact: { value: 1, max: 2, level: 3 } };
    expect(slotLeft(warlock, 1)).toBe(true);
    expect(slotLeft(warlock, 3)).toBe(true);
    expect(slotLeft(warlock, 4)).toBe(false);
    expect(slotLeft({ pact: { value: 0, max: 2, level: 3 } }, 1)).toBe(false);
  });

  it("sans fiche de sorts : rien", () => {
    expect(slotLeft(null, 1)).toBe(false);
  });
});

describe("coûts et manques", () => {
  it("un coût en formule compte pour 1", () => {
    expect(plainCost("2")).toBe(2);
    expect(plainCost(3)).toBe(3);
    expect(plainCost("1d4")).toBe(1);
  });

  it("manque : coût positif au-dessus de ce qui reste", () => {
    expect(isShort({ cost: 1, available: 0 })).toBe(true);
    expect(isShort({ cost: 2, available: 1 })).toBe(true);
    expect(isShort({ cost: 1, available: 1 })).toBe(false);
    expect(isShort({ cost: 0, available: 0 })).toBe(false);
  });
});

describe("resourceIssues", () => {
  it("les raisons dans l'ordre", () => {
    expect(resourceIssues({ slotMissing: true, usesShort: true, quantityShort: true, unprepared: true }))
      .toEqual(["noSlot", "noUses", "noQuantity", "unprepared"]);
    expect(resourceIssues({ usesShort: true })).toEqual(["noUses"]);
    expect(resourceIssues({})).toEqual([]);
  });
});

// Issue #144 : les châtiments non préparés étaient proposés après un coup — la liste (`smiteOptions`) ne regardait pas la
// préparation, que le moteur ne vérifiait qu'au lancement. Une seule règle pour les deux.
describe("awaitsPreparation — un sort qui attend d'être préparé", () => {
  it("méthode qui se prépare, niveau 1 ou plus, pas préparé : oui", async () => {
    const { awaitsPreparation } = await import("../module/scripts/core/resources.mjs");
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 0 })).toBe(true);
    expect(awaitsPreparation({ level: 3, prepares: true, prepared: false })).toBe(true);
  });
  it("préparé (1), toujours préparé (2), sort mineur, méthode qui ne se prépare pas : non", async () => {
    const { awaitsPreparation } = await import("../module/scripts/core/resources.mjs");
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 1 })).toBe(false);
    expect(awaitsPreparation({ level: 1, prepares: true, prepared: 2 })).toBe(false);
    expect(awaitsPreparation({ level: 0, prepares: true, prepared: 0 })).toBe(false);
    expect(awaitsPreparation({ level: 1, prepares: false, prepared: 0 })).toBe(false);
    expect(awaitsPreparation()).toBe(false);
  });
  it("la liste des châtiments et le lancement emploient la même règle", async () => {
    const { readFileSync } = await import("node:fs");
    const read = path => readFileSync(new URL(`../module/scripts/adapter/${path}`, import.meta.url), "utf8");
    expect(read("smite.mjs")).toMatch(/if \( rule && unpreparedSpell\(item\) && [^\n]*cachedFor[^\n]* \) continue;/);
    expect(read("resources.mjs")).toContain("const unprepared = spell && !linked && unpreparedSpell(item) && !ritual;");
    // Issue #145 : et ce que la fiche déclare — la Réaction d'un Bouclier non préparé était proposée.
    expect(read("triggers.mjs")).toMatch(/if \( wornOrNotEquipment\(item\) && preparedOrNotSpell\(item\) \) out\.push\(/);
  });
});
