import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * §433: what the scenario pass on dnd5e 6.1 surveyed — SRD 6.1 changes activity and effect identifiers, moves effects from one
 * item to another and replaces item effects with those of the `dnd5e.effects` compendium. Older sheets (Player's Handbook, SRD
 * 6.0) keep the old identifiers: each rule reads under both forms.
 */

const fromEffects = (id, on) => SHIPPED[id].triggers.filter(t => [t.on].flat().includes(on)).map(t => t.fromEffect);

describe("§433: the content's rules under both data forms", () => {
  it("Stinking Cloud: the start-of-turn save, under its two activity identifiers", () => {
    const [turnStart] = SHIPPED["stinking-cloud"].triggers;
    expect(turnStart.do.filter(s => s.type === "replay").map(s => s.activity)).toEqual(["dnd5eactivity000", "pyaS54TcG7kx15V2"]);
  });

  it("Cunning Strike, Poison: the item's effect, or \"Poisoned\" from the effects compendium", () => {
    expect(fromEffects("cunning-strike", "endOfTurn")).toEqual(["RazTM6biKVtNtjEW", "wAnw5y4atBxNJHUP"]);
  });

  it("Devious Strikes, Knock Out: new save and end on damage for both effects", () => {
    expect(fromEffects("devious-strikes", "endOfTurn")).toEqual(["C2IGgt4PnRMxZVey", "HjLkxDzLNBogspf9"]);
    expect(fromEffects("devious-strikes", "isDamaged")).toEqual(["C2IGgt4PnRMxZVey", "HjLkxDzLNBogspf9"]);
  });

  it("Improved Brutal Strike: the effect of each option, on this item or on Brutal Strike", () => {
    const { options } = SHIPPED["improved-brutal-strike"].brutalStrike;
    expect(options.staggering.effect).toEqual(["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"]);
    expect(options.sundering.effect).toEqual(["tUyuyTQGmpUqMcFe", "Q0ou16II1WEcCdyW"]);
    const brutal = SHIPPED["brutal-strike"];
    // The rules of the two effects follow the item that carries them: ends at the start of the barbarian's turn, Disadvantage
    // on saves, no Opportunity Attack, +5 to the next attack of another.
    expect(brutal.effectEnds).toMatchObject({ uacly0JAXLVwAS6y: "casterTurnStart", Q0ou16II1WEcCdyW: "casterTurnStart" });
    expect(brutal.effectChanges.uacly0JAXLVwAS6y).toEqual(SHIPPED["improved-brutal-strike"].effectChanges.L9N4evZo1jt46dap);
    expect(brutal.noOpportunityAttacks).toEqual(["uacly0JAXLVwAS6y"]);
    expect(brutal.triggers.some(t => (t.fromEffect === "Q0ou16II1WEcCdyW") && t.do.some(s => s.type === "attackBonus"))).toBe(true);
  });

  it("Crippling Strike: Speed is not reduced twice when the effect already reduces it", () => {
    const [walk] = SHIPPED["brutal-strike"].effectChanges.bg9jWpPRIJ0Q2vPY;
    expect(walk).toMatchObject({ key: "system.attributes.movement.walk", value: "-15", unlessKey: "system.attributes.movement.bonus" });
  });
});

describe("§433: the schema accepts these forms", () => {
  it("brutalStrike : `effect` en identifiant ou en liste d'identifiants", () => {
    expect(validateEntry({ brutalStrike: { options: { a: { effect: ["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"] } } } })).toEqual([]);
    expect(validateEntry({ brutalStrike: { options: { a: { effect: [] } } } }).length).toBe(1);
    expect(validateEntry({ brutalStrike: { options: { a: { effect: ["trop-court"] } } } }).length).toBe(1);
  });

  it("effectChanges : `unlessKey`", () => {
    const change = { key: "system.attributes.movement.walk", type: "add", value: "-15" };
    expect(validateEntry({ effectChanges: { bg9jWpPRIJ0Q2vPY: [{ ...change, unlessKey: "system.attributes.movement.bonus" }] } })).toEqual([]);
    expect(validateEntry({ effectChanges: { bg9jWpPRIJ0Q2vPY: [{ ...change, unlessKey: "" }] } }).length).toBe(1);
  });
});
