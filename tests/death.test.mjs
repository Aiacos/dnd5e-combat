import { describe, it, expect } from "vitest";
import { makesDeathSaves, damageAtZero, needsDeathSave, statusAfterDeathSave } from "../module/scripts/core/death.mjs";

describe("who makes death saving throws", () => {
  it("PCs and important NPCs, not the other NPCs", () => {
    expect(makesDeathSaves({ type: "character" })).toBe(true);
    expect(makesDeathSaves({ type: "npc", important: true })).toBe(true);
    expect(makesDeathSaves({ type: "npc", important: false })).toBe(false);
    expect(makesDeathSaves({ type: "vehicle" })).toBe(false);
  });
});

describe("damage and 0 HP", () => {
  const pj = { max: 30, saves: true };

  it("dropping to 0 without enough remainder: nothing more (the system applies Unconscious)", () => {
    expect(damageAtZero({ ...pj, hp: 10, through: 25 })).toMatchObject({ failures: null, dead: false });
  });
  it("Instant Death: the remainder reaches max HP", () => {
    expect(damageAtZero({ ...pj, hp: 10, through: 40 })).toMatchObject({ dead: true, reason: "massive", failures: null });
    expect(damageAtZero({ ...pj, hp: 10, through: 39 }).dead).toBe(false);
  });
  it("at 0 HP: one failure, two on a Critical Hit", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 5 })).toMatchObject({ failures: 1, added: 1, dead: false, unstable: true });
    expect(damageAtZero({ ...pj, hp: 0, through: 5, critical: true, failures: 0 })).toMatchObject({ failures: 2, added: 2 });
  });
  it("at 0 HP: the third failure kills, without exceeding three", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 5, failures: 2 })).toMatchObject({ failures: 3, dead: true, reason: "failures" });
    expect(damageAtZero({ ...pj, hp: 0, through: 5, failures: 2, critical: true }).failures).toBe(3);
  });
  it("at 0 HP: damage at least equal to max HP kills", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 30 })).toMatchObject({ dead: true, reason: "massive" });
  });
  it("nothing for whoever makes no death saving throws, nor without damage that gets past Temporary Hit Points", () => {
    expect(damageAtZero({ hp: 0, max: 30, through: 50, saves: false }).dead).toBe(false);
    expect(damageAtZero({ ...pj, hp: 0, through: 0 }).failures).toBeNull();
  });
});

describe("death saving throw at the start of the turn", () => {
  const base = { hp: 0, saves: true, statuses: ["unconscious"] };
  it("at 0 HP, neither stable nor dead: yes", () => {
    expect(needsDeathSave(base)).toBe(true);
    expect(needsDeathSave({ ...base, failures: 2, successes: 2 })).toBe(true);
  });
  it("no: HP above 0, stable, dead, three failures, or no death saving throws", () => {
    expect(needsDeathSave({ ...base, hp: 1 })).toBe(false);
    expect(needsDeathSave({ ...base, statuses: ["stable"] })).toBe(false);
    expect(needsDeathSave({ ...base, statuses: ["dead"] })).toBe(false);
    expect(needsDeathSave({ ...base, failures: 3 })).toBe(false);
    expect(needsDeathSave({ ...base, saves: false })).toBe(false);
  });
});

describe("after a death saving throw", () => {
  it("three successes: Stable; three failures: Dead; otherwise nothing", () => {
    expect(statusAfterDeathSave("stable")).toBe("stable");
    expect(statusAfterDeathSave("death")).toBe("dead");
    expect(statusAfterDeathSave("revive")).toBeNull();
    expect(statusAfterDeathSave(null)).toBeNull();
  });
});

import { downedStatus, isDead } from "../module/scripts/core/death.mjs";

describe("§17.1: the mandatory condition at 0 HP", () => {
  it("ordinary NPC at 0 HP: Dead; PC: Unconscious; three failures: Dead", () => {
    expect(downedStatus({ hp: 0, saves: false, statuses: [] })).toBe("dead");
    expect(downedStatus({ hp: 0, saves: true, statuses: [] })).toBe("unconscious");
    expect(downedStatus({ hp: 0, saves: true, statuses: ["unconscious"], failures: 3 })).toBe("dead");
  });
  it("nothing to apply: remaining HP, already dead, already unconscious", () => {
    expect(downedStatus({ hp: 3, saves: false, statuses: [] })).toBe(null);
    expect(downedStatus({ hp: 0, saves: false, statuses: ["dead"] })).toBe(null);
    expect(downedStatus({ hp: 0, saves: true, statuses: ["unconscious", "incapacitated"] })).toBe(null);
  });
  it("dead: the condition, or 0 HP with no death saving throws", () => {
    expect(isDead({ hp: 0, saves: false, statuses: [] })).toBe(true);
    expect(isDead({ hp: 0, saves: true, statuses: ["unconscious"] })).toBe(false);
    expect(isDead({ hp: 5, saves: true, statuses: ["dead"] })).toBe(true);
  });
});

import { canStabilize } from "../module/scripts/core/death.mjs";

describe("§50 : stabiliser (trousse de soins)", () => {
  it("at 0 HP, neither dead nor already stable", () => {
    expect(canStabilize({ hp: 0, statuses: ["unconscious"] })).toBe(true);
    expect(canStabilize({ hp: 3, statuses: [] })).toBe(false);
    expect(canStabilize({ hp: 0, statuses: ["dead"] })).toBe(false);
    expect(canStabilize({ hp: 0, statuses: ["unconscious", "stable"] })).toBe(false);
  });
});
