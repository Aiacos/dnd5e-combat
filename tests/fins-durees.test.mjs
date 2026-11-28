/** §79: charm endings by damage from the caster's side, and generic "1 turn" durations read from the item's text. */
import { describe, it, expect } from "vitest";
import { expiryFromText } from "../module/scripts/core/durations.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("charm endings: \"if you or your allies deal damage to it\"", () => {
  for ( const id of ["charm-person", "charm-monster", "animal-friendship"] ) {
    it(id, () => {
      expect(CONTENT[id].triggers).toEqual([{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }]);
      expect(validateEntry(CONTENT[id])).toEqual([]);
    });
  }
  it("the targets stay bounded (Humanoid, Beast)", () => {
    expect(CONTENT["charm-person"].targets).toEqual({ types: ["humanoid"] });
    expect(CONTENT["animal-friendship"].targets).toEqual({ types: ["beast"] });
  });
});

describe("\"before the end of your next turn\" bounds the effect like \"until\"", () => {
  it("anglais", () => {
    expect(expiryFromText("<p>The next attack roll made against it before the end of your next turn has Advantage.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>…before the start of its next turn.</p>", [], { alone: true })).toBe("targetStart");
  });
  it("French", () => {
    expect(expiryFromText("<p>… avant la fin de votre prochain tour.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>… avant le début de son tour suivant.</p>", [], { alone: true })).toBe("targetStart");
  });
});

describe("fallback of a generic duration to the item's text (fallback)", () => {
  it("condition written without a link: the single duration of the text", () => {
    const menacing = "<p>The target must succeed on a Wisdom saving throw or have the Frightened condition until the end of your next turn.</p>";
    expect(expiryFromText(menacing, ["frightened"])).toBeNull();
    expect(expiryFromText(menacing, ["frightened"], { fallback: true })).toBe("sourceEnd");
  });
  it("effect without a condition: the single duration of the text, even repeated", () => {
    const slasher = "<p>…reduce the Speed of that creature by 10 feet until the start of your next turn. …it has Disadvantage on attack rolls until the start of your next turn.</p>";
    expect(expiryFromText(slasher, [])).toBeNull();
    expect(expiryFromText(slasher, [], { fallback: true })).toBe("sourceStart");
  });
  it("different durations: nothing", () => {
    const two = "<p>…until the start of its next turn. …until the end of your next turn.</p>";
    expect(expiryFromText(two, [], { fallback: true })).toBeNull();
  });
  it("the condition named elsewhere without a duration does not take that of another sentence", () => {
    const pws = "<p>If the target has 150 Hit Points or fewer, it has the &amp;Reference[Stunned] condition. Otherwise, its Speed is 0 until the start of your next turn.</p>";
    expect(expiryFromText(pws, ["stunned"], { fallback: true })).toBeNull();
  });
});
