import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";

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
