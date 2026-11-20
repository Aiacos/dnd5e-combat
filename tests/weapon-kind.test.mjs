import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { holds, unknownFacts } from "../module/scripts/core/triggers.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

// Le fait `activity.weaponKind` (adapter/facts.mjs, relu dans la source : il touche à Foundry, on ne l'importe pas ici).
const factsSource = readFileSync(new URL("../module/scripts/adapter/facts.mjs", import.meta.url), "utf8");
const ADAPTER_FACTS = Array.from(factsSource.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm), m => m[1]);

describe("fait activity.weaponKind", () => {
  const condition = { "activity.weaponKind": ["unarmed", "simpleM", "improv"], "activity.isMelee": true };

  it("l'adaptateur le fournit", () => {
    expect(ADAPTER_FACTS).toContain("activity.weaponKind");
    expect(unknownFacts(condition, Object.fromEntries(ADAPTER_FACTS.map(k => [k, true])))).toEqual([]);
  });

  it("une liste de genres : frappe à mains nues, arme courante ou improvisée oui, arme de guerre non", () => {
    for ( const kind of ["unarmed", "simpleM", "improv"] ) expect(holds(condition, { "activity.weaponKind": kind, "activity.isMelee": true }), kind).toBe(true);
    expect(holds(condition, { "activity.weaponKind": "martialM", "activity.isMelee": true })).toBe(false);
    expect(holds(condition, { "activity.weaponKind": null, "activity.isMelee": true })).toBe(false);
  });
});

describe("fait activity.baseItem (Brassards d'archer)", () => {
  const entry = CONTENT["bracers-of-archery"];
  const condition = entry.triggers[0].if;

  it("l'adaptateur le fournit, et l'entrée se valide", () => {
    expect(ADAPTER_FACTS).toContain("activity.baseItem");
    expect(validateEntry(entry, { facts: Object.fromEntries(ADAPTER_FACTS.map(k => [k, true])) })).toEqual([]);
  });

  it("le +2 aux dégâts d'un Arc long ou court, pas d'une arbalète ni d'une fronde", () => {
    for ( const base of ["longbow", "shortbow"] ) {
      expect(holds(condition, { "activity.isAttack": true, "activity.baseItem": base }), base).toBe(true);
    }
    for ( const base of ["lightcrossbow", "sling", null] ) {
      expect(holds(condition, { "activity.isAttack": true, "activity.baseItem": base }), String(base)).toBe(false);
    }
    expect(entry.triggers[0].do).toEqual([{ type: "damage", formula: "2", damageType: "weapon" }]);
  });

  it("l'effet « +2 à toute arme à distance » de la donnée est vidé ; déjà vidé ou changé à la main, il ne bouge pas", () => {
    const data = { key: "system.bonuses.rwak.damage", value: 2, type: "add", phase: "initial", conditions: "{}" };
    const item = { effects: [{ _id: "PSGGfFEy4CjBVzyX", transfer: true, system: { changes: [data] } }], system: {} };
    expect(dataFixPlan(item, entry.dataFixes).effects).toEqual([{ _id: "PSGGfFEy4CjBVzyX", "system.changes": [] }]);
    item.effects[0].system.changes = [];
    expect(dataFixPlan(item, entry.dataFixes).fields).toEqual([]);
    item.effects[0].system.changes = [{ ...data, value: 3 }];
    expect(dataFixPlan(item, entry.dataFixes).fields).toEqual([]);
  });
});
