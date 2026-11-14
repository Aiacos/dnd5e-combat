/** §441 : relevé du contenu « personnage » de Ravenloft face au moteur — les trous comblés par les briques existantes. */
import { describe, it, expect } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const AVATAR = "sjAc47PXRIIRKS0u";
/** L'activité « prendre la forme » telle que la donnée la livre : deux tranches de niveau, la troisième oubliée. */
const formSource = () => ({
  name: "Form", system: { activities: { [AVATAR]: { _id: AVATAR, type: "heal", effects: [
    { _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: 9 }, riders: { activity: [], effect: [], item: [] } },
    { _id: "TH1kqbmgrvkMohdQ", level: { min: 10, max: null }, riders: { activity: [], effect: [], item: [] } }
  ] } } },
  effects: [{ _id: "4vZQGHnDrz11Fy0j" }, { _id: "TH1kqbmgrvkMohdQ" }, { _id: "1oBMDR1fQh6rCruX" }]
});

describe("Ravenloft : sous-classes (§441)", () => {
  it("entrées valides", () => {
    for ( const id of ["form-of-dread", "necrotic-husk", "ancient-might"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "source.hasEffect": true, "activity.isAttack": true, "target.hasStatus": true } }), id).toEqual([]);
    }
  });

  it("Forme d'effroi : la tranche du niveau 14 pose l'effet d'Effroi supérieur", () => {
    const plan = dataFixPlan(formSource(), CONTENT["form-of-dread"].dataFixes);
    const effects = plan.item[`system.activities.${AVATAR}.effects`];
    expect(effects.map(e => e._id)).toEqual(["4vZQGHnDrz11Fy0j", "TH1kqbmgrvkMohdQ", "1oBMDR1fQh6rCruX"]);
    expect(effects[1].level).toEqual({ min: 10, max: 13 });
    expect(effects[2].level).toEqual({ min: 14, max: null });
    // Déjà corrigée : plus rien à faire.
    const fixed = formSource();
    fixed.system.activities[AVATAR].effects = effects;
    expect(Object.keys(dataFixPlan(fixed, CONTENT["form-of-dread"].dataFixes).item)).toEqual([]);
  });

  it("Forme d'effroi : une activité modifiée à la main ne bouge pas", () => {
    const edited = formSource();
    edited.system.activities[AVATAR].effects = [{ _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: null } }];
    expect(Object.keys(dataFixPlan(edited, CONTENT["form-of-dread"].dataFixes).item)).toEqual([]);
  });

  it("Effrayé de l'Avatar terrifiant tombe à la fin du tour suivant du lanceur", () => {
    expect(CONTENT["form-of-dread"].effectEnds).toEqual({ "3K2zIjA7tFdREiJA": "casterTurnEnd" });
  });

  it("Résilience nécrotique et Intemporel : accordés sans effet de la donnée", () => {
    expect(CONTENT["necrotic-husk"].grantsResistances).toEqual(["necrotic"]);
    expect(CONTENT["ancient-might"].grantsConditionImmunities).toEqual(["exhaustion"]);
  });
});
