import { describe, it, expect } from "vitest";
import { opportunityAttackers, opportunityMisses } from "../module/scripts/core/reaction.mjs";

// §479 : pourquoi une attaque d'opportunité n'est pas proposée.
describe("attaque d'opportunité manquée : la raison", () => {
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 15, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const why = (mover, other) => opportunityMisses(mover, [other])[0] ?? null;

  it("rien quand l'attaque est proposée, ni quand l'allonge n'est pas quittée", () => {
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
    expect(opportunityMisses(pj, [zombi])).toEqual([]);
    expect(opportunityMisses(pj, [{ ...zombi, after: 5 }])).toEqual([]);
    expect(opportunityMisses(pj, [{ ...zombi, disposition: 0, before: 10 }])).toEqual([]);
  });
  it("une raison par condition, dans l'ordre de la règle", () => {
    expect(why({ ...pj, teleported: true }, zombi)).toEqual({ token: "T.z", reason: "teleported", notice: false });
    expect(why({ ...pj, disengaged: true }, zombi).reason).toBe("disengaged");
    expect(why(pj, { ...zombi, disposition: 1 }).reason).toBe("notHostile");
    expect(why(pj, { ...zombi, hasMeleeAttack: false }).reason).toBe("noMelee");
    expect(why(pj, { ...zombi, incapacitated: true }).reason).toBe("incapacitated");
    expect(why(pj, { ...zombi, reactionAvailable: false }).reason).toBe("noReaction");
    expect(why(pj, { ...zombi, seesMover: false }).reason).toBe("cantSee");
    expect(why(pj, { ...zombi, hasLineOfEffect: false }).reason).toBe("noLineOfEffect");
  });
  it("dit au MJ : un camp Neutre face à un Amical ou un Hostile, pas deux alliés", () => {
    expect(why(pj, { ...zombi, disposition: 0 }).notice).toBe(true);
    expect(why({ ...pj, disposition: 0 }, zombi).notice).toBe(true);
    expect(why(pj, { ...zombi, disposition: 1 }).notice).toBe(false);
    expect(why({ ...pj, disposition: -2 }, { ...zombi, disposition: 0 }).notice).toBe(false);
  });
  it("dit au MJ : sans attaque de mêlée, ou sans voir celui qui part ; pas une Réaction prise ni un Désengagement", () => {
    expect(why(pj, { ...zombi, hasMeleeAttack: false }).notice).toBe(true);
    expect(why(pj, { ...zombi, seesMover: false }).notice).toBe(true);
    expect(why(pj, { ...zombi, reactionAvailable: false }).notice).toBe(false);
    expect(why({ ...pj, disengaged: true }, zombi).notice).toBe(false);
    expect(why(pj, { ...zombi, hasLineOfEffect: false }).notice).toBe(false);
  });
});
