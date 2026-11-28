import { describe, it, expect } from "vitest";
import { expiryFromText, namesStatus } from "../module/scripts/core/durations.mjs";

describe("duration written in the text (M4)", () => {
  it("English: \"its\" = the bearer, \"the <monster>'s\" = the source", () => {
    expect(expiryFromText("<p>The target has the &amp;Reference[Paralyzed apply=false] condition until the end of its next turn.</p>", ["paralyzed"])).toBe("targetEnd");
    expect(expiryFromText("<p>The target can't take Reactions until the start of its next turn.</p>", [], { alone: true })).toBe("targetStart");
    expect(expiryFromText("<p>The target has the &amp;Reference[Poisoned] condition until the start of the [[lookup @name lowercase]]’s next turn.</p>", ["poisoned"])).toBe("sourceStart");
    expect(expiryFromText("<p>…until the end of the attacking creature's next turn.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>…until the end of the target’s next turn.</p>", [], { alone: true })).toBe("targetEnd");
    expect(expiryFromText("<p>…until the start of your next turn.</p>", [], { alone: true })).toBe("sourceStart");
  });

  it("French (MM-fr, PHB-fr)", () => {
    expect(expiryFromText("<p>La cible subit l'état &amp;Reference[Paralyzed apply=false] jusqu'à la fin de son tour suivant.</p>", ["paralyzed"])).toBe("targetEnd");
    expect(expiryFromText("<p>… jusqu'au début de son propre tour suivant.</p>", [], { alone: true })).toBe("targetStart");
    expect(expiryFromText("<p>… jusqu'au début du tour suivant du [[lookup @name lowercase]]{monstre}.</p>", [], { alone: true })).toBe("sourceStart");
    expect(expiryFromText("<p>… jusqu'à la fin du tour suivant de la créature attaquante.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>… jusqu'au début du tour suivant de l'utilisateur.</p>", [], { alone: true })).toBe("sourceStart");
    expect(expiryFromText("<p>… jusqu'à la fin de votre tour suivant.</p>", [], { alone: true })).toBe("sourceEnd");
  });

  it("several durations: the sentence that names the effect's condition", () => {
    const text = "<p>Failure: the target has the &amp;Reference[Prone] condition until the start of its next turn. The target also has the &amp;Reference[Poisoned] condition until the end of the [[lookup @name lowercase]]'s next turn.</p>";
    expect(expiryFromText(text, ["prone"])).toBe("targetStart");
    expect(expiryFromText(text, ["poisoned"])).toBe("sourceEnd");
    expect(expiryFromText(text, [])).toBeNull();   // nothing to choose with: we do not guess
  });

  it("a duration written for something other than the effect's condition is not its own (Power Word Stun)", () => {
    const pws = "<p>If the target has 150 Hit Points or fewer, it has the &amp;Reference[Stunned] condition. Otherwise, its Speed is 0 until the start of your next turn.</p>";
    expect(expiryFromText(pws, ["stunned"])).toBeNull();
    // Without a condition, a duration is only taken from the description of the effect itself.
    expect(expiryFromText("<p>… until the start of your next turn.</p>", [])).toBeNull();
  });

  it("the duration follows the condition in the sentence (synthetic text, \"(A) … or (B) …\" form of the MM)", () => {
    const warp = "<p>The creature picks one: (A) the target has the &amp;Reference[Charmed apply=false] condition until the start of the creature's next turn, or (B) the target has the &amp;Reference[Prone apply=false] condition.</p>";
    expect(expiryFromText(warp, ["charmed"])).toBe("sourceStart");
    expect(expiryFromText(warp, ["prone"])).toBeNull();
  });

  it("the description of an effect that names its condition is authoritative (Death Tyrant)", () => {
    expect(namesStatus("<p>The target has the &amp;Reference[Restrained apply=false] condition and repeats the save.</p>", ["restrained"])).toBe(true);
    expect(namesStatus("<p>No condition here.</p>", ["restrained"])).toBe(false);
  });

  it("what is not a duration", () => {
    expect(expiryFromText("<p>The target has the Restrained condition and repeats the save at the end of its next turn.</p>", ["restrained"])).toBeNull();
    expect(expiryFromText("<p>The target has the Prone condition.</p>", ["prone"])).toBeNull();
    expect(expiryFromText("")).toBeNull();
  });
});
