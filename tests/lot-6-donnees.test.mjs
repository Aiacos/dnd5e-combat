import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const valid = entry => validateEntry(entry, { at: "x." });

describe("§288: defective PHB data", () => {
  it("Lightning Arrow: its dice replace those of the weapon, half on a miss, Dexterity burst at 3 m", () => {
    const rule = CONTENT["lightning-arrow"].smite;
    expect(rule).toMatchObject({ damage: "dnd5eactivity000", ranged: true, replaces: true, onMiss: "half" });
    expect(rule.blast).toEqual({ activity: "dnd5eactivity200", radius: 10, units: "ft", ability: "dex" });
    expect(valid({ smite: rule })).toEqual([]);
  });

  it("schema of `smite`: `replaces`, `onMiss`, `blast`", () => {
    expect(valid({ smite: { damage: "dnd5eactivity000", replaces: "yes" } }).length).toBe(1);
    expect(valid({ smite: { damage: "dnd5eactivity000", onMiss: "full" } }).length).toBe(1);
    expect(valid({ smite: { damage: "dnd5eactivity000", blast: { activity: "dnd5eactivity200", radius: 10, units: "ft" } } }).length).toBe(1);
  });

  it("Dispel Evil and Good: mark at the \"Cast\", Disadvantage of the five types, Dismissal and Break Enchantment end it", () => {
    const entry = CONTENT["dispel-evil-and-good"];
    expect(entry.trace).toEqual({ activity: "0vS3We98acymzUXC" });
    expect(entry.endsOnUse).toEqual(["dnd5eactivity000", "eBbyE0du7mEJWDbZ"]);
    expect(entry.cures).toEqual(["charmed", "frightened"]);
    expect(entry.curesOn).toBe("eBbyE0du7mEJWDbZ");
    const trigger = entry.triggers[0];
    expect(trigger).toMatchObject({ on: "preAttackRoll", via: "effect", do: [{ type: "disadvantage" }] });
    expect(trigger.if["source.creatureType"]).toEqual(["celestial", "elemental", "fey", "fiend", "undead"]);
    expect(valid({ endsOnUse: [] }).length).toBe(1);
    expect(valid({ curesOn: "court" }).length).toBe(1);
  });

  it("Maze: banishes, the Study at the start of the turn ends the spell", () => {
    const entry = CONTENT.maze;
    expect(entry.banishes).toEqual(["y7cYsJ0DCzXt4Tvy"]);
    expect(entry.actionEnds.y7cYsJ0DCzXt4Tvy).toEqual({ by: "bearer", roll: "check", spell: true, turnStart: true });
    expect(valid({ actionEnds: { y7cYsJ0DCzXt4Tvy: { by: "other", turnStart: true } } }).length).toBe(1);
  });
});
