import { describe, expect, it } from "vitest";
import { scrollCandidates, scrollSpell, slug, spellPartOf } from "../module/scripts/core/scrolls.mjs";

// The scrolls surveyed in `ravenloft-test` on 2026-10-02 (SPEC §48).
const known = new Map([
  ["healing-word", { identifier: "healing-word", level: 1, school: "evo" }],
  ["mot-de-guerison", { identifier: "healing-word", level: 1, school: "evo" }],
  ["command", { identifier: "command", level: 1, school: "enc" }],
  ["toll-the-dead", { identifier: "toll-the-dead", level: 0, school: "nec" }],
  ["spiritual-weapon", { identifier: "spiritual-weapon", level: 2, school: "evo" }],
  ["protection-from-poison", { identifier: "protection-from-poison", level: 2, school: "abj" }],
  ["protection-contre-le-poison", { identifier: "protection-from-poison", level: 2, school: "abj" }]
]);
const of = (name, originalNames=[], level=null, stamped=null) =>
  scrollSpell({ stamped, candidates: scrollCandidates({ name, originalNames }), known, level });

describe("spell slug and name", () => {
  it("dnd5e style: without accents or punctuation", () => {
    expect(slug("Mot de guérison")).toBe("mot-de-guerison");
    expect(slug("Melf's Acid Arrow")).toBe("melfs-acid-arrow");
    expect(slug("Blindness/Deafness")).toBe("blindness-deafness");
    // Like dnd5e: its "a/b" → "a-b" does not see an accented letter (\w), the slash is then removed.
    expect(slug("Cécité/Surdité")).toBe("cecitesurdite");
  });
  it("what follows the colon", () => {
    expect(spellPartOf("Parchemin de sort : Mot de guérison")).toBe("Mot de guérison");
    expect(spellPartOf("Healing Word")).toBe("Healing Word");
  });
});

describe("le sort d'un parchemin", () => {
  it("dnd5e traduit par Babele : le nom anglais d'origine", () => {
    expect(of("Parchemin: Mot de guérison", ["Healing Word"], 1)).toEqual({ identifier: "healing-word", level: 1, school: "evo" });
  });
  it("D&D Beyond import: the original name of the import, not that of the base scroll", () => {
    expect(of("Parchemin: Command", ["Spell Scroll, 1st Level", "Command"], 1)?.identifier).toBe("command");
    expect(of("Parchemin: Toll the Dead", ["Spell Scroll, Cantrip", "Toll the Dead"], 0)).toEqual({ identifier: "toll-the-dead", level: 0, school: "nec" });
  });
  it("ancien parchemin anglais : le nom seul", () => {
    expect(of("Spell Scroll: Spiritual Weapon", [], 2)?.identifier).toBe("spiritual-weapon");
  });
  it("French name alone: found by the index of translated names", () => {
    expect(of("Parchemin: Protection contre le poison")?.identifier).toBe("protection-from-poison");
  });
  it("the scroll's level wins, otherwise that of the spell", () => {
    expect(of("Spell Scroll: Spiritual Weapon", [], 4)?.level).toBe(4);
    expect(of("Spell Scroll: Spiritual Weapon")?.level).toBe(2);
  });
  it("the spell noted at creation comes before the names", () => {
    expect(of("Parchemin: Mot de guérison", [], 1, { identifier: "cure-wounds", level: 1, school: "abj" })?.identifier).toBe("cure-wounds");
  });
  it("un parchemin de base, ou un sort inconnu : rien", () => {
    expect(of("Parchemin de sort : 1er niveau", ["Spell Scroll 1st Level"])).toBeNull();
    expect(of("Spell Scroll, 1st Level")).toBeNull();
    expect(of("Parchemin: Sort maison")).toBeNull();
  });
  it("the base scroll's names are never candidates", () => {
    expect(scrollCandidates({ name: "Parchemin de sort : 2e niveau", originalNames: ["Spell Scroll, 2nd Level"] })).toEqual([]);
  });
});

import { scrollAccess, highestSlotLevel } from "../module/scripts/core/scrolls.mjs";

describe("O8g (§350) : lire un parchemin de sort", () => {
  it("hors de la liste de classe : inintelligible", () => {
    expect(scrollAccess({ level: 1, onList: false, maxLevel: 5 }).access).toBe("refused");
  });
  it("on the list, at a castable level: free; beyond: DC 10 + level check", () => {
    expect(scrollAccess({ level: 3, onList: true, maxLevel: 3 })).toEqual({ access: "free", via: "class", dc: null });
    expect(scrollAccess({ level: 5, onList: true, maxLevel: 3 })).toEqual({ access: "check", via: "class", dc: 15 });
    expect(scrollAccess({ level: 0, onList: true, maxLevel: 0 }).access).toBe("free");
  });
  it("Using Magic Items: any scroll, Arcana check beyond level 1", () => {
    expect(scrollAccess({ level: 1, onList: false, anyScroll: true })).toEqual({ access: "free", via: "device", dc: null });
    expect(scrollAccess({ level: 4, onList: false, anyScroll: true })).toEqual({ access: "check", via: "device", dc: 14 });
    expect(scrollAccess({ level: 2, onList: true, anyScroll: true, maxLevel: 2 }).access).toBe("free");
  });
  it("highest slot: slots or pact, those at 0 ignored", () => {
    expect(highestSlotLevel({ spell1: { max: 4 }, spell2: { max: 3 }, spell3: { max: 0 }, pact: { level: 0, max: 0 } })).toBe(2);
    expect(highestSlotLevel({ spell1: { max: 0 }, pact: { level: 3, max: 2 } })).toBe(3);
    expect(highestSlotLevel({})).toBe(0);
  });
});
