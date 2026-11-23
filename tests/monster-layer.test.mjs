import { describe, expect, it } from "vitest";
import { monsterTextLayer } from "../module/scripts/core/monster-layer.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { monsterEffectDurations } from "../module/scripts/core/monster-text.mjs";

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

describe("§484 : sensibilité à la lumière — les tests de caractéristique aussi", () => {
  const SUN = "<p>While in sunlight, the drider has Disadvantage on ability checks and attack rolls.</p>";
  it("au soleil : Désavantage aux jets d'attaque (déclencheur) et aux tests (rollDisadvantage)", () => {
    expect(monsterTextLayer({ html: SUN })).toEqual({
      triggers: [{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }],
      rollDisadvantage: { on: ["check"], if: { "self.inSunlight": true } }
    });
  });
  it("en lumière vive : le fait de lumière vive", () => {
    const html = "<p>While in Bright Light, the beast has Disadvantage on ability checks and attack rolls.</p>";
    const layer = monsterTextLayer({ html });
    expect(layer.rollDisadvantage).toEqual({ on: ["check"], if: { "self.inBrightLight": true } });
  });
  it("une phrase qui ne nomme que les jets d'attaque : pas de Désavantage aux tests", () => {
    const layer = monsterTextLayer({ html: "<p>While in Bright Light, the cloaker has Disadvantage on attack rolls.</p>" });
    expect(layer.triggers).toHaveLength(1);
    expect(layer.rollDisadvantage).toBeUndefined();
  });
  it("l'entrée lue passe le validateur", () => {
    const facts = { "source.inSunlight": () => true, "self.inSunlight": () => true };
    expect(validateEntry(monsterTextLayer({ html: SUN }), { facts })).toEqual([]);
  });
});

// Exemples synthétiques, réduits aux tournures lues (aucun texte de livre).
describe("§334 : la durée en tours d'un effet sans état, dite de la cible", () => {
  const data = { activities: [{ type: "save", effects: ["aaaaaaaaaaaaaaaa"] }],
    effects: [{ id: "aaaaaaaaaaaaaaaa", statuses: [] }] };
  it("« the target's Speed is halved until the end of its next turn » : la fin du tour du porteur", () => {
    const html = "<p>Failure: 10 Fire damage, and the target's Speed is halved until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
  });
  it("la phrase qui parle de la créature (« can't take this action again ») ne change pas la durée lue", () => {
    const html = "<p>Failure: 10 Fire damage, and the target's Speed is halved until the end of its next turn. "
      + "Failure or Success: The beast can't take this action again until the start of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
    const alone = "<p>Failure or Success: The beast can't take this action again until the start of its next turn.</p>";
    expect(monsterEffectDurations(alone, data)).toEqual({});
  });
  it("« This effect lasts until the end of its next turn », dans une phrase à part", () => {
    const html = "<p>Failure: The target's Speed is halved. This effect lasts until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
  });
  it("« the target's next turn » est le tour du porteur ; « the beast's next turn », celui de la créature", () => {
    const own = "<p>Failure: The target's Speed is 0 until the end of the target's next turn.</p>";
    expect(monsterEffectDurations(own, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
    const user = "<p>Hit: 5 damage, and the target can't climb until the start of the beast's next turn.</p>";
    expect(monsterEffectDurations(user, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "casterTurnStart" } });
  });
  it("deux effets sans état : on ne devine pas lequel", () => {
    const two = { activities: [{ type: "save", effects: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"] }],
      effects: [{ id: "aaaaaaaaaaaaaaaa", statuses: [] }, { id: "bbbbbbbbbbbbbbbb", statuses: [] }] };
    const html = "<p>Failure: The target's Speed is halved until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, two)).toEqual({});
  });
  it("deux phrases, deux durées différentes : rien n'est lu pour l'effet sans état", () => {
    const html = "<p>The beast has Advantage on attack rolls against the target until the start of the beast's next turn. "
      + "The target has Disadvantage on attack rolls until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({});
  });
  it("un état nommé garde sa lecture (l'effet qui porte l'état)", () => {
    const named = { activities: [{ type: "save", effects: ["cccccccccccccccc"] }],
      effects: [{ id: "cccccccccccccccc", statuses: ["prone"] }] };
    const html = "<p>Failure: The target has the Prone condition until the end of the target's next turn.</p>";
    expect(monsterEffectDurations(html, named)).toEqual({ effectEnds: { cccccccccccccccc: "bearerTurnEnd" } });
  });
});

