import { describe, it, expect } from "vitest";
import { skillAids, AID_REACH, GUIDANCE_REACH } from "../module/scripts/core/skill-aid.mjs";

const me = { id: "moi", self: true, inReach: true, able: true };
const clerc = { id: "clerc", inReach: true, able: true, knowsGuidance: true, canCast: true, proficient: false };
const roublard = { id: "roublard", inReach: true, able: true, proficient: true };

describe("aids to a skill check (§113)", () => {
  it("an ally in range who knows Assistance, an ally proficient in the skill: Assistance first", () => {
    expect(skillAids({ skill: "prc", candidates: [roublard, clerc, me] })).toEqual([
      { kind: "guidance", helper: "clerc" }, { kind: "help", helper: "roublard" }
    ]);
  });
  it("the tester who knows Assistance applies it to themselves, first; they do not Support themselves", () => {
    const self = { ...me, knowsGuidance: true, proficient: true };
    expect(skillAids({ skill: "prc", candidates: [clerc, self] })).toEqual([
      { kind: "guidance", helper: "moi" }, { kind: "guidance", helper: "clerc" }
    ]);
  });
  it("out of range, Incapacitated or silenced: nothing", () => {
    expect(skillAids({ skill: "prc", candidates: [me, { ...clerc, inReach: false }, { ...roublard, able: false }] })).toEqual([]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...clerc, canCast: false }] })).toEqual([]);
  });
  it("already under Assistance for this skill: only Support remains", () => {
    expect(skillAids({ skill: "prc", guided: true, candidates: [me, clerc, roublard] })).toEqual([{ kind: "help", helper: "roublard" }]);
  });
  it("a tool check: Support only (Assistance targets a skill)", () => {
    expect(skillAids({ tool: "thief", candidates: [me, clerc, roublard] })).toEqual([{ kind: "help", helper: "roublard" }]);
  });
  it("out of combat, Assistance has its own range (7.50 m): an ally too far for Support can still offer it", () => {
    const far = { ...clerc, proficient: true, inReach: false, inGuidanceReach: true };
    expect(skillAids({ skill: "prc", candidates: [me, far] })).toEqual([{ kind: "guidance", helper: "clerc" }]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...far, inGuidanceReach: false }] })).toEqual([]);
    expect(GUIDANCE_REACH).toEqual({ value: 25, units: "ft" });
  });
  it("Bardic Inspiration: a bard ally in their range, not oneself, not if the tester is already inspired", () => {
    const barde = { id: "barde", inReach: false, able: true, inspires: true, inInspirationReach: true };
    expect(skillAids({ tool: "thief", candidates: [me, barde, roublard] })).toEqual([
      { kind: "inspiration", helper: "barde" }, { kind: "help", helper: "roublard" }
    ]);
    expect(skillAids({ skill: "prc", candidates: [{ ...me, inspires: true, inInspirationReach: true }] })).toEqual([]);
    expect(skillAids({ skill: "prc", inspired: true, candidates: [me, barde] })).toEqual([]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...barde, inInspirationReach: false }] })).toEqual([]);
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, barde] })).toEqual([{ kind: "inspiration", helper: "barde" }]);
  });
  it("in combat, the same aids, but Assistance on contact only", () => {
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, clerc, roublard] })).toEqual([
      { kind: "guidance", helper: "clerc" }, { kind: "help", helper: "roublard" }
    ]);
    const far = { ...clerc, inReach: false, inGuidanceReach: true };
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, far] })).toEqual([]);
  });
  it("without skill or tool: nothing; the range of Support is contact", () => {
    expect(skillAids({ candidates: [me, clerc, roublard] })).toEqual([]);
    expect(AID_REACH).toEqual({ value: 5, units: "ft" });
  });
});
