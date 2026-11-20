import { describe, expect, it } from "vitest";
import { healingTotal, withMaxRaise } from "../module/scripts/core/heal-raises-max.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("healRaisesMax : le soin tiré relève aussi les PV maximum (Festin des héros)", () => {
  it("le total des parts de soin, et seulement d'elles", () => {
    expect(healingTotal([{ type: "healing", value: 6 }, { type: "healing", value: 5 }])).toBe(11);
    expect(healingTotal([{ type: "fire", value: 9 }, { type: "healing", value: 4 }])).toBe(4);
    expect(healingTotal([])).toBe(0);
    expect(healingTotal(null)).toBe(0);
  });
  it("la hausse s'ajoute aux changements de l'effet, et remplace une hausse déjà là", () => {
    const base = [{ key: "system.traits.dr.value", type: "add", value: "poison" }];
    const once = withMaxRaise(base, 11);
    expect(once).toHaveLength(2);
    expect(once[1]).toMatchObject({ key: "system.attributes.hp.tempmax", type: "add", value: 11 });
    expect(withMaxRaise(once, 7).filter(c => c.key === "system.attributes.hp.tempmax")).toEqual([once[1]].map(c => ({ ...c, value: 7 })));
    expect(base).toHaveLength(1);
  });
  it("Festin des héros la déclare, avec les effets posés d'abord", () => {
    expect(CONTENT["heroes-feast"]).toMatchObject({ effectsFirst: true, healRaisesMax: true });
    expect(validateEntry({ effectsFirst: true, healRaisesMax: true })).toEqual([]);
    expect(validateEntry({ healRaisesMax: 2 })).not.toEqual([]);
  });
});
