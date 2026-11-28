import { describe, it, expect } from "vitest";
import { chooseRoller } from "../module/scripts/core/roller.mjs";

const u = (id, over = {}) => ({ id, active: true, isGM: false, owner: true, ...over });

describe("chooseRoller", () => {
  it("the engine rolls for an NPC that only the GM owns", () => {
    expect(chooseRoller([u("mj", { isGM: true })])).toBeNull();
  });
  it("the connected player rolls for their PC", () => {
    expect(chooseRoller([u("mj", { isGM: true }), u("alice")])).toBe("alice");
  });
  it("le moteur lance si le joueur est absent", () => {
    expect(chooseRoller([u("mj", { isGM: true }), u("alice", { active: false })])).toBeNull();
  });
  it("ignores a connected player who does not own the actor", () => {
    expect(chooseRoller([u("bob", { owner: false })])).toBeNull();
  });
  it("always designates the same player when a PC is shared", () => {
    expect(chooseRoller([u("zoe"), u("alice")])).toBe("alice");
    expect(chooseRoller([u("alice"), u("zoe")])).toBe("alice");
  });
});
