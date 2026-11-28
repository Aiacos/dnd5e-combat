import { describe, it, expect } from "vitest";
import { opportunityAttackers, opportunityMisses } from "../module/scripts/core/reaction.mjs";

// §479: why an Opportunity Attack is not offered.
describe("missed Opportunity Attack: the reason", () => {
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 15, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const why = (mover, other) => opportunityMisses(mover, [other])[0] ?? null;

  it("nothing when the attack is offered, nor when the reach is not left", () => {
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
    expect(opportunityMisses(pj, [zombi])).toEqual([]);
    expect(opportunityMisses(pj, [{ ...zombi, after: 5 }])).toEqual([]);
    expect(opportunityMisses(pj, [{ ...zombi, disposition: 0, before: 10 }])).toEqual([]);
  });
  it("one reason per condition, in the rule's order", () => {
    expect(why({ ...pj, teleported: true }, zombi)).toEqual({ token: "T.z", reason: "teleported", notice: false });
    expect(why({ ...pj, disengaged: true }, zombi).reason).toBe("disengaged");
    expect(why(pj, { ...zombi, disposition: 1 }).reason).toBe("notHostile");
    expect(why(pj, { ...zombi, hasMeleeAttack: false }).reason).toBe("noMelee");
    expect(why(pj, { ...zombi, incapacitated: true }).reason).toBe("incapacitated");
    expect(why(pj, { ...zombi, reactionAvailable: false }).reason).toBe("noReaction");
    expect(why(pj, { ...zombi, seesMover: false }).reason).toBe("cantSee");
    expect(why(pj, { ...zombi, hasLineOfEffect: false }).reason).toBe("noLineOfEffect");
  });
  it("tells the GM: a Neutral side facing a Friendly or a Hostile, not two allies", () => {
    expect(why(pj, { ...zombi, disposition: 0 }).notice).toBe(true);
    expect(why({ ...pj, disposition: 0 }, zombi).notice).toBe(true);
    expect(why(pj, { ...zombi, disposition: 1 }).notice).toBe(false);
    expect(why({ ...pj, disposition: -2 }, { ...zombi, disposition: 0 }).notice).toBe(false);
  });
  it("tells the GM: without a melee attack, or not seeing the one who leaves; not a Reaction taken or a Disengage", () => {
    expect(why(pj, { ...zombi, hasMeleeAttack: false }).notice).toBe(true);
    expect(why(pj, { ...zombi, seesMover: false }).notice).toBe(true);
    expect(why(pj, { ...zombi, reactionAvailable: false }).notice).toBe(false);
    expect(why({ ...pj, disengaged: true }, zombi).notice).toBe(false);
    expect(why(pj, { ...zombi, hasLineOfEffect: false }).notice).toBe(false);
  });
});
