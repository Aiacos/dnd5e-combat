import { describe, it, expect } from "vitest";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";

describe("§214 formation au port d'armure", () => {
  const base = { attacker: [], target: [], adjacent: true, ranged: false };
  it("armor without training: Disadvantage on the attack", () => {
    expect(attackModifiers({ ...base, untrainedArmor: true }).disadvantage).toContainEqual({ who: "situation", key: "untrainedArmor" });
  });
  it("trained: nothing", () => {
    expect(attackModifiers({ ...base }).disadvantage).toEqual([]);
  });
});
