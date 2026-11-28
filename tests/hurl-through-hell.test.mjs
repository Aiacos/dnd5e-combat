/**
 * Hurl Through Hell (Warlock, Fiend 14 — SRD 5.2): once per turn on a hit, a Charisma save; on a failure, 8d10 psychic and
 * Incapacitated until the end of the Warlock's next turn.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";

describe("Hurl Through Hell", () => {
  const entry = CONTENT["hurl-through-hell"];
  it("the item's save offered on a hit, once per turn", () => {
    expect(entry.hitRider).toEqual({ save: "vIY5Deb2vCh5POdP", oncePerTurn: true });
    expect(validateEntry(entry)).toEqual([]);
  });
  it("Incapacitated ends at the end of the Warlock's next turn, not at the end of the turn of the hit", () => {
    // The placed effect comes from the common effects pack (`uuid` in the activity): the rule follows it by its condition.
    const when = entry.effectEnds["status:incapacitated"];
    expect(when).toBe("casterTurnEnd");
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: false })).toBe(true);
  });
});
