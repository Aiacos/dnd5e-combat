import { describe, it, expect } from "vitest";
import { contestOutcome, bestSkill } from "../module/scripts/core/contest.mjs";

describe("§72 : test en opposition", () => {
  it("strictement plus : l'auteur l'emporte", () => expect(contestOutcome(15, 12)).toBe("win"));
  it("tie: nothing changes", () => expect(contestOutcome(12, 12)).toBe("tie"));
  it("moins : la cible l'emporte", () => expect(contestOutcome(9, 12)).toBe("lose"));
  it("a missing roll: no victory", () => expect(contestOutcome(15, NaN)).toBe("lose"));
  it("the target opposes its best skill", () => {
    expect(bestSkill({ dec: 2, ins: 5, ath: 7 }, ["dec", "ins"])).toBe("ins");
    expect(bestSkill({ dec: 2 }, ["dec"])).toBe("dec");
    expect(bestSkill({}, ["dec"])).toBe("dec");
  });
});
