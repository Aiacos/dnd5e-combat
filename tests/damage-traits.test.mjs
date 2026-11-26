import { describe, expect, it } from "vitest";
import { damageTraitHits, validateOnDamageTaken, traitEffectData } from "../module/scripts/core/damage-traits.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("onDamageTaken : un trait qui répond à un type de dégâts subi", () => {
  const rule = { types: ["cold"], effect: "B3otZdkyUcUlgrmk" };
  it("l'un des types subis suffit ; un autre type, ou aucun dégât, ne déclenche rien", () => {
    expect(damageTraitHits(rule, ["cold"])).toBe(true);
    expect(damageTraitHits(rule, ["bludgeoning", "cold"])).toBe(true);
    expect(damageTraitHits(rule, ["fire"])).toBe(false);
    expect(damageTraitHits(rule, [])).toBe(false);
    expect(damageTraitHits(rule, null)).toBe(false);
  });
  it("sans règle, sans effet ou sans type : rien", () => {
    expect(damageTraitHits(null, ["cold"])).toBe(false);
    expect(damageTraitHits({ types: ["cold"] }, ["cold"])).toBe(false);
    expect(damageTraitHits({ types: [], effect: "B3otZdkyUcUlgrmk" }, ["cold"])).toBe(false);
  });
  it("la clé est validée : types de dégâts connus, id d'effet de 16 caractères", () => {
    const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
    expect(validateOnDamageTaken(rule, "", ["cold", "fire"], isId)).toEqual([]);
    expect(validateOnDamageTaken({ types: ["ice"], effect: "B3otZdkyUcUlgrmk" }, "", ["cold", "fire"], isId)).toHaveLength(1);
    expect(validateOnDamageTaken({ types: ["cold"], effect: "short" }, "", ["cold", "fire"], isId)).toHaveLength(1);
    expect(validateOnDamageTaken({ types: ["cold"], effect: "B3otZdkyUcUlgrmk", extra: 1 }, "", ["cold"], isId)).toHaveLength(1);
    expect(validateEntry({ onDamageTaken: rule })).toEqual([]);
  });
});

describe("monstres du SRD 5.2 qui la déclarent", () => {
  it("Gel (Élémentaire de l'eau) : dégâts de froid → l'effet de Vitesse de la donnée", () => {
    expect(CONTENT.freeze.onDamageTaken).toEqual({ types: ["cold"], effect: "B3otZdkyUcUlgrmk" });
  });
  it("Aversion au feu (Golem de chair) : dégâts de feu → Désavantage aux attaques et aux tests, que l'effet vide reçoit", () => {
    const entry = CONTENT["aversion-to-fire"];
    expect(entry.onDamageTaken).toEqual({ types: ["fire"], effect: "kJYNjmfI0RpvF7CQ" });
    const plan = dataFixPlan({ effects: [{ _id: "kJYNjmfI0RpvF7CQ", system: { changes: [] } }], system: {} }, entry.dataFixes);
    const changes = plan.effects[0]["system.changes"];
    expect(changes).toHaveLength(12);
    expect(changes.every(c => (c.value === -1) && /\.(attack|check)\.roll\.mode$/.test(c.key))).toBe(true);
  });
});

describe("onDamageTaken : l'effet posé garde sa source, et tombe à la fin du prochain tour du porteur", () => {
  it("la copie n'a plus d'id, porte l'item en origine et l'effet d'item en source", () => {
    const item = { _id: "kJYNjmfI0RpvF7CQ", name: "Averse", disabled: true, transfer: true, _stats: { coreVersion: "14" } };
    const data = traitEffectData(item, "Actor.a.Item.i.ActiveEffect.kJYNjmfI0RpvF7CQ", "Actor.a.Item.i");
    expect(data._id).toBeUndefined();
    expect(data).toMatchObject({ name: "Averse", origin: "Actor.a.Item.i", transfer: false, disabled: false });
    expect(data._stats).toEqual({ coreVersion: "14", duplicateSource: "Actor.a.Item.i.ActiveEffect.kJYNjmfI0RpvF7CQ" });
  });
  it("Gel et Aversion au feu : « jusqu'à la fin de son prochain tour »", () => {
    expect(CONTENT.freeze.effectEnds).toEqual({ B3otZdkyUcUlgrmk: "bearerTurnEnd" });
    expect(CONTENT["aversion-to-fire"].effectEnds).toEqual({ kJYNjmfI0RpvF7CQ: "bearerTurnEnd" });
    for ( const id of ["freeze", "aversion-to-fire"] ) expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
  });
});

