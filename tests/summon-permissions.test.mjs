import { describe, it, expect } from "vitest";
import { summonGaps, gapSignature, hasNewGap, summonBlocker, SUMMON_GAPS } from "../module/scripts/core/summon-permissions.mjs";

const player = (name, tokenCreate=false, actorCreate=false) => ({ name, tokenCreate, actorCreate });

describe("summonGaps (§542, issue #43)", () => {
  it("no players: nothing to report, whatever the setting", () => {
    expect(summonGaps({ allowSummoning: false, players: [] })).toEqual([]);
  });

  it("Foundry's defaults: setting off, no Create Tokens, no Create Actors", () => {
    expect(summonGaps({ allowSummoning: false, players: [player("Ann"), player("Bob")] })).toEqual([
      { key: "allowSummoning" },
      { key: "tokenCreate", players: ["Ann", "Bob"] },
      { key: "actorCreate", players: ["Ann", "Bob"] }
    ]);
  });

  it("names only the players who lack a right (a Trusted player may have it)", () => {
    const gaps = summonGaps({ allowSummoning: true, players: [player("Ann", true, true), player("Bob", false, true)] });
    expect(gaps).toEqual([{ key: "tokenCreate", players: ["Bob"] }]);
  });

  it("everything set: no gap", () => {
    expect(summonGaps({ allowSummoning: true, players: [player("Ann", true, true)] })).toEqual([]);
  });

  it("gaps come in SUMMON_GAPS order", () => {
    const keys = summonGaps({ allowSummoning: false, players: [player("Ann")] }).map(g => g.key);
    expect(keys).toEqual([...SUMMON_GAPS]);
  });
});

describe("gapSignature / hasNewGap (« don't show again »)", () => {
  const all = summonGaps({ allowSummoning: false, players: [player("Ann")] });

  it("the signature lists the kinds, sorted, without the names", () => {
    expect(gapSignature(all)).toBe("actorCreate,allowSummoning,tokenCreate");
  });

  it("nothing dismissed: every gap is new", () => {
    expect(hasNewGap(all, "")).toBe(true);
    expect(hasNewGap(all, null)).toBe(true);
  });

  it("dismissed: silent while the kinds stay the same, even with one more player", () => {
    const more = summonGaps({ allowSummoning: false, players: [player("Ann"), player("Cid")] });
    expect(hasNewGap(more, gapSignature(all))).toBe(false);
  });

  it("a new kind of gap brings the window back", () => {
    const before = summonGaps({ allowSummoning: true, players: [player("Ann", false, true)] });
    const after = summonGaps({ allowSummoning: false, players: [player("Ann", false, true)] });
    expect(hasNewGap(after, gapSignature(before))).toBe(true);
  });

  it("no gap: nothing new", () => {
    expect(hasNewGap([], "")).toBe(false);
  });
});

describe("summonBlocker (a use without the right)", () => {
  it("Create Tokens first: dnd5e's canSummon fails on it, even for a GM", () => {
    expect(summonBlocker({ isGM: false, tokenCreate: false, allowSummoning: false })).toBe("tokenCreate");
    expect(summonBlocker({ isGM: true, tokenCreate: false, allowSummoning: true })).toBe("tokenCreate");
  });

  it("then Allow Summoning, for a player only", () => {
    expect(summonBlocker({ isGM: false, tokenCreate: true, allowSummoning: false })).toBe("allowSummoning");
    expect(summonBlocker({ isGM: true, tokenCreate: true, allowSummoning: false })).toBe(null);
  });

  it("Create Actors only when dnd5e must import the creature", () => {
    const base = { isGM: false, tokenCreate: true, allowSummoning: true, actorCreate: false };
    expect(summonBlocker({ ...base, needsImport: true })).toBe("actorCreate");
    expect(summonBlocker({ ...base, needsImport: false })).toBe(null);
  });

  it("all rights: null", () => {
    expect(summonBlocker({ isGM: false, tokenCreate: true, actorCreate: true, allowSummoning: true, needsImport: true })).toBe(null);
  });
});
