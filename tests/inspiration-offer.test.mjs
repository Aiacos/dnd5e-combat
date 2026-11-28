import { describe, it, expect } from "vitest";
import { inspirationOffer } from "../module/scripts/core/inspiration.mjs";

describe("§148 : Inspiration bardique, proposer ou non", () => {
  it("sans seuil connu : toujours (au joueur de juger)", () => {
    expect(inspirationOffer({ total: 13, needed: null, max: 6 })).toBe("offer");
  });
  it("success: nothing", () => {
    expect(inspirationOffer({ total: 15, needed: 15, max: 6 })).toBe("success");
  });
  it("miss but recoverable: offered; even the die's maximum would not be enough: nothing", () => {
    expect(inspirationOffer({ total: 13, needed: 19, max: 6 })).toBe("offer");
    expect(inspirationOffer({ total: 13, needed: 20, max: 6 })).toBe("hopeless");
    expect(inspirationOffer({ total: 13, needed: 20, max: null })).toBe("offer");
  });
});
