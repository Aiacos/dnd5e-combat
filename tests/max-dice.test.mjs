import { describe, it, expect } from "vitest";
import { maximizeDice } from "../module/scripts/core/max-dice.mjs";

describe("dés de soin au maximum (§233)", () => {
  it("NdF, dF et (expression)dF deviennent leur maximum ; le reste ne bouge pas", () => {
    expect(maximizeDice("2d4 + 2")).toBe("(2*4) + 2");
    expect(maximizeDice("d8")).toBe("(1*8)");
    expect(maximizeDice("(@scale.channel-divinity.spark)d8 + @abilities.wis.mod")).toBe("((@scale.channel-divinity.spark)*8) + @abilities.wis.mod");
    expect(maximizeDice("1d4r1 + 3")).toBe("(1*4) + 3");
  });
  it("les dés gardés ou retirés (kh, kl, dh, dl) : seul ce qui reste compte", () => {
    expect(maximizeDice("4d6kh3 + 2")).toBe("(3*6) + 2");
    expect(maximizeDice("2d20kh")).toBe("(1*20)");
    expect(maximizeDice("2d20kl1")).toBe("(1*20)");
    expect(maximizeDice("4d6dl1")).toBe("(3*6)");
    expect(maximizeDice("3d8d1r1")).toBe("(2*8)");
    expect(maximizeDice("2d4kh5")).toBe("(2*4)");
    expect(maximizeDice("(@prof)d6kh2")).toBe("(min((@prof), 2)*6)");
    expect(maximizeDice("(@prof)d6dl1")).toBe("(max((@prof) - 1, 0)*6)");
  });
  it("les autres modificateurs ne changent pas le nombre de dés", () => {
    expect(maximizeDice("2d8min2")).toBe("(2*8)");
    expect(maximizeDice("3d6x6")).toBe("(3*6)");
    expect(maximizeDice("5d10cs>=8")).toBe("(5*10)");
    expect(maximizeDice("4d6df")).toBe("(4*6)");
  });
  it("un mot n'est pas un dé", () => {
    expect(maximizeDice("@flags.dnd5e.x + 5")).toBe("@flags.dnd5e.x + 5");
    expect(maximizeDice("@abilities.wis.mod")).toBe("@abilities.wis.mod");
  });
});
