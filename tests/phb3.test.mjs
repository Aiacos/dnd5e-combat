/**
 * §438 : le Manuel des joueurs 3.0.0 (identifiants du SRD de dnd5e 6.1, activités rangées derrière une porte de niveau, échelles retirées,
 * effets de compendium) — le contenu lit la nouvelle forme ET l'ancienne (fiches faites avec le 2.2.0).
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT, SHIPPED, SRD_ALIASES } from "../module/scripts/content/index.mjs";
import { hiddenAtLevel } from "../module/scripts/core/level-gate.mjs";
import { phbDifferences, phbShape, renamedSourceItem, citesSubclass, grantedForwards, withoutGrantedForwards } from "../module/scripts/core/phb-update.mjs";

/** Une formule de dés évaluée sans Foundry : les données remplacées, `NdF` rendu « N|F » pour lire le nombre et les faces. */
function dice(formula, levels) {
  const text = formula.replace(/@classes\.(\w+)\.levels/g, (_, c) => String(levels[c] ?? 0));
  const m = /^(.+?)d(.+)$/.exec(text);
  const num = s => Function("min", "max", "floor", `return (${s});`)(Math.min, Math.max, Math.floor);
  return `${num(m[1])}d${num(m[2])}`;
}
const radius = (formula, druid) => Function("min", "floor", `return (${formula.replace("@classes.druid.levels", String(druid))});`)(Math.min, Math.floor);
const damageOf = (id, i=0) => CONTENT[id].triggers[i].do.find(s => s.type === "damage").formula;

describe("§438 : identifiants du Manuel 3.0.0", () => {
  it("Tempête radieuse de Jallarzi sous son identifiant du SRD", () => {
    expect(SRD_ALIASES["storm-of-radiance"]).toBe("jallarzis-storm-of-radiance");
    expect(CONTENT["storm-of-radiance"]).toEqual(CONTENT["jallarzis-storm-of-radiance"]);
    expect(CONTENT["black-tentacles"]).toBeTruthy();
  });
});

describe("§438 : échelles retirées — dés lus sur le niveau de classe", () => {
  it("Coup brutal : 1d10, 2d10 au niveau 17", () => {
    const f = damageOf("brutal-strike");
    expect(f).not.toMatch(/@scale/);
    expect(dice(f, { barbarian: 9 })).toBe("1d10");
    expect(dice(f, { barbarian: 16 })).toBe("1d10");
    expect(dice(f, { barbarian: 17 })).toBe("2d10");
  });
  it("Frappe effroyable (Traqueur des ténèbres) : 2d6, 2d8 au niveau 11", () => {
    const f = damageOf("dread-ambusher");
    expect(dice(f, { ranger: 3 })).toBe("2d6");
    expect(dice(f, { ranger: 10 })).toBe("2d6");
    expect(dice(f, { ranger: 11 })).toBe("2d8");
  });
  it("Frappes effroyables (Vagabond féerique) : 1d4, 1d6 au niveau 11", () => {
    const f = damageOf("dreadful-strikes");
    expect(dice(f, { ranger: 3 })).toBe("1d4");
    expect(dice(f, { ranger: 11 })).toBe("1d6");
  });
  it("Courroux des mers : 1,50 m, 3 m au niveau 6 (forme 2.2.0 et 3.0.0)", () => {
    for ( const id of ["wrath-of-the-sea", "stormborn"] ) {
      const f = CONTENT[id].pickTargets.radius;
      expect(f).not.toMatch(/@scale/);
      expect(radius(f, 3)).toBe(5);
      expect(radius(f, 5)).toBe(5);
      expect(radius(f, 6)).toBe(10);
      expect(radius(f, 20)).toBe(10);
    }
    expect(CONTENT["wrath-of-the-sea"].pickTargets.activities).toEqual(["nNTYj4vqURV4Dhjt", "9U9AoJYvcrCQtIMm"]);
  });
});

describe("§438 : activités derrière une porte de niveau", () => {
  it("hiddenAtLevel", () => {
    expect(hiddenAtLevel(null, 3)).toBe(false);
    expect(hiddenAtLevel({ min: null, max: null }, 3)).toBe(false);
    expect(hiddenAtLevel({ min: null, max: 5 }, 5)).toBe(false);
    expect(hiddenAtLevel({ min: null, max: 5 }, 6)).toBe(true);
    expect(hiddenAtLevel({ min: 6, max: null }, 5)).toBe(true);
    expect(hiddenAtLevel({ min: 6, max: null }, 6)).toBe(false);
    expect(hiddenAtLevel({ min: 6 }, Number.NaN)).toBe(false);
  });
  it("Éclat protecteur : l'activité 2.2.0 (jusqu'au niveau 5 en 3.0.0) et celle du niveau 6", () => {
    const used = CONTENT["warding-flare"].triggers.map(t => t.do.find(s => s.type === "use").activity);
    expect(used).toEqual(["dnd5eactivity000", "6V4FAVqgjzctbpoC"]);
    for ( const t of CONTENT["warding-flare"].triggers ) expect(t.on).toBe("enemyAttacks");
  });
  it("Concentration du moine : Déluge de base et « Heightened », Pas du vent payé d'un point", () => {
    const focus = CONTENT["monks-focus"];
    expect(focus.flurry.activity).toEqual(["2ghJTBhilLrFn9xT", "r0ou3Al6Dn3tgUC6"]);
    expect(focus.basicActions.KpoKztsxm5yuJWk6).toEqual(["disengage", "dodge"]);
    expect(focus.basicActions.Iv2YrISquTZWEjjN).toEqual(["dash", "disengage"]);
    expect(focus.basicActions.R3sqnBDwAjve0FvW).toEqual(["dash", "disengage"]);
    expect(focus.jump.double).toEqual(expect.arrayContaining(["0MuRZ0Ur95xQTKFq", "Iv2YrISquTZWEjjN", "R3sqnBDwAjve0FvW"]));
    // Ancienne forme intacte.
    expect(focus.basicActions["7xj7b6e8tDznDSrE"]).toEqual(["disengage", "dodge"]);
  });
  it("flurry : une activité ou une liste, rien d'autre", () => {
    expect(validateEntry({ flurry: { activity: "2ghJTBhilLrFn9xT", strikes: 2 } })).toEqual([]);
    expect(validateEntry({ flurry: { activity: ["2ghJTBhilLrFn9xT", "r0ou3Al6Dn3tgUC6"], strikes: 2 } })).toEqual([]);
    expect(validateEntry({ flurry: { activity: [], strikes: 2 } }).length).toBeGreaterThan(0);
    expect(validateEntry({ flurry: { activity: ["court"], strikes: 2 } }).length).toBeGreaterThan(0);
  });
  it("Toucher du médecin : la Main guérisseuse du niveau 6 de Main guérisseuse, et l'ancienne activité", () => {
    expect(CONTENT["hand-of-healing"].ranges).toMatchObject({ iDDZmeoYTIdWukLQ: { value: 5 }, ugC7uePiAZLSL55l: { value: 5 } });
    expect(CONTENT["hand-of-healing"].curesOn).toBe("ugC7uePiAZLSL55l");
    expect(CONTENT["hand-of-healing"].cures).toEqual(CONTENT["physicians-touch"].cures);
    expect(CONTENT["physicians-touch"].curesOn).toBe("stWL2fvcxsh0HFw2");
  });
  it("Pas féeriques : l'Échappatoire brumeuse du niveau 6 (Réaction, deux Foulées) ; l'ancien item garde la sienne", () => {
    const steps = CONTENT["steps-of-the-fey"];
    expect(steps.triggers.some(t => (t.on === "isDamaged") && t.do.some(s => s.activity === "Z2DMzP2QpvVjNVLY"))).toBe(true);
    expect(steps.afterTeleport.options.map(o => o.activity)).toEqual(expect.arrayContaining(["zgz1KLkZUycIeVF9", "PPflqO75qwj2WJP9"]));
    expect(steps.saveDamage).toEqual({ PPflqO75qwj2WJP9: "none" });
    expect(steps.breaksOn).toBeUndefined();   // Provocation (ennemis) ne doit pas tomber à leur attaque
    expect(CONTENT["misty-escape"].triggers[0].do[0].activity).toBe("2ceGTpBbBclN3qF9");
  });
});

describe("§438 : effets du compendium de dnd5e à la place des effets de l'item", () => {
  it("Ange vengeur : l'Effrayé commun, en plus de l'ancien", () => {
    const from = CONTENT["avenging-angel"].triggers.map(t => `${t.on}:${t.fromEffect}`);
    expect(from).toEqual(expect.arrayContaining(["isDamaged:ucmM8P37dhbuz8eK", "preAttackRoll:ucmM8P37dhbuz8eK",
      "isDamaged:OpCz3oGBfDZfxAlt", "preAttackRoll:OpCz3oGBfDZfxAlt"]));
  });
  it("Vengeance ardente : l'Aveuglé commun tombe à la fin du tour en cours", () => {
    expect(CONTENT["searing-vengeance"].effectEnds)
      .toEqual({ KOXCayzftTFF9Kam: "currentTurnEnd", "4odkdDU1wBQrCMJ1": "currentTurnEnd" });
  });
});

describe("§438 : rien de compté deux fois", () => {
  it("Affinité élémentaire : pas avec l'aptitude 3.0.0 du même type", () => {
    const triggers = CONTENT["elemental-affinity"].triggers;
    expect(triggers).toHaveLength(5);
    for ( const t of triggers ) {
      const type = t.if["activity.dealsType"];
      expect(t.if.not).toEqual({ "source.hasFeature": `elemental-affinity-${type}` });
    }
  });
});

describe("§438 : remise à jour des fiches (diagnostic)", () => {
  const act = (type, extra={}) => ({ type, effects: [], damage: { parts: [] }, visibility: { level: { min: null, max: null } }, ...extra });
  const old = { system: { identifier: "improved-brutal-strike", activities: { aaaaaaaaaaaaaaaa: act("utility") }, advancement: {} },
    effects: [{ _id: "eeeeeeeeeeeeeeee", system: { changes: [{ key: "system.attributes.movement.speed", type: "add", value: "-15" }] } }] };
  it("même forme : rien", () => {
    expect(phbDifferences(phbShape(old), phbShape(structuredClone(old)))).toEqual([]);
  });
  it("l'état de la fiche ne compte pas (utilisations, nom)", () => {
    const used = structuredClone(old);
    used.system.activities.aaaaaaaaaaaaaaaa.uses = { spent: 2 };
    used.system.activities.aaaaaaaaaaaaaaaa.name = "Traduit";
    used.effects[0].name = "Traduit";
    expect(phbDifferences(phbShape(used), phbShape(old))).toEqual([]);
  });
  it("identifiant, activités, effets, contenu, avancement", () => {
    const ref = structuredClone(old);
    ref.system.identifier = "brutal-strike";
    ref.system.activities.bbbbbbbbbbbbbbbb = act("damage");
    ref.effects.push({ _id: "ffffffffffffffff", system: { changes: [] } });
    ref.effects[0].system.changes = [{ key: "system.attributes.movement.bonus", type: "subtract", value: "15" }];
    ref.system.advancement = { x: { type: "ItemChoice" } };
    expect(phbDifferences(phbShape(old), phbShape(ref))).toEqual(["identifier", "activities", "effects", "content", "advancement"]);
  });
  it("une porte de niveau ajoutée est un changement de contenu", () => {
    const ref = structuredClone(old);
    ref.system.activities.aaaaaaaaaaaaaaaa.visibility.level.max = 5;
    expect(phbDifferences(phbShape(old), phbShape(ref))).toEqual(["content"]);
  });
  it("sorts d'une sous-classe renommée, formules qui citent l'ancien identifiant", () => {
    expect(renamedSourceItem("subclass:vengeance", "vengeance", "oath-vengeance")).toBe("subclass:oath-vengeance");
    expect(renamedSourceItem("class:paladin", "vengeance", "oath-vengeance")).toBeNull();
    expect(renamedSourceItem(undefined, "fey", "fey-wanderer")).toBeNull();
    expect(citesSubclass({ activities: { a: { damage: { parts: [{ custom: { formula: "@scale.fey.dreadful-strike" } }] } } } }, "fey")).toBe(true);
    expect(citesSubclass({ x: "@scale.fey-wanderer.die" }, "fey")).toBe(false);
    expect(citesSubclass({ x: "max(@subclasses.moon.levels, 1)" }, "moon")).toBe(true);
  });
});

describe("§438 : Calcination du Manuel 3.0.0 derrière sa porte de niveau", async () => {
  const { upgradeOf } = await import("../module/scripts/adapter/pick-targets.mjs");
  const TURN = "aOptL5pMaj3WtR8S", SEAR_61 = "rprxorXdFoHbRERZ";
  const rule = SHIPPED["channel-divinity-cleric"].pickTargets;
  const cleric = level => {
    const actor = { classes: { cleric: { identifier: "cleric" } } };
    const acts = new Map([[TURN, { id: TURN }], [SEAR_61, { id: SEAR_61, visibility: { level: { min: 5, max: null } }, relevantLevel: level }]]);
    const channel = { name: "Channel Divinity", actor, system: { identifier: "channel-divinity-cleric", activities: acts } };
    for ( const a of acts.values() ) { a.item = channel; a.actor = actor; }
    actor.items = [channel, { name: "Sear Undead", actor, system: { identifier: "sear-undead", activities: new Map() } }];
    return channel.system.activities.get(TURN);
  };
  it("niveau 5 : proposée ; niveau 3 (item prêté, activité cachée par dnd5e) : pas proposée", () => {
    expect(upgradeOf(cleric(5), rule)?.id).toBe(SEAR_61);
    expect(upgradeOf(cleric(3), rule)).toBe(null);
  });
});

describe("§438 : la règle d'invocation suit l'aptitude qui lance le sort (Compagnon sauvage 3.0.0)", async () => {
  const { summonRuleOf } = await import("../module/scripts/adapter/content.mjs");
  const companion = { _id: "phbdrdWildCompan", name: "Wild Companion", system: { identifier: "wild-companion" } };
  const actor = { items: new Map([[companion._id, companion]]) };
  companion.actor = actor;
  const copy = { name: "Find Familiar", actor, system: { identifier: "find-familiar" },
    flags: { dnd5e: { cachedFor: ".Item.phbdrdWildCompan.Activity.iS5gQuNiriMwrrWg" } } };
  it("la copie lancée par le Compagnon sauvage part au Repos long ; le sort lancé seul, non", () => {
    // contentOf lit la surcouche du monde (réglage) : vide ici.
    globalThis.game = { settings: { get: () => ({ v: 0, entries: {} }) } };
    expect(summonRuleOf(copy)).toMatchObject({ familiar: true, initiative: "own", endsOnLongRest: true });
    const plain = { ...copy, flags: {} };
    expect(summonRuleOf(plain)).toMatchObject({ familiar: true, initiative: "own" });
    expect(summonRuleOf(plain).endsOnLongRest).toBeUndefined();
    expect(summonRuleOf(null)).toBe(null);
    expect(summonRuleOf({ name: "x", system: { identifier: "longsword" } })).toBe(null);
    delete globalThis.game;
  });
});

describe("§438 : Liberté de mouvement et les clés de Vitesse de dnd5e 6.1", async () => {
  const { reducesSpeed, withoutSpeedReductions } = await import("../module/scripts/core/speed-floor.mjs");
  it("Lenteur 3.0.0 (`movement.multiplier` ×0,5) et 2.2.0 (`movement.speed` ×0,5) réduisent la Vitesse", () => {
    expect(reducesSpeed({ key: "system.attributes.movement.multiplier", type: "multiply", value: 0.5 })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.speed", type: "multiply", value: "0.5" })).toBe(true);
  });
  it("`movement.bonus` : soustraire ou ajouter un négatif réduit ; ajouter un positif, non", () => {
    expect(reducesSpeed({ key: "system.attributes.movement.bonus", type: "subtract", value: "15" })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.bonus", type: "add", value: "-10" })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.bonus", type: "add", value: "10" })).toBe(false);
    expect(reducesSpeed({ key: "system.attributes.movement.multiplier", type: "multiply", value: 2 })).toBe(false);
  });
  it("le reste de l'effet est gardé (CA, sauvegarde de Dextérité)", () => {
    const slowed = [{ key: "system.attributes.ac.bonus", type: "add", value: -2 }, { key: "system.attributes.movement.multiplier", type: "multiply", value: 0.5 },
      { key: "system.abilities.dex.bonuses.save", type: "add", value: -2 }];
    expect(withoutSpeedReductions(slowed).map(c => c.key)).toEqual(["system.attributes.ac.bonus", "system.abilities.dex.bonuses.save"]);
  });
});

describe("§438 : l'origine d'un effet copié du Manuel 3.0.0 (system.origin vers le compendium)", async () => {
  const { originItemOf } = await import("../module/scripts/adapter/facts.mjs");
  const own = { documentName: "Item", uuid: "Actor.a.Item.i", pack: null, name: "Clairvoyant Combatant" };
  const packed = { documentName: "Item", uuid: "Compendium.dnd-players-handbook.classes.Item.phbwlkClairvoyan", pack: "dnd-players-handbook.classes" };
  const docs = new Map([[own.uuid, own], [packed.uuid, packed]]);
  it("l'item de la fiche (origin écrite) plutôt que celui du compendium ; sinon comme avant", () => {
    globalThis.fromUuidSync = uuid => docs.get(uuid) ?? null;
    const copy = { system: { origin: { item: packed.uuid } }, origin: packed.uuid, _source: { origin: own.uuid } };
    expect(originItemOf(copy)).toBe(own);
    expect(originItemOf({ system: { origin: { item: own.uuid } }, _source: {} })).toBe(own);
    // Sans origine écrite : l'item du compendium (rien de mieux), comme avant.
    expect(originItemOf({ system: { origin: { item: packed.uuid } }, _source: { origin: null } })).toBe(packed);
    delete globalThis.fromUuidSync;
  });
});

describe("§438 : Frappe effroyable — les utilisations de l'activité ou de l'item, l'activité du niveau", async () => {
  const { usesHolderOf, shownActivityOf } = await import("../module/scripts/adapter/uses.mjs");
  it("2.2.0 : les utilisations de l'activité ; 3.0.0 : celles de l'item (itemUses sans cible)", () => {
    const old = { uses: { max: "3", value: 2, spent: 1 }, consumption: { targets: [{ type: "activityUses", value: "1" }] } };
    expect(usesHolderOf(old).left).toBe(2);
    const item = { system: { uses: { value: 0, spent: 3 } } };
    const v3 = { uses: { max: "", value: 0 }, item, actor: { items: new Map() }, consumption: { targets: [{ type: "itemUses", value: "1", target: "" }] } };
    expect(usesHolderOf(v3).left).toBe(0);
    item.system.uses.value = 2;
    expect(usesHolderOf(v3).left).toBe(2);
    expect(usesHolderOf({ uses: { max: "" }, consumption: { targets: [] } })).toBe(null);
  });
  it("la première activité que la fiche montre à ce niveau", () => {
    const at = level => ({ system: { activities: new Map([
      ["DMVf7FTyTC2HCAf9", { id: "DMVf7FTyTC2HCAf9", visibility: { level: { min: null, max: 10 } }, relevantLevel: level }],
      ["NGiX54LWGJGvMMwL", { id: "NGiX54LWGJGvMMwL", visibility: { level: { min: 11, max: null } }, relevantLevel: level }]]) } });
    const ids = ["DMVf7FTyTC2HCAf9", "NGiX54LWGJGvMMwL"];
    expect(shownActivityOf(at(5), ids)?.id).toBe("DMVf7FTyTC2HCAf9");
    expect(shownActivityOf(at(11), ids)?.id).toBe("NGiX54LWGJGvMMwL");
    expect(shownActivityOf({ system: { activities: new Map([["DMVf7FTyTC2HCAf9", { id: "DMVf7FTyTC2HCAf9" }]]) } }, ids)?.id).toBe("DMVf7FTyTC2HCAf9");
  });
});

describe("§438 : formules de dés lisibles (groupes de nombres calculés)", async () => {
  const { tidyDice } = await import("../module/scripts/core/formula-tidy.mjs");
  it("dés du niveau, rien d'autre", () => {
    expect(tidyDice("2d(6 + 2 * min(1, floor(5 / 11)))")).toBe("2d6");
    expect(tidyDice("2d(6 + 2 * min(1, floor(11 / 11)))")).toBe("2d8");
    expect(tidyDice("(1 + floor(17 / 17))d10")).toBe("2d10");
    expect(tidyDice("1d8 + @abilities.wis.mod")).toBe("1d8 + @abilities.wis.mod");
    expect(tidyDice("(1d6)")).toBe("(1d6)");
    expect(tidyDice("2d6 + max(1, 3)")).toBe("2d6 + 3");
  });
});

describe("§438 : la formule du Coup brutal se lit en dés simples (carte de chat)", async () => {
  const { tidyDice } = await import("../module/scripts/core/formula-tidy.mjs");
  /** Ce que fait `Roll.replaceFormulaData` pour un niveau de classe, puis la mise au propre du moteur (runtime/triggers.mjs). */
  const shown = (formula, levels) => tidyDice(formula.replace(/@classes\.(\w+)\.levels/g, (_, c) => String(levels[c] ?? 0)));
  it("le nombre de dés est calculé avant l'affichage : niveau 9 → 1d10, niveau 17 → 2d10", () => {
    const f = damageOf("brutal-strike");
    expect(tidyDice("(1 + floor(9 / 17))d10")).toBe("1d10");
    expect(shown(f, { barbarian: 9 })).toBe("1d10");
    expect(shown(f, { barbarian: 16 })).toBe("1d10");
    expect(shown(f, { barbarian: 17 })).toBe("2d10");
    expect(shown(f, { barbarian: 20 })).toBe("2d10");
  });
  it("toute formule de dégâts livrée qui lit un niveau de classe devient des dés simples, du niveau 1 au niveau 20", () => {
    const formulas = Object.values(SHIPPED).flatMap(e => (e.triggers ?? []).flatMap(t => [t.do ?? []].flat()))
      .filter(s => (s?.type === "damage") && /@classes\.\w+\.levels/.test(s.formula ?? "")).map(s => s.formula);
    expect(formulas.length).toBeGreaterThan(0);
    for ( const f of formulas ) for ( let lv = 1; lv <= 20; lv++ ) {
      const levels = new Proxy({}, { get: () => lv });
      expect(shown(f, levels), `${f} au niveau ${lv}`).not.toMatch(/[()]|floor|ceil|min|max/);
    }
  });
});

describe("§438 : Foulée évanescente — l'Invisible cesse, Nargué reste (`breaksOnActivity`)", async () => {
  const { effectBreakMoments } = await import("../module/scripts/core/conditions.mjs");
  const { originActivityIdOf } = await import("../module/scripts/adapter/facts.mjs");
  const steps = CONTENT["steps-of-the-fey"];
  it("donnée : seulement l'activité de la Foulée évanescente, pas de `breaksOn` sur l'item", () => {
    expect(validateEntry({ breaksOnActivity: steps.breaksOnActivity })).toEqual([]);
    expect(steps.breaksOn).toBeUndefined();
    expect(steps.breaksOnActivity).toEqual({ zgz1KLkZUycIeVF9: ["attack", "damage", "spell"] });
    expect(validateEntry({ breaksOnActivity: { zgz1KLkZUycIeVF9: ["jump"] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ breaksOnActivity: { court: ["attack"] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ breaksOnActivity: {} }).length).toBeGreaterThan(0);
  });
  it("règle : les moments de l'item, plus ceux de l'activité qui a posé l'effet", () => {
    expect(effectBreakMoments(steps, "zgz1KLkZUycIeVF9")).toEqual(["attack", "damage", "spell"]);
    expect(effectBreakMoments(steps, "48TdRWDqCVcC9mh4")).toEqual([]);
    expect(effectBreakMoments(steps, null)).toEqual([]);
    expect(effectBreakMoments({ breaksOn: ["save"], breaksOnActivity: { zgz1KLkZUycIeVF9: ["save", "attack"] } }, "zgz1KLkZUycIeVF9")).toEqual(["save", "attack"]);
    expect(effectBreakMoments(CONTENT["misty-escape"], null)).toEqual(["attack", "damage", "spell"]);
  });
  it("l'activité d'origine : par dnd5e (origin.activity, profil) ou par la copie du moteur (effet distant)", () => {
    const remote = "Compendium.dnd5e.effects.ActiveEffect.QUmDKA6mnK7HoASC";
    const acts = [
      { id: "zgz1KLkZUycIeVF9", effects: [{ _id: "G8l0X26HrzREMOTE", uuid: remote }] },
      { id: "48TdRWDqCVcC9mh4", effects: [{ _id: "sERUxQRn17lzEQbl" }] }
    ];
    const activities = Object.assign([...acts], { get: id => acts.find(a => a.id === id) });
    const item = { system: { activities } };
    expect(originActivityIdOf({ system: { origin: { activity: "Actor.a.Item.i.Activity.zgz1KLkZUycIeVF9" } }, _stats: {} }, item)).toBe("zgz1KLkZUycIeVF9");
    expect(originActivityIdOf({ system: { origin: { profile: "G8l0X26HrzREMOTE" } }, _stats: {} }, item)).toBe("zgz1KLkZUycIeVF9");
    expect(originActivityIdOf({ system: { origin: {} }, _stats: { compendiumSource: remote } }, item)).toBe("zgz1KLkZUycIeVF9");
    expect(originActivityIdOf({ system: { origin: {} }, _stats: { duplicateSource: "Actor.a.Item.i.ActiveEffect.sERUxQRn17lzEQbl" } }, item)).toBe("48TdRWDqCVcC9mh4");
    expect(originActivityIdOf({ system: { origin: {} }, _stats: {} }, item)).toBeNull();
  });
});

describe("§438 : Courroux des mers 3.0.0 — la sauvegarde suit la manifestation, sur soi ou sur une autre créature", async () => {
  const { chainedPickOf, picksFor, withinCenters } = await import("../module/scripts/core/pick-after.mjs");
  const rule = CONTENT["wrath-of-the-sea"].pickTargets;
  it("donnée valide ; `after` et `bearers` refusés quand ils sont mal formés", () => {
    expect(validateEntry({ pickTargets: rule })).toEqual([]);
    expect(validateEntry({ pickTargets: { ...rule, after: { nNTYj4vqURV4Dhjt: { activity: "AAAAAAAAAAAAAAAA", around: "self" } } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ pickTargets: { ...rule, after: { nNTYj4vqURV4Dhjt: { activity: "9U9AoJYvcrCQtIMm", around: "loin" } } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ pickTargets: { ...rule, bearers: { radius: 10 } } }).length).toBeGreaterThan(0);
  });
  it("manifestation utilitaire (3.0.0) : la sauvegarde suit, autour du druide ou de la créature visée (niveau 14)", () => {
    expect(chainedPickOf(rule, "nNTYj4vqURV4Dhjt", "utility")).toEqual({ activity: "9U9AoJYvcrCQtIMm", around: "self" });
    expect(chainedPickOf(rule, "ituofBRxXKLI7wNW", "utility")).toEqual({ activity: "9U9AoJYvcrCQtIMm", around: "targets" });
    expect(picksFor(rule, "nNTYj4vqURV4Dhjt", "utility")).toBe(false);
    expect(picksFor(rule, "9U9AoJYvcrCQtIMm", "save")).toBe(true);
  });
  it("forme 2.2.0 : `nNTY…` est la sauvegarde — liste avant l'utilisation, rien d'enchaîné", () => {
    expect(chainedPickOf(rule, "nNTYj4vqURV4Dhjt", "save")).toBeNull();
    expect(picksFor(rule, "nNTYj4vqURV4Dhjt", "save")).toBe(true);
  });
  it("une créature est dans l'une des émanations : la distance la plus courte, ou null", () => {
    expect(withinCenters([{ distance: 12, radius: 10 }, { distance: 5, radius: 10 }])).toBe(5);
    expect(withinCenters([{ distance: 7, radius: 5 }, { distance: 10, radius: 10 }])).toBe(10);
    expect(withinCenters([{ distance: 15, radius: 10 }])).toBeNull();
  });
});

describe("§547: a granted spell's free-cast activity is not a difference from the Handbook", () => {
  const smite = { system: { identifier: "divine-smite", activities: { dnd5eactivity000: { type: "damage", damage: { parts: [{ number: 2, denomination: 8 }] } } } } };
  const granted = structuredClone(smite);
  granted.system.activities.r4nd0mF0rward001 = { type: "forward", activity: { id: "dnd5eactivity000" } };

  it("the forward activity is found and dropped: no reason left", () => {
    const own = phbShape(granted), ref = phbShape(smite);
    expect(grantedForwards(own, ref)).toEqual(["r4nd0mF0rward001"]);
    expect(phbDifferences(own, ref)).toEqual(["activities"]);
    expect(phbDifferences(withoutGrantedForwards(own, ref), ref)).toEqual([]);
  });

  it("a forward activity to nothing the Handbook has, or another added activity, still counts", () => {
    const odd = structuredClone(granted);
    odd.system.activities.r4nd0mF0rward001.activity.id = "notInHandbook00";
    odd.system.activities.extraActivity001 = { type: "utility" };
    const own = phbShape(odd), ref = phbShape(smite);
    expect(grantedForwards(own, ref)).toEqual([]);
    expect(phbDifferences(withoutGrantedForwards(own, ref), ref)).toEqual(["activities"]);
  });

  it("an activity the Handbook changed is still seen through the grant", () => {
    const newer = structuredClone(smite);
    newer.system.activities.dnd5eactivity000.damage.parts[0].number = 3;
    const own = phbShape(granted), ref = phbShape(newer);
    expect(phbDifferences(withoutGrantedForwards(own, ref), ref)).toEqual(["content"]);
  });
});
