import { describe, it, expect } from "vitest";
import { forcedReasons } from "../module/scripts/core/forced.mjs";
import { FLOAT_CATEGORIES, FLOAT_KINDS, floatStyleDefault } from "../module/scripts/core/float-text.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

// §408 (issue #44, batch 1): a rule overridden — what is flagged to the GM and marked on the card.
describe("forcedReasons", () => {
  const lines = ["Ce n'est pas votre tour.", "Hors de portée : Zombi.", "Hors de portée : Zombi."];
  const budgetLines = ["Ce n'est pas votre tour."];

  it("\"Use anyway\": all the reasons, without duplicates", () => {
    expect(forcedReasons({ lines, budgetLines, action: "go" })).toEqual(["Ce n'est pas votre tour.", "Hors de portée : Zombi."]);
  });

  it("\"Use my Reaction\" settles the budget: only the other reasons remain", () => {
    expect(forcedReasons({ lines, budgetLines, action: "reaction" })).toEqual(["Hors de portée : Zombi."]);
    expect(forcedReasons({ lines: budgetLines, budgetLines, action: "reaction" })).toEqual([]);
  });

  it("\"Give up\" or window closed: nothing is overridden", () => {
    expect(forcedReasons({ lines, budgetLines, action: "cancel" })).toEqual([]);
    expect(forcedReasons({ lines, budgetLines, action: null })).toEqual([]);
  });

  it("empty reasons ignored", () => {
    expect(forcedReasons({ lines: ["", null, "Silence."], action: "go" })).toEqual(["Silence."]);
  });
});

describe("\"Forced\" feedback", () => {
  it("a floating text kind of its own, set with the notices", () => {
    expect(FLOAT_KINDS).toContain("forced");
    expect(FLOAT_CATEGORIES.forced).toBe("floatPrompts");
    expect(floatStyleDefault("forced").color).toBe("#ff9a3c");
  });

  it("un son entendu de la table", () => {
    expect(actionSound("overridden", "success")).toBeTruthy();
    expect(actionSound("overridden", "failure")).toBeNull();
  });
});

// §417: the "Impossible action" setting — what a refusal becomes.
describe("refusalOutcome", async () => {
  const { refusalOutcome, REFUSAL_MODES } = await import("../module/scripts/core/forced.mjs");
  it("by default and \"by level\": the window, the one who acts decides, the GM is warned", () => {
    for ( const mode of ["level", "window", undefined, "inconnu"] ) {
      expect(refusalOutcome(mode)).toMatchObject({ window: true, proceed: null, report: true });
    }
  });
  it("simple warning: no window, the action goes ahead, notice and flag", () => {
    expect(refusalOutcome("notice")).toMatchObject({ window: false, proceed: true, warn: true, report: true });
  });
  it("strict refusal: a player can only give up, the GM keeps the full window", () => {
    expect(refusalOutcome("strict", { isGM: false })).toMatchObject({ window: true, proceed: false, report: false });
    expect(refusalOutcome("strict", { isGM: true })).toMatchObject({ window: true, proceed: null, report: true });
  });
  it("no control: no window, no notice, no flag", () => {
    expect(refusalOutcome("off")).toMatchObject({ window: false, proceed: true, warn: false, report: false });
  });
  it("five modes, \"level\" first (the default)", () => {
    expect(REFUSAL_MODES).toEqual(["level", "window", "notice", "strict", "off"]);
  });
});
