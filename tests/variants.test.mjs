import { describe, it, expect } from "vitest";
import { variantsOf, chooseVariant, advantageVariant, chargeOnlyEffects, straightChargeFeet } from "../module/scripts/core/variants.mjs";

const atk = (id, name, extra={}) => ({ id, type: "attack", name, ...extra });

describe("variantes d'attaque (M5)", () => {
  it("Boar's Defense: charge of 20 ft, Prone only after the charge", () => {
    const plan = variantsOf([atk("base000000000000", "Attack", { effects: ["prone00000000000"] }),
      atk("moving0000000000", "Moving Attack", { condition: "moved 20+ feet", effects: ["prone00000000000"] })]);
    expect(plan).toEqual({ base: "base000000000000", baseEffects: ["prone00000000000"],
      variants: [{ id: "moving0000000000", kind: "charge", feet: 20, effects: ["prone00000000000"] }] });
    expect(chargeOnlyEffects(plan)).toEqual(["prone00000000000"]);
    expect(chooseVariant(plan, { chargedFeet: 15 })).toBeNull();
    expect(chooseVariant(plan, { chargedFeet: 20 })).toBe("moving0000000000");
  });

  it("the charge only applies against a target of at most the stated size (activity, else a sentence of the description)", () => {
    const acts = (extra={}) => [atk("base000000000000", "Attack"),
      atk("moving0000000000", "Moving Attack", { condition: "moved 20+ feet", ...extra })];
    const said = variantsOf(acts({ sizeAtMost: "med" }));
    expect(said.variants[0].sizeAtMost).toBe("med");
    expect(chooseVariant(said, { chargedFeet: 25, targetSize: "med" })).toBe("moving0000000000");
    expect(chooseVariant(said, { chargedFeet: 25, targetSize: "sm" })).toBe("moving0000000000");
    expect(chooseVariant(said, { chargedFeet: 25, targetSize: "lg" })).toBeNull();
    // Taille de la cible inconnue : la borne ne retient rien (comme avant).
    expect(chooseVariant(said, { chargedFeet: 25 })).toBe("moving0000000000");
    const written = variantsOf(acts(), "<p>Hit: 4 damage. If the target is a Large or smaller creature and the elk moved 20+ feet"
      + " straight toward it immediately before the hit, the target takes extra damage.</p>");
    expect(written.variants[0].sizeAtMost).toBe("lg");
    expect(chooseVariant(written, { chargedFeet: 25, targetSize: "huge" })).toBeNull();
    expect(chooseVariant(written, { chargedFeet: 25, targetSize: "lg" })).toBe("moving0000000000");
    // A size stated for something other than the charge (a grapple) does not bound the charge.
    const other = variantsOf(acts(), "<p>If the target is a Medium or smaller creature, it has the Grappled condition."
      + " If the bull moved 20+ feet straight toward the target, extra damage.</p>");
    expect(other.variants[0].sizeAtMost).toBeUndefined();
  });

  it("distance read from the text when the activity does not state it (invented creature, 30 ft)", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Moving Attack")], "<p>If the skyhorn moved 30+ feet straight toward the target…</p>");
    expect(plan.variants[0].feet).toBe(30);
  });

  it("Bloodied: the swarm itself, or the target (Blood Hawk)", () => {
    const swarm = variantsOf([atk("a", ""), atk("b", "Bloodied Attack")], "<p>… or 1d4 if the swarm is Bloodied.</p>");
    expect(swarm.variants[0].subject).toBe("self");
    expect(chooseVariant(swarm, { selfBloodied: true })).toBe("b");
    expect(chooseVariant(swarm, { targetBloodied: true })).toBeNull();
    const hawk = variantsOf([atk("a", ""), atk("b", "Bloodied Attack")], "<p>… damage if the target is &amp;Reference[Bloodied].</p>");
    expect(hawk.variants[0].subject).toBe("target");
    expect(chooseVariant(hawk, { targetBloodied: true })).toBe("b");
  });

  it("Advantage: judged at the damage roll, not before", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Attack with Advantage")]);
    expect(chooseVariant(plan, { selfBloodied: true, chargedFeet: 99 })).toBeNull();
    expect(advantageVariant(plan)).toBe("b");
  });

  it("Mimic: target grappled by it", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Attacked if Grappling")]);
    expect(chooseVariant(plan, { grappledBySelf: true })).toBe("b");
  });

  it("no variant: a single attack, or attacks without a condition (Shapechanger)", () => {
    expect(variantsOf([atk("a", "")])).toBeNull();
    expect(variantsOf([atk("a", "Attack: Claws"), atk("b", "Attack: Hooves")])).toBeNull();
  });
});

describe("charge en ligne droite", () => {
  const T = { x: 10, y: 0 };
  it("quatre cases droit vers la cible : 20 ft", () => {
    expect(straightChargeFeet([{ x: 5, y: 0 }, { x: 7, y: 0 }, { x: 9, y: 0 }], T, 5)).toBe(20);
  });
  it("diagonal: one cell per step (dnd5e default rule)", () => {
    expect(straightChargeFeet([{ x: 5, y: 5 }, { x: 9, y: 1 }], T, 5)).toBe(20);
  });
  it("un coude : seule la fin droite compte", () => {
    expect(straightChargeFeet([{ x: 7, y: 5 }, { x: 7, y: 0 }, { x: 9, y: 0 }], T, 5)).toBe(10);
  });
  it("moving away or moving alongside the target does not count", () => {
    expect(straightChargeFeet([{ x: 9, y: -4 }, { x: 9, y: 0 }], { x: 13, y: 0 }, 5)).toBe(0);
    expect(straightChargeFeet([{ x: 12, y: 0 }, { x: 16, y: 0 }], T, 5)).toBe(0);
  });
  it("without movement: 0", () => {
    expect(straightChargeFeet([{ x: 9, y: 0 }], T, 5)).toBe(0);
    expect(straightChargeFeet([], T, 5)).toBe(0);
  });
});
