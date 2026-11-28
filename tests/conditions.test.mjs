import { describe, it, expect } from "vitest";
import {
  attackModifiers, netMode, combineTargets, isAutoCritical, autoFailSave, verbalSpellBlocked, typeAutoSave
} from "../module/scripts/core/conditions.mjs";

const attack = over => attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, ...over });
const keys = list => list.map(r => `${r.who}.${r.key}`);

describe("target conditions", () => {
  it.each(["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious"])(
    "attaquer une cible %s donne l'avantage", status => {
      expect(netMode(attack({ target: [status] }))).toBe(1);
    });
  it("attacking an Invisible target or one that dodges gives Disadvantage", () => {
    expect(netMode(attack({ target: ["invisible"] }))).toBe(-1);
    expect(netMode(attack({ target: ["dodging"] }))).toBe(-1);
  });
  it("Prone: Advantage up close, Disadvantage from afar", () => {
    expect(keys(attack({ target: ["prone"], adjacent: true }).advantage)).toEqual(["target.prone"]);
    expect(keys(attack({ target: ["prone"], adjacent: false, ranged: true }).disadvantage)).toEqual(["target.proneFar"]);
  });
  it("a 10 ft reach against a Prone target that is not adjacent: Disadvantage", () => {
    expect(netMode(attack({ target: ["prone"], adjacent: false, ranged: false }))).toBe(-1);
  });
});

describe("attacker conditions", () => {
  it.each(["blinded", "frightened", "prone", "restrained"])("un attaquant %s a le désavantage", status => {
    expect(netMode(attack({ attacker: [status] }))).toBe(-1);
  });
  it("un attaquant invisible a l'avantage", () => {
    expect(netMode(attack({ attacker: ["invisible"] }))).toBe(1);
  });
  it("does not redo what dnd5e already applies by itself (Poisoned)", () => {
    expect(attack({ attacker: ["poisoned"] })).toEqual({ advantage: [], disadvantage: [] });
  });
});

describe("situation", () => {
  it("long range and melee weigh only on a ranged attack", () => {
    expect(keys(attack({ ranged: true, adjacent: false, longRange: true, closeCombat: true }).disadvantage))
      .toEqual(["situation.longRange", "situation.closeCombat"]);
    expect(attack({ ranged: false, longRange: true, closeCombat: true }).disadvantage).toEqual([]);
  });
});

describe("cumul", () => {
  it("an Advantage and a Disadvantage cancel out", () => {
    expect(netMode(attack({ attacker: ["prone"], target: ["restrained"] }))).toBe(0);
  });
  it("two Advantages against one Disadvantage: still a normal roll", () => {
    expect(netMode(attack({ attacker: ["prone"], target: ["restrained", "blinded"] }))).toBe(0);
  });
  it("garde toutes les raisons pour l'affichage", () => {
    const mods = attack({ attacker: ["invisible"], target: ["stunned"] });
    expect(keys(mods.advantage)).toEqual(["attacker.invisible", "target.stunned"]);
  });
});

describe("plusieurs cibles, un seul jet", () => {
  it("tranche quand toutes les cibles s'accordent", () => {
    expect(combineTargets([attack({ target: ["prone"] }), attack({ target: ["stunned"] })])).toEqual({ mode: 1, agreed: true });
  });
  it("does not decide when they diverge", () => {
    expect(combineTargets([attack({ target: ["prone"] }), attack({})])).toEqual({ mode: 0, agreed: false });
  });
  it("sans cible, jet normal", () => {
    expect(combineTargets([])).toEqual({ mode: 0, agreed: true });
  });
});

describe("automatic critical and failure", () => {
  it("hitting a Paralyzed or Unconscious target within 5 ft is a critical", () => {
    expect(isAutoCritical(["paralyzed"], true)).toBe(true);
    expect(isAutoCritical(["unconscious"], true)).toBe(true);
  });
  it("not at range, not for a mere Stunned", () => {
    expect(isAutoCritical(["paralyzed"], false)).toBe(false);
    expect(isAutoCritical(["stunned"], true)).toBe(false);
  });
  it("Strength and Dexterity fail automatically for a Paralyzed, Stunned, Unconscious, Petrified creature", () => {
    for ( const s of ["paralyzed", "petrified", "stunned", "unconscious"] ) {
      expect(autoFailSave([s], "dex")).toBe(s);
      expect(autoFailSave([s], "str")).toBe(s);
    }
  });
  it("not the other abilities, not the other conditions", () => {
    expect(autoFailSave(["paralyzed"], "wis")).toBeNull();
    expect(autoFailSave(["restrained"], "dex")).toBeNull();
  });
});

describe("Silence: spells with a verbal component", () => {
  it("a silenced caster does not cast a verbal spell", () => {
    expect(verbalSpellBlocked(["silenced", "deafened"], { spell: true, verbal: true })).toBe("silenced");
  });
  it("a spell without a verbal component, or what is not a spell, goes through", () => {
    expect(verbalSpellBlocked(["silenced"], { spell: true, verbal: false })).toBeNull();
    expect(verbalSpellBlocked(["silenced"], { spell: false, verbal: false })).toBeNull();
  });
  it("Deafened alone prevents nothing", () => {
    expect(verbalSpellBlocked(["deafened"], { spell: true, verbal: true })).toBeNull();
  });
});

describe("simulated vision (P1): who sees whom", () => {
  const seen = { attackerSees: true, targetSees: true };

  it("without vision facts, nothing changes (flat conditions)", () => {
    expect(keys(attack({ target: ["invisible"] }).disadvantage)).toEqual(["target.invisible"]);
    expect(keys(attack({ attacker: ["blinded"] }).disadvantage)).toEqual(["attacker.blinded"]);
  });

  it("tout le monde se voit : aucun modificateur", () => {
    expect(netMode(attack({ vision: seen }))).toBe(0);
  });

  it("attacking a target one cannot see: Disadvantage", () => {
    const m = attack({ vision: { attackerSees: false, targetSees: true } });
    expect(keys(m.disadvantage)).toEqual(["target.unseen"]);
    expect(netMode(m)).toBe(-1);
  });

  it("attacking without being seen: Advantage", () => {
    const m = attack({ vision: { attackerSees: true, targetSees: false } });
    expect(keys(m.advantage)).toEqual(["attacker.unseen"]);
    expect(netMode(m)).toBe(1);
  });

  it("neither sees the other: Advantage and Disadvantage cancel out", () => {
    expect(netMode(attack({ vision: { attackerSees: false, targetSees: false } }))).toBe(0);
  });

  it("with vision, Invisible and Blinded no longer count by themselves: what is seen is what counts", () => {
    // Invisible but seen target (Blindsight): no Disadvantage.
    expect(keys(attack({ target: ["invisible"], vision: seen }).disadvantage)).toEqual([]);
    // Invisible but seen attacker: no Advantage.
    expect(keys(attack({ attacker: ["invisible"], vision: seen }).advantage)).toEqual([]);
    // Blinded attacker who still sees (Blindsight): no Disadvantage; Blinded target who sees: no Advantage.
    expect(keys(attack({ attacker: ["blinded"], vision: seen }).disadvantage)).toEqual([]);
    expect(keys(attack({ target: ["blinded"], vision: seen }).advantage)).toEqual([]);
    // And the reverse: an unseen Invisible attacker does give Advantage, through vision and only once.
    expect(keys(attack({ attacker: ["invisible"], vision: { attackerSees: true, targetSees: false } }).advantage)).toEqual(["attacker.unseen"]);
  });

  it("Dodge (2024): Disadvantage only if the target sees the attacker", () => {
    expect(keys(attack({ target: ["dodging"], vision: seen }).disadvantage)).toEqual(["target.dodging"]);
    expect(keys(attack({ target: ["dodging"], vision: { attackerSees: true, targetSees: false } }).disadvantage)).toEqual([]);
  });

  it("the other conditions keep their effect with vision (Prone, Paralyzed, Frightened)", () => {
    expect(keys(attack({ target: ["paralyzed"], vision: seen }).advantage)).toEqual(["target.paralyzed"]);
    expect(keys(attack({ attacker: ["frightened"], vision: seen }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ target: ["prone"], adjacent: false, ranged: true, vision: seen }).disadvantage)).toEqual(["target.proneFar"]);
  });
});

describe("Frightened \"while the source is in line of sight\" (P1)", () => {
  it("the condition hinders the attack unless no known source is in view", () => {
    expect(keys(attack({ attacker: ["frightened"] }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: true }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: null }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: false }).disadvantage)).toEqual([]);
  });
});

describe("reasons declared by the content (SPEC §16, B6)", () => {
  it("are added to the conditions, by item name, and weigh like the others", () => {
    const r = attack({ declared: { advantage: ["Lueurs féeriques"], disadvantage: [] } });
    expect(keys(r.advantage)).toEqual(["content.Lueurs féeriques"]);
    expect(netMode(r)).toBe(1);
    expect(netMode(attack({ declared: { disadvantage: ["Protection contre le mal et le bien"] } }))).toBe(-1);
    // With a condition Disadvantage, they cancel out like the rest.
    expect(netMode(attack({ attacker: ["prone"], declared: { advantage: ["Tactique de meute"] } }))).toBe(0);
  });
  it("without a declaration: nothing more", () => {
    expect(attack({ declared: null })).toEqual({ advantage: [], disadvantage: [] });
    expect(attack({})).toEqual({ advantage: [], disadvantage: [] });
  });
});

import { hampersRangedAttack } from "../module/scripts/core/conditions.mjs";

describe("point-blank shot: which hinders", () => {
  it("an enemy who sees the attacker and is not Incapacitated", () => {
    expect(hampersRangedAttack({ hostile: true, statuses: [], seesAttacker: true })).toBe(true);
    expect(hampersRangedAttack({ hostile: true, statuses: [] })).toBe(true);
    expect(hampersRangedAttack({ hostile: true, statuses: [], seesAttacker: false })).toBe(false);
    expect(hampersRangedAttack({ hostile: false, statuses: [], seesAttacker: true })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: ["unconscious", "incapacitated"] })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: ["stunned"] })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: [], dead: true })).toBe(false);
  });
});

import { conditionUseIssues, forbiddenAgainstCharmer, requiresSight, movesCloser } from "../module/scripts/core/conditions.mjs";

describe("§17.3: what conditions forbid", () => {
  it("Incapacitated: no action, no Bonus Action, no Reaction", () => {
    expect(conditionUseIssues({ statuses: ["stunned", "incapacitated"], cost: "action" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["paralyzed"], cost: "bonus" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["unconscious"], cost: "reaction" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["incapacitated"], cost: null })).toEqual([]);
    expect(conditionUseIssues({ statuses: ["prone"], cost: "action" })).toEqual([]);
  });
  it("Charmed: attack, damage or magical effect against the charmer", () => {
    expect(forbiddenAgainstCharmer({ attack: true, damage: false, magical: false })).toBe(true);
    expect(forbiddenAgainstCharmer({ attack: false, damage: false, magical: true })).toBe(true);
    expect(forbiddenAgainstCharmer({ attack: false, damage: false, magical: false })).toBe(false);
  });
  it("\"a creature you can see\"", () => {
    expect(requiresSight("<p>Choose a creature that you can see within range.</p>")).toBe(true);
    expect(requiresSight("<p>One creature you can see within range must succeed</p>")).toBe(true);
    expect(requiresSight("<p>Une créature que vous voyez dans un rayon de 18 m</p>")).toBe(true);
    expect(requiresSight("<p>jusqu'à trois créatures de votre choix parmi celles que vous voyez</p>")).toBe(true);
    expect(requiresSight("<p>vers un espace inoccupé que vous voyez</p>")).toBe(false);
    expect(requiresSight("<p>A bright streak flashes to a point you choose within range</p>")).toBe(false);
  });
  it("Frightened: moving closer to the source", () => {
    expect(movesCloser(30, [30, 35])).toBe(false);
    expect(movesCloser(30, [35, 25])).toBe(true);
  });
});

import { breakMoments, curable, fightingAdvantage } from "../module/scripts/core/conditions.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§16.47: spell rules", () => {
  it("Arms of Hadar: no Reaction", () => {
    expect(conditionUseIssues({ statuses: [], cost: "reaction", noReactions: true })).toEqual(["noReactions"]);
    expect(conditionUseIssues({ statuses: [], cost: "action", noReactions: true })).toEqual([]);
  });
  it("Invisibility: what breaks it", () => {
    expect(breakMoments({ attack: true, damage: false, spell: false })).toEqual(["attack"]);
    expect(breakMoments({ attack: false, damage: true, spell: true })).toEqual(["damage", "spell"]);
    expect(breakMoments({ attack: false, damage: false, spell: false })).toEqual([]);
  });
  it("Lesser Restoration: the conditions present", () => {
    expect(curable(["poisoned", "prone", "blinded"], ["blinded", "deafened", "paralyzed", "poisoned"])).toEqual(["blinded", "poisoned"]);
    expect(curable(["prone"], ["blinded"])).toEqual([]);
  });
  it("Charme-personne : avantage si on la combat", () => {
    expect(fightingAdvantage({ targetInCombat: true, hostile: true })).toBe(true);
    expect(fightingAdvantage({ targetInCombat: false, hostile: true })).toBe(false);
    expect(fightingAdvantage({ targetInCombat: true, hostile: false })).toBe(false);
  });
});

describe("§77: an action or a Bonus Action, not both", () => {
  const budget = (action, bonus, used=0) => ({ action, bonus, attacks: { granted: used ? 2 : 0, used } });
  it("the action already taken: no more Bonus Action", () => {
    expect(conditionUseIssues({ statuses: [], cost: "bonus", actionOrBonus: true, budget: budget(0, 1) })).toEqual(["actionOrBonus"]);
    expect(conditionUseIssues({ statuses: [], cost: "bonus", actionOrBonus: true, budget: budget(0, 1, 1) })).toEqual(["actionOrBonus"]);
  });
  it("the Bonus Action already taken: no more action", () => {
    expect(conditionUseIssues({ statuses: [], cost: "action", actionOrBonus: true, budget: budget(1, 0) })).toEqual(["actionOrBonus"]);
  });
  it("rien de pris, ou sans l'effet : libre", () => {
    expect(conditionUseIssues({ statuses: [], cost: "action", actionOrBonus: true, budget: budget(1, 1) })).toEqual([]);
    expect(conditionUseIssues({ statuses: [], cost: "bonus", budget: budget(0, 1) })).toEqual([]);
  });
});

describe("automatic save by creature type (saveAutoSuccess.types, saveAutoFail.types)", () => {
  it("Blight: a Plant fails automatically, the others roll", () => {
    expect(typeAutoSave({ fail: ["plant"] }, "plant")).toEqual({ autoFail: "type:plant" });
    expect(typeAutoSave({ fail: ["plant"] }, "undead")).toBeNull();
    expect(typeAutoSave({ fail: ["plant"] }, "")).toBeNull();
    expect(typeAutoSave({ fail: ["plant"] }, undefined)).toBeNull();
  });
  it("Petrification: a Construct succeeds automatically", () => {
    expect(typeAutoSave({ success: ["construct"] }, "construct")).toEqual({ autoSucceed: "type:construct" });
    expect(typeAutoSave({ success: ["construct"] }, "plant")).toBeNull();
  });
  it("no rule, nothing; declared on both sides, the failure wins", () => {
    expect(typeAutoSave({}, "plant")).toBeNull();
    expect(typeAutoSave(undefined, "plant")).toBeNull();
    expect(typeAutoSave({ success: ["plant"], fail: ["plant"] }, "plant")).toEqual({ autoFail: "type:plant" });
  });
  it("saveAutoFail schema: creature types, nothing else; Blight declares it", () => {
    expect(validateEntry({ saveAutoFail: { types: ["plant"] } })).toEqual([]);
    expect(validateEntry({ saveAutoFail: { types: [] } })).toEqual(["saveAutoFail: { types: [creature types] }"]);
    expect(validateEntry({ saveAutoFail: { types: ["arbre"] } })).toHaveLength(1);
    expect(validateEntry({ saveAutoFail: { types: ["plant"], fighting: true } })).toHaveLength(1);
    expect(CONTENT.blight.saveAutoFail).toEqual({ types: ["plant"] });
  });
});
