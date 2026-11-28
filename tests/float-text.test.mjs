import { describe, it, expect } from "vitest";
import { FLOAT_CATEGORIES, FLOAT_CATEGORY_DEFAULTS, floatLine, floatLabel, floatFrame, floatDelays, floatEndName } from "../module/scripts/core/float-text.mjs";

describe("textes flottants (§228)", () => {
  it("each kind has a category that has a default value", () => {
    for ( const category of Object.values(FLOAT_CATEGORIES) ) expect(category in FLOAT_CATEGORY_DEFAULTS).toBe(true);
  });
  it("a disabled category shows nothing; the roll is added to the verdict", () => {
    expect(floatLine({ kind: "miss", roll: 9 }, "Raté")).toEqual({ text: "Raté", roll: 9, dieIcon: true, icon: null, mode: null });
    expect(floatLine({ kind: "miss", roll: 9 }, "Raté", { dice: false })).toEqual({ text: "Raté", roll: null, dieIcon: false, icon: null, mode: null });
    expect(floatLine({ kind: "miss" }, "Raté", { show: { floatAttacks: false } })).toBeNull();
    expect(floatLine({ kind: "cover" }, "Abri partiel")?.icon).toBe("icons/svg/shield.svg");
    expect(floatLine({ kind: "cover" }, "Abri partiel", { icons: false })?.icon).toBeNull();
  });
  it("a hit: nothing by default without a roll, its roll alone, or \"Hit\" if requested", () => {
    expect(floatLine({ kind: "hit" }, null)).toBeNull();
    expect(floatLine({ kind: "hit", roll: 17 }, null)).toEqual({ text: "", roll: 17, dieIcon: true, icon: null, mode: null });
    expect(floatLine({ kind: "hit", roll: 17 }, null, { dice: false })).toBeNull();
    expect(floatLine({ kind: "hit" }, null, { show: { floatHits: true }, hitText: "Touché" })?.text).toBe("Touché");
  });
  it("the animation stays opaque in the middle and fades out at the end", () => {
    expect(floatFrame(0).alpha).toBe(0);
    expect(floatFrame(0.5).alpha).toBe(1);
    expect(floatFrame(1).alpha).toBeCloseTo(0);
    expect(floatFrame(1).offset).toBeCloseTo(1);
    expect(floatFrame(0.5).offset).toBeCloseTo(0.5);
  });
  it("the texts of the same token are spaced out, from one volley to the next too", () => {
    const busy = new Map();
    expect(floatDelays(["a", "a", "b"], 1, 1000, busy)).toEqual([0, 1000, 0]);
    expect(floatDelays(["a"], 1, 1500, busy)).toEqual([1500]);   // "a" is free at 3000
  });
  it("§231: Advantage / Disadvantage after the total, or alone before the verdict", () => {
    const modeText = { advantage: "Avantage", disadvantage: "Désavantage" };
    const miss = floatLine({ kind: "miss", roll: 9, mode: "disadvantage" }, "Raté", { modeText });
    expect(miss.mode).toBe("disadvantage");
    expect(floatLabel(miss, modeText, "avec")).toBe("9 avec Désavantage · Raté");
    const noDice = floatLine({ kind: "miss", roll: 9, mode: "advantage" }, "Raté", { modeText, dice: false });
    expect(floatLabel(noDice, modeText, "avec")).toBe("Avantage · Raté");
    expect(floatLine({ kind: "miss", roll: 9, mode: "advantage" }, "Raté", { modeText, show: { floatAdvantage: false } }).mode).toBeNull();
    const hit = floatLine({ kind: "hit", mode: "advantage" }, null, { modeText, dice: false });
    expect(floatLabel(hit, modeText, "avec")).toBe("Avantage");
    expect(floatLine({ kind: "cover", mode: "advantage" }, "Abri", { modeText }).mode).toBeNull();
  });
});

describe("§292: ability checks and skill checks", async () => {
  const { checkKind, floatLine, floatLabel } = await import("../module/scripts/core/float-text.mjs");
  const modeText = { advantage: "Avantage", disadvantage: "Désavantage" };

  it("without a DC, the total alone; with a DC, success or failure", () => {
    expect(checkKind({ total: 15 })).toBe("check");
    expect(checkKind({ total: 15, target: null })).toBe("check");
    expect(checkKind({ total: 15, target: 12, isSuccess: true })).toBe("checkSuccess");
    expect(checkKind({ total: 9, target: 12, isFailure: true })).toBe("checkFail");
    expect(checkKind({ total: 12, target: 12 })).toBe("checkSuccess");
    expect(checkKind({ total: 11, target: "12" })).toBe("checkFail");
  });

  it("the line: total, mode, skill and verdict; cut by its category", () => {
    const line = floatLine({ kind: "checkSuccess", roll: 15, mode: "advantage" }, "Athlétisme · Réussite", { modeText });
    expect(floatLabel(line, modeText, "avec")).toBe("15 avec Avantage · Athlétisme · Réussite");
    expect(line.dieIcon).toBe(true);
    expect(floatLabel(floatLine({ kind: "check", roll: 8 }, "Force", { modeText }), modeText)).toBe("8 · Force");
    expect(floatLine({ kind: "check", roll: 8 }, "Force", { show: { floatChecks: false } })).toBeNull();
    expect(floatLabel(floatLine({ kind: "checkFail", roll: 4 }, "Discrétion · Échec", { dice: false }))).toBe("Discrétion · Échec");
  });
});

describe("§400: an effect ending announced twice", () => {
  it("the non-struck-through removal \"−(Name)\" is compared by its name alone", () => {
    expect(floatEndName("−(Sommeil)")).toBe("sommeil");
    expect(floatEndName("Sommeil")).toBe("sommeil");
    expect(floatEndName("Fin : Sommeil")).toContain(floatEndName("−(Sommeil)"));
  });
});
