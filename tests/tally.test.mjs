import { describe, it, expect } from "vitest";
import { tallyAfter, tallySettled } from "../module/scripts/core/tally.mjs";

const RULE = { successes: 3, failures: 3 };

describe("counter of repeated saves (§43.1)", () => {
  it("counts successes and failures, which need not be consecutive", () => {
    let s = tallyAfter(null, false, RULE);
    expect(s).toEqual({ successes: 0, failures: 1, settled: false, outcome: null });
    s = tallyAfter(s, true, RULE);
    s = tallyAfter(s, false, RULE);
    expect(s).toEqual({ successes: 1, failures: 2, settled: false, outcome: null });
  });

  it("three successes: the effect ends", () => {
    const s = tallyAfter({ successes: 2, failures: 2 }, true, RULE);
    expect(s.outcome).toBe("ended");
    expect(s.settled).toBe(false);
  });

  it("three failures: the effect stays, the counter is closed", () => {
    const s = tallyAfter({ successes: 2, failures: 2 }, false, RULE);
    expect(s).toEqual({ successes: 2, failures: 3, settled: true, outcome: "settled" });
    expect(tallySettled(s)).toBe(true);
    expect(tallySettled({ successes: 1, failures: 1 })).toBe(false);
    expect(tallySettled(undefined)).toBe(false);
  });

  it("different thresholds", () => {
    expect(tallyAfter(null, true, { successes: 1, failures: 5 }).outcome).toBe("ended");
    expect(tallyAfter({ failures: 1 }, false, { successes: 3, failures: 2 }).outcome).toBe("settled");
  });
});
