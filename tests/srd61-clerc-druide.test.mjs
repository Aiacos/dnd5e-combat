import { describe, it, expect } from "vitest";
import { holds } from "../module/scripts/core/triggers.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * §431: the dnd5e 6.1 SRD renames the options of Blessed Strikes (Cleric) and Elemental Fury (Druid) — the two Potent Spellcasting
 * are both called `potent-spellcasting` — and moves the Sear Undead activity onto Channel Divinity.
 * Older sheets (premium Handbook, SRD 6.0) keep the old identifiers: both forms count.
 */

/** A test actor: its classes and its items (identifier, origin class, activities). */
const actorWith = (classes, items) => {
  const actor = { classes: Object.fromEntries(classes.map(c => [c, { identifier: c }])) };
  actor.items = items.map(({ id, cls=null, requirements="", activities=[] }) => {
    const acts = new Map(activities.map(a => [a, { id: a }]));
    const item = { name: id, actor, system: { identifier: id, classIdentifier: cls ?? undefined, requirements, activities: acts } };
    for ( const a of acts.values() ) { a.item = item; a.actor = actor; }
    return item;
  });
  return actor;
};

describe("§431: the class of a feature with the same identifier (potent-spellcasting)", async () => {
  const { featureClassOf, hasClassFeature } = await import("../module/scripts/adapter/content.mjs");

  it("lit system.classIdentifier (6.1), puis l'item racine de l'avancement (6.0), puis requirements s'il nomme une classe de l'acteur", () => {
    expect(featureClassOf({ system: { classIdentifier: "druid" } })).toBe("druid");
    expect(featureClassOf({ system: { advancementRootItem: { type: "class", identifier: "cleric" } } })).toBe("cleric");
    expect(featureClassOf({ system: { advancementRootItem: { type: "subclass", system: { classIdentifier: "cleric" } } } })).toBe("cleric");
    expect(featureClassOf({ system: { requirements: "Druid" }, actor: { classes: { druid: {} } } })).toBe("druid");
    expect(featureClassOf({ system: { requirements: "Druide" }, actor: { classes: { druid: {} } } })).toBe(null);
  });

  it("the Druid's option does not count for the Cleric, and vice versa; unknown class: the actor's", () => {
    const multi = actorWith(["cleric", "druid"], [{ id: "potent-spellcasting", cls: "druid" }]);
    expect(hasClassFeature(multi, "potent-spellcasting", "druid")).toBe(true);
    expect(hasClassFeature(multi, "potent-spellcasting", "cleric")).toBe(false);
    const loose = actorWith(["cleric"], [{ id: "potent-spellcasting" }]);
    expect(hasClassFeature(loose, "potent-spellcasting", "cleric")).toBe(true);
    expect(hasClassFeature(loose, "potent-spellcasting", "druid")).toBe(false);
    expect(hasClassFeature(actorWith(["druid"], [{ id: "elemental-fury-potent-spellcasting" }]),
      ["elemental-fury-potent-spellcasting", "potent-spellcasting"], "druid")).toBe(true);
  });

  it("§433: a classless NPC that carries the option — the `requirements` text says which", () => {
    const npc = actorWith([], [{ id: "potent-spellcasting", requirements: "Druid" }]);
    expect(featureClassOf(npc.items[0])).toBe("druid");
    expect(hasClassFeature(npc, "potent-spellcasting", "druid")).toBe(true);
    expect(hasClassFeature(npc, "potent-spellcasting", "cleric")).toBe(false);
    // A text that is not a lone class name ("Druid 7", empty) says nothing.
    expect(featureClassOf(actorWith([], [{ id: "potent-spellcasting", requirements: "Circle of the Land" }]).items[0])).toBe(null);
    expect(hasClassFeature(actorWith([], [{ id: "potent-spellcasting" }]), "potent-spellcasting", "druid")).toBe(false);
  });
});

describe("§431: Divine Strike and Primal Strike removed by either form of the option", () => {
  const facts = (features, classFeatures=[]) => ({ "activity.isWeapon": () => true, "source.wildShaped": () => false, "activity.isAttack": () => true,
    "source.hasFeature": f => features.includes(f),
    "source.hasClassFeature": ({ id, class: cls }) => classFeatures.some(([i, c]) => [id].flat().includes(i) && (c === cls)) });

  it("the Cleric: old identifier, or the Cleric's `potent-spellcasting` — not the Druid's", () => {
    const [basic] = SHIPPED["blessed-strikes"].triggers;
    expect(holds(basic.if, facts([]))).toBe(true);
    expect(holds(basic.if, facts(["blessed-strikes-potent-spellcasting"]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "cleric"]]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "druid"]]))).toBe(true);
  });

  it("the Druid: old identifier, or the Druid's `potent-spellcasting` — not the Cleric's", () => {
    const [basic] = SHIPPED["elemental-fury"].triggers;
    expect(holds(basic.if, facts([]))).toBe(true);
    expect(holds(basic.if, facts(["elemental-fury-potent-spellcasting"]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "druid"]]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "cleric"]]))).toBe(true);
  });

  it("no `potent-spellcasting` entry: dnd5e 6.1 itself adds Wisdom (item effect), no bonus counted twice", () => {
    expect(SHIPPED["potent-spellcasting"]).toBeUndefined();
    expect(SHIPPED["blessed-strikes-potent-spellcasting"].triggers).toHaveLength(1);
    expect(SHIPPED["elemental-fury-potent-spellcasting"].triggers).toHaveLength(1);
  });

  it("Improved Elemental Fury: the cantrip range requires either form", () => {
    expect(SHIPPED["improved-elemental-fury"].cantripRange.requires).toEqual(["elemental-fury-potent-spellcasting", "potent-spellcasting"]);
    const add = { value: 300, units: "ft" };
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: ["a", "b"] } })).toEqual([]);
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: [] } })).toHaveLength(1);
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: ["a", 3] } })).toHaveLength(1);
  });
});

describe("§431 : Calcination des morts-vivants, ancienne et nouvelle forme", async () => {
  const { upgradeOf } = await import("../module/scripts/adapter/pick-targets.mjs");
  const TURN = "aOptL5pMaj3WtR8S", SEAR_OLD = "fW3U8L8Ca9a6O9Wx", SEAR_61 = "rprxorXdFoHbRERZ";
  const rule = SHIPPED["channel-divinity-cleric"].pickTargets;

  it("the list also opens for the Channel Divinity \"Sear Undead\" (6.1), and the declaration is valid", () => {
    expect(rule.activities).toEqual([TURN, SEAR_61]);
    expect(SHIPPED["channel-divinity"].pickTargets.activities).toEqual([TURN, SEAR_61]);
    expect(validateEntry({ pickTargets: rule })).toEqual([]);
    expect(validateEntry({ pickTargets: { ...rule, upgrade: [] } })).toHaveLength(1);
    expect(validateEntry({ pickTargets: { ...rule, upgrade: [{ item: "x", activity: SEAR_61, requires: "" }] } })).toHaveLength(1);
  });

  it("old form: the activity of the Sear Undead item", () => {
    const actor = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN] }, { id: "sear-undead", activities: [SEAR_OLD] }]);
    const turn = actor.items[0].system.activities.get(TURN);
    expect(upgradeOf(turn, rule)?.id).toBe(SEAR_OLD);
  });

  it("6.1 form: the Channel Divinity activity, only with the Sear Undead item (level 5), never itself", () => {
    const at5 = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN, SEAR_61] }, { id: "sear-undead" }]);
    expect(upgradeOf(at5.items[0].system.activities.get(TURN), rule)?.id).toBe(SEAR_61);
    expect(upgradeOf(at5.items[0].system.activities.get(SEAR_61), rule)).toBe(null);
    const at3 = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN, SEAR_61] }]);
    expect(upgradeOf(at3.items[0].system.activities.get(TURN), rule)).toBe(null);
  });

  it("\"Sear Undead\" 6.1 targets only Undead, and its own damage does not end \"Turned\"", () => {
    expect(SHIPPED["channel-divinity-cleric"].targets.unaffectedIf["activity.id"]).toEqual([TURN, SEAR_61]);
    expect(SHIPPED["channel-divinity-cleric"].triggers.find(t => t.on === "isDamaged")).toMatchObject({ fromEffect: "iUeSbfduM7K8XrCF", by: "otherActivity" });
  });
});
