import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { traitBlocksHealing } from "../module/scripts/core/healing-block.mjs";

const FACTS = { "target.sharesSpaceWithSource": () => true, "target.grappledBySource": () => true };

describe("§505 (B25): swarm — no Temporary Hit Points, targets in its space", () => {
  it("blocksTempHp: true or a list of effects", () => {
    expect(validateEntry({ blocksTempHp: true })).toEqual([]);
    expect(validateEntry({ blocksTempHp: ["aaaaaaaaaaaaaaaa"] })).toEqual([]);
    expect(validateEntry({ blocksTempHp: false })).toEqual([expect.stringContaining("blocksTempHp")]);
    expect(mergeEntries([null, { sharesSpace: "mutual", blocksHealing: true }, { blocksTempHp: true }])).toMatchObject({ sharesSpace: "mutual", blocksHealing: true, blocksTempHp: true });
  });
  it("targets.requires : une condition de faits connus", () => {
    expect(validateEntry({ targets: { requires: { "target.sharesSpaceWithSource": true } } }, { facts: FACTS })).toEqual([]);
    expect(validateEntry({ targets: { requires: {} } }, { facts: FACTS })).toEqual([expect.stringContaining("requires")]);
    expect(validateEntry({ targets: { requires: { "target.inconnu": true } } }, { facts: FACTS })).toEqual([expect.stringContaining("unknown fact")]);
    expect(validateEntry({ targets: { requires: { "target.sharesSpaceWithSource": true }, unaffectedIf: { "target.grappledBySource": false } } }, { facts: FACTS })).toEqual([]);
  });
});

describe("§505: swarm — neither HP regained, nor Temporary Hit Points", () => {
  it("the shipped content: shared space, healing and Temporary Hit Points blocked", () => {
    expect(CONTENT.swarm).toMatchObject({ sharesSpace: "mutual", blocksHealing: true, blocksTempHp: true });
  });
  it("a trait without an effect that declares blocksHealing applies to the creature that bears it", () => {
    expect(traitBlocksHealing({ rule: true, effects: 0 })).toBe(true);
  });
  it("an item that places effects does not block its owner (Chill Touch: the caster heals)", () => {
    expect(traitBlocksHealing({ rule: true, effects: 1 })).toBe(false);
    expect(CONTENT["chill-touch"].blocksHealing).toBe(true);
  });
  it("a list of effects, or no rule: never the bearer of the trait", () => {
    expect(traitBlocksHealing({ rule: ["aaaaaaaaaaaaaaaa"], effects: 0 })).toBe(false);
    expect(traitBlocksHealing({ rule: null, effects: 0 })).toBe(false);
    expect(traitBlocksHealing()).toBe(false);
  });
});

