import { describe, expect, it } from "vitest";
import { monsterTextLayer } from "../module/scripts/core/monster-layer.mjs";

// §460 : la couche texte des capacités de PNJ, sortie de l'adaptateur pour que l'ATLAS calcule ce que joue le moteur. Exemples synthétiques.
describe("§460 : monsterTextLayer", () => {
  it("rien sans texte, ni pour un texte qui ne dit rien", () => {
    expect(monsterTextLayer({ html: "" })).toBeNull();
    expect(monsterTextLayer({ html: "<p>The creature hums a tune.</p>" })).toBeNull();
  });
  it("une poussée sur une sauvegarde ratée (K8)", () => {
    const layer = monsterTextLayer({ html: "<p>Strength Saving Throw: DC 15. Failure: 10 damage, and the target is pushed up to 15 feet straight away from the beast.</p>",
      activities: [{ id: "aaaaaaaaaaaaaaaa", type: "save" }] });
    expect(layer.triggers).toEqual([{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]);
  });
  it("un drain qui rend les PV au drainer", () => {
    const layer = monsterTextLayer({ html: "<p>The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the beast regains Hit Points equal to that amount.</p>",
      activities: [{ id: "aaaaaaaaaaaaaaaa", type: "attack" }] });
    expect(layer.drain).toBe(true);
  });
  it("la brique Avaler écarte les dégâts récurrents lus dans le texte", () => {
    const html = "<p>The target takes [[/damage 10 activity=bbbbbbbbbbbbbbbb]] Acid damage at the start of each of its turns.</p>";
    const acts = [{ id: "bbbbbbbbbbbbbbbb", type: "damage" }];
    expect(monsterTextLayer({ html, activities: acts })?.triggers?.length ?? 0).toBeGreaterThan(0);
    expect(monsterTextLayer({ html, activities: acts, swallow: true })?.triggers).toBeUndefined();
  });
});
