import { describe, it, expect } from "vitest";
import { flanks, crossesOpposite, touchesBox, cellCenters, flankingApplies } from "../module/scripts/core/flanking.mjs";
import { attackModifiers, netMode } from "../module/scripts/core/conditions.mjs";

// Espaces en cases : la cible Moyenne occupe la case (5, 5).
const at = (x, y, w=1, h=1) => ({ x, y, w, h });
const target = at(5, 5);

describe("flanking: geometry (square grid)", () => {
  it("on either side, opposite sides: left / right, top / bottom", () => {
    expect(flanks(target, at(4, 5), at(6, 5))).toBe(true);
    expect(flanks(target, at(5, 4), at(5, 6))).toBe(true);
  });
  it("opposite corners", () => {
    expect(flanks(target, at(4, 4), at(6, 6))).toBe(true);
    expect(flanks(target, at(6, 4), at(4, 6))).toBe(true);
  });
  it("adjacent sides, or side by side: no flanking", () => {
    expect(flanks(target, at(4, 5), at(5, 4))).toBe(false);   // gauche + haut
    expect(flanks(target, at(4, 5), at(4, 4))).toBe(false);   // side by side on the left
    expect(flanks(target, at(4, 4), at(6, 4))).toBe(false);   // deux coins du haut
  });
  it("a corner and the offset opposite side: no flanking (the line exits through a neighboring side)", () => {
    expect(flanks(target, at(4, 4), at(6, 5))).toBe(false);
  });
  it("one of the two not in contact: no flanking", () => {
    expect(flanks(target, at(3, 5), at(6, 5))).toBe(false);
  });
  it("a Large target: on either side of its four cells", () => {
    const big = at(5, 5, 2, 2);
    expect(flanks(big, at(4, 5), at(7, 6))).toBe(true);    // gauche (haut) / droite (bas)
    expect(flanks(big, at(5, 4), at(6, 7))).toBe(true);    // haut / bas
    expect(flanks(big, at(4, 5), at(5, 4))).toBe(false);   // gauche / haut
  });
  it("a Large attacker: it is enough that one of its cells fits", () => {
    expect(flanks(target, at(3, 4, 2, 2), at(6, 5))).toBe(true);
    expect(flanks(target, at(3, 3, 2, 2), at(6, 6))).toBe(true);   // sa case (4, 4) et le coin (6, 6)
  });
  it("tools: contact, centers, crossing", () => {
    expect(touchesBox({ x: 4.5, y: 5.5 }, target)).toBe(true);
    expect(touchesBox({ x: 5.5, y: 5.5 }, target)).toBe(false);   // dans l'espace
    expect(touchesBox({ x: 3.5, y: 5.5 }, target)).toBe(false);
    expect(cellCenters(at(0, 0, 2, 1))).toEqual([{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }]);
    expect(cellCenters(at(0, 0, 0.5, 0.5))).toEqual([{ x: 0.25, y: 0.25 }]);
    expect(crossesOpposite({ x: 4.5, y: 5.5 }, { x: 6.5, y: 5.5 }, target)).toBe(true);
    expect(crossesOpposite({ x: 4.5, y: 4.5 }, { x: 4.5, y: 6.5 }, target)).toBe(false);   // passes beside
  });
});

describe("flanking: settings", () => {
  it("disabled by default", () => {
    expect(flankingApplies({ mode: "off", side: "all", attackerIsPc: true })).toBe(false);
  });
  it("PJ et PNJ, PJ seulement, PNJ seulement", () => {
    expect(flankingApplies({ mode: "advantage", side: "all", attackerIsPc: false })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "pc", attackerIsPc: true })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "pc", attackerIsPc: false })).toBe(false);
    expect(flankingApplies({ mode: "advantage", side: "npc", attackerIsPc: false })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "npc", attackerIsPc: true })).toBe(false);
  });
});

describe("prise en tenaille : Avantage", () => {
  const attack = over => attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, ...over });
  it("gives Advantage, with the ally's name", () => {
    const m = attack({ flankedWith: "Bramo" });
    expect(m.advantage).toEqual([{ who: "situation", key: "flanking", ally: "Bramo" }]);
    expect(netMode(m)).toBe(1);
  });
  it("never ranged", () => {
    expect(attack({ ranged: true, flankedWith: "Bramo" }).advantage).toEqual([]);
  });
  it("a Disadvantage cancels it; Elusive prevents it", () => {
    expect(netMode(attack({ flankedWith: "Bramo", attacker: ["prone"] }))).toBe(0);
    expect(attack({ flankedWith: "Bramo", elusive: true }).advantage).toEqual([]);
  });
  it("does not stack with another Advantage (only one extra d20)", () => {
    expect(netMode(attack({ flankedWith: "Bramo", helped: true }))).toBe(1);
  });
});
