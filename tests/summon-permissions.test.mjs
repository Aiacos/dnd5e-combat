import { describe, it, expect } from "vitest";
import { summonGaps, gapSignature, hasNewGap, summonBlocker, SUMMON_GAPS, summonDataProblem, SUMMON_DATA_PROBLEMS } from "../module/scripts/core/summon-permissions.mjs";

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

describe("gapSignature / hasNewGap (\"don't show again\")", () => {
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

describe("summonDataProblem (§552, Discord \"Summon spells\")", () => {
  // Find Familiar 2024: one CR-mode profile, placed on use.
  const familiar = { profiles: 1, available: 1, meantToPlace: true, placing: true, crMode: true, chosenHasCreature: true, scene: true };

  it("a summon that works has no problem, placed or waiting for the compendium browser", () => {
    expect(summonDataProblem(familiar)).toBe(null);
    expect(summonDataProblem({ ...familiar, placed: 1 })).toBe(null);
  });

  it("no profile at all: nothing to summon", () => {
    expect(summonDataProblem({ ...familiar, profiles: 0, available: 0, placing: false })).toBe("noProfile");
  });

  it("profiles, but none at this cast level", () => {
    expect(summonDataProblem({ ...familiar, profiles: 2, available: 0, placing: false })).toBe("noProfileAtLevel");
  });

  it("an activity that does not place on use is left alone when it has no profile (the card button is the way)", () => {
    expect(summonDataProblem({ ...familiar, meantToPlace: false, profiles: 0, available: 0, placing: false })).toBe(null);
    expect(summonDataProblem({ ...familiar, meantToPlace: false, placing: false })).toBe(null);
  });

  it("\"Place Summons\" unticked in dnd5e's window: the user's choice", () => {
    expect(summonDataProblem({ ...familiar, placing: false })).toBe(null);
  });

  it("no scene viewed: dnd5e does not place (create.summons false)", () => {
    expect(summonDataProblem({ ...familiar, placing: false, scene: false })).toBe("noScene");
  });

  it("a named-creature profile without a creature (SRD 2014 Animate Dead, Simulacrum)", () => {
    expect(summonDataProblem({ ...familiar, crMode: false, chosenHasCreature: false })).toBe("noCreature");
    // In CR mode the creature is picked later in the compendium browser: no uuid is expected on the profile.
    expect(summonDataProblem({ ...familiar, crMode: true, chosenHasCreature: false })).toBe(null);
  });

  it("every problem it returns is listed", () => {
    const cases = [
      { ...familiar, profiles: 0, available: 0 }, { ...familiar, available: 0 },
      { ...familiar, scene: false }, { ...familiar, crMode: false, chosenHasCreature: false }
    ];
    for ( const c of cases ) expect(SUMMON_DATA_PROBLEMS).toContain(summonDataProblem(c));
  });
});
