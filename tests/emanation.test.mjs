/** M7 (SPEC §18.11): monster auras that act — reading the original English text, and who is affected. */
import { describe, it, expect } from "vitest";
import { readEmanationText, emanationTargets } from "../module/scripts/core/emanation.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../module/scripts/content/sources.mjs";

// Texts in the form of those of the 2024 Monster Manual, enrichers included: SRD 5.2 creatures (Ghast, Pit Fiend, Azer,
// Balor), or synthetic text of the same grammar (invented creature) outside the SRD.
const STENCH = `<p><em>Constitution Saving Throw</em>: DC [[lookup @save.dc.value activity=mJbwhj3beOIB3Jgj]], any creature (other than a [[lookup @name lowercase]]) that starts its turn in a [[lookup @target.template.size activity=mJbwhj3beOIB3Jgj]]-foot Emanation originating from the [[lookup @name lowercase]]. <em>Failure</em>: The target has the &amp;Reference[Poisoned] condition until the start of its next turn. <em>Success</em>: The target is immune to the Stench of all [[lookup @name lowercase]]s for 1 hour.</p>`;
const FEAR = `<p>The [[lookup @name lowercase]] emanates an aura in a 20-foot Emanation while it doesn’t have the &amp;Reference[Incapacitated] condition. <em>Wisdom Saving Throw</em>: DC 21, any enemy that starts its turn in the aura. <em>Failure</em>: The target has the Frightened condition until the start of its next turn. <em>Success</em>: The target is immune to this [[lookup @name lowercase]]'s aura for 24 hours.</p>`;
const AZER = `<p>At the end of each of the [[lookup @name lowercase]]'s turns, each creature of the azer's choice in a 5-foot Emanation originating from the azer takes [[/damage average]] damage unless the [[lookup @name lowercase]] has the &amp;Reference[Incapacitated] condition.</p>`;
const BALOR = `<p>At the end of each of the [[lookup @name lowercase]]'s turns, each creature of the balor's choice in a 10-foot Emanation originating from the balor takes [[/damage average]] damage.</p>`;
const MOAN = `<p>Success: The target is immune to this gloomwing’s Wail for the next 24 hours.</p>`;

describe("monster emanations (M7)", () => {
  it("reads \"other than a …\", the immunity and its range", () => {
    expect(readEmanationText(STENCH)).toEqual({ active: false, kin: true, immunity: { hours: 1, all: true } });
    expect(readEmanationText(FEAR)).toEqual({ active: true, kin: false, immunity: { hours: 24, all: false } });
    expect(readEmanationText(MOAN).immunity).toEqual({ hours: 24, all: false });
  });

  it("\"unless it is Incapacitated\": Azer yes, Balor no", () => {
    expect(readEmanationText(AZER)).toMatchObject({ active: true, immunity: null });
    expect(readEmanationText(BALOR)).toMatchObject({ active: false, kin: false, immunity: null });
  });

  const source = { token: "S", disposition: -1, radius: 10, affects: "any", inactive: false };
  const c = (token, extra={}) => ({ token, disposition: 1, distance: 5, ...extra });

  it("affects whoever is in range, not the bearer, nor those out of play, nor the immune, nor the like", () => {
    expect(emanationTargets(source, [
      c("S", { distance: 0 }), c("A"), c("loin", { distance: 15 }), c("bord", { distance: 10 }), c("mort", { out: true }),
      c("immunisé", { immune: true }), c("ghast", { kin: true }), c("derrière un mur", { lineOfEffect: false }),
      c("ne voit pas", { sees: false }), c("voit ?", { sees: null })
    ])).toEqual(["A", "bord", "voit ?"]);
  });

  it("\"of its choice\": opposing sides only; bearer switched off: nobody", () => {
    const choice = { ...source, affects: "enemy" };
    expect(emanationTargets(choice, [c("PJ"), c("allié", { disposition: -1 }), c("neutre", { disposition: 0 })])).toEqual(["PJ"]);
    expect(emanationTargets({ ...source, inactive: true }, [c("PJ")])).toEqual([]);
  });

  it("the shipped content is valid", () => {
    for ( const id of ["fire-aura", "stench", "fear-aura", "vile-appearance", "death-burst", "death-throes"] ) {
      expect(CONTENT[id]?.emanation).toBeTruthy();
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    // "Each creature" (Fire Elemental, Balor): no "of its choice", and the text's radius for the Balor.
    expect(CONTENT["fire-aura"].emanation.affects).toBe("enemy");
    expect(CONTENT["mm-fire-aura-each"].emanation).toEqual({ on: "ownTurnEnd" });
    expect(CONTENT["mm-balor-fire-aura"].emanation).toEqual({ on: "ownTurnEnd", radius: 5, units: "ft" });
    for ( const id of ["mm-fire-aura-each", "mm-balor-fire-aura"] ) expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    expect(SOURCE_IDENTIFIERS["mmFireElemental0.mmFireAura000000"]).toBe("mm-fire-aura-each");
    expect(SOURCE_IDENTIFIERS["mmBalor000000000.mmFireAura000000"]).toBe("mm-balor-fire-aura");
    expect(validateEntry({ emanation: { on: "whenever" } })).toHaveLength(1);
    expect(validateEntry({ emanation: { on: "turnStart", radius: 10 } })).toHaveLength(1);   // a radius without a unit
  });
});
