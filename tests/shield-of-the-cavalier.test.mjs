import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Bouclier du cavalier (SRD 5.2) : Coup violent", () => {
  const entry = ITEM_FIXES["shield-of-the-cavalier"];
  it("un coup qui touche pousse la cible de 3 m", () => {
    const [rule] = entry.triggers;
    expect(rule.on).toBe("hit");
    expect(rule.do).toEqual([{ type: "move", mode: "push", distance: 10, units: "ft" }]);
    expect(holds(rule.if, { "activity.id": "ABPaLpY5mrKpB4ou" })).toBe(true);
    expect(holds(rule.if, { "activity.id": "Zk2NWOrZcSWTaogR" })).toBe(false);
  });
  it("À terre seulement pour une cible de la taille de l'auteur ou plus petite", () => {
    expect(entry.effectsIf).toEqual({ "target.sizeAtMost": "source" });
    const ranks = { tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 };
    const facts = (target, source) => ({ "target.sizeAtMost": size => ranks[target] <= ranks[(size === "source") ? source : size] });
    expect(holds(entry.effectsIf, facts("med", "med"))).toBe(true);
    expect(holds(entry.effectsIf, facts("sm", "med"))).toBe(true);
    expect(holds(entry.effectsIf, facts("lg", "med"))).toBe(false);
  });
  it("l'entrée est valide", () => {
    expect(validateEntry(entry, { facts: { "activity.id": true, "target.sizeAtMost": true } })).toEqual([]);
  });
});
