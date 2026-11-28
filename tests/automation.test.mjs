import { describe, it, expect } from "vitest";
import { automationOf, reportsByActor, reportsText } from "../module/scripts/core/automation.mjs";

describe("pastille d'automatisation (§9.2)", () => {
  it("an engine rule takes precedence over everything", () => {
    expect(automationOf({ rules: ["triggers"], activities: [{ type: "attack" }] })).toEqual({ level: "rule", rules: ["triggers"] });
  });
  it("an activity that rolls, heals, summons or casts a spell: auto", () => {
    for ( const type of ["attack", "save", "heal", "summon", "cast", "transform"] ) {
      expect(automationOf({ activities: [{ type }] }).level, type).toBe("auto");
    }
  });
  it("a utility activity is auto only if it rolls or places an effect", () => {
    expect(automationOf({ activities: [{ type: "utility" }] }).level).toBe("manual");
    expect(automationOf({ activities: [{ type: "utility", roll: true }] }).level).toBe("auto");
    expect(automationOf({ activities: [{ type: "utility", effects: 1 }] }).level).toBe("auto");
  });
  it("permanent effects without a gesture: passive; nothing at all: manual", () => {
    expect(automationOf({ passiveEffects: 1 }).level).toBe("passive");
    expect(automationOf({}).level).toBe("manual");
  });
  it("gear with nothing to play has no badge; an empty ability stays manual", () => {
    expect(automationOf({ gear: true }).level).toBe("none");
    expect(automationOf({ gear: true, activities: [{ type: "utility" }] }).level).toBe("manual");
    expect(automationOf({ gear: true, passiveEffects: 1 }).level).toBe("passive");
  });
});

describe("bilan des signalements", () => {
  const entries = {
    "Actor.b.Item.1": { actor: "Druidesse", item: "Rayon de lune", note: "zone pas retirée", at: 2 },
    "Actor.a.Item.2": { actor: "Abjurateur", item: "Égide arcanique", at: 1 },
    "Actor.b.Item.3": { actor: "Druidesse", item: "Forme sauvage", note: "", at: 3 }
  };
  it("groups by actor, in alphabetical order", () => {
    const groups = reportsByActor(entries);
    expect(groups.map(g => g.actor)).toEqual(["Abjurateur", "Druidesse"]);
    expect(groups[1].items.map(i => i.item)).toEqual(["Forme sauvage", "Rayon de lune"]);
    expect(groups[1].items[1].key).toBe("Actor.b.Item.1");
  });
  it("renders text to paste", () => {
    expect(reportsText(entries)).toBe("Abjurateur\n  - Égide arcanique\nDruidesse\n  - Forme sauvage\n  - Rayon de lune : zone pas retirée");
  });
  it("un bilan vide est vide", () => {
    expect(reportsByActor({})).toEqual([]);
    expect(reportsText()).toBe("");
  });
});
