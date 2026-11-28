import { describe, it, expect } from "vitest";
import { localizeEffectNames, retranslateItem, retranslateActor } from "../module/scripts/core/localize.mjs";

describe("effects copied from the compendium by the diagnostic (§202)", () => {
  const effects = [{ _id: "a", name: "Walloping Ammunition" }, { _id: "b", name: "Prone" }];
  it("an effect with the item's original name takes its translated name, the others do not change", () => {
    expect(localizeEffectNames(effects, "Walloping Ammunition", "Projectile percutant").map(e => e.name)).toEqual(["Projectile percutant", "Prone"]);
  });
  it("no original name (no translation), or an unchanged name: nothing", () => {
    expect(localizeEffectNames(effects, null, "Projectile percutant").map(e => e.name)).toEqual(["Walloping Ammunition", "Prone"]);
    expect(localizeEffectNames(effects, "Walloping Ammunition", "Walloping Ammunition").map(e => e.name)).toEqual(["Walloping Ammunition", "Prone"]);
  });
  it("does not modify the original data", () => {
    localizeEffectNames(effects, "Walloping Ammunition", "Projectile percutant");
    expect(effects[0].name).toBe("Walloping Ammunition");
  });
});

describe("texts left in the original language (§203)", () => {
  const original = {
    name: "Walloping Ammunition", description: "<p>A creature hit…</p>", chat: "",
    effects: { "Walloping Ammunition": { name: "Walloping Ammunition", description: "" } },
    activities: { act1: { name: "Walloping Save", condition: "on hit with this ammunition", chatFlavor: "Target is prone." } }
  };
  const translated = {
    name: "Projectile percutant", system: {
      description: { value: "<p>Une créature touchée…</p>", chat: "" },
      activities: { act1: { name: "Sauvegarde percutante", activation: { condition: "quand ce projectile touche" }, description: { chatFlavor: "La cible est à terre." } } }
    },
    effects: [{ _id: "eff1", name: "Projectile percutant", description: "" }]
  };
  const english = () => ({
    name: "Walloping Ammunition", system: {
      description: { value: "<p>A creature hit…</p>", chat: "" },
      activities: { act1: { name: "Walloping Save", activation: { condition: "on hit with this ammunition" }, description: { chatFlavor: "Target is prone." } } }
    },
    effects: [{ _id: "eff1", name: "Walloping Ammunition", description: "" }]
  });

  it("an item left in English takes back translated name, description, activities and effects", () => {
    const { update, effects } = retranslateItem(english(), original, translated);
    expect(update).toEqual({
      name: "Projectile percutant", "system.description.value": "<p>Une créature touchée…</p>",
      "system.activities.act1.name": "Sauvegarde percutante",
      "system.activities.act1.activation.condition": "quand ce projectile touche",
      "system.activities.act1.description.chatFlavor": "La cible est à terre."
    });
    expect(effects).toEqual([{ _id: "eff1", name: "Projectile percutant" }]);
  });
  it("the table case: translated name, effect left in English — only the effect changes", () => {
    const item = english();
    Object.assign(item, { name: "Projectile percutant" });
    item.system.description.value = "<p>Une créature touchée…</p>";
    item.system.activities = translated.system.activities;
    const { update, effects } = retranslateItem(item, original, translated);
    expect(update).toEqual({});
    expect(effects).toEqual([{ _id: "eff1", name: "Projectile percutant" }]);
  });
  it("a hand-edited text, an empty or already translated field are never taken back", () => {
    const item = english();
    item.name = "Flèche de Laurent";
    item.system.description.value = "<p>Ma description</p>";
    const { update } = retranslateItem(item, original, translated);
    expect(update.name).toBeUndefined();
    expect(update["system.description.value"]).toBeUndefined();
    expect(update["system.description.chat"]).toBeUndefined();
  });
  it("an effect without a common id is matched only if it is the only one on both sides", () => {
    const item = english();
    item.effects = [{ _id: "autre", name: "Walloping Ammunition", description: "" }];
    expect(retranslateItem(item, original, translated).effects).toEqual([{ _id: "autre", name: "Projectile percutant" }]);
    const two = { ...translated, effects: [...translated.effects, { _id: "eff2", name: "Autre" }] };
    expect(retranslateItem(item, original, two).effects).toEqual([]);
  });
  it("an actor: name, biography and prototype token name that followed the original name", () => {
    const { update } = retranslateActor(
      { name: "Otherworldly Steed", system: { details: { biography: { value: "" } } }, prototypeToken: { name: "Otherworldly Steed" } },
      { name: "Otherworldly Steed", biography: "" },
      { name: "Destrier d'outre-monde", prototypeToken: { name: "Destrier d'outre-monde" }, system: { details: { biography: { value: "" } } } });
    expect(update).toEqual({ name: "Destrier d'outre-monde", "prototypeToken.name": "Destrier d'outre-monde" });
  });
  it("a sheet renamed by hand keeps its name and its token", () => {
    const { update } = retranslateActor(
      { name: "Gray Ooze Glob", prototypeToken: { name: "Gray Ooze" } }, { name: "Gray Ooze" },
      { name: "Vase grise", prototypeToken: { name: "Vase grise" } });
    expect(update).toEqual({});
  });
  it("no original payload (untranslated reference): nothing", () => {
    expect(retranslateItem(english(), null, translated).update).toEqual({});
    expect(retranslateActor({ name: "X" }, null, { name: "Y" }).update).toEqual({});
  });
});
