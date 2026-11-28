/**
 * "with Advantage during the first round of each combat" (Doppelganger's Slam, SRD 5.2): the attack's activation condition,
 * read as a `preAttackRoll` trigger under the fact `combat.firstRound`, for the item's own attacks only.
 */
import { describe, it, expect } from "vitest";
import { monsterActivationAdvantage } from "../module/scripts/core/monster-text.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Advantage during the first round of combat", () => {
  const read = monsterActivationAdvantage(["with Advantage during the first round of each combat"], "slam");
  it("the activation condition becomes a trigger limited to the item's attacks", () => {
    expect(read).toEqual([{ on: "preAttackRoll", if: { all: [{ "combat.firstRound": true }, { "activity.identifier": "slam" }] },
      do: [{ type: "advantage" }] }]);
    expect(monsterActivationAdvantage(["during the first round of each combat"], "slam")).toEqual([]);
    expect(monsterActivationAdvantage(["with Advantage during the first round of each combat"], null)).toEqual([]);
  });
  it("the entry passes the validator; the condition holds in the first round, not after", () => {
    const facts = (first) => ({ "combat.firstRound": want => first === want, "activity.identifier": "slam" });
    expect(validateEntry({ triggers: read }, { facts: facts(true) })).toEqual([]);
    expect(holds(read[0].if, facts(true))).toBe(true);
    expect(holds(read[0].if, facts(false))).toBe(false);
  });
  it("the other phrasings are read as before", () => {
    expect(monsterActivationAdvantage(["with Advantage if the target doesn't have all its Hit Points"], "bite")[0].if.all[0])
      .toEqual({ "target.wounded": true });
  });
});
