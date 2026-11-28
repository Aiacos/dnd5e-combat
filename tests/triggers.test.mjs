import { describe, it, expect } from "vitest";
import { normalize, holds, unknownFacts, select, stepsOf, MOMENTS, spareBearer } from "../module/scripts/core/triggers.mjs";
import { STEP_TYPES } from "../module/scripts/core/content.mjs";
import { TRIGGERS } from "../module/scripts/content/triggers.mjs";
import { eligibleReactions } from "../module/scripts/core/reaction.mjs";

const facts = {
  "activity.isAttack": true,
  "activity.type": "attack",
  "target.hasStatus": id => ["prone", "poisoned"].includes(id),
  "target.hasEffectFrom": id => id === "hex"
};

describe("conditions", () => {
  it("absent or true: holds; false: does not hold", () => {
    expect(holds(undefined, facts)).toBe(true);
    expect(holds(null, facts)).toBe(true);
    expect(holds(true, facts)).toBe(true);
    expect(holds(false, facts)).toBe(false);
  });

  it("compares a value-fact strictly, or within a list", () => {
    expect(holds({ "activity.type": "attack" }, facts)).toBe(true);
    expect(holds({ "activity.type": "save" }, facts)).toBe(false);
    expect(holds({ "activity.type": ["save", "attack"] }, facts)).toBe(true);
    expect(holds({ "activity.isAttack": 1 }, facts)).toBe(false);   // pas de conversion
  });

  it("calls a function-fact with the argument", () => {
    expect(holds({ "target.hasStatus": "prone" }, facts)).toBe(true);
    expect(holds({ "target.hasStatus": "stunned" }, facts)).toBe(false);
  });

  it("several keys = all of them; all / any / not combine", () => {
    expect(holds({ "activity.isAttack": true, "target.hasEffectFrom": "hex" }, facts)).toBe(true);
    expect(holds({ "activity.isAttack": true, "target.hasEffectFrom": "hunters-mark" }, facts)).toBe(false);
    expect(holds({ any: [{ "target.hasStatus": "stunned" }, { "target.hasStatus": "prone" }] }, facts)).toBe(true);
    expect(holds({ all: [{ "target.hasStatus": "stunned" }, { "target.hasStatus": "prone" }] }, facts)).toBe(false);
    expect(holds({ not: { "target.hasStatus": "stunned" } }, facts)).toBe(true);
    expect(holds([{ "activity.isAttack": true }, { not: { "activity.type": "save" } }], facts)).toBe(true);
  });

  it("an unknown key makes the condition false, and can be listed", () => {
    expect(holds({ "moon.phase": "full" }, facts)).toBe(false);
    expect(holds({ any: [{ "moon.phase": "full" }, { "activity.isAttack": true }] }, facts)).toBe(true);
    expect(unknownFacts({ all: [{ "moon.phase": "full" }, { not: { "tide.high": true } }, { "activity.isAttack": true }] }, facts))
      .toEqual(["moon.phase", "tide.high"]);
    expect(unknownFacts({ "activity.isAttack": true }, facts)).toEqual([]);
  });
});

describe("declarations", () => {
  it("are normalized: `on` as a list, `if` and `do` present, provenance added", () => {
    expect(normalize({ on: "isHit", do: [{ type: "use" }] }, { item: "I" })).toEqual({ item: "I", on: ["isHit"], if: null, do: [{ type: "use" }], via: null });
    expect(normalize({ on: ["enter", null, "turnEnd"] })).toEqual({ on: ["enter", "turnEnd"], if: null, do: [], via: null });
  });

  it("select: the moment AND the condition", () => {
    const declared = [
      normalize({ on: "preDamageRoll", if: { "target.hasEffectFrom": "hex" }, do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }] }, { name: "Maléfice" }),
      normalize({ on: "preDamageRoll", if: { "target.hasEffectFrom": "hunters-mark" }, do: [{ type: "damage", formula: "1d6", damageType: "force" }] }, { name: "Marque" }),
      normalize({ on: "isHit", do: [{ type: "use" }] }, { name: "Bouclier" })
    ];
    expect(select(declared, "preDamageRoll", facts).map(d => d.name)).toEqual(["Maléfice"]);
    expect(select(declared, "isHit", facts).map(d => d.name)).toEqual(["Bouclier"]);
    expect(select(declared, "turnEnd", facts)).toEqual([]);
    expect(stepsOf(declared[0], "damage")).toEqual([{ type: "damage", formula: "1d6", damageType: "necrotic" }]);
    expect(stepsOf(declared[0], "use")).toEqual([]);
  });

  it("the Reaction budget filters after the selection", () => {
    const shield = normalize({ on: "isHit", do: [{ type: "use" }] }, { name: "Bouclier" });
    expect(eligibleReactions([shield], "isHit", { reactionAvailable: true })).toHaveLength(1);
    expect(eligibleReactions([shield], "isHit", { reactionAvailable: false })).toHaveLength(0);
  });
});

describe("shipped content", () => {
  const all = Object.entries(TRIGGERS).flatMap(([id, list]) => list.map(d => ({ id, ...normalize(d) })));

  it("only hooks onto known moments, with known steps", () => {
    for ( const d of all ) {
      for ( const m of d.on ) expect(Object.keys(MOMENTS), `${d.id} : moment ${m}`).toContain(m);
      for ( const s of d.do ) expect(STEP_TYPES, `${d.id} : étape ${s.type}`).toContain(s.type);
      expect(d.do.length, `${d.id} : aucune étape`).toBeGreaterThan(0);
    }
  });

  it("n'emploie que des faits que l'adaptateur fournit", () => {
    // The keys of adapter/facts.mjs, `factsFor` — to be kept in sync with it (tests/content.test.mjs restates them).
    const provided = ["activity.type", "activity.isAttack", "activity.isSpell", "activity.isWeapon", "activity.identifier", "activity.id", "activity.hasProperty",
      "source.hasStatus", "source.hasEffect", "source.creatureType", "source.allyNearTarget", "source.summonNearTarget", "source.seesTarget",
      "target.hasStatus", "target.hasEffect", "target.hasEffectFrom", "target.sizeAtMost", "target.within", "target.seesSource",
      "target.creatureType", "target.immuneTo", "activity.isMelee", "target.hasTempHp", "target.speedZero", "damage.hasType", "target.hpAtMost", "hit.stoppableBy", "hit.critical", "activity.ability",
      "source.onOwnTurn"];
    const known = Object.fromEntries(provided.map(k => [k, true]));
    for ( const d of all ) expect(unknownFacts(d.if, known), d.id).toEqual([]);
  });

  it("Hex: bonus damage on the target marked by THIS caster, on an attack only", () => {
    const [hex] = select(all.filter(d => d.id === "hex"), "preDamageRoll", facts);
    expect(stepsOf(hex, "damage")).toEqual([{ type: "damage", formula: "1d6", damageType: "necrotic" }]);
    expect(select(all.filter(d => d.id === "hex"), "preDamageRoll", { ...facts, "activity.isAttack": false })).toEqual([]);
    expect(select(all.filter(d => d.id === "hex"), "preDamageRoll", { ...facts, "target.hasEffectFrom": () => false })).toEqual([]);
  });

  it("Shield and Hellish Rebuke: the same windows as before, the target in addition", () => {
    const stoppable = { "hit.stoppableBy": () => true };
    expect(select(all.filter(d => d.id === "shield"), "isHit", stoppable)).toHaveLength(1);
    // §138: not on a hit that +5 would not change (Critical Hit, or a roll above AC + 5).
    expect(select(all.filter(d => d.id === "shield"), "isHit", { "hit.stoppableBy": () => false })).toHaveLength(0);
    const sees = { "target.seesSource": want => want === true };
    const [rebuke] = select(all.filter(d => d.id === "hellish-rebuke"), "isDamaged", sees);
    expect(stepsOf(rebuke, "use")[0].target).toBe("source");
  });

  it("Hellish Rebuke requires seeing who hurt you (P1); Shield does not", () => {
    const blind = { "target.seesSource": want => want === false };
    expect(select(all.filter(d => d.id === "hellish-rebuke"), "isDamaged", blind)).toHaveLength(0);
    expect(select(all.filter(d => d.id === "shield"), "isHit", { ...blind, "hit.stoppableBy": () => true })).toHaveLength(1);
  });

  it("areas: Moonbeam acts on entry and at end of turn; Flaming Sphere is not an area (§16.15: pulse)", () => {
    const on = id => all.filter(d => d.id === id).flatMap(d => d.on);
    expect(on("moonbeam")).toEqual(["enter", "turnEnd", "failedSave"]);   // §402: the true form resumed on a failure
    expect(on("flaming-sphere")).toEqual([]);
  });
});

import { OUTCOME_MOMENTS, TURN_MOMENTS } from "../module/scripts/core/triggers.mjs";

describe("briques (SPEC §16) : moments d'issue et de tour, via", () => {
  it("the outcome and turn moments are known to the registry", () => {
    for ( const m of [...OUTCOME_MOMENTS, ...TURN_MOMENTS] ) expect(MOMENTS[m]).toBeTruthy();
    expect(OUTCOME_MOMENTS).toEqual(["hit", "failedSave", "savedSave"]);
    expect(MOMENTS.preAttackRoll).toBeTruthy();
    expect(MOMENTS.castsSpell).toBeTruthy();
    expect(MOMENTS.isAttacked).toBeTruthy();
    expect(TURN_MOMENTS).toEqual(["startOfTurn", "endOfTurn"]);
  });

  it("normalize: via is null by default, otherwise what is declared", () => {
    expect(normalize({ on: "endOfTurn", do: [{ type: "resave" }] }).via).toBe(null);
    expect(normalize({ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }).via).toBe("effect");
  });

  it("select: a \"via effect\" declaration is selected like the others, by moment", () => {
    const d = normalize({ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }, { effect: "E1" });
    expect(select([d], "endOfTurn", facts)).toEqual([d]);
    expect(select([d], "turnEnd", facts)).toEqual([]);
    expect(stepsOf(d, "resave")).toEqual([{ type: "resave" }]);
  });
});

describe("bearer's damage on its turn (issue #40)", () => {
  it("a dead creature no longer takes them", () => {
    expect(spareBearer({ dead: true, heals: false })).toBe(true);
  });
  it("a living creature, or one at 0 HP making Death Saving Throws (not dead), takes them", () => {
    expect(spareBearer({ dead: false, heals: false })).toBe(false);
  });
  it("healing carried by the same path is not discarded", () => {
    expect(spareBearer({ dead: true, heals: true })).toBe(false);
    expect(spareBearer({ dead: false, heals: true })).toBe(false);
  });
});
