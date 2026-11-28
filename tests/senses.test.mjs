/**
 * Generic `sense` block (core/senses.mjs): a sense declared by content — it locates a creature without seeing it, or counts as
 * a sight — and `wardsDetection`, what protects against it. Pure rule: range, walls, detected target or not, protection.
 */
import { describe, it, expect } from "vitest";
import { senseVerdict, bestVerdict, wardedAgainst, sensesIn, SENSE_VERDICTS, detectsTarget, mutedSenses, hidesIdentity, pinpoints, drawsSensed,
  onlyLocated }
  from "../module/scripts/core/senses.mjs";
import { validateEntry } from "../module/scripts/core/content/entry.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

const near = { distance: 20, walled: false, matches: true, wards: [] };

describe("declared sense: the verdict on a target", () => {
  const locate = { kind: "locate", range: 30 };
  it("in range, no wall, target detected: located; \"sight\": sight", () => {
    expect(senseVerdict(locate, near)).toBe("locate");
    expect(senseVerdict({ kind: "sight", range: 30 }, near)).toBe("sight");
  });
  it("beyond range, or the target is not of those the sense detects: nothing", () => {
    expect(senseVerdict(locate, { ...near, distance: 31 })).toBe(null);
    expect(senseVerdict(locate, { ...near, distance: 30 })).toBe("locate");
    expect(senseVerdict(locate, { ...near, matches: false })).toBe(null);
  });
  it("a wall stops it, except the sense that passes through them (`walls: false`)", () => {
    expect(senseVerdict(locate, { ...near, walled: true })).toBe(null);
    expect(senseVerdict({ ...locate, walls: false }, { ...near, walled: true })).toBe("locate");
  });
  it("`reveals: \"presence\"`: the presence is known, not the position", () => {
    expect(senseVerdict({ ...locate, reveals: "presence" }, near)).toBe("presence");
  });
  it("a sight does not see an Invisible target; a locating sense does", () => {
    expect(senseVerdict({ kind: "sight", range: 30 }, { ...near, invisible: true })).toBe(null);
    expect(senseVerdict(locate, { ...near, invisible: true })).toBe("locate");
  });
  it("a fog stops all sight; so does Darkness, except the sight that pierces it (`through`)", () => {
    const sight = { kind: "sight", range: 30 };
    const piercing = { ...sight, through: ["darkness"] };
    expect(senseVerdict(sight, { ...near, darkness: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, darkness: true })).toBe("sight");
    expect(senseVerdict(sight, { ...near, fog: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, fog: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, darkness: true, invisible: true })).toBe(null);
    // Neither fog nor Darkness stops a locating sense.
    expect(senseVerdict(locate, { ...near, fog: true, darkness: true })).toBe("locate");
  });
  it("`needs`: off while the bearer is Blinded (`sight`) or Deafened (`hearing`)", () => {
    const eyes = { kind: "sight", range: 30, needs: "sight" };
    const ears = { kind: "locate", range: 30, needs: "hearing" };
    expect(senseVerdict(eyes, { ...near, blind: true })).toBe(null);
    expect(senseVerdict(eyes, { ...near, deaf: true })).toBe("sight");
    expect(senseVerdict(ears, { ...near, deaf: true })).toBe(null);
    expect(senseVerdict(ears, { ...near, blind: true })).toBe("locate");
    // Without `needs`, neither turns it off (a sight that does not go through the eyes).
    expect(senseVerdict({ kind: "sight", range: 30 }, { ...near, blind: true, deaf: true })).toBe("sight");
  });
  it("presence alone does not depend on sight, even for a sense of kind \"sight\"", () => {
    const presence = { kind: "sight", range: 30, reveals: "presence" };
    expect(senseVerdict(presence, { ...near, invisible: true, fog: true })).toBe("presence");
  });
  it("`reveals: \"aura\"`: an aura on what is already seen — neither position nor sight; walls and protections stop it", () => {
    const aura = { kind: "locate", range: 30, reveals: "aura", magic: "div" };
    expect(senseVerdict(aura, near)).toBe("aura");
    expect(senseVerdict(aura, { ...near, distance: 35 })).toBe(null);
    expect(senseVerdict(aura, { ...near, walled: true })).toBe(null);
    expect(senseVerdict(aura, { ...near, matches: false })).toBe(null);
    expect(senseVerdict(aura, { ...near, wards: ["div"] })).toBe(null);
  });
  it("le meilleur verdict de plusieurs sens l'emporte", () => {
    expect(SENSE_VERDICTS).toEqual(["aura", "presence", "locate", "sight"]);
    expect(bestVerdict(["aura", null])).toBe("aura");
    expect(bestVerdict(["aura", "locate"])).toBe("locate");
    expect(bestVerdict(["presence", null, "locate"])).toBe("locate");
    expect(bestVerdict([null, "sight", "locate"])).toBe("sight");
    expect(bestVerdict([null, undefined])).toBe(null);
    expect(bestVerdict([])).toBe(null);
  });
});

describe("protection against detection (`wardsDetection`)", () => {
  it("a protection against a school stops only the senses of that school", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["div"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 30, magic: true }, ["div"])).toBe(false);
    expect(wardedAgainst({ kind: "locate", range: 30 }, ["div"])).toBe(false);
  });
  it("a protection against magic stops every magical sense, of a school or not, not a natural sense", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60, magic: true }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60 }, ["magic"])).toBe(false);
  });
  it("the protected target is not perceived by this sense", () => {
    expect(senseVerdict({ kind: "locate", range: 30, magic: "div" }, { ...near, wards: ["div"] })).toBe(null);
    expect(senseVerdict({ kind: "locate", range: 30 }, { ...near, wards: ["div", "magic"] })).toBe("locate");
  });
});

describe("`detectedAs`: also perceived as other types", () => {
  const undead = { "target.creatureType": ["undead"] };
  const living = { not: { "target.creatureType": ["construct", "undead"] } };
  const humanoid = { "target.creatureType": "humanoid" };
  it("without the key, only its type counts", () => {
    expect(detectsTarget(undead, humanoid)).toBe(false);
    expect(detectsTarget(living, humanoid)).toBe(true);
    expect(detectsTarget(null, humanoid)).toBe(true);
  });
  it("with it, the sense that seeks this type finds it; the one that already found it still does", () => {
    expect(detectsTarget(undead, humanoid, ["undead"])).toBe(true);
    expect(detectsTarget(living, humanoid, ["undead"])).toBe(true);
    expect(detectsTarget({ "target.creatureType": ["fiend"] }, humanoid, ["undead"])).toBe(false);
  });
  it("les autres faits de la condition tiennent toujours", () => {
    const facts = { ...humanoid, "target.hasStatus": id => id === "poisoned" };
    expect(detectsTarget({ ...undead, "target.hasStatus": "poisoned" }, facts, ["undead"])).toBe(true);
    expect(detectsTarget({ ...undead, "target.hasStatus": "diseased" }, facts, ["undead"])).toBe(false);
  });
});

describe("`senseNeeds`: a sheet sense that depends on hearing or sight", () => {
  const echo = [{ blindsight: "hearing" }];
  it("off while its bearer is Deafened, not otherwise", () => {
    expect(mutedSenses(echo, { deaf: true })).toEqual(["blindsight"]);
    expect(mutedSenses(echo, { blind: true })).toEqual([]);
    expect(mutedSenses(echo, {})).toEqual([]);
    expect(mutedSenses([], { deaf: true, blind: true })).toEqual([]);
  });
  it("plusieurs items, plusieurs sens", () => {
    const needs = [{ blindsight: "hearing" }, { seeAll: "sight", blindsight: "hearing" }, undefined];
    expect(mutedSenses(needs, { deaf: true, blind: true }).sort()).toEqual(["blindsight", "seeAll"]);
    expect(mutedSenses(needs, { blind: true })).toEqual(["seeAll"]);
  });
});

describe("setting `anonymousLocated`: the identity of a creature perceived without being seen", () => {
  it("off: never Hidden", () => {
    for ( const kind of ["heard", "located", "aura", null] ) expect(hidesIdentity(kind, false), String(kind)).toBe(false);
  });
  it("on: Hidden for a creature heard or located; not for an aura, placed on what is seen", () => {
    expect(hidesIdentity("heard", true)).toBe(true);
    expect(hidesIdentity("located", true)).toBe(true);
    expect(hidesIdentity("aura", true)).toBe(false);
    expect(hidesIdentity(null, true)).toBe(false);
  });
});

describe("the \"located, not seen\" mark of a creature displayed by a declared sense", () => {
  it("located only: the mark", () => {
    expect(onlyLocated(["locate"])).toBe(true);
    expect(onlyLocated([null, "locate", "presence"])).toBe(true);
    expect(onlyLocated([])).toBe(true);
  });
  it("seen by a declared sight, even by a single observer: no mark", () => {
    expect(onlyLocated(["sight"])).toBe(false);
    expect(onlyLocated(["locate", "sight"])).toBe(false);
  });
});

describe("declaration in the content", () => {
  it("the keys are in the schema", () => {
    expect(ENTRY_KEYS).toContain("detectedAs");
    expect(ENTRY_KEYS).toContain("senseNeeds");
    expect(ENTRY_KEYS).toContain("sense");
    expect(ENTRY_KEYS).toContain("wardsDetection");
  });
  it("an entry carries a sense or a list of senses", () => {
    const one = { kind: "locate", range: 30 };
    expect(sensesIn({ sense: one })).toEqual([one]);
    expect(sensesIn({ sense: [one, { kind: "sight", range: 10 }] })).toHaveLength(2);
    expect(sensesIn({})).toEqual([]);
    expect(sensesIn(null)).toEqual([]);
  });
  it("valid: kind, range, and the known options", () => {
    const facts = { "target.creatureType": null };
    const ok = { sense: { kind: "locate", range: 30, units: "ft", via: "effect", fromEffect: "abcdefghij012345", walls: false,
      magic: "div", reveals: "presence", detects: { "target.creatureType": ["undead"] } } };
    expect(validateEntry(ok, { facts })).toEqual([]);
    const two = { sense: [{ kind: "sight", range: 10, through: ["darkness"], needs: "sight" },
      { kind: "locate", range: 60, magic: true, needs: "hearing" }] };
    expect(validateEntry(two, { facts })).toEqual([]);
    expect(validateEntry({ wardsDetection: ["div", "magic"] }, { facts })).toEqual([]);
    expect(validateEntry({ sense: { kind: "locate", range: 30, reveals: "aura" } }, { facts })).toEqual([]);
    expect(validateEntry({ detectedAs: ["undead"] }, { facts })).toEqual([]);
    expect(validateEntry({ senseNeeds: { blindsight: "hearing", seeAll: "sight" } }, { facts })).toEqual([]);
  });
  it("refuses: unknown kind, missing range, unknown option or fact, empty protection", () => {
    const facts = { "target.creatureType": null };
    const bad = [{ sense: { kind: "smell", range: 30 } }, { sense: { kind: "locate" } }, { sense: { kind: "locate", range: 0 } },
      { sense: { kind: "locate", range: 30, colour: "red" } }, { sense: { kind: "locate", range: 30, walls: true } },
      { sense: { kind: "locate", range: 30, fromEffect: "abcdefghij012345" } },
      { sense: { kind: "locate", range: 30, reveals: "name" } },
      { sense: { kind: "locate", range: 30, through: ["darkness"] } }, { sense: { kind: "sight", range: 30, through: ["fog"] } },
      { sense: { kind: "sight", range: 30, through: [] } }, { sense: { kind: "sight", range: 30, needs: "smell" } },
      { sense: { kind: "locate", range: 30, detects: { "target.unknownFact": true } } }, { sense: [] },
      { wardsDetection: [] }, { wardsDetection: "div" }, { wardsDetection: [""] },
      { detectedAs: [] }, { detectedAs: "undead" }, { senseNeeds: {} }, { senseNeeds: { blindsight: "smell" } },
      { senseNeeds: ["blindsight"] }];
    for ( const entry of bad ) expect(validateEntry(entry, { facts }).length, JSON.stringify(entry)).toBeGreaterThan(0);
  });
});

describe("issue #107: a locating sense pinpoints a Hidden creature", () => {
  it("seen or located: the square is known, Hidden or not", () => {
    expect(pinpoints({ located: true, hidden: false, sensed: false })).toBe(true);
    expect(pinpoints({ located: true, hidden: true, sensed: false })).toBe(true);
  });
  it("Hidden, not located, but a sense that does not see reaches it: the square is known", () => {
    expect(pinpoints({ located: false, hidden: true, sensed: true })).toBe(true);
  });
  it("Hidden, and no locating sense reaches it: unknown", () => {
    expect(pinpoints({ located: false, hidden: true, sensed: false })).toBe(false);
  });
  it("not Hidden and not located: the locating sense is not asked again", () => {
    expect(pinpoints({ located: false, hidden: false, sensed: true })).toBe(false);
  });
  it("the vision cannot tell: null passes through", () => {
    expect(pinpoints({ located: null, hidden: true, sensed: true })).toBe(null);
    expect(pinpoints({ located: false, hidden: true, sensed: null })).toBe(null);
  });
  it("a declared sense draws a Hidden creature only when it locates", () => {
    expect(drawsSensed("locate", true)).toBe(true);
    expect(drawsSensed("sight", true)).toBe(false);
    expect(drawsSensed("sight", false)).toBe(true);
    expect(drawsSensed("presence", false)).toBe(false);
    expect(drawsSensed(null, true)).toBe(false);
  });
});
