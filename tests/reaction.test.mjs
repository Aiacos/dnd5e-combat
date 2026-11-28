import { describe, it, expect } from "vitest";
import { eligibleReactions, areHostile, opportunityAttackers } from "../module/scripts/core/reaction.mjs";
import { resolveAttack } from "../module/scripts/core/attack.mjs";

describe("reaction windows", () => {
  const declared = [{ on: ["isHit"], name: "Bouclier" }, { on: ["isDamaged"], name: "Représailles infernales" }];

  it("offers only the reactions of the open window", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: true }).map(r => r.name)).toEqual(["Bouclier"]);
  });
  it("offers nothing if the Reaction is already spent", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: false })).toEqual([]);
  });
  it("offers nothing to an Incapacitated creature", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: true, incapacitated: true })).toEqual([]);
  });
  it("Shield: +5 to AC turns a hit into a miss, but not a Critical Hit", () => {
    const roll = { total: 17, isCritical: false, isFumble: false };
    const mage = { token: "T.m", name: "Magicien", ac: 13 };
    expect(resolveAttack(roll, [mage])[0].hit).toBe(true);
    expect(resolveAttack(roll, [{ ...mage, ac: 18 }])[0].hit).toBe(false);
    expect(resolveAttack({ ...roll, isCritical: true }, [{ ...mage, ac: 18 }])[0].hit).toBe(true);
  });
});

describe("camps", () => {
  it("seuls amicaux et hostiles s'opposent", () => {
    expect(areHostile(1, -1)).toBe(true);
    expect(areHostile(-1, 1)).toBe(true);
    expect(areHostile(1, 1)).toBe(false);
    expect(areHostile(0, -1)).toBe(false);
    expect(areHostile(-2, 1)).toBe(false);
  });
});

describe("Opportunity Attack", () => {
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 15, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  const pj = { disposition: 1, disengaged: false, teleported: false };

  it("triggers when an enemy leaves reach", () => {
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
  });
  it("not if it stays within reach, nor if it was not there", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, after: 5 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, before: 10 }])).toEqual([]);
  });
  it("une allonge de 10 ft couvre deux cases", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, reach: 10, after: 10 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, reach: 10, after: 15 }])).toEqual(["T.z"]);
  });
  it("not after Disengage, nor on a teleport", () => {
    expect(opportunityAttackers({ ...pj, disengaged: true }, [zombi])).toEqual([]);
    expect(opportunityAttackers({ ...pj, teleported: true }, [zombi])).toEqual([]);
  });
  it("not between allies, not without a Reaction, not without a melee attack, not Incapacitated", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, disposition: 1 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, reactionAvailable: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasMeleeAttack: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, incapacitated: true }])).toEqual([]);
  });
  it("each enemy is judged separately", () => {
    const goule = { ...zombi, token: "T.g", after: 5 };
    expect(opportunityAttackers(pj, [zombi, goule])).toEqual(["T.z"]);
  });
});

describe("Opportunity Attack and sight (P1)", () => {
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 10, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  it("one who cannot see the mover does not react; unknown does not exclude it", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: true }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: null }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
  });
});

describe("opportunityAttackers — ligne d'effet (P2)", () => {
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 10, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  it("one who cannot strike the mover (floor between them) does not react; unknown does not exclude it", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: true }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: null }])).toEqual(["T.z"]);
  });
});
