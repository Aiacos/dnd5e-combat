import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Wind Walk (SRD 5.2): in cloud form, neither attack nor spell", () => {
  it("the bearer of the spell's effect can neither attack nor cast spells, as under Gaseous Form", () => {
    expect(CONTENT["wind-walk"].noAttacksOrSpells).toBe(true);
    expect(CONTENT["gaseous-form"].noAttacksOrSpells).toBe(true);
  });
});
