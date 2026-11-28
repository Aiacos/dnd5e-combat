import { describe, it, expect } from "vitest";
import {
  normalizeLock, isKey, judgeAttempt, normalizeTries, alreadyTried, recordTry, lockChoices, stateAfter, triesKey, attemptReport
} from "../module/scripts/core/locks.mjs";

describe("serrure d'une porte (§244)", () => {
  it("reads the flag without trusting it: empty or invalid DC = the GM decides", () => {
    expect(normalizeLock(undefined)).toEqual({ pickDc: null, forceDc: null, unforceable: false, key: "" });
    expect(normalizeLock({ pickDc: "", forceDc: null })).toMatchObject({ pickDc: null, forceDc: null });
    expect(normalizeLock({ pickDc: "15", forceDc: 0, unforceable: "yes", key: "  Clé de la crypte " }))
      .toEqual({ pickDc: 15, forceDc: null, unforceable: false, key: "Clé de la crypte" });
    expect(normalizeLock({ pickDc: 12.6, forceDc: 20, unforceable: true })).toMatchObject({ pickDc: 13, forceDc: 20, unforceable: true });
  });

  it("recognizes the key by its name (case and spaces ignored) or by its identifier", () => {
    expect(isKey({ name: "Clé de la crypte" }, "clé de la crypte ")).toBe(true);
    expect(isKey({ name: "Crypt Key", identifier: "crypt-key" }, "crypt-key")).toBe(true);
    expect(isKey({ name: "Clé rouillée" }, "Clé de la crypte")).toBe(false);
    expect(isKey({ name: "" }, "")).toBe(false);
  });

  it("judges an attempt against the DC; without a DC, the GM rules; a non-forceable door resists", () => {
    const lock = normalizeLock({ pickDc: 15, forceDc: 20 });
    expect(judgeAttempt(lock, "pick", 15)).toBe("success");
    expect(judgeAttempt(lock, "pick", 14)).toBe("failure");
    expect(judgeAttempt(lock, "force", 25)).toBe("success");
    expect(judgeAttempt(normalizeLock({}), "pick", 30)).toBe("gm");
    expect(judgeAttempt(normalizeLock({ forceDc: 5, unforceable: true }), "force", 30)).toBe("failure");
    expect(judgeAttempt(lock, "pick", NaN)).toBe("failure");
  });

  it("records a failed attempt per character only with the \"one attempt\" setting", () => {
    expect(recordTry({}, "Actor.a", "pick", "free")).toEqual({});
    const tries = recordTry({}, "Actor.a", "pick", "once");
    expect(tries).toEqual({ "Actor.a": ["pick"] });
    expect(recordTry(tries, "Actor.a", "pick", "once")).toEqual({ "Actor.a": ["pick"] });
    expect(alreadyTried(tries, "Actor.a", "pick", "once")).toBe(true);
    expect(alreadyTried(tries, "Actor.a", "force", "once")).toBe(false);
    expect(alreadyTried(tries, "Actor.b", "pick", "once")).toBe(false);
    expect(alreadyTried(tries, "Actor.a", "pick", "free")).toBe(false);
    expect(normalizeTries({ "Actor.a": ["pick", "bogus", "pick"], "Actor.b": "force", "Actor.c": [] }))
      .toEqual({ "Actor.a": ["pick"], "Actor.b": ["force"] });
  });

  it("records attempts under a key without dots (Foundry would unfold \"Actor.abc\")", () => {
    expect(triesKey("Scene.s1.Token.t1.Actor.a1")).toBe("Scene_s1_Token_t1_Actor_a1");
    expect(triesKey(undefined)).toBe("");
  });

  it("offers the key to whoever carries it, lock picking, and forcing except a non-forceable door", () => {
    const lock = normalizeLock({ key: "Clé", unforceable: false });
    expect(lockChoices(lock, { hasKey: true })).toEqual([
      { method: "key", spent: false }, { method: "pick", spent: false }, { method: "force", spent: false }
    ]);
    expect(lockChoices(lock, { hasKey: false }).map(c => c.method)).toEqual(["pick", "force"]);
    // O9d (§357): without thieves' tools, no lock picking.
    expect(lockChoices(lock, { hasKey: false, hasTools: false }).map(c => c.method)).toEqual(["force"]);
    expect(lockChoices(normalizeLock({ unforceable: true }), {}).map(c => c.method)).toEqual(["pick"]);
    expect(lockChoices(normalizeLock({}), { tries: { "Actor.a": ["pick"] }, who: "Actor.a", mode: "once" }))
      .toEqual([{ method: "pick", spent: true }, { method: "force", spent: false }]);
  });

  it("picked or opened with the key, the door stays closed; forced, it opens", () => {
    expect(stateAfter("pick")).toBe("closed");
    expect(stateAfter("key")).toBe("closed");
    expect(stateAfter("force")).toBe("open");
  });
});

describe("hook lockAttempt (§247)", () => {
  it("reports the method, the outcome and the total", () => {
    expect(attemptReport("pick", "failure", 7)).toEqual({ method: "pick", outcome: "failure", total: 7 });
    expect(attemptReport("force", "success", "21")).toEqual({ method: "force", outcome: "success", total: 21 });
    expect(attemptReport("pick", "gm", 14)).toEqual({ method: "pick", outcome: "gm", total: 14 });
  });
  it("no total for the key or for an unreadable total", () => {
    expect(attemptReport("key", "success", undefined).total).toBeNull();
    expect(attemptReport("pick", "failure", NaN).total).toBeNull();
    expect(attemptReport("pick", "failure", null).total).toBeNull();
  });
});
