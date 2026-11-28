/** §441: survey of Ravenloft's "character" content against the engine — gaps filled by the existing building blocks. */
import { describe, it, expect } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const AVATAR = "sjAc47PXRIIRKS0u";
/** The "take the shape" activity as the data ships it: two level tiers, the third forgotten. */
const formSource = () => ({
  name: "Form", system: { activities: { [AVATAR]: { _id: AVATAR, type: "heal", effects: [
    { _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: 9 }, riders: { activity: [], effect: [], item: [] } },
    { _id: "TH1kqbmgrvkMohdQ", level: { min: 10, max: null }, riders: { activity: [], effect: [], item: [] } }
  ] } } },
  effects: [{ _id: "4vZQGHnDrz11Fy0j" }, { _id: "TH1kqbmgrvkMohdQ" }, { _id: "1oBMDR1fQh6rCruX" }]
});

describe("Ravenloft : sous-classes (§441)", () => {
  it("valid entries", () => {
    for ( const id of ["form-of-dread", "necrotic-husk", "ancient-might"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "source.hasEffect": true, "activity.isAttack": true, "target.hasStatus": true } }), id).toEqual([]);
    }
  });

  it("Form of Dread: the level 14 tier applies the greater Dread effect", () => {
    const plan = dataFixPlan(formSource(), CONTENT["form-of-dread"].dataFixes);
    const effects = plan.item[`system.activities.${AVATAR}.effects`];
    expect(effects.map(e => e._id)).toEqual(["4vZQGHnDrz11Fy0j", "TH1kqbmgrvkMohdQ", "1oBMDR1fQh6rCruX"]);
    expect(effects[1].level).toEqual({ min: 10, max: 13 });
    expect(effects[2].level).toEqual({ min: 14, max: null });
    // Already corrected: nothing left to do.
    const fixed = formSource();
    fixed.system.activities[AVATAR].effects = effects;
    expect(Object.keys(dataFixPlan(fixed, CONTENT["form-of-dread"].dataFixes).item)).toEqual([]);
  });

  it("Form of Dread: a hand-modified activity does not change", () => {
    const edited = formSource();
    edited.system.activities[AVATAR].effects = [{ _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: null } }];
    expect(Object.keys(dataFixPlan(edited, CONTENT["form-of-dread"].dataFixes).item)).toEqual([]);
  });

  it("Frightened from the \"Terrifying Avatar\" ends at the end of the caster's next turn", () => {
    expect(CONTENT["form-of-dread"].effectEnds).toEqual({ "3K2zIjA7tFdREiJA": "casterTurnEnd" });
  });

  it("\"Necrotic Resilience\" and \"Timeless\": granted without an effect from the data", () => {
    expect(CONTENT["necrotic-husk"].grantsResistances).toEqual(["necrotic"]);
    expect(CONTENT["ancient-might"].grantsConditionImmunities).toEqual(["exhaustion"]);
  });
});

/* §447: Ravenloft batch C12 — building blocks added or widened. */
import { resistanceRuleCovers } from "../module/scripts/core/feats.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const UMBRAL = "kkoILNOHSzVHTCZX";
const umbralSource = () => ({
  name: "Umbral", system: { activities: { [UMBRAL]: { _id: UMBRAL, type: "utility", effects: [] } } },
  effects: [{ _id: "vAfLEL8A1fNW5JWb", transfer: true, disabled: true }]
});

describe("Ravenloft : lot C12 (§447)", () => {
  it("valid entries", () => {
    const facts = { "source.hasEffect": true, "activity.classSpell": true, "activity.isAttack": true, "activity.identifier": true };
    for ( const id of ["umbral-form", "power-of-shadow", "touch-of-death", "grave-touched"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["power-of-shadow"].seesThroughOwnDarkness).toBe(true);
  });

  it("schema: seesThroughOwnDarkness boolean, ignoresResistance.from/if, spellDamageTypes without class", () => {
    expect(validateEntry({ seesThroughOwnDarkness: "yes" }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], from: ["short"] } }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], when: true } }).length).toBe(1);
    expect(validateEntry({ ignoresResistance: { types: ["necrotic"], if: { "nope.fact": true } } }, { facts: { "activity.isAttack": true } }).length).toBe(1);
    expect(validateEntry({ spellDamageTypes: { types: ["necrotic"] } })).toEqual([]);
    expect(validateEntry({ spellDamageTypes: { class: "", types: ["necrotic"] } }).length).toBe(1);
  });

  it("Umbral Form: the activity applies the item's effect; a hand-modified activity does not change", () => {
    const plan = dataFixPlan(umbralSource(), CONTENT["umbral-form"].dataFixes);
    expect(plan.item[`system.activities.${UMBRAL}.effects`]).toEqual([{ _id: "vAfLEL8A1fNW5JWb", level: { min: null, max: null } }]);
    const edited = umbralSource();
    edited.system.activities[UMBRAL].effects = [{ _id: "zzzzzzzzzzzzzzzz" }];
    expect(Object.keys(dataFixPlan(edited, CONTENT["umbral-form"].dataFixes).item)).toEqual([]);
  });

  it("Umbral Form: Advantage on Sorcerer spell attacks while its effect is carried", () => {
    const [t] = CONTENT["umbral-form"].triggers;
    expect(t.on).toBe("preAttackRoll");
    expect(holds(t.if, { "source.hasEffect": id => id === "umbral-form", "activity.classSpell": "sorcerer" })).toBe(true);
    expect(holds(t.if, { "source.hasEffect": () => false, "activity.classSpell": "sorcerer" })).toBe(false);
    expect(holds(t.if, { "source.hasEffect": () => true, "activity.classSpell": "wizard" })).toBe(false);
  });

  it("Touch of Death: the Resistance ignored for the Chill Touch cast by the boon alone", () => {
    const from = CONTENT["touch-of-death"].ignoresResistance.from;
    const feat = "aaaaaaaaaaaaaaaa";
    // The copy of the spell cast by the boon's "cast" activity.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "copycopycopycopy", activityId: "bbbbbbbbbbbbbbbb",
      cachedFor: `.Item.${feat}.Activity.UZVFEmVZMhLRl5vD` })).toBe(true);
    // The same spell, learned otherwise (no cachedFor): no.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "spellspellspells", activityId: "bbbbbbbbbbbbbbbb" })).toBe(false);
    // A spell cast by the activity of ANOTHER item: no.
    expect(resistanceRuleCovers(from, { itemId: feat, activityItemId: "copycopycopycopy", cachedFor: ".Item.otherotherother1.Activity.UZVFEmVZMhLRl5vD" })).toBe(false);
    // Without `from`, all activities (Poisoner).
    expect(resistanceRuleCovers(undefined, { itemId: feat })).toBe(true);
  });

  it("Marked by the Grave: attacks, Warlock spells, Necrotic Husk; not another spell", () => {
    const cond = CONTENT["grave-touched"].ignoresResistance.if;
    const f = (o) => ({ "activity.isAttack": false, "activity.classSpell": null, "activity.identifier": null, ...o });
    expect(holds(cond, f({ "activity.isAttack": true }))).toBe(true);
    expect(holds(cond, f({ "activity.classSpell": "warlock" }))).toBe(true);
    expect(holds(cond, f({ "activity.identifier": "necrotic-husk" }))).toBe(true);
    expect(holds(cond, f({ "activity.classSpell": "cleric" }))).toBe(false);
  });

  it("Sleep: no effect on Marked by the Grave and Undying", () => {
    const any = CONTENT["sleep"].targets?.unaffectedIf?.any ?? CONTENT["sleep"].unaffectedIf?.any;
    expect(any).toEqual(expect.arrayContaining([{ "target.hasFeature": "grave-touched" }, { "target.hasFeature": "everlasting" }]));
  });
});

describe("Ravenloft: Hollow Warden and Ghost (§447)", () => {
  const facts = { "target.hasEffect": true, "target.within": true, "target.seesSource": true, "self.hasEffect": true, "source.nearSelf": true, "self.seesSource": true };
  it("valid entries", () => {
    for ( const id of ["wrath-of-the-wild", "deaths-friend"] ) expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
  });
  it("\"Savage Wrath\": the aura also on transformation, ends at Incapacitated", () => {
    const w = CONTENT["wrath-of-the-wild"];
    expect(w.emanation).toMatchObject({ on: "ownTurnStart", whileActive: true, atStart: true });
    expect(w.endsWhen).toEqual({ incapacitated: "bearer" });
  });
  it("\"Prowling Reprisal\": weapon attack against the author, transformed, at 1.50 m, seen", () => {
    const [self, ally] = CONTENT["wrath-of-the-wild"].triggers;
    expect(self.on).toBe("isDamaged");
    expect(ally.on).toBe("allyIsHit");
    for ( const t of [self, ally] ) expect(t.do).toEqual([{ type: "use", target: "source", weapon: true }]);
    expect(holds(ally.if, { "self.hasEffect": () => false, "source.nearSelf": () => true, "self.seesSource": () => true })).toBe(false);
    expect(holds(ally.if, { "self.hasEffect": id => id === "wrath-of-the-wild", "source.nearSelf": () => true, "self.seesSource": w => w === true })).toBe(true);
  });
  it("\"Rot and Violence\": neither healing nor Reaction under the level 11 effect only", () => {
    expect(CONTENT["wrath-of-the-wild"].noReactions).toEqual(["FU4SqQwhN1i0chUR"]);
    expect(CONTENT["wrath-of-the-wild"].blocksHealing).toEqual(["FU4SqQwhN1i0chUR"]);
  });
  it("Emanation: atStart requires whileActive", () => {
    expect(validateEntry({ emanation: { on: "ownTurnStart", atStart: true } }).length).toBe(1);
    expect(validateEntry({ emanation: { on: "ownTurnStart", whileActive: true, atStart: true } })).toEqual([]);
  });
  it("\"Friend of Death\": a soul trinket at Initiative", () => {
    expect(CONTENT["deaths-friend"].regainOnInitiative).toEqual({ item: "soul-trinkets", upTo: 1 });
  });
});
