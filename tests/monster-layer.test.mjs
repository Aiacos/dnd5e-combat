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
  // Vu en jeu : deux monstres portent la même Disparition (même identifiant, mêmes ids) ; déclarée par identifiant, la fin « après
  // un jet d'attaque » du Feu follet faisait aussi tomber l'Invisible de l'autre, dont le texte ne la prévoit pas. Exemples
  // synthétiques, de même tournure.
  it("un effet qui cesse après un jet d'attaque : lu dans le texte, pas dans l'identifiant", () => {
    const effects = [{ id: "cccccccccccccccc", statuses: ["invisible"] }];
    const activities = [{ id: "dddddddddddddddd", type: "utility", effects: ["cccccccccccccccc"] }];
    const untilAttack = "<p>The beast has the &Reference[Invisible] condition until its Concentration ends on this effect, "
      + "which ends early immediately after the beast makes an attack roll or uses Drain.</p>";
    const atWill = "<p>The beast gives itself the &Reference[Invisible] condition or ends that condition on itself.</p>";
    expect(monsterTextLayer({ html: untilAttack, identifier: "vanish", activities, effects }).breaksOn).toEqual(["attack"]);
    expect(monsterTextLayer({ html: atWill, identifier: "vanish", activities, effects })?.breaksOn).toBeUndefined();
    // Sans effet à faire tomber : rien à déclarer.
    expect(monsterTextLayer({ html: untilAttack, identifier: "vanish", activities: [], effects: [] })?.breaksOn).toBeUndefined();
  });
  it("la brique Avaler écarte les dégâts récurrents lus dans le texte", () => {
    const html = "<p>The target takes [[/damage 10 activity=bbbbbbbbbbbbbbbb]] Acid damage at the start of each of its turns.</p>";
    const acts = [{ id: "bbbbbbbbbbbbbbbb", type: "damage" }];
    expect(monsterTextLayer({ html, activities: acts })?.triggers?.length ?? 0).toBeGreaterThan(0);
    expect(monsterTextLayer({ html, activities: acts, swallow: true })?.triggers).toBeUndefined();
  });
});
