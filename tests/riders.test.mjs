import { describe, it, expect } from "vitest";
import { sizeLimitIn, sizeGateOf, siblingSaveOf, soleSaveOf, announcesHitSave } from "../module/scripts/core/riders.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("porte de taille (M3)", () => {
  it("reads the size in English and in French", () => {
    expect(sizeLimitIn("Large or smaller")).toBe("lg");
    expect(sizeLimitIn("a Medium or smaller creature")).toBe("med");
    expect(sizeLimitIn("de taille G ou inférieure")).toBe("lg");
    expect(sizeLimitIn("une créature de taille TG ou inférieure Agrippée")).toBe("huge");
    expect(sizeLimitIn("de taille M ou inferieure")).toBe("med");
    expect(sizeLimitIn("that isn’t an Undead or elf")).toBeNull();
    expect(sizeLimitIn("")).toBeNull();
  });

  it("prefers the activity's value", () => {
    expect(sizeGateOf({ special: "Medium or smaller", description: "<p>If the target is a Huge or smaller creature…</p>" })).toBe("med");
  });

  it("reads the phrase \"If the target is\" of the description (\"Tyrannosaurus Tail\")", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a Huge or smaller creature, it has the &amp;Reference[Prone apply=false] condition.</p>";
    expect(sizeGateOf({ description })).toBe("huge");
  });

  it("resolves a lookup to the sister activity (\"Boar Tusk\")", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a [[lookup @target.affects.type activity=abcdefghijklmnop]] [[lookup @target.affects.special activity=abcdefghijklmnop]] and the boar moved 20+ feet straight toward it immediately before the hit, the target takes an extra 3 (1d6) damage and has the Prone condition.</p>";
    expect(sizeGateOf({ description, specialOf: id => (id === "abcdefghijklmnop" ? "Medium or smaller" : "") })).toBe("med");
  });

  it("in French (translated \"Wolf Bite\")", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. Si la cible est une créature de taille M ou inférieure, elle subit l'état &amp;Reference[Prone apply=false].</p>";
    expect(sizeGateOf({ description })).toBe("med");
  });

  it("\"If target is\", without an article (\"Tear of the Displacer Beast\")", () => {
    expect(sizeGateOf({ description: "<p>[[/attack extended]]. [[/damage average extended]]. If target is a Large or smaller creature, it has the Prone condition.</p>" })).toBe("lg");
  });

  it("ignores a size outside the sentence about the target", () => {
    expect(sizeGateOf({ description: "<p>The blob can move through the spaces of Huge or smaller creatures.</p>" })).toBeNull();
    expect(sizeGateOf({ description: "<p>[[/attack extended]]. [[/damage average extended]].</p>" })).toBeNull();
  });
});

const GHOUL = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a [[lookup @target.affects.type activity=u64Kjp19EAOJoLeo]] [[lookup @target.affects.special activity=u64Kjp19EAOJoLeo]], it is subjected to the following effect.</p><p><em>Constitution Saving Throw:</em> DC [[lookup @save.dc.value activity=u64Kjp19EAOJoLeo]].</p><p><em>Failure:</em> The target has the Paralyzed condition until the end of its next turn.</p>";

describe("lead-in to a save on hit", () => {
  it("MM formulas, in English and in French", () => {
    expect(announcesHitSave(GHOUL)).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]]. [[/damage average extended]]. If the target is a creature, it must make the following saving throw.</p>")).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]]. Si la cible est une créature qui n’est ni un Mort-vivant ni un elfe, elle est soumise à l’effet suivant.</p>")).toBe(true);
    expect(announcesHitSave("<p>La cible subit en outre l'effet suivant.</p>")).toBe(true);
  });

  it("2014-format sheets and their translations: the save after \"Hit:\" / \"Touché:\"", () => {
    // Poisoned Shortsword (synthetic, 2014 grammar); Werecrow Beak; translated Claws and Bite.
    expect(announcesHitSave("<p>Melee Weapon Attack: [[/attack]] to hit, reach 5 ft., one target. Hit: [[/damage average]] damage, and the target must make a DC 15 Constitution saving throw, taking 24 ([[/r 7d6]]) poison damage on a failed save, or half as much damage on a successful one.</p>")).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]], reach 5 ft., one target. Hit: 1 piercing damage in raven form. If the target is a humanoid, it must succeed on a [[/save con 10 format=long]] or be cursed with wereraven lycanthropy.</p>")).toBe(true);
    expect(announcesHitSave("<p>Attaque d'arme au corps à corps : [[/attack]] au toucher, allonge 1,50 m, une créature. Touché : [[/damage average]] dégâts. Si la cible est une créature, elle doit réussir un jet de sauvegarde de Force DD 13 ou se retrouver &amp;Reference[Prone apply=false].</p>")).toBe(true);
    expect(announcesHitSave("<p>(Forme hybride uniquement) Attaque d’arme au corps à corps : [[/attack]] pour toucher. Touché : [[/damage average]] dégâts. Si la cible est un humanoïde, elle doit réussir un jet de sauvegarde de Constitution DD 10 ou être maudite.</p>")).toBe(true);
  });

  it("2014 format without \"Hit:\": no save on hit (Unarmed Strike, magic weapon)", () => {
    expect(announcesHitSave("<p>Grapple. The target must succeed on a Strength or Dexterity saving throw (it chooses), or it has the Grappled condition.</p>")).toBe(false);
    expect(announcesHitSave("<p>When you hit a creature with this weapon, it must succeed on a DC 15 Constitution saving throw or be Poisoned.</p>")).toBe(false);
  });

  it("not on hit: Otyugh (after a Long Rest), PHB items", () => {
    expect(announcesHitSave("<p>[[/attack extended]]. [[/damage average extended]], and the target has the Poisoned condition. Whenever the Poisoned target finishes a Long Rest, it is subjected to the following effect.</p>")).toBe(false);
    expect(announcesHitSave("<p>See: &amp;Reference[unarmedstrike]</p>")).toBe(false);
    expect(announcesHitSave("<p>When you hit a Fiend or an Undead with this magic weapon, that creature takes an extra 2d6 Radiant damage. If the target has 25 Hit Points or fewer after taking this damage, it must succeed on a DC 15 Wisdom saving throw or be destroyed.</p>")).toBe(false);
  });
});

describe("sister save on hit (M2)", () => {
  const attack = { id: "attackattackatta", type: "attack", activation: { type: "action" } };
  const save = (over={}) => ({ id: "savesavesavesave", type: "save", activation: { type: "" }, target: { template: { type: "" }, affects: { count: "1" } }, ...over });

  it("Ghoul Claws: an attack, a save without its own activation", () => {
    expect(siblingSaveOf([attack, save()], GHOUL)).toBe("savesavesavesave");
    expect(siblingSaveOf([attack, save({ activation: { type: "special" } })], GHOUL)).toBe("savesavesavesave");
    // Ghast, lycanthropes: the save carries the "action" activation of the attack.
    expect(siblingSaveOf([attack, save({ activation: { type: "action" } }), { id: "summonsummonsumm", type: "summon", activation: { type: "action" } }], GHOUL)).toBe("savesavesavesave");
    expect(siblingSaveOf([attack, save(), { id: "escapeescapeesca", type: "check", activation: { type: "special" } }], GHOUL)).toBe("savesavesavesave");
  });

  it("does not guess: without an attack, two saves, an area, its own activation, several targets", () => {
    expect(siblingSaveOf([save()], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save(), save({ id: "secondsecondseco" })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ target: { template: { type: "radius" } } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ activation: { type: "reaction" } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ activation: { type: "bonus" } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ target: { affects: { count: "3" } } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack], GHOUL)).toBeNull();
    // Same form as the Ghoul Claws, without the lead-in: PHB Unarmed Strike (Grapple/Shove).
    expect(siblingSaveOf([attack, save({ activation: { type: "action" } })], "<p>See: &amp;Reference[unarmedstrike]</p>")).toBeNull();
  });
});

describe("the sole save of an enchanted weapon (onHit.save: \"sole\")", () => {
  const attack = { id: "attackattackatta", type: "attack" };
  it("one save, whatever its id: that is the one", () => {
    expect(soleSaveOf([attack, { id: "fhrQrcewmeNh8Jr6", type: "save" }])).toBe("fhrQrcewmeNh8Jr6");
    const utility = { id: "utilityutilityut", type: "utility" };
    expect(soleSaveOf([attack, { id: "AutreIdAuHasard0", type: "save" }, utility])).toBe("AutreIdAuHasard0");
  });
  it("none, or several: nothing — no guessing", () => {
    expect(soleSaveOf([attack])).toBeNull();
    expect(soleSaveOf([attack, { id: "aaaaaaaaaaaaaaaa", type: "save" }, { id: "bbbbbbbbbbbbbbbb", type: "save" }])).toBeNull();
    expect(soleSaveOf(null)).toBeNull();
  });
  it("schema: an id or \"sole\", nothing else", () => {
    expect(validateEntry({ onHit: { save: "sole" } })).toEqual([]);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop" } })).toEqual([]);
    expect(validateEntry({ onHit: { save: "unique" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ onHit: {} }).length).toBeGreaterThan(0);
  });
  it("Sword of Wounding: the save on hit, no more healing, the repeated save at the end of its turns", () => {
    const entry = CONTENT["sword-of-wounding-enchanted"];
    expect(entry.onHit).toEqual({ save: "sole" });
    expect(entry.blocksHealing).toBe(true);
    expect(entry.triggers).toEqual([{ on: "endOfTurn", via: "effect", fromEffect: "UeuDQeM3fRIB0aMN", do: [{ type: "resave" }] }]);
    expect(validateEntry(entry)).toEqual([]);
  });
});
