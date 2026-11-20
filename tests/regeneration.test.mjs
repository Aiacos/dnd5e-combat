/** M8 (SPEC §18.13) : Régénération — lecture du texte anglais d'origine, décision au début du tour. */
import { describe, it, expect } from "vitest";
import { readRegeneration, regenerationAtTurnStart, stopsRegeneration } from "../module/scripts/core/regeneration.mjs";
import { downedStatus } from "../module/scripts/core/death.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const TROLL = `<p>The [[lookup @name lowercase]] regains [[lookup @activities.healing.formula]] Hit Points at the start of each of its turns. If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn. The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate.</p>`;
// Troll : SRD 5.2 ; les deux suivants sont synthétiques (créatures inventées), de même grammaire que le Monster Manual.
const MIRE_BEAST = `<p>The [[lookup @name lowercase]] regains [[lookup @activities.healing.formula]] Hit Points at the start of each of its turns if it has at least 1 Hit Point.</p>`;
const GRAVE_KNIGHT = `<p>The [[lookup @name lowercase]] regains … Hit Points at the start of each of its turns. If the grave knight takes &amp;Reference[Fire] or Radiant damage, this trait doesn’t function at the start of its next turn. It is destroyed only if it starts its turn with 0 Hit Points and doesn’t regenerate.</p>`;

describe("Régénération (M8)", () => {
  it("lit ce qui la coupe, et qui survit à 0 PV", () => {
    expect(readRegeneration(TROLL)).toEqual({ needsHp: false, silveredBy: [], stoppedBy: ["acid", "fire"], stoppedByItems: [], stoppedWhile: [], survivesZero: true, critical: false });
    expect(readRegeneration(MIRE_BEAST)).toEqual({ needsHp: true, silveredBy: [], stoppedBy: [], stoppedByItems: [], stoppedWhile: [], survivesZero: false, critical: false });
    expect(readRegeneration(GRAVE_KNIGHT)).toEqual({ needsHp: false, silveredBy: [], stoppedBy: ["fire", "radiant"], stoppedByItems: [], stoppedWhile: [], survivesZero: true, critical: false });
  });

  it("au début du tour", () => {
    const troll = { needsHp: false, survivesZero: true, dead: false };
    expect(regenerationAtTurnStart({ ...troll, hp: 0, stopped: false })).toBe("heal");
    expect(regenerationAtTurnStart({ ...troll, hp: 0, stopped: true })).toBe("dies");
    expect(regenerationAtTurnStart({ ...troll, hp: 30, stopped: true })).toBe("none");
    const slaad = { needsHp: true, survivesZero: false, dead: false, stopped: false };
    expect(regenerationAtTurnStart({ ...slaad, hp: 0 })).toBe("none");
    expect(regenerationAtTurnStart({ ...slaad, hp: 1 })).toBe("heal");
    expect(regenerationAtTurnStart({ ...slaad, hp: 5, dead: true })).toBe("none");
  });

  it("coupée par les types nommés seulement", () => {
    expect(stopsRegeneration(["acid", "fire"], ["slashing", "fire"])).toBe(true);
    expect(stopsRegeneration(["acid", "fire"], ["slashing"])).toBe(false);
  });

  it("un troll à 0 PV est Inconscient, pas Mort", () => {
    expect(downedStatus({ hp: 0, saves: false, statuses: [], regenerates: true })).toBe("unconscious");
    expect(downedStatus({ hp: 0, saves: false, statuses: [] })).toBe("dead");
  });

  it("contenu livré", () => {
    expect(CONTENT.regeneration).toEqual({ regeneration: true });
    expect(validateEntry(CONTENT.regeneration)).toEqual([]);
    expect(validateEntry({ regeneration: "oui" })).toHaveLength(1);
  });
});

describe("§78 : Régénération d'un lycanthrope (arme argentée)", () => {
  const WERE = "<p>The wereraven regains 10 hit points at the start of its turn if it hasn’t taken necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon since its last turn. It dies only if it starts its turn with 0 hit points and doesn&#39;t regenerate.</p>";
  it("nécrotique toujours, contondant/perforant/tranchant seulement d'une arme argentée", () => {
    expect(readRegeneration(WERE)).toEqual({ needsHp: false, stoppedBy: ["necrotic"], silveredBy: ["bludgeoning", "piercing", "slashing"], stoppedByItems: [], stoppedWhile: [], survivesZero: true, critical: false });
  });
  it("une arme ordinaire ne la coupe pas, une arme argentée oui", () => {
    const r = readRegeneration(WERE);
    expect(stopsRegeneration(r.stoppedBy, ["piercing"], r.silveredBy, [])).toBe(false);
    expect(stopsRegeneration(r.stoppedBy, ["piercing"], r.silveredBy, ["piercing"])).toBe(true);
    expect(stopsRegeneration(r.stoppedBy, ["necrotic"], r.silveredBy, [])).toBe(true);
  });
});

describe("K2 (§323) : régénération coupée par un coup critique", () => {
  it("« Radiant damage or damage from a Critical Hit »", async () => {
    const { readRegeneration, stopsRegeneration } = await import("../module/scripts/core/regeneration.mjs");
    const r = readRegeneration("<p>It regains 10 Hit Points at the start of each of its turns. If it takes Radiant damage or damage from a Critical Hit, this trait doesn't function on its next turn. It dies only if it starts its turn with 0 Hit Points and doesn't regenerate.</p>");
    expect(r).toEqual({ needsHp: false, silveredBy: [], stoppedBy: ["radiant"], stoppedByItems: [], stoppedWhile: [], survivesZero: true, critical: true });
    expect(stopsRegeneration(r.stoppedBy, ["slashing"], [], [], { byCritical: true, critical: true })).toBe(true);
    expect(stopsRegeneration(r.stoppedBy, ["slashing"], [], [], { byCritical: true, critical: false })).toBe(false);
    expect(stopsRegeneration(r.stoppedBy, ["radiant"])).toBe(true);
  });
});

describe("B04 : régénération — accord, arme argentée « this trait doesn't function », eau bénite, soleil, forme déclarée", async () => {
  const { resolveRegeneration, validateRegeneration, REGENERATION_STOPS } = await import("../module/scripts/core/regeneration.mjs");
  const { DAMAGE_TYPES } = await import("../module/scripts/core/content/enums.mjs");
  // Créatures inventées, grammaire du Monster Manual et des aventures.
  const HAG = "<p>The swamp hag regains 10 Hit Points at the start of her turn if she has at least 1 Hit Point and isn’t in sunlight or running water. If she takes Radiant damage or damage from holy water, this trait doesn't function at the start of her next turn.</p>";
  const HOUND = "<p>The moon hound regains 10 hit points at the start of its turn. If the moon hound takes necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon, this trait doesn't function at the start of the moon hound's next turn. The moon hound dies only if it starts its turn with 0 hit points and doesn't regenerate.</p>";

  it("« if she/he/they has at least 1 Hit Point »", () => {
    expect(readRegeneration(HAG).needsHp).toBe(true);
    expect(readRegeneration("<p>He regains 5 Hit Points at the start of his turn if he has at least 1 Hit Point.</p>").needsHp).toBe(true);
    expect(readRegeneration("<p>They regain 5 Hit Points at the start of their turn if they have at least 1 Hit Point.</p>").needsHp).toBe(true);
    expect(readRegeneration("<p>He regains 5 Hit Points.</p>").needsHp).toBe(false);
    expect(readRegeneration("<p>He dies only if he starts his turn with 0 Hit Points and doesn't regenerate.</p>").survivesZero).toBe(true);
  });

  it("« takes … damage from a silvered weapon, this trait doesn't function at the start of its next turn »", () => {
    expect(readRegeneration(HOUND)).toEqual({ needsHp: false, stoppedBy: ["necrotic"], silveredBy: ["bludgeoning", "piercing", "slashing"],
      stoppedByItems: [], stoppedWhile: [], survivesZero: true, critical: false });
  });

  it("« damage from holy water » et « isn't in sunlight or running water »", () => {
    expect(readRegeneration(HAG)).toEqual({ needsHp: true, stoppedBy: ["radiant"], silveredBy: [], stoppedByItems: ["holy-water"],
      stoppedWhile: ["sunlight", "runningWater"], survivesZero: false, critical: false });
    expect(readRegeneration("<p>It regains 10 Hit Points at the start of its turn if it isn't in sunlight.</p>").stoppedWhile).toEqual(["sunlight"]);
  });

  it("l'objet des dégâts (eau bénite) coupe la régénération", () => {
    const r = readRegeneration(HAG);
    expect(stopsRegeneration(r.stoppedBy, ["radiant"], r.silveredBy, [], { byItems: r.stoppedByItems })).toBe(true);
    expect(stopsRegeneration(["fire"], ["acid"], [], [], { byItems: r.stoppedByItems, item: "holy-water" })).toBe(true);
    expect(stopsRegeneration(["fire"], ["acid"], [], [], { byItems: r.stoppedByItems, item: "alchemists-fire" })).toBe(false);
    expect(stopsRegeneration(["fire"], ["acid"], [], [], { byItems: [], item: "holy-water" })).toBe(false);
  });

  it("au soleil ou dans l'eau courante (`held`) : pas de soin ; à 0 PV et qui ne survit qu'en régénérant, meurt", () => {
    expect(regenerationAtTurnStart({ hp: 5, needsHp: true, stopped: false, held: true, survivesZero: false, dead: false })).toBe("none");
    expect(regenerationAtTurnStart({ hp: 0, needsHp: false, stopped: false, held: true, survivesZero: true, dead: false })).toBe("dies");
    expect(regenerationAtTurnStart({ hp: 5, needsHp: true, stopped: false, held: false, survivesZero: false, dead: false })).toBe("heal");
  });

  it("la forme déclarée l'emporte clé par clé sur le texte", () => {
    const read = readRegeneration(HOUND);
    expect(resolveRegeneration(true, read)).toEqual({ amount: null, ...read });
    const r = resolveRegeneration({ amount: 10, needsHp: true, stoppedBy: ["radiant"], stoppedByItems: ["holy-water"], stoppedWhile: ["sunlight"] }, read);
    expect(r).toEqual({ amount: "10", needsHp: true, stoppedBy: ["radiant"], silveredBy: ["bludgeoning", "piercing", "slashing"],
      stoppedByItems: ["holy-water"], stoppedWhile: ["sunlight"], survivesZero: true, critical: false });
    expect(resolveRegeneration({ amount: "2d6 + 3" }, read).amount).toBe("2d6 + 3");
  });

  it("validation de la forme déclarée", () => {
    expect(REGENERATION_STOPS).toEqual(["sunlight", "runningWater"]);
    expect(validateEntry({ regeneration: true })).toEqual([]);
    expect(validateEntry({ regeneration: { amount: 10, needsHp: true, stoppedBy: ["radiant"], silveredBy: ["slashing"], stoppedByItems: ["holy-water"],
      stoppedWhile: ["sunlight", "runningWater"], survivesZero: false, critical: true } })).toEqual([]);
    expect(validateEntry({ regeneration: {} })).toEqual([]);
    expect(validateEntry({ regeneration: false })).toHaveLength(1);
    expect(validateRegeneration({ amount: 0 }, DAMAGE_TYPES)).toHaveLength(1);
    expect(validateRegeneration({ stoppedBy: ["holy"] }, DAMAGE_TYPES)).toHaveLength(1);
    expect(validateRegeneration({ stoppedWhile: ["moonlight"] }, DAMAGE_TYPES)).toHaveLength(1);
    expect(validateRegeneration({ needsHp: "yes", stoppedByItems: [""], speed: 1 }, DAMAGE_TYPES)).toHaveLength(3);
  });
});
