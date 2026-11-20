import { describe, expect, it } from "vitest";
import { dataFixPlan, withDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";
import { creatureAutoSuccess } from "../module/scripts/core/action.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §457 : copier-coller du Guide du maître 2.0.0 (ids publics du SRD 5.2), sur des formes synthétiques.
const book = (activity, wrong) => ({ effects: [{ _id: "ownBookEffect000" }], system: { activities: {
  [activity]: { _id: activity, type: "utility", effects: [{ _id: wrong, level: {} }] } } } });

describe("objets du Guide : liens d'effet recopiés d'un autre objet, part de dégâts vide (dataFixes)", () => {
  for ( const [ident, activity, wrong] of [["manual-of-gainful-exercise", "QoMjlu00wQebXPDg", "9npFjYvEL3twc99F"],
    ["manual-of-bodily-health", "L5OnUjZIn27NHd2E", "9npFjYvEL3twc99F"], ["tome-of-clear-thought", "OCFufJcLGbTJqDqS", "jXvtCEBoDCydH8fa"]] ) {
    it(`${ident} : « Read » ne pose plus l'effet d'un autre livre ; le +2 vient quand la lecture épuise le livre`, () => {
      const plan = dataFixPlan(book(activity, wrong), ITEM_FIXES[ident].dataFixes);
      expect(plan.item[`system.activities.${activity}.effects`]).toEqual([]);
      expect(ITEM_FIXES[ident].onUsesSpent?.activity).toBe(activity);
      expect(ITEM_FIXES[ident].gmAlert).toBeUndefined();
    });
  }

  it("Fers du zéphyr : leur effet recréé, et l'activité y pointe au lieu de l'effet des Fers de rapidité", () => {
    const item = { effects: [], system: { activities: { Bm8dAa2MyA5NhcPU: { _id: "Bm8dAa2MyA5NhcPU", effects: [{ _id: "9lS2LxCve4hPYGMn" }] } } } };
    const { data } = withDataFixes(item, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes);
    expect(data.effects.map(e => e._id)).toEqual(["AYtAkgcEHRws0Qeo"]);
    expect(data.effects[0].system.changes[0]).toMatchObject({ key: "system.attributes.movement.ignoredDifficultTerrain", value: "all" });
    expect(data.system.activities.Bm8dAa2MyA5NhcPU.effects).toEqual([{ _id: "AYtAkgcEHRws0Qeo" }]);
    // Déjà juste (SRD) : rien ne bouge.
    const sane = { effects: [{ _id: "AYtAkgcEHRws0Qeo" }], system: { activities: { Bm8dAa2MyA5NhcPU: { effects: [{ _id: "AYtAkgcEHRws0Qeo" }] } } } };
    expect(dataFixPlan(sane, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes).fields).toEqual([]);
  });

  it("Bâton de tonnerre et de foudre : la part de dégâts vide de « Tonnerre et foudre » est retirée", () => {
    const lightning = { custom: { enabled: false, formula: "" }, number: 2, denomination: 6, bonus: "", types: ["lightning"], scaling: { number: 1 } };
    const empty = { custom: { enabled: false, formula: "" }, number: null, denomination: 0, bonus: "", types: [], scaling: { number: 1 } };
    const item = { effects: [], system: { activities: { EtOETCHaEK0mcw03: { damage: { parts: [lightning, empty] } } } } };
    const plan = dataFixPlan(item, ITEM_FIXES["staff-of-thunder-and-lightning"].dataFixes);
    const parts = plan.item["system.activities.EtOETCHaEK0mcw03.damage.parts"];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ number: 2, denomination: 6, types: ["lightning"] });
  });

  it("§458 : les six livres posent leur +2 à la fin de la lecture, jamais à chaque heure", async () => {
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

describe("§458 : la clé onUsesSpent est validée", () => {
  it("refuse une forme fausse", async () => {
    const { validateEntry } = await import("../module/scripts/core/content/entry.mjs");
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: ["yjQAL2g65jahNoBP"] } })).toEqual([]);
    expect(validateEntry({ onUsesSpent: { activity: "court", effects: ["yjQAL2g65jahNoBP"] } }).length).toBe(1);
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: [] } }).length).toBe(1);
    expect(validateEntry({ onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: ["yjQAL2g65jahNoBP"], extra: 1 } }).length).toBe(1);
  });
});

describe("§459 : sorts du Manuel 3.0.0 dont l'effet a disparu", () => {
  it("Coquille antivie : l'effet recréé ; Dissipation du mal et du bien : le lien orphelin retiré", async () => {
    const { SPELL_RULES } = await import("../module/scripts/content/spell-rules.mjs");
    const shell = withDataFixes({ effects: [], system: { activities: { dnd5eactivity000: { effects: [{ _id: "IrE5td3goSQtcc0U" }] } } } },
      SPELL_RULES["antilife-shell"].dataFixes).data;
    expect(shell.effects.map(e => e._id)).toEqual(["IrE5td3goSQtcc0U"]);
    const dispel = withDataFixes({ effects: [], system: { activities: { "0vS3We98acymzUXC": { effects: [{ _id: "RMeb9TUrFdhXMTzz" }] } } } },
      SPELL_RULES["dispel-evil-and-good"].dataFixes).data;
    expect(dispel.system.activities["0vS3We98acymzUXC"].effects).toEqual([]);
  });
});

// Guide du maître 2.0.0 : la donnée contredit le texte de l'objet lui-même (DD, lien, charges rendues).
describe("objets du Guide : DD, lien et recharge que le texte de l'objet donne (dataFixes)", () => {
  it("Sérum de vérité : la sauvegarde passe de DD 10 à DD 11", () => {
    const item = { effects: [], system: { activities: { gZRykfpoTDxT6cqO: { save: { ability: ["con"], dc: { calculation: "", formula: "10" } } } } } };
    expect(dataFixPlan(item, ITEM_FIXES["truth-serum"].dataFixes).item).toEqual({ "system.activities.gZRykfpoTDxT6cqO.save.dc.formula": "11" });
    item.system.activities.gZRykfpoTDxT6cqO.save.dc.formula = "11";
    expect(dataFixPlan(item, ITEM_FIXES["truth-serum"].dataFixes).fields).toEqual([]);
  });

  it("Boule de cristal de vision véritable : lien requis, Scrutation à DD 17", () => {
    const item = { effects: [], system: { attunement: "", activities: { EsEZwTpUoGAXQskP: { spell: { challenge: { attack: null, save: null, override: false } } } } } };
    expect(dataFixPlan(item, ITEM_FIXES["true-seeing-crystal-ball-of"].dataFixes).item).toEqual({
      "system.attunement": "required",
      "system.activities.EsEZwTpUoGAXQskP.spell.challenge": { attack: null, save: 17, override: true }
    });
  });

  it("Bâton du grand essaim : 1d6 + 4 charges à l'aube ; la fumée reste déclarée", () => {
    const item = { effects: [], system: { uses: { spent: 0, max: "10", recovery: [{ period: "dawn", type: "formula", formula: "1d6" }] } } };
    expect(dataFixPlan(item, ITEM_FIXES["staff-of-swarming-insects"].dataFixes).item)
      .toEqual({ "system.uses.recovery": [{ period: "dawn", type: "formula", formula: "1d6 + 4" }] });
    expect(ITEM_FIXES["staff-of-swarming-insects"].obscures).toBe(true);
  });

  it("Balai dansant de Baba Yaga : lien requis ; il agit toujours juste après son maître", () => {
    const item = { effects: [], system: { attunement: "" } };
    expect(dataFixPlan(item, ITEM_FIXES["baba-yagas-dancing-broom"].dataFixes).item).toEqual({ "system.attunement": "required" });
    expect(ITEM_FIXES["baba-yagas-dancing-broom"].summon).toEqual({ initiative: "after" });
  });
});


// Compendium du SRD 5.2 (dnd5e 6.1) : donnée relevée telle quelle, changement vide et durée comprises.
describe("objets du SRD 5.2 : effet porté vide, durée qui n'est pas celle du texte (dataFixes)", () => {
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

  it("Cape elfique : la Perception pour repérer le porteur garde son Désavantage", () => {
    expect(ITEM_FIXES["cloak-of-elvenkind"].hardToPerceive).toBe(true);
  });

  it("Potion d'invulnérabilité : 1 minute, sur l'effet et sur l'activité, au lieu de 10", () => {
    const item = { effects: [{ _id: "ojfKVnyWWyc5EPA2", duration: { value: 600, units: "seconds", expiry: "turnStart" } }],
      system: { activities: { WGHHrNkceMYEl8as: { duration: { units: "minute", value: "10" } } } } };
    const plan = dataFixPlan(item, ITEM_FIXES["potion-of-invulnerability"].dataFixes);
    expect(plan.effects).toEqual([{ _id: "ojfKVnyWWyc5EPA2", "duration.value": 60 }]);
    expect(plan.item).toEqual({ "system.activities.WGHHrNkceMYEl8as.duration.value": "1" });
    // Une durée déjà changée à la main reste.
    item.effects[0].duration.value = 3600;
    expect(dataFixPlan(item, ITEM_FIXES["potion-of-invulnerability"].dataFixes).effects).toEqual([]);
  });
});

describe("Épée vorpale (SRD 5.2) : l'arme ignore la Résistance aux dégâts tranchants", () => {
  const rule = ITEM_FIXES["vorpal-sword-enchanted"].ignoresResistance;
  const by = source => ({ "activity.enchantedBy": id => id === source });

  it("les dégâts tranchants, pour l'arme qui porte l'enchantement seulement", () => {
    expect(rule.types).toEqual(["slashing"]);
    expect(holds(rule.if, by("vorpal-sword"))).toBe(true);
    // Une autre arme du même porteur (une épée longue ordinaire, une Langue de feu) n'en profite pas.
    expect(holds(rule.if, by(null))).toBe(false);
    expect(holds(rule.if, by("flame-tongue"))).toBe(false);
  });

  it("l'entrée se valide", () => {
    expect(validateEntry(ITEM_FIXES["vorpal-sword-enchanted"], { facts: { "activity.enchantedBy": true } })).toEqual([]);
  });
});

describe("Marteau de lancer nain (SRD 5.2) : le 1d8 de force au lancer seulement, 2d8 contre un Géant", () => {
  const entry = ITEM_FIXES["dwarven-thrower"];
  const force = { number: 1, denomination: 8, bonus: "", types: ["force"], modifiers: [], scaling: { number: 1 } };
  const attack = _id => ({ _id, type: "attack", damage: { includeBase: true, parts: [structuredClone(force)] } });
  const item = () => ({ effects: [], system: { activities: {
    bd1kKOncfoLha8CT: attack("bd1kKOncfoLha8CT"), w3ATyMSroDLch6Re: attack("w3ATyMSroDLch6Re") } } });

  it("l'attaque de corps à corps perd sa part de force ; « Throw » garde la sienne", () => {
    const plan = dataFixPlan(item(), entry.dataFixes);
    expect(plan.item).toEqual({ "system.activities.bd1kKOncfoLha8CT.damage.parts": [] });
  });

  it("une part changée à la main (2d8, un autre type) ne bouge pas", () => {
    const edited = item();
    edited.system.activities.bd1kKOncfoLha8CT.damage.parts[0].number = 2;
    expect(dataFixPlan(edited, entry.dataFixes).fields).toEqual([]);
  });

  it("le second d8 : au lancer, contre un Géant seulement", () => {
    const [rule] = entry.triggers;
    expect(rule.do).toEqual([{ type: "damage", formula: "1d8", damageType: "force" }]);
    expect(holds(rule.if, { "activity.id": "w3ATyMSroDLch6Re", "target.creatureType": "giant" })).toBe(true);
    expect(holds(rule.if, { "activity.id": "w3ATyMSroDLch6Re", "target.creatureType": "undead" })).toBe(false);
    expect(holds(rule.if, { "activity.id": "bd1kKOncfoLha8CT", "target.creatureType": "giant" })).toBe(false);
    expect(validateEntry(entry, { facts: { "activity.id": true, "target.creatureType": true } })).toEqual([]);
  });
});

describe("objets du SRD 5.2 : charges, durée et réussite d'office que le texte donne", () => {
  it("Orbe des dragons : 7 charges, 1d4 + 3 à l'aube — comme l'orbe du Guide", () => {
    const item = { effects: [], system: { uses: { spent: 0, max: "", recovery: [] } } };
    expect(dataFixPlan(item, ITEM_FIXES["dragon-orb"].dataFixes).item).toEqual({
      "system.uses.max": "7", "system.uses.recovery": [{ period: "dawn", type: "formula", formula: "1d4 + 3" }] });
    expect(ITEM_FIXES["dragon-orb"].dataFixes).toEqual(ITEM_FIXES["orb-of-dragonkind"].dataFixes);
    // Des charges déjà réglées à la main ne bougent pas.
    const set = { effects: [], system: { uses: { spent: 0, max: "5", recovery: [{ period: "dawn", type: "recoverAll" }] } } };
    expect(dataFixPlan(set, ITEM_FIXES["dragon-orb"].dataFixes).fields).toEqual([]);
  });
  it("Philtre d'amour : Charmé 1 heure, pas 10 minutes", () => {
    const item = { effects: [{ _id: "MLhvjPiSXOX1tkUr", duration: { value: 600, units: "seconds" } }], system: {} };
    expect(dataFixPlan(item, ITEM_FIXES["philter-of-love"].dataFixes).effects)
      .toEqual([{ _id: "MLhvjPiSXOX1tkUr", "duration.value": 3600 }]);
  });
  it("Miroir d'emprisonnement : une Créature artificielle réussit d'office", () => {
    expect(ITEM_FIXES["mirror-of-life-trapping"].saveAutoSuccess).toEqual({ types: ["construct"] });
  });
});

describe("objets du SRD 5.2 : effets vides que le texte remplit (Comète, Piège de chasse)", () => {
  const empty = _id => ({ effects: [{ _id, system: { changes: [] } }], system: {} });
  it("Comète : l'Avantage aux sauvegardes contre la mort", () => {
    const plan = dataFixPlan(empty("asqZlVwoKSS1ckCU"), ITEM_FIXES.comet.dataFixes);
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]["system.changes"]).toMatchObject([{ key: "system.attributes.death.roll.mode", type: "add", value: 1 }]);
  });
  it("Piège de chasse : Vitesse 0 tant que l'effet « Trapped » est porté", () => {
    const plan = dataFixPlan(empty("9jl46RZ5GOjs9QlJ"), ITEM_FIXES["hunting-trap"].dataFixes);
    expect(plan.effects[0]["system.changes"])
      .toMatchObject([{ key: "system.attributes.movement.multiplier", type: "override", value: "0" }]);
  });
  it("un effet déjà rempli par dnd5e n'est pas réécrit", () => {
    const changes = [{ key: "x", type: "add", value: 1 }];
    const filled = { effects: [{ _id: "asqZlVwoKSS1ckCU", system: { changes } }], system: {} };
    expect(dataFixPlan(filled, ITEM_FIXES.comet.dataFixes).effects).toEqual([]);
  });
});

describe("Filet tombant (SRD 5.2) : une créature de taille TG ou plus réussit d'office (saveAutoSuccess.sizeAtLeast)", () => {
  const rule = ITEM_FIXES["falling-net"].saveAutoSuccess;
  it("TG et Gig : réussite d'office ; G et moins : la sauvegarde se tire", () => {
    expect(creatureAutoSuccess(rule, { type: "giant", size: "huge" })).toBe("size:huge");
    expect(creatureAutoSuccess(rule, { size: "grg" })).toBe("size:grg");
    expect(creatureAutoSuccess(rule, { size: "lg" })).toBeNull();
    expect(creatureAutoSuccess(rule, { size: "med" })).toBeNull();
  });
  it("taille inconnue : rien ; le type garde sa règle", () => {
    expect(creatureAutoSuccess(rule, {})).toBeNull();
    expect(creatureAutoSuccess({ types: ["construct"] }, { type: "construct", size: "tiny" })).toBe("type:construct");
    expect(creatureAutoSuccess(null, { type: "construct", size: "huge" })).toBeNull();
  });
  it("la clé est validée", () => {
    expect(validateEntry({ saveAutoSuccess: { sizeAtLeast: "huge" } })).toEqual([]);
    expect(validateEntry({ saveAutoSuccess: { sizeAtLeast: "enormous" } })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccess: {} })).not.toEqual([]);
  });
});
