/** §495 (block B15): condition ladder on repeated saves (`resave.stages`) and ending on magical healing (`endsWhen.healedByMagic`). */
import { describe, it, expect } from "vitest";
import { stageAfter } from "../module/scripts/core/tally.mjs";
import { healsMagically } from "../module/scripts/core/endings.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const RULE = { count: 2 };
const EFF = "abcdefghij123456";

describe("condition ladder (§495)", () => {
  it("each failure goes up one step, to the last", () => {
    expect(stageAfter(0, false, RULE)).toEqual({ level: 1, outcome: "up" });
    expect(stageAfter(1, false, RULE)).toEqual({ level: 2, outcome: "up" });
    expect(stageAfter(2, false, RULE)).toEqual({ level: 2, outcome: "same" });
    expect(stageAfter(undefined, false, RULE)).toEqual({ level: 1, outcome: "up" });
  });

  it("each success goes down one step; at step 0, the effect ends", () => {
    expect(stageAfter(2, true, RULE)).toEqual({ level: 1, outcome: "down" });
    expect(stageAfter(1, true, RULE)).toEqual({ level: 0, outcome: "down" });
    expect(stageAfter(0, true, RULE).outcome).toBe("ended");
  });

  it("`onSuccess: \"end\"`: one success ends the effect at once", () => {
    expect(stageAfter(2, true, { count: 2, onSuccess: "end" }).outcome).toBe("ended");
  });

  it("`critEnds`: a natural 20 ends the effect, whatever the step, even under the DC", () => {
    expect(stageAfter(2, true, { count: 2, natural20: true, critEnds: true }).outcome).toBe("ended");
    expect(stageAfter(1, false, { count: 2, natural20: true, critEnds: true }).outcome).toBe("ended");
    expect(stageAfter(2, true, { count: 2, natural20: true }).outcome).toBe("down");
    expect(stageAfter(2, true, { count: 2, natural20: false, critEnds: true }).outcome).toBe("down");
  });

  it("a step noted outside the ladder is brought back within its bounds", () => {
    expect(stageAfter(9, true, RULE)).toEqual({ level: 1, outcome: "down" });
    expect(stageAfter(-3, false, RULE)).toEqual({ level: 1, outcome: "up" });
  });
});

describe("schema: resave.stages, endsWhen.healedByMagic (§495)", () => {
  const entry = step => ({ triggers: [{ on: "endOfTurn", via: "effect", fromEffect: EFF, do: [{ type: "resave", ...step }] }] });
  it("accepts a well-formed ladder", () => {
    expect(validateEntry(entry({ stages: [{ effect: EFF }, { status: "paralyzed" }] }))).toEqual([]);
    expect(validateEntry(entry({ stages: [{ effect: EFF, status: "restrained" }], onSuccess: "end", critEnds: true }))).toEqual([]);
    expect(validateEntry({ endsWhen: { healedByMagic: true } })).toEqual([]);
  });
  it("rejects a malformed ladder", () => {
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
  it("a spell, a magic item, a feature said to be magical, a potion: yes", () => {
    expect(healsMagically(-8, spell)).toBe(true);
    expect(healsMagically(-8, { item: { type: "equipment", properties: ["mgc"] }, activityType: "heal" })).toBe(true);
    expect(healsMagically(-8, { item: { type: "feat", magical: true }, activityType: "heal" })).toBe(true);
    expect(healsMagically(-8, { item: { type: "consumable", subtype: "potion" }, activityType: "heal" })).toBe(true);
  });
  it("an ordinary heal, without a source, or damage: no", () => {
    expect(healsMagically(-8, { item: { type: "feat" }, activityType: "heal" })).toBe(false);
    expect(healsMagically(-8, { item: { type: "consumable", subtype: "food" }, activityType: "heal" })).toBe(false);
    expect(healsMagically(-8, null)).toBe(false);
    expect(healsMagically(8, spell)).toBe(false);
    expect(healsMagically(0, spell)).toBe(false);
  });
});
