/**
 * Moving a movable area (`movable`) costs the activation of its spell — except when the rule makes it follow the caster's
 * movement (`cost: "none"`). Seen in play: moving the Celestial Summoning cylinder (SRD 5.2) took the caster's action.
 */
import { describe, it, expect } from "vitest";
import { zoneMoveCost } from "../module/scripts/core/turn.mjs";
import { MOVABLES } from "../module/scripts/content/movables.mjs";

describe("zoneMoveCost", () => {
  it("the spell's activation by default; nothing when the rule declares a zero cost", () => {
    expect(zoneMoveCost({ distance: 60, units: "ft" }, "action")).toBe("action");
    expect(zoneMoveCost({ distance: 60, units: "ft" }, "bonus")).toBe("bonus");
    expect(zoneMoveCost({ distance: 30, units: "ft", cost: "none" }, "action")).toBeNull();
    expect(zoneMoveCost({ distance: 30, units: "ft" }, "minute")).toBeNull();
    expect(zoneMoveCost(null, "action")).toBe("action");
  });
  it("the shipped content: Summon Celestial follows the movement, Moonbeam and Spiritual Dagger swarm take the action", () => {
    expect(MOVABLES["conjure-celestial"]).toEqual({ distance: 30, units: "ft", cost: "none" });
    expect(zoneMoveCost(MOVABLES["conjure-celestial"], "action")).toBeNull();
    expect(zoneMoveCost(MOVABLES.moonbeam, "action")).toBe("action");
    expect(zoneMoveCost(MOVABLES["cloud-of-daggers"], "action")).toBe("action");
  });
});
