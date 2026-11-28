/**
 * Nature's Veil (Ranger 14, SRD 5.2): the Invisible condition "until the end of your next turn". The item's "Veiled" effect has
 * no duration in the data: seen in play, it lasted past the end of the next turn.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";

describe("Voile de la nature", () => {
  it("the item's effect ends at the end of the Ranger's next turn", () => {
    expect(CONTENT["natures-veil"].effectEnds).toEqual({ NOSQczI2MCQ5Ha8F: "casterTurnEnd" });
    expect(validateEntry(CONTENT["natures-veil"])).toEqual([]);
  });
  it("not at the end of the turn it is applied, nor on someone else's turn", () => {
    const when = CONTENT["natures-veil"].effectEnds.NOSQczI2MCQ5Ha8F;
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: false, placedInEnded: false })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: false })).toBe(true);
  });
});
