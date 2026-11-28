import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { isEndableEnchantment } from "../module/scripts/core/endings.mjs";

/** Spell endings (SPEC §42.2): what the schema accepts, and what the shipped content declares. */
describe("spell endings — schema", () => {
  it("effectThen : un effet de l'item en suit un autre", () => {
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" } })).toEqual([]);
    expect(validateEntry({ effectThen: {} })).toEqual(["effectThen: { effect id: effect id }"]);
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "NEFWcyysYgsE6de3" } })).toEqual(["effectThen.NEFWcyysYgsE6de3: two distinct effect ids (16 characters)"]);
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "court" } })).toHaveLength(1);
  });

  it("effectEnds: the end of the bearer's next turn", () => {
    expect(validateEntry({ effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } })).toEqual([]);
  });

  it("smite.effect: the effect placed by the smite", () => {
    expect(validateEntry({ smite: { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" } })).toEqual([]);
    expect(validateEntry({ smite: { damage: "M4KS57lcf4K6fUMU", effect: "court" } })).toHaveLength(1);
  });

  it("resave.unlessSeesOrigin : true ou absent", () => {
    const entry = unless => ({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", unlessSeesOrigin: unless }] }] });
    expect(validateEntry(entry(true))).toEqual([]);
    expect(validateEntry(entry(false))).toEqual(["triggers[0].do[0].unlessSeesOrigin: true or absent"]);
  });

  it("effectThen merges key by key across the layers", () => {
    const merged = mergeEntries([{ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" } }, { effectThen: { A0tTvLeRetrC708K: "5FPaEGhqJ5yPP2Ln" } }]);
    expect(merged.effectThen).toEqual({ NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr", A0tTvLeRetrC708K: "5FPaEGhqJ5yPP2Ln" });
  });
});

describe("tally and ending action — schema (§43)", () => {
  const resave = extra => ({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ...extra }] }] });

  it("resave.tally: positive whole-number thresholds, an optional state", () => {
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3 } }))).toEqual([]);
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3, status: "petrified" } }))).toEqual([]);
    expect(validateEntry(resave({ tally: { successes: 0, failures: 3 } }))).toHaveLength(1);
    expect(validateEntry(resave({ tally: { successes: 3 } }))).toHaveLength(1);
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3, consecutive: true } }))).toHaveLength(1);
    expect(validateEntry(resave({ keep: true, tally: { successes: 3, failures: 3 } }))).toEqual(["triggers[0].do[0].tally: not applicable with keep"]);
  });

  it("actionEnds: by the bearer or by someone else, with or without a roll", () => {
    const id = "MpToumiJ2o3S16K7";
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", roll: "save" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", roll: "check" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", verb: "wake" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", roll: "check" } } })).toEqual([]);
    // the spell's save is replayed only by the creature that suffers it
    expect(validateEntry({ actionEnds: { [id]: { by: "other", roll: "save" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { [id]: { by: "ally" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { court: { by: "bearer" } } })).toHaveLength(1);
    // §49: the condition the bearer gives itself by ending it (Greek fire: Prone) — the bearer alone, a known condition.
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", status: "prone" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", verb: "wake", status: "prone" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", status: "dead" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: {} })).toEqual(["actionEnds: { effect id: { by, roll?, verb? } }"]);
  });

  it("actionEnds merges key by key across the layers", () => {
    const merged = mergeEntries([{ actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } } }, { actionEnds: { QeYsfnjEj2T9A3C8: { by: "bearer" } } }]);
    expect(Object.keys(merged.actionEnds)).toEqual(["MpToumiJ2o3S16K7", "QeYsfnjEj2T9A3C8"]);
  });
});

describe("tally and ending action — shipped content (§43)", () => {
  it("Contagion and Flesh to Stone: three successes or three failures", () => {
    expect(CONTENT.contagion.triggers[0].do[0]).toEqual({ type: "resave", tally: { successes: 3, failures: 3 } });
    expect(CONTENT["flesh-to-stone"].triggers[0].do[0].tally).toEqual({ successes: 3, failures: 3, status: "petrified" });
    expect(CONTENT["flesh-to-stone"]).toMatchObject({ savedEffects: ["sFyjp6wt9bjyIl9W"], effectEnds: { sFyjp6wt9bjyIl9W: "casterTurnStart" } });
    // Contagion keeps its choice of ability
    expect(CONTENT.contagion.choice).toBeTruthy();
  });

  it("Otto's Irresistible Dance: the action replays the save", () => {
    expect(CONTENT["ottos-irresistible-dance"]).toMatchObject({
      actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } }, savedEffects: ["UhFtBDEZEDpVgz9G"], effectEnds: { UhFtBDEZEDpVgz9G: "bearerTurnEnd" } });
  });

  it("shaking a sleeper: Sleep, Hypnotic Pattern, Eyebite, Symbol — without losing their end on damage", () => {
    for ( const id of ["sleep", "hypnotic-pattern", "eyebite", "symbol"] ) {
      expect(Object.values(CONTENT[id].actionEnds), id).toEqual([{ by: "other", verb: "wake" }]);
    }
    for ( const id of ["sleep", "hypnotic-pattern", "eyebite"] ) expect(CONTENT[id].triggers.some(d => [].concat(d.on).includes("isDamaged")), id).toBe(true);
  });

  it("Gaseous Form without a roll, Earthquake by its check, Ensnaring Strike by someone else", () => {
    expect(Object.values(CONTENT["gaseous-form"].actionEnds)).toEqual([{ by: "bearer" }]);
    expect(Object.values(CONTENT.earthquake.actionEnds)).toEqual([{ by: "bearer", roll: "check" }]);
    expect(Object.values(CONTENT["ensnaring-strike"].actionEnds)).toEqual([{ by: "other", roll: "check" }]);
  });
});

describe("spell endings — shipped content", () => {
  const steps = (id, moment) => (CONTENT[id]?.triggers ?? []).filter(d => [].concat(d.on).includes(moment)).flatMap(d => d.do.map(s => s.type));

  it("Tasha's Hideous Laughter from the Player's Handbook carries the SRD rule", () => {
    expect(CONTENT["tashas-hideous-laughter"].triggers).toEqual(CONTENT["hideous-laughter"].triggers);
  });

  it("save replayed at the end of the turn: Hold Monster, Slow, Confusion, Sunbeam, Blinding Smite", () => {
    for ( const id of ["hold-monster", "slow", "confusion", "sunburst", "blinding-smite", "wrathful-smite"] ) expect(steps(id, "endOfTurn"), id).toEqual(["resave"]);
  });

  it("save replayed and damage on a failure: Phantasmal Killer, \"Subconscious Enemy\"", () => {
    for ( const id of ["phantasmal-killer", "weird"] ) expect(steps(id, "endOfTurn"), id).toEqual(["resave", "damage"]);
  });

  it("Searing Smite: the damage first, the save afterwards, at the start of the turn", () => {
    expect(CONTENT["searing-smite"].triggers.map(d => d.do.map(s => s.type))).toEqual([["damage"], ["resave"]]);
    expect(CONTENT["searing-smite"].smite.effect).toBe("A0tTvLeRetrC708K");
  });

  it("Vitriolic Sphere: the end-of-turn damage, then the effect ends", () => {
    expect(steps("vitriolic-sphere", "endOfTurn")).toEqual(["damage", "remove"]);
  });

  it("Fear: replayed only without line of sight to the caster", () => {
    expect(CONTENT.fear.triggers[0].do[0]).toEqual({ type: "resave", unlessSeesOrigin: true });
  });

  it("Calm Emotions ends on damage; Sanctuary and Mislead on an attack, a spell, damage", () => {
    expect(steps("calm-emotions", "isDamaged")).toEqual(["remove"]);
    for ( const id of ["sanctuary", "mislead", "invisibility"] ) expect(CONTENT[id].breaksOn, id).toEqual(["attack", "damage", "spell"]);
  });

  it("Haste: the lethargy follows, until the end of the bearer's next turn", () => {
    expect(CONTENT.haste).toMatchObject({ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" }, effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } });
  });
});

describe("§54: mark placed on the outcome (\"Oil\")", () => {
  it("a named mark, on an outcome moment", () => {
    const mark = { type: "mark", mark: "oiled", label: "Marque.Huile", seconds: 60 };
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [mark] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "mark", label: "Marque.Huile" }] }] })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ ...mark, seconds: -1 }] }] })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "startOfTurn", via: "effect", do: [mark] }] }).length).toBeGreaterThan(0);
  });
});

describe("effects that end when their bearer is Incapacitated (SRD 5.2)", () => {
  it("\"Superior Defense\" and \"Animated Shield\" declare it, like Draconic Flight", () => {
    for ( const id of ["superior-defense", "animated-shield"] ) {
      expect(CONTENT[id].endsWhen, id).toEqual({ incapacitated: "bearer" });
      expect(validateEntry(CONTENT[id]), id).toEqual([]);
    }
    expect(CONTENT["draconic-flight"].endsWhen.incapacitated).toBe("bearer");
  });
});

/** §447: a generic ending removes the enchantment that was placed, not the definition the item carries to enchant. */
describe("generic endings — the placed enchantment, not its definition", () => {
  it("a placed, active enchantment can end", () => {
    expect(isEndableEnchantment({ type: "enchantment", disabled: false, applied: true })).toBe(true);
  });

  it("the definition carried by the item (not placed) stays", () => {
    expect(isEndableEnchantment({ type: "enchantment", disabled: false, applied: false })).toBe(false);
  });

  it("§525: the profile of the item activated in its place (\"Savage Wrath\") can end", () => {
    expect(isEndableEnchantment({ type: "enchantment", disabled: false, applied: false, ownProfile: true })).toBe(true);
    expect(isEndableEnchantment({ type: "enchantment", disabled: true, applied: false, ownProfile: true })).toBe(false);
  });

  it("a deactivated enchantment, or an effect of another type, is not concerned", () => {
    expect(isEndableEnchantment({ type: "enchantment", disabled: true, applied: true })).toBe(false);
    expect(isEndableEnchantment({ type: "base", disabled: false, applied: true })).toBe(false);
    expect(isEndableEnchantment()).toBe(false);
  });

  it("sans le drapeau de dnd5e, tout enchantement actif compte (comportement d'avant)", () => {
    expect(isEndableEnchantment({ type: "enchantment", disabled: false })).toBe(true);
    expect(isEndableEnchantment({ type: "enchantment", disabled: false, applied: undefined })).toBe(true);
  });
});

