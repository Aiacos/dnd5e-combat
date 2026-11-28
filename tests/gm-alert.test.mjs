/** §364: GM alert — the content key `gmAlert`. */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import fs from "node:fs";

const en = JSON.parse(fs.readFileSync(new URL("../module/lang/en.json", import.meta.url), "utf8"));

describe("§364 : gmAlert", () => {
  it("accepts a key, a text, activities, a list", () => {
    expect(validateEntry({ gmAlert: { key: "Titan" } })).toEqual([]);
    expect(validateEntry({ gmAlert: { text: "Au MJ", activities: ["6WJ08JWazu3OZign"] } })).toEqual([]);
    expect(validateEntry({ gmAlert: [{ key: "Titan" }, { text: "x" }] })).toEqual([]);
  });
  it("refuse les formes fautives", () => {
    for ( const bad of [{}, { key: "a b" }, { key: "A", text: "B" }, { text: "" }, { key: "A", activities: ["court"] }, { key: "A", other: 1 }, []] ) {
      expect(validateEntry({ gmAlert: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it("each shipped key has its text", () => {
    const keys = Object.values(CONTENT).flatMap(e => [e?.gmAlert].flat().filter(Boolean)).map(r => r.key).filter(Boolean);
    expect(keys.length).toBeGreaterThan(5);
    for ( const k of keys ) expect(en[`DND5ECOMBAT.AlerteMJ.${k}`], k).toBeTruthy();
  });
});

describe("§366: breaksOnOrigin and handing back the shares left to the GM", () => {
  it("validates the key", () => {
    expect(validateEntry({ breaksOnOrigin: ["attack", "damage", "forcesSave"] })).toEqual([]);
    expect(validateEntry({ breaksOnOrigin: ["spell"] }).length).toBeGreaterThan(0);
    expect(validateEntry({ breaksOnOrigin: [] }).length).toBeGreaterThan(0);
  });
  it("Friends, Tentacle Rod, Jester, Greater Restoration, Cordon of Arrows", () => {
    expect(CONTENT.friends.breaksOnOrigin).toEqual(["attack", "damage", "forcesSave"]);
    expect(CONTENT["tentacle-rod"].endsWhen.apart).toEqual({ distance: 15, units: "ft" });
    expect(CONTENT.jester.triggers[0].do).toEqual([{ type: "advantage" }]);
    // The Fool, its counterpart: "D20 Tests" includes attack rolls — seen in play, only they were left without Disadvantage.
    expect(CONTENT.fool.triggers).toEqual([{ on: "preAttackRoll", via: "effect", fromEffect: "BkChhqAw5emn7aQp",
      if: { "source.hasEffect": "fool" }, do: [{ type: "disadvantage" }] }]);
    expect(CONTENT.fool.effectChanges.BkChhqAw5emn7aQp).toHaveLength(12);
    expect(CONTENT["greater-restoration"].endsCurses).toEqual(["bestow-curse", "hex"]);
    expect(CONTENT["cordon-of-arrows"].zoneAffects).toBe("enemy");
    for ( const id of ["friends", "fear", "crown-of-madness", "eyebite", "death-ward", "tentacle-rod", "jester"] ) expect(CONTENT[id]?.gmAlert, id).toBeUndefined();
  });
});

describe("§367 : endActivity, teleport.maxLight, noRangedWeapons", () => {
  it("validates the keys", () => {
    expect(validateEntry({ endActivity: { fzN2X69eyByhtaYu: { activity: "abooAkpLL09oe1T8", radius: 5, units: "ft" } } })).toEqual([]);
    expect(validateEntry({ endActivity: { fzN2X69eyByhtaYu: { activity: "abooAkpLL09oe1T8" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ endActivity: { court: { activity: "abooAkpLL09oe1T8", radius: 5, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ teleport: { distance: 120, units: "ft", maxLight: "dim" } })).toEqual([]);
    expect(validateEntry({ teleport: { distance: 120, units: "ft", maxLight: "bright" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ noRangedWeapons: true })).toEqual([]);
    expect(validateEntry({ noRangedWeapons: { fromPulse: 4 } })).toEqual([]);
    expect(validateEntry({ noRangedWeapons: { fromPulse: 0 } }).length).toBeGreaterThan(0);
    expect(validateEntry({ noRangedWeapons: { fromPulse: 4, x: 1 } }).length).toBeGreaterThan(0);
  });
  it("\"Shadow Spirit\", Shadow Walk, Storm of Vengeance", () => {
    expect(CONTENT["shade-spirit"].endActivity.fzN2X69eyByhtaYu.activity).toBe("abooAkpLL09oe1T8");
    expect(CONTENT["shadow-walk"].teleport.maxLight).toBe("dim");
    expect(CONTENT["storm-of-vengeance"].noRangedWeapons).toEqual({ fromPulse: 4 });
    // The text also puts Difficult Terrain and no visibility in the "turns 5 to 10": not from placement.
    expect(CONTENT["storm-of-vengeance"].difficultTerrain).toEqual({ fromPulse: 4 });
    expect(CONTENT["storm-of-vengeance"].obscures).toEqual({ fromPulse: 4 });
    for ( const id of ["shade-spirit", "shadow-walk", "storm-of-vengeance"] ) expect(CONTENT[id]?.gmAlert, id).toBeUndefined();
  });
});
