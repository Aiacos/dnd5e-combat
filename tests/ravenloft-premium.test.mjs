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

/* §446 : le lot C12 de Ravenloft — briques ajoutées ou élargies. */
import { resistanceRuleCovers } from "../module/scripts/core/feats.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const UMBRAL = "kkoILNOHSzVHTCZX";
const umbralSource = () => ({
  name: "Umbral", system: { activities: { [UMBRAL]: { _id: UMBRAL, type: "utility", effects: [] } } },
  effects: [{ _id: "vAfLEL8A1fNW5JWb", transfer: true, disabled: true }]
});

describe("Ravenloft : lot C12 (§446)", () => {
  it("entrées valides", () => {
    const facts = { "source.hasEffect": true, "activity.classSpell": true, "activity.isAttack": true, "activity.identifier": true };
    for ( const id of ["umbral-form", "power-of-shadow", "touch-of-death", "grave-touched"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["power-of-shadow"].seesThroughOwnDarkness).toBe(true);
  });

  it("schéma : seesThroughOwnDarkness booléen, ignoresResistance.from/if, spellDamageTypes sans classe", () => {
    expect(validateEntry({ seesThroughOwnDarkness: "yes" }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], from: ["short"] } }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], when: true } }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], if: { "nope.fact": true } } }, { facts: { "activity.isAttack": true } }).length).toBe(1);
    expect(validateEntry({ spellDamageTypes: { types: ["necrotic"] } })).toEqual([]);
    expect(validateEntry({ spellDamageTypes: { class: "", types: ["necrotic"] } }).length).toBe(1);
  });

  it("Forme ombrale : l'activité pose l'effet de l'item ; une activité modifiée à la main ne bouge pas", () => {
    const plan = dataFixPlan(umbralSource(), CONTENT["umbral-form"].dataFixes);
    expect(plan.item[`system.activities.${UMBRAL}.effects`]).toEqual([{ _id: "vAfLEL8A1fNW5JWb", level: { min: null, max: null } }]);
    const edited = umbralSource();
    edited.system.activities[UMBRAL].effects = [{ _id: "zzzzzzzzzzzzzzzz" }];
    expect(Object.keys(dataFixPlan(edited, CONTENT["umbral-form"].dataFixes).item)).toEqual([]);
  });

  it("Forme ombrale : l'Avantage aux attaques des sorts d'Ensorceleur tant que son effet est porté", () => {
    const [t] = CONTENT["umbral-form"].triggers;
    expect(t.on).toBe("preAttackRoll");
    expect(holds(t.if, { "source.hasEffect": id => id === "umbral-form", "activity.classSpell": "sorcerer" })).toBe(true);
    expect(holds(t.if, { "source.hasEffect": () => false, "activity.classSpell": "sorcerer" })).toBe(false);
    expect(holds(t.if, { "source.hasEffect": () => true, "activity.classSpell": "wizard" })).toBe(false);
  });

  it("Toucher de la mort : la Résistance ignorée pour le seul Contact glacial lancé par le don", () => {
    const from = CONTENT["touch-of-death"].ignoresResistance.from;
    const feat = "aaaaaaaaaaaaaaaa";
    // La copie du sort lancée par l'activité « cast » du don.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "copycopycopycopy", activityId: "bbbbbbbbbbbbbbbb",
      cachedFor: `.Item.${feat}.Activity.UZVFEmVZMhLRl5vD` })).toBe(true);
    // Le même sort, appris autrement (pas de cachedFor) : non.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "spellspellspells", activityId: "bbbbbbbbbbbbbbbb" })).toBe(false);
    // Un sort lancé par l'activité d'un AUTRE item : non.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "copycopycopycopy", cachedFor: ".Item.otherotherother1.Activity.UZVFEmVZMhLRl5vD" })).toBe(false);
    // Sans `from`, toutes les activités (Empoisonneur).
    expect(resistanceRuleCovers(undefined, { itemId: feat })).toBe(true);
  });

  it("Marqué par la tombe : attaques, sorts d'Occultiste, Cosse nécrotique ; pas un autre sort", () => {
    const cond = CONTENT["grave-touched"].ignoresResistance.if;
    const f = (o) => ({ "activity.isAttack": false, "activity.classSpell": null, "activity.identifier": null, ...o });
    expect(holds(cond, f({ "activity.isAttack": true }))).toBe(true);
    expect(holds(cond, f({ "activity.classSpell": "warlock" }))).toBe(true);
    expect(holds(cond, f({ "activity.identifier": "necrotic-husk" }))).toBe(true);
    expect(holds(cond, f({ "activity.classSpell": "cleric" }))).toBe(false);
  });

  it("Sommeil : sans effet sur Marqué par la tombe et Impérissable", () => {
    const any = CONTENT["sleep"].targets?.unaffectedIf?.any ?? CONTENT["sleep"].unaffectedIf?.any;
    expect(any).toEqual(expect.arrayContaining([{ "target.hasFeature": "grave-touched" }, { "target.hasFeature": "everlasting" }]));
  });
});

describe("Ravenloft : Gardien creux et Fantôme (§446)", () => {
  const facts = { "target.hasEffect": true, "target.within": true, "target.seesSource": true, "self.hasEffect": true, "source.nearSelf": true, "self.seesSource": true };
  it("entrées valides", () => {
    for ( const id of ["wrath-of-the-wild", "deaths-friend"] ) expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
  });
  it("Courroux sauvage : l'aura aussi à la transformation, fin à Neutralisé", () => {
    const w = CONTENT["wrath-of-the-wild"];
    expect(w.emanation).toMatchObject({ on: "ownTurnStart", whileActive: true, atStart: true });
    expect(w.endsWhen).toEqual({ incapacitated: "bearer" });
  });
  it("Représailles rôdeuses : attaque d'arme contre l'auteur, transformé, à 1,50 m, vu", () => {
    const [self, ally] = CONTENT["wrath-of-the-wild"].triggers;
    expect(self.on).toBe("isDamaged");
    expect(ally.on).toBe("allyIsHit");
    for ( const t of [self, ally] ) expect(t.do).toEqual([{ type: "use", target: "source", weapon: true }]);
    expect(holds(ally.if, { "self.hasEffect": () => false, "source.nearSelf": () => true, "self.seesSource": () => true })).toBe(false);
    expect(holds(ally.if, { "self.hasEffect": id => id === "wrath-of-the-wild", "source.nearSelf": () => true, "self.seesSource": w => w === true })).toBe(true);
  });
  it("Pourriture et violence : ni soin ni Réaction sous l'effet du niveau 11 seulement", () => {
    expect(CONTENT["wrath-of-the-wild"].noReactions).toEqual(["FU4SqQwhN1i0chUR"]);
    expect(CONTENT["wrath-of-the-wild"].blocksHealing).toEqual(["FU4SqQwhN1i0chUR"]);
  });
  it("émanation : atStart exige whileActive", () => {
    expect(validateEntry({ emanation: { on: "ownTurnStart", atStart: true } }).length).toBe(1);
    expect(validateEntry({ emanation: { on: "ownTurnStart", whileActive: true, atStart: true } })).toEqual([]);
  });
  it("Ami de la mort : une babiole d'âme à l'initiative", () => {
    expect(CONTENT["deaths-friend"].regainOnInitiative).toEqual({ item: "soul-trinkets", upTo: 1 });
  });
});
