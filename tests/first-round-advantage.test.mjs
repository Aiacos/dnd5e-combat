/**
 * « with Advantage during the first round of each combat » (Coup du Doppelgänger, SRD 5.2) : la condition d'activation de
 * l'attaque, lue en déclencheur `preAttackRoll` sous le fait `combat.firstRound`, pour les attaques de l'item seulement.
 */
import { describe, it, expect } from "vitest";
import { monsterActivationAdvantage } from "../module/scripts/core/monster-text.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Avantage au premier round du combat", () => {
  const read = monsterActivationAdvantage(["with Advantage during the first round of each combat"], "slam");
  it("la condition d'activation devient un déclencheur limité aux attaques de l'item", () => {
    expect(read).toEqual([{ on: "preAttackRoll", if: { all: [{ "combat.firstRound": true }, { "activity.identifier": "slam" }] },
      do: [{ type: "advantage" }] }]);
    expect(monsterActivationAdvantage(["during the first round of each combat"], "slam")).toEqual([]);
    expect(monsterActivationAdvantage(["with Advantage during the first round of each combat"], null)).toEqual([]);
  });
  it("l'entrée passe le validateur ; la condition tient au premier round, plus ensuite", () => {
    const facts = (first) => ({ "combat.firstRound": want => first === want, "activity.identifier": "slam" });
    expect(validateEntry({ triggers: read }, { facts: facts(true) })).toEqual([]);
    expect(holds(read[0].if, facts(true))).toBe(true);
    expect(holds(read[0].if, facts(false))).toBe(false);
  });
  it("les autres tournures sont lues comme avant", () => {
    expect(monsterActivationAdvantage(["with Advantage if the target doesn't have all its Hit Points"], "bite")[0].if.all[0])
      .toEqual({ "target.wounded": true });
  });
});
