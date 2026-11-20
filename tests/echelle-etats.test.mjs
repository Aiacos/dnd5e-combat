/** §495 (brique B15) : échelle d'états sur sauvegardes répétées (`resave.stages`) et fin sur soin magique (`endsWhen.healedByMagic`). */
import { describe, it, expect } from "vitest";
import { stageAfter } from "../module/scripts/core/tally.mjs";
import { healsMagically } from "../module/scripts/core/endings.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const RULE = { count: 2 };
const EFF = "abcdefghij123456";

describe("échelle d'états (§495)", () => {
  it("chaque échec monte d'un palier, jusqu'au dernier", () => {
    expect(stageAfter(0, false, RULE)).toEqual({ level: 1, outcome: "up" });
    expect(stageAfter(1, false, RULE)).toEqual({ level: 2, outcome: "up" });
    expect(stageAfter(2, false, RULE)).toEqual({ level: 2, outcome: "same" });
    expect(stageAfter(undefined, false, RULE)).toEqual({ level: 1, outcome: "up" });
  });

  it("chaque réussite redescend d'un palier ; au palier 0, l'effet tombe", () => {
    expect(stageAfter(2, true, RULE)).toEqual({ level: 1, outcome: "down" });
    expect(stageAfter(1, true, RULE)).toEqual({ level: 0, outcome: "down" });
    expect(stageAfter(0, true, RULE).outcome).toBe("ended");
  });

  it("`onSuccess: \"end\"` : une réussite fait tomber l'effet d'un coup", () => {
    expect(stageAfter(2, true, { count: 2, onSuccess: "end" }).outcome).toBe("ended");
  });

  it("`critEnds` : un 20 naturel fait tomber l'effet, quel que soit le palier, même sous le DD", () => {
    expect(stageAfter(2, true, { count: 2, natural20: true, critEnds: true }).outcome).toBe("ended");
    expect(stageAfter(1, false, { count: 2, natural20: true, critEnds: true }).outcome).toBe("ended");
    expect(stageAfter(2, true, { count: 2, natural20: true }).outcome).toBe("down");
    expect(stageAfter(2, true, { count: 2, natural20: false, critEnds: true }).outcome).toBe("down");
  });

  it("un palier noté hors de l'échelle est ramené dans ses bornes", () => {
    expect(stageAfter(9, true, RULE)).toEqual({ level: 1, outcome: "down" });
    expect(stageAfter(-3, false, RULE)).toEqual({ level: 1, outcome: "up" });
  });
});

describe("schéma : resave.stages, endsWhen.healedByMagic (§495)", () => {
  const entry = step => ({ triggers: [{ on: "endOfTurn", via: "effect", fromEffect: EFF, do: [{ type: "resave", ...step }] }] });
  it("accepte une échelle bien formée", () => {
    expect(validateEntry(entry({ stages: [{ effect: EFF }, { status: "paralyzed" }] }))).toEqual([]);
    expect(validateEntry(entry({ stages: [{ effect: EFF, status: "restrained" }], onSuccess: "end", critEnds: true }))).toEqual([]);
    expect(validateEntry({ endsWhen: { healedByMagic: true } })).toEqual([]);
  });
  it("refuse une échelle mal formée", () => {
    expect(validateEntry(entry({ stages: [] }))).toHaveLength(1);
    expect(validateEntry(entry({ stages: [{}] }))).toHaveLength(1);
    expect(validateEntry(entry({ stages: [{ effect: "court" }] }))).toHaveLength(1);
    expect(validateEntry(entry({ stages: [{ status: "paralyzed", other: 1 }] }))).toHaveLength(1);
    expect(validateEntry(entry({ stages: [{ status: "paralyzed" }], tally: { successes: 1, failures: 1 } }))).toHaveLength(1);
    expect(validateEntry(entry({ stages: [{ status: "paralyzed" }], onSuccess: "up" }))).toHaveLength(1);
    expect(validateEntry(entry({ onSuccess: "end" }))).toHaveLength(1);
    expect(validateEntry(entry({ critEnds: true }))).toHaveLength(1);
    expect(validateEntry({ endsWhen: { healedByMagic: "yes" } })).toHaveLength(1);
  });
});

describe("soin magique (§495)", () => {
  const spell = { spellCast: true, item: { type: "spell" }, activityType: "heal" };
  it("un sort, un objet magique, une capacité dite magique, une potion : oui", () => {
    expect(healsMagically(-8, spell)).toBe(true);
    expect(healsMagically(-8, { item: { type: "equipment", properties: ["mgc"] }, activityType: "heal" })).toBe(true);
    expect(healsMagically(-8, { item: { type: "feat", magical: true }, activityType: "heal" })).toBe(true);
    expect(healsMagically(-8, { item: { type: "consumable", subtype: "potion" }, activityType: "heal" })).toBe(true);
  });
  it("un soin ordinaire, sans source, ou des dégâts : non", () => {
    expect(healsMagically(-8, { item: { type: "feat" }, activityType: "heal" })).toBe(false);
    expect(healsMagically(-8, { item: { type: "consumable", subtype: "food" }, activityType: "heal" })).toBe(false);
    expect(healsMagically(-8, null)).toBe(false);
    expect(healsMagically(8, spell)).toBe(false);
    expect(healsMagically(0, spell)).toBe(false);
  });
});
