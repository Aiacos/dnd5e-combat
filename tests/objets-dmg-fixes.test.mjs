import { describe, expect, it } from "vitest";
import { dataFixPlan, withDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";
import { creatureAutoSuccess } from "../module/scripts/core/action.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §457: copy-paste from the Dungeon Master's Guide 2.0.0 (public SRD 5.2 ids), on synthetic shapes.
const book = (activity, wrong) => ({ effects: [{ _id: "ownBookEffect000" }], system: { activities: {
  [activity]: { _id: activity, type: "utility", effects: [{ _id: wrong, level: {} }] } } } });

describe("Guide items: effect links copied from another item, empty damage part (dataFixes)", () => {
  for ( const [ident, activity, wrong] of [["manual-of-gainful-exercise", "QoMjlu00wQebXPDg", "9npFjYvEL3twc99F"],
    ["manual-of-bodily-health", "L5OnUjZIn27NHd2E", "9npFjYvEL3twc99F"], ["tome-of-clear-thought", "OCFufJcLGbTJqDqS", "jXvtCEBoDCydH8fa"]] ) {
    it(`${ident} : « Read » ne pose plus l'effet d'un autre livre ; le +2 vient quand la lecture épuise le livre`, () => {
      const plan = dataFixPlan(book(activity, wrong), ITEM_FIXES[ident].dataFixes);
      expect(plan.item[`system.activities.${activity}.effects`]).toEqual([]);
      expect(ITEM_FIXES[ident].onUsesSpent?.activity).toBe(activity);
      expect(ITEM_FIXES[ident].gmAlert).toBeUndefined();
    });
  }

  it("Horseshoes of a Zephyr: effect recreated, and the activity points to it, not to the Horseshoes of Speed effect", () => {
    const item = { effects: [], system: { activities: { Bm8dAa2MyA5NhcPU: { _id: "Bm8dAa2MyA5NhcPU", effects: [{ _id: "9lS2LxCve4hPYGMn" }] } } } };
    const { data } = withDataFixes(item, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes);
    expect(data.effects.map(e => e._id)).toEqual(["AYtAkgcEHRws0Qeo"]);
    expect(data.effects[0].system.changes[0]).toMatchObject({ key: "system.attributes.movement.ignoredDifficultTerrain", value: "all" });
    expect(data.system.activities.Bm8dAa2MyA5NhcPU.effects).toEqual([{ _id: "AYtAkgcEHRws0Qeo" }]);
    // Already correct (SRD): nothing changes.
    const sane = { effects: [{ _id: "AYtAkgcEHRws0Qeo" }], system: { activities: { Bm8dAa2MyA5NhcPU: { effects: [{ _id: "AYtAkgcEHRws0Qeo" }] } } } };
    expect(dataFixPlan(sane, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes).fields).toEqual([]);
  });

  it("Staff of Thunder and Lightning: the empty damage part of \"Thunder and Lightning\" is removed", () => {
    const lightning = { custom: { enabled: false, formula: "" }, number: 2, denomination: 6, bonus: "", types: ["lightning"], scaling: { number: 1 } };
    const empty = { custom: { enabled: false, formula: "" }, number: null, denomination: 0, bonus: "", types: [], scaling: { number: 1 } };
    const item = { effects: [], system: { activities: { EtOETCHaEK0mcw03: { damage: { parts: [lightning, empty] } } } } };
    const plan = dataFixPlan(item, ITEM_FIXES["staff-of-thunder-and-lightning"].dataFixes);
    const parts = plan.item["system.activities.EtOETCHaEK0mcw03.damage.parts"];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ number: 2, denomination: 6, types: ["lightning"] });
  });

  it("§458: the six books apply their +2 at the end of the reading, never every hour", async () => {
    const { validateEntry } = await import("../module/scripts/core/content/entry.mjs").catch(() => ({}));
    for ( const ident of ["manual-of-quickness-of-action", "manual-of-gainful-exercise", "manual-of-bodily-health", "tome-of-clear-thought",
      "tome-of-leadership-and-influence", "tome-of-understanding"] ) {
      const { activity, effects } = ITEM_FIXES[ident].onUsesSpent;
      expect(effects).toHaveLength(1);
      const fix = ITEM_FIXES[ident].dataFixes.find(d => d.path === `system.activities.${activity}.effects`);
      expect(fix.value).toEqual([]);
      if ( validateEntry ) expect(validateEntry(ITEM_FIXES[ident], { at: ident })).toEqual([]);
    }
  });
});

describe("§458: the onUsesSpent key is validated", () => {
  it("refuse une forme fausse", async () => {
    const { validateEntry } = await import("../module/scripts/core/content/entry.mjs");
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: ["yjQAL2g65jahNoBP"] } })).toEqual([]);
    expect(validateEntry({ onUsesSpent: { activity: "court", effects: ["yjQAL2g65jahNoBP"] } }).length).toBe(1);
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: [] } }).length).toBe(1);
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: ["yjQAL2g65jahNoBP"], extra: 1 } }).length).toBe(1);
  });
});

describe("§459 : sorts du Manuel 3.0.0 dont l'effet a disparu", () => {
  it("Antilife Shell: the effect recreated; Dispel Evil and Good: the orphan link removed", async () => {
    const { SPELL_RULES } = await import("../module/scripts/content/spell-rules.mjs");
    const shell = withDataFixes({ effects: [], system: { activities: { dnd5eactivity000: { effects: [{ _id: "IrE5td3goSQtcc0U" }] } } } },
      SPELL_RULES["antilife-shell"].dataFixes).data;
    expect(shell.effects.map(e => e._id)).toEqual(["IrE5td3goSQtcc0U"]);
    const dispel = withDataFixes({ effects: [], system: { activities: { "0vS3We98acymzUXC": { effects: [{ _id: "RMeb9TUrFdhXMTzz" }] } } } },
      SPELL_RULES["dispel-evil-and-good"].dataFixes).data;
    expect(dispel.system.activities["0vS3We98acymzUXC"].effects).toEqual([]);
  });
});

// Dungeon Master's Guide 2.0.0: the data contradicts the item's own text (DC, attunement, charges regained).
describe("Guide items: DC, attunement and recharge that the item's text gives (dataFixes)", () => {
  it("\"Truth Serum\": the save goes from DC 10 to DC 11", () => {
    const item = { effects: [], system: { activities: { gZRykfpoTDxT6cqO: { save: { ability: ["con"], dc: { calculation: "", formula: "10" } } } } } };
    expect(dataFixPlan(item, ITEM_FIXES["truth-serum"].dataFixes).item).toEqual({ "system.activities.gZRykfpoTDxT6cqO.save.dc.formula": "11" });
    item.system.activities.gZRykfpoTDxT6cqO.save.dc.formula = "11";
    expect(dataFixPlan(item, ITEM_FIXES["truth-serum"].dataFixes).fields).toEqual([]);
  });

  it("Crystal Ball of True Seeing: attunement required, Scrying at DC 17", () => {
    const item = { effects: [], system: { attunement: "", activities: { EsEZwTpUoGAXQskP: { spell: { challenge: { attack: null, save: null, override: false } } } } } };
    expect(dataFixPlan(item, ITEM_FIXES["true-seeing-crystal-ball-of"].dataFixes).item).toEqual({
      "system.attunement": "required",
      "system.activities.EsEZwTpUoGAXQskP.spell.challenge": { attack: null, save: 17, override: true }
    });
  });

  it("Staff of Swarming: 1d6 + 4 charges at dawn; the smoke stays declared", () => {
    const item = { effects: [], system: { uses: { spent: 0, max: "10", recovery: [{ period: "dawn", type: "formula", formula: "1d6" }] } } };
    expect(dataFixPlan(item, ITEM_FIXES["staff-of-swarming-insects"].dataFixes).item)
      .toEqual({ "system.uses.recovery": [{ period: "dawn", type: "formula", formula: "1d6 + 4" }] });
    expect(ITEM_FIXES["staff-of-swarming-insects"].obscures).toBe(true);
  });

  it("Baba Yaga's Dancing Broom: attunement required; it always acts right after its master", () => {
    const item = { effects: [], system: { attunement: "" } };
    expect(dataFixPlan(item, ITEM_FIXES["baba-yagas-dancing-broom"].dataFixes).item).toEqual({ "system.attunement": "required" });
    expect(ITEM_FIXES["baba-yagas-dancing-broom"].summon).toEqual({ initiative: "after" });
  });
});


// SRD 5.2 compendium (dnd5e 6.1): data recorded as is, including the empty change and the duration.
describe("SRD 5.2 items: empty carried effect, duration that is not the text's (dataFixes)", () => {
  const emptyChange = { key: "", value: "", type: "add", phase: "initial", _id: "RHoNEHxHTNzZMBHD", conditions: "{}",
    replacement: "" };

  for ( const [ident, effect] of [["boots-of-elvenkind", "gHyJQGFKkZJ2rbUe"], ["cloak-of-elvenkind", "hyU6mHq6YNhLZlTY"]] ) {
    it(`${ident} : le changement vide de l'effet porté devient l'Avantage en Discrétion`, () => {
      const item = { effects: [{ _id: effect, transfer: true, system: { changes: [emptyChange] } }], system: {} };
      const plan = dataFixPlan(item, ITEM_FIXES[ident].dataFixes);
      expect(plan.effects).toEqual([{ _id: effect,
        "system.changes": [{ key: "system.skills.ste.roll.mode", value: 1, priority: null, type: "add" }] }]);
    });

    it(`${ident} : un effet déjà rempli (à la main, ou par une autre donnée) ne bouge pas`, () => {
      const filled = { ...emptyChange, key: "system.skills.ste.roll.mode", value: "1" };
      const item = { effects: [{ _id: effect, transfer: true, system: { changes: [filled] } }], system: {} };
      expect(dataFixPlan(item, ITEM_FIXES[ident].dataFixes).fields).toEqual([]);
    });
  }

  it("Cloak of Elvenkind: the Perception to spot the bearer keeps its Disadvantage", () => {
    expect(ITEM_FIXES["cloak-of-elvenkind"].hardToPerceive).toBe(true);
  });

  it("Potion of Invulnerability: 1 minute, on the effect and on the activity, instead of 10", () => {
    const item = { effects: [{ _id: "ojfKVnyWWyc5EPA2", duration: { value: 600, units: "seconds", expiry: "turnStart" } }],
      system: { activities: { WGHHrNkceMYEl8as: { duration: { units: "minute", value: "10" } } } } };
    const plan = dataFixPlan(item, ITEM_FIXES["potion-of-invulnerability"].dataFixes);
    expect(plan.effects).toEqual([{ _id: "ojfKVnyWWyc5EPA2", "duration.value": 60 }]);
    expect(plan.item).toEqual({ "system.activities.WGHHrNkceMYEl8as.duration.value": "1" });
    // A duration already changed by hand stays.
    item.effects[0].duration.value = 3600;
    expect(dataFixPlan(item, ITEM_FIXES["potion-of-invulnerability"].dataFixes).effects).toEqual([]);
  });
});

describe("Vorpal Sword (SRD 5.2): the weapon ignores Resistance to slashing damage", () => {
  const rule = ITEM_FIXES["vorpal-sword-enchanted"].ignoresResistance;
  const by = source => ({ "activity.enchantedBy": id => id === source });

  it("slashing damage, for the weapon that carries the enchantment only", () => {
    expect(rule.types).toEqual(["slashing"]);
    expect(holds(rule.if, by("vorpal-sword"))).toBe(true);
    // Another weapon of the same bearer (an ordinary longsword, a Flame Tongue) does not benefit.
    expect(holds(rule.if, by(null))).toBe(false);
    expect(holds(rule.if, by("flame-tongue"))).toBe(false);
  });

  it("the entry validates", () => {
    expect(validateEntry(ITEM_FIXES["vorpal-sword-enchanted"], { facts: { "activity.enchantedBy": true } })).toEqual([]);
  });
});

describe("Dwarven Thrower (SRD 5.2): the 1d8 force on a throw only, 2d8 against a Giant", () => {
  const entry = ITEM_FIXES["dwarven-thrower"];
  const force = { number: 1, denomination: 8, bonus: "", types: ["force"], modifiers: [], scaling: { number: 1 } };
  const attack = _id => ({ _id, type: "attack", damage: { includeBase: true, parts: [structuredClone(force)] } });
  const item = () => ({ effects: [], system: { activities: {
    bd1kKOncfoLha8CT: attack("bd1kKOncfoLha8CT"), w3ATyMSroDLch6Re: attack("w3ATyMSroDLch6Re") } } });

  it("the melee attack loses its force part; \"Throw\" keeps its own", () => {
    const plan = dataFixPlan(item(), entry.dataFixes);
    expect(plan.item).toEqual({ "system.activities.bd1kKOncfoLha8CT.damage.parts": [] });
  });

  it("a part changed by hand (2d8, another type) stays unchanged", () => {
    const edited = item();
    edited.system.activities.bd1kKOncfoLha8CT.damage.parts[0].number = 2;
    expect(dataFixPlan(edited, entry.dataFixes).fields).toEqual([]);
  });

  it("the second d8: on a throw, against a Giant only", () => {
    const [rule] = entry.triggers;
    expect(rule.do).toEqual([{ type: "damage", formula: "1d8", damageType: "force" }]);
    expect(holds(rule.if, { "activity.id": "w3ATyMSroDLch6Re", "target.creatureType": "giant" })).toBe(true);
    expect(holds(rule.if, { "activity.id": "w3ATyMSroDLch6Re", "target.creatureType": "undead" })).toBe(false);
    expect(holds(rule.if, { "activity.id": "bd1kKOncfoLha8CT", "target.creatureType": "giant" })).toBe(false);
    expect(validateEntry(entry, { facts: { "activity.id": true, "target.creatureType": true } })).toEqual([]);
  });
});

describe("SRD 5.2 items: charges, duration and automatic success that the text gives", () => {
  it("Orb of Dragonkind: 7 charges, 1d4 + 3 at dawn — like the Guide's orb", () => {
    const item = { effects: [], system: { uses: { spent: 0, max: "", recovery: [] } } };
    expect(dataFixPlan(item, ITEM_FIXES["dragon-orb"].dataFixes).item).toEqual({
      "system.uses.max": "7", "system.uses.recovery": [{ period: "dawn", type: "formula", formula: "1d4 + 3" }] });
    expect(ITEM_FIXES["dragon-orb"].dataFixes).toEqual(ITEM_FIXES["orb-of-dragonkind"].dataFixes);
    // Charges already set by hand do not change.
    const set = { effects: [], system: { uses: { spent: 0, max: "5", recovery: [{ period: "dawn", type: "recoverAll" }] } } };
    expect(dataFixPlan(set, ITEM_FIXES["dragon-orb"].dataFixes).fields).toEqual([]);
  });
  it("Philter of Love: Charmed 1 hour, not 10 minutes", () => {
    const item = { effects: [{ _id: "MLhvjPiSXOX1tkUr", duration: { value: 600, units: "seconds" } }], system: {} };
    expect(dataFixPlan(item, ITEM_FIXES["philter-of-love"].dataFixes).effects)
      .toEqual([{ _id: "MLhvjPiSXOX1tkUr", "duration.value": 3600 }]);
  });
  it("Mirror of Life Trapping: a Construct succeeds automatically", () => {
    expect(ITEM_FIXES["mirror-of-life-trapping"].saveAutoSuccess).toEqual({ types: ["construct"] });
  });
});

describe("SRD 5.2 items: empty effects that the text fills (Comet, Hunting Trap)", () => {
  const empty = _id => ({ effects: [{ _id, system: { changes: [] } }], system: {} });
  it("Comet: Advantage on death saving throws", () => {
    const plan = dataFixPlan(empty("asqZlVwoKSS1ckCU"), ITEM_FIXES.comet.dataFixes);
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]["system.changes"]).toMatchObject([{ key: "system.attributes.death.roll.mode", type: "add", value: 1 }]);
  });
  it("Hunting Trap: Speed 0 while the \"Trapped\" effect is carried", () => {
    const plan = dataFixPlan(empty("9jl46RZ5GOjs9QlJ"), ITEM_FIXES["hunting-trap"].dataFixes);
    expect(plan.effects[0]["system.changes"])
      .toMatchObject([{ key: "system.attributes.movement.multiplier", type: "override", value: "0" }]);
  });
  it("an effect already filled in by dnd5e is not rewritten", () => {
    const changes = [{ key: "x", type: "add", value: 1 }];
    const filled = { effects: [{ _id: "asqZlVwoKSS1ckCU", system: { changes } }], system: {} };
    expect(dataFixPlan(filled, ITEM_FIXES.comet.dataFixes).effects).toEqual([]);
  });
});

describe("\"Falling Net\" (SRD 5.2): a Huge or larger creature succeeds automatically (saveAutoSuccess.sizeAtLeast)", () => {
  const rule = ITEM_FIXES["falling-net"].saveAutoSuccess;
  it("Huge and Gargantuan: automatic success; Large and smaller: the save is rolled", () => {
    expect(creatureAutoSuccess(rule, { type: "giant", size: "huge" })).toBe("size:huge");
    expect(creatureAutoSuccess(rule, { size: "grg" })).toBe("size:grg");
    expect(creatureAutoSuccess(rule, { size: "lg" })).toBeNull();
    expect(creatureAutoSuccess(rule, { size: "med" })).toBeNull();
  });
  it("unknown size: nothing; the type keeps its rule", () => {
    expect(creatureAutoSuccess(rule, {})).toBeNull();
    expect(creatureAutoSuccess({ types: ["construct"] }, { type: "construct", size: "tiny" })).toBe("type:construct");
    expect(creatureAutoSuccess(null, { type: "construct", size: "huge" })).toBeNull();
  });
  it("the key is validated", () => {
    expect(validateEntry({ saveAutoSuccess: { sizeAtLeast: "huge" } })).toEqual([]);
    expect(validateEntry({ saveAutoSuccess: { sizeAtLeast: "enormous" } })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccess: {} })).not.toEqual([]);
  });
});
describe("Balai volant (SRD 5.2) : l'activation vise son utilisateur, qui choisit sa charge", () => {
  const entry = ITEM_FIXES["broom-of-flying"];
  it("the activity's empty target becomes the user; an already filled target does not change", () => {
    const item = type => ({ effects: [], system: { activities: { "2wrq53BtZk3dUEuW": { target: { affects: { type } } } } } });
    expect(dataFixPlan(item(""), entry.dataFixes).item)
      .toEqual({ "system.activities.2wrq53BtZk3dUEuW.target.affects.type": "self" });
    expect(dataFixPlan(item("creature"), entry.dataFixes).fields).toEqual([]);
  });
  it("the two effects (light charge, heavy charge) exclude each other", () => {
    expect(entry.choice).toEqual({ effects: "one" });
  });
});
describe("Candle of Invocation (SRD 5.2): Advantage on D20 Tests set on whoever lights it", () => {
  const fixes = ITEM_FIXES["candle-of-invocation"].dataFixes;
  const item = { effects: [{ _id: "gN0PgSLPlbsD8T2g", system: { changes: [] } }],
    system: { activities: { hG1Iplp3uG2fd39N: { target: { affects: { type: "" } } } } } };
  it("the activity targets its user", () => {
    expect(dataFixPlan(item, fixes).item).toEqual({ "system.activities.hG1Iplp3uG2fd39N.target.affects.type": "self" });
  });
  it("the empty effect receives 19 changes: attack, save and check for each ability, and death saves", () => {
    const changes = dataFixPlan(item, fixes).effects[0]["system.changes"];
    expect(changes).toHaveLength(19);
    expect(changes.every(c => (c.type === "add") && (c.value === 1) && c.key.endsWith(".roll.mode"))).toBe(true);
    expect(changes.map(c => c.key)).toEqual(expect.arrayContaining(["system.abilities.str.attack.roll.mode",
      "system.abilities.wis.save.roll.mode", "system.abilities.cha.check.roll.mode", "system.attributes.death.roll.mode"]));
  });
});
describe("Rod of Alertness (SRD 5.2): Advantage on Perception and Initiative, carried by the item", () => {
  const fixes = ITEM_FIXES["rod-of-alertness"].dataFixes;
  it("the \"Alertness\" effect is created, transferred to the bearer", () => {
    const plan = dataFixPlan({ effects: [{ _id: "fHNlrUKZ6KWRNTmy" }], system: {} }, fixes);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ _id: "dasRodAlertness0", name: "Alertness", transfer: true });
    expect(plan.create[0].system.changes.map(c => c.key))
      .toEqual(["system.skills.prc.roll.mode", "system.attributes.init.roll.mode"]);
  });
  it("already created: nothing to redo", () => {
    const plan = dataFixPlan({ effects: [{ _id: "fHNlrUKZ6KWRNTmy" }, { _id: "dasRodAlertness0" }], system: {} }, fixes);
    expect(plan.create).toEqual([]);
  });
});
