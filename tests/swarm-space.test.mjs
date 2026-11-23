import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { traitBlocksHealing } from "../module/scripts/core/healing-block.mjs";

const FACTS = { "target.sharesSpaceWithSource": () => true, "target.grappledBySource": () => true };

describe("§505 (B25) : nuée — pas de PV temporaires, cibles dans son espace", () => {
  it("blocksTempHp : true ou une liste d'effets", () => {
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

describe("§505 : nuée — ni PV regagnés, ni PV temporaires", () => {
  it("le contenu livré : espace partagé, soins et PV temporaires bloqués", () => {
    expect(CONTENT.swarm).toMatchObject({ sharesSpace: "mutual", blocksHealing: true, blocksTempHp: true });
  });
  it("un trait sans effet qui déclare blocksHealing vaut pour la créature qui le porte", () => {
    expect(traitBlocksHealing({ rule: true, effects: 0 })).toBe(true);
  });
  it("un item qui pose des effets ne bloque pas son propriétaire (Contact glacial : le lanceur se soigne)", () => {
    expect(traitBlocksHealing({ rule: true, effects: 1 })).toBe(false);
    expect(CONTENT["chill-touch"].blocksHealing).toBe(true);
  });
  it("une liste d'effets, ou pas de règle : jamais le porteur du trait", () => {
    expect(traitBlocksHealing({ rule: ["aaaaaaaaaaaaaaaa"], effects: 0 })).toBe(false);
    expect(traitBlocksHealing({ rule: null, effects: 0 })).toBe(false);
    expect(traitBlocksHealing()).toBe(false);
  });
});

