import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RECIPES, FACTS, FIELD_KINDS, PUBLIC_KEYS, ISSUE_CODES, buildEntry, buildCondition } from "../module/scripts/core/recipes.mjs";
import { validateEntry, ENTRY_KEYS } from "../module/scripts/core/content.mjs";

// The facts the adapter provides: re-read from its source (it touches Foundry, so it is not imported here).
const factsSource = readFileSync(new URL("../module/scripts/adapter/facts.mjs", import.meta.url), "utf8");
const ADAPTER_FACTS = Array.from(factsSource.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm), m => m[1]);
const facts = Object.fromEntries(ADAPTER_FACTS.map(k => [k, true]));
const lang = l => JSON.parse(readFileSync(new URL(`../module/lang/${l}.json`, import.meta.url), "utf8"));

describe("recettes : le catalogue", () => {
  it("each proposed fact exists in the adapter", () => {
    expect(ADAPTER_FACTS.length).toBeGreaterThan(30);
    expect(Object.keys(FACTS).filter(k => !ADAPTER_FACTS.includes(k))).toEqual([]);
  });

  it("each recipe produces only known keys, with fields of a known kind", () => {
    for ( const [type, r] of Object.entries(RECIPES) ) {
      expect(r.keys.every(k => ENTRY_KEYS.includes(k)), type).toBe(true);
      for ( const f of r.fields ) expect(FIELD_KINDS, `${type}.${f.key}`).toContain(f.kind);
    }
    expect(PUBLIC_KEYS).toContain("triggers");
  });

  it("each recipe's example gives a valid entry", () => {
    for ( const [type, r] of Object.entries(RECIPES) ) {
      const { entry, errors } = buildEntry([{ type, values: r.example }], { identifier: "essai" });
      expect(errors, type).toEqual([]);
      expect(validateEntry(entry, { facts }), type).toEqual([]);
      expect(Object.keys(entry).every(k => r.keys.includes(k)), type).toBe(true);
    }
  });

  for ( const l of ["fr", "en"] ) {
    it(`${l} : chaque recette, champ, valeur et fait a son libellé`, () => {
      const keys = lang(l);
      const wanted = new Set();
      for ( const [type, r] of Object.entries(RECIPES) ) {
        wanted.add(`DND5ECOMBAT.Recette.${type}.Nom`);
        wanted.add(`DND5ECOMBAT.Recette.${type}.Aide`);
        wanted.add(`DND5ECOMBAT.Recette.Categorie.${r.category}`);
        for ( const f of r.fields ) {
          wanted.add(`DND5ECOMBAT.Recette.Champ.${f.key}`);
          for ( const o of f.options ?? [] ) if ( o ) wanted.add(`DND5ECOMBAT.Recette.Valeur.${o}`);
        }
      }
      for ( const k of Object.keys(FACTS) ) wanted.add(`DND5ECOMBAT.Recette.Fait.${k.replace(".", "_")}`);
      for ( const c of ISSUE_CODES ) wanted.add(`DND5ECOMBAT.Recette.Erreur.${c}`);
      expect(Array.from(wanted).filter(k => !(k in keys))).toEqual([]);
    });
  }
});

describe("recipes: translatable issues", () => {
  it("each issue code written in recipes.mjs is declared in ISSUE_CODES (so has its label)", () => {
    const src = readFileSync(new URL("../module/scripts/core/recipes.mjs", import.meta.url), "utf8");
    const used = Array.from(src.matchAll(/issue\([^,]+,\s*"(\w+)"/g), m => m[1]);
    expect(used.length).toBeGreaterThan(8);
    expect(used.filter(c => !ISSUE_CODES.includes(c))).toEqual([]);
  });
});

describe("recipes: building an entry", () => {
  it("Hex: bonus damage on the marked target", () => {
    const { entry } = buildEntry([{ type: "bonusDamage", values: RECIPES.bonusDamage.example }]);
    expect(entry).toEqual({ triggers: [{
      on: "preDamageRoll",
      if: { all: [{ "activity.isAttack": true }, { "target.hasEffectFrom": "hex" }] },
      do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }]
    }] });
  });

  it("\"this item only\" relies on the creation's identifier", () => {
    const { entry } = buildEntry([{ type: "bonusDamage", values: { formula: "1d4", damageType: "fire" } }], { identifier: "lame-ardente" });
    expect(entry.triggers[0].if).toEqual({ "activity.identifier": "lame-ardente" });
    const sans = buildEntry([{ type: "bonusDamage", values: { formula: "1d4", damageType: "fire" } }]);
    expect(sans.errors[0]).toMatch(/identifier/);
    expect(sans.issues[0]).toMatchObject({ recipe: 0, type: "bonusDamage", at: "scope", code: "needsIdentifier" });
  });

  it("several recipes add up; a unique recipe comes only once", () => {
    const { entry, errors } = buildEntry([
      { type: "outcomeStatus", values: { on: "failedSave", status: "prone" } },
      { type: "forcedMove", values: { on: "failedSave", distance: 10 } },
      { type: "teleport", values: { distance: 30 } },
      { type: "teleport", values: { distance: 60 } }
    ]);
    expect(entry.triggers).toHaveLength(2);
    expect(entry.teleport).toEqual({ distance: 30, units: "ft" });
    expect(errors).toEqual(["recipes[3].type: \"teleport\" only once per item"]);
    expect(validateEntry(entry, { facts })).toEqual([]);
  });

  it("a missing required field is reported, the recipe is dropped", () => {
    const { entry, errors, issues } = buildEntry([{ type: "outcomeStatus", values: { on: "hit" } }]);
    expect(errors).toEqual(["recipes[0].status: required"]);
    expect(issues).toEqual([{ recipe: 0, type: "outcomeStatus", at: "status", code: "required", data: { field: "status" }, message: "recipes[0].status: required" }]);
    expect(entry).toEqual({});
  });

  it("a field required only \"when\" is not demanded outside its case", () => {
    expect(buildEntry([{ type: "attackModifier", values: { mode: "disadvantage", carrier: "effect" } }]).errors).toEqual([]);
  });

  it("an entry taken from another item is kept, the recipes are added to it", () => {
    const base = { triggers: [{ on: "isHit", do: [{ type: "use" }] }], aura: { radius: 5, units: "ft" } };
    const { entry } = buildEntry([{ type: "reaction", values: { on: "isDamaged" } }], { base });
    expect(entry.triggers).toHaveLength(2);
    expect(entry.aura).toEqual(base.aura);
    expect(base.triggers).toHaveLength(1);   // the base is not modified
  });

  it("usage limits merge per activity", () => {
    const { entry } = buildEntry([
      { type: "usageLimit", values: { activity: "aaaaaaaaaaaaaaaa" } },
      { type: "usageLimit", values: { activity: "bbbbbbbbbbbbbbbb", oncePerTurn: false, cost: "bonus" } }
    ]);
    expect(entry.usageLimits).toEqual({ aaaaaaaaaaaaaaaa: { oncePerTurn: true }, bbbbbbbbbbbbbbbb: { cost: "bonus" } });
  });

  it("an unknown recipe is refused", () => {
    expect(buildEntry([{ type: "fireball" }]).issues[0]).toMatchObject({ code: "unknownRecipe", data: { type: "fireball" } });
  });
});

describe("recettes : conditions", () => {
  it("no clause: no condition; one: as is; several: all", () => {
    expect(buildCondition([])).toBe(null);
    expect(buildCondition([{ fact: "target.hasStatus", arg: "prone" }])).toEqual({ "target.hasStatus": "prone" });
    expect(buildCondition([{ fact: "activity.isMelee" }, { fact: "target.wounded", not: true }]))
      .toEqual({ all: [{ "activity.isMelee": true }, { not: { "target.wounded": true } }] });
  });

  it("the arguments are formatted and checked", () => {
    expect(buildCondition([{ fact: "target.within", arg: { distance: "10", units: "ft" } }])).toEqual({ "target.within": { distance: 10, units: "ft" } });
    expect(buildCondition([{ fact: "damage.hasType", arg: "fire" }])).toEqual({ "damage.hasType": ["fire"] });
    const errors = [];
    buildCondition([{ fact: "target.sizeAtMost", arg: "giant" }, { fact: "moon.phase" }], { errors });
    expect(errors).toHaveLength(2);
  });
});
