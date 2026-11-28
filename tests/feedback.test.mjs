import { describe, it, expect } from "vitest";
import { feedbackBetween } from "../module/scripts/core/feedback.mjs";

const target = (over={}) => ({ token: "Scene.s.Token.z", hit: null, critical: false, cover: null, reaction: null, save: null, ...over });
const state = (targets, step="awaitingRolls") => ({ step, targets });

describe("visual feedback: new facts of a resolution", () => {
  it("rien de neuf : rien", () => {
    const s = state([target({ hit: true })]);
    expect(feedbackBetween(s, s)).toEqual([]);
  });

  it("miss verdict, with the Cover that caused it", () => {
    const out = feedbackBetween(state([target()]), state([target({ hit: false, cover: { degree: "half", bonus: 2 } })], "missed"));
    expect(out.map(f => f.kind)).toEqual(["cover", "miss"]);
    expect(out[0].degree).toBe("half");
  });

  it("Critical Hit; a normal hit is a \"hit\" fact (§228: the display decides), with the roll total", () => {
    expect(feedbackBetween(null, state([target({ hit: true, critical: true })])).map(f => f.kind)).toEqual(["critical"]);
    expect(feedbackBetween(null, state([target({ hit: true })])).map(f => f.kind)).toEqual(["hit"]);
    const rolled = { ...state([target({ hit: false })]), attack: { roll: { total: 9 } } };
    expect(feedbackBetween(null, rolled)).toEqual([{ token: "Scene.s.Token.z", kind: "miss", roll: 9 }]);
    const adv = { ...state([target({ hit: false })]), attack: { roll: { total: 9, mode: "advantage" } } };
    expect(feedbackBetween(null, adv)).toEqual([{ token: "Scene.s.Token.z", kind: "miss", roll: 9, mode: "advantage" }]);
  });

  it("reaction that changes the verdict: its name, then the miss", () => {
    const before = state([target({ hit: true })], "awaitingReaction");
    const after = state([target({ hit: false, reaction: "Bouclier" })]);
    expect(feedbackBetween(before, after)).toEqual([
      { token: "Scene.s.Token.z", kind: "reaction", name: "Bouclier" },
      { token: "Scene.s.Token.z", kind: "miss" }
    ]);
  });

  it("saves: succeeded, failed, automatically failed — once only", () => {
    const before = state([target({ token: "a" }), target({ token: "b" }), target({ token: "c" })]);
    const after = state([
      target({ token: "a", save: { success: true, total: 15 } }),
      target({ token: "b", save: { success: false, total: 4 } }),
      target({ token: "c", save: { success: false, total: null, auto: "paralyzed" } })
    ]);
    expect(feedbackBetween(before, after)).toEqual([
      { token: "a", kind: "saveSuccess", auto: false, roll: 15 },
      { token: "b", kind: "saveFail", auto: false, roll: 4 },
      { token: "c", kind: "saveFail", auto: true }
    ]);
    expect(feedbackBetween(after, after)).toEqual([]);
  });

  it("annulation par le MJ : rien", () => {
    expect(feedbackBetween(null, state([target({ hit: false })], "undone"))).toEqual([]);
  });
});

describe("counter, unaffected (§16.25, §16.8)", () => {
  it("a counter that takes the hit is written instead of \"miss\"; an unaffected target says so", () => {
    const before = { step: "awaitingReaction", targets: [{ token: "T1", hit: true, critical: false }, { token: "T2", hit: null }] };
    const after = { step: "done", targets: [
      { token: "T1", hit: false, critical: false, reason: "duplicate", duplicate: { taken: true, dice: [4] } },
      { token: "T2", hit: null, unaffected: { reason: "type" } }
    ] };
    expect(feedbackBetween(before, after)).toEqual([{ token: "T1", kind: "duplicate" }, { token: "T2", kind: "unaffected" }]);
  });
});
