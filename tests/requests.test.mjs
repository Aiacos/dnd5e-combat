/**
 * Les requêtes reçues d'un autre client (§471) : ce qu'un joueur peut demander, et ce qui tombe du reste. Règles pures de core/requests.mjs.
 */
import { describe, it, expect } from "vitest";
import { needsCheck, fromTrusted, actsFor, cureAllowed, healedHp, grantedTempHp, plainReaction } from "../module/scripts/core/requests.mjs";

describe("qui faut-il vérifier", () => {
  it("un joueur, oui ; un appel local, soi-même ou un MJ, non", () => {
    expect(needsCheck({ isGM: false, isSelf: false })).toBe(true);
    expect(needsCheck(null)).toBe(false);
    expect(needsCheck(undefined)).toBe(false);
    expect(needsCheck({ isGM: false, isSelf: true })).toBe(false);
    expect(needsCheck({ isGM: true, isSelf: false })).toBe(false);
  });
});

describe("seulement du MJ, seulement ce qu'il possède (§472)", () => {
  const player = { isGM: false, isSelf: false, id: "p" };
  const gm = { isGM: true, isSelf: false, id: "g" };
  const mine = { testUserPermission: (user, level) => (user.id === "p") && (level === "OWNER") };
  const theirs = { testUserPermission: () => false };

  it("une requête du MJ : du MJ, de soi-même ou locale passe ; d'un joueur, non", () => {
    expect(fromTrusted(gm)).toBe(true);
    expect(fromTrusted(null)).toBe(true);
    expect(fromTrusted({ isGM: false, isSelf: true })).toBe(true);
    expect(fromTrusted(player)).toBe(false);
  });
  it("un joueur n'agit que pour ce qu'il possède ; le MJ et l'appel local pour tout", () => {
    expect(actsFor(player, mine)).toBe(true);
    expect(actsFor(player, theirs)).toBe(false);
    expect(actsFor(player, null)).toBe(false);
    expect(actsFor(gm, theirs)).toBe(true);
    expect(actsFor(null, theirs)).toBe(true);
  });
});

describe("la règle de l'objet permet-elle l'acte (cure)", () => {
  const restoration = { cures: ["blinded", "deafened", "paralyzed", "poisoned"] };
  const greater = { cures: ["exhaustion", "petrified"] };
  const potion = { curesAll: ["exhaustion", "poisoned"] };

  it("un état : seulement ceux que l'objet fait cesser", () => {
    expect(cureAllowed(restoration, "paralyzed")).toBe(true);
    expect(cureAllowed(restoration, "stunned")).toBe(false);
    expect(cureAllowed(potion, "poisoned")).toBe(true);
    expect(cureAllowed(null, "paralyzed")).toBe(false);
  });
  it("PV et PV temporaires : seulement une réserve de soin ou une résurrection", () => {
    expect(cureAllowed(restoration, "hp", 0)).toBe(false);
    expect(cureAllowed(restoration, "temphp", 500)).toBe(false);
    expect(cureAllowed({ healPool: { formula: "2d8" } }, "hp", 12)).toBe(true);
    expect(cureAllowed({ revivesFull: true }, "hp", 40)).toBe(true);
    expect(cureAllowed({ healPool: { temp: true } }, "temphp", 10)).toBe(true);
    expect(cureAllowed({ tempHpPool: 120 }, "temphp", 60)).toBe(true);
    expect(cureAllowed({ healPool: { formula: "2d8" } }, "temphp", 10)).toBe(false);
  });
  it("Épuisement : un niveau de moins (cures) ou tout (curesAll)", () => {
    expect(cureAllowed(greater, "exhaustion-1")).toBe(true);
    expect(cureAllowed(greater, "exhaustion")).toBe(false);
    expect(cureAllowed(potion, "exhaustion")).toBe(true);
    expect(cureAllowed(restoration, "exhaustion-1")).toBe(false);
  });
  it("malédictions : seulement celles que l'objet lève", () => {
    const remove = { endsCurses: ["bestow-curse", "hex"] };
    expect(cureAllowed(remove, "curses", ["hex"])).toBe(true);
    expect(cureAllowed(remove, "curses", ["hex", "bless"])).toBe(false);
    expect(cureAllowed(remove, "curses", [])).toBe(false);
    expect(cureAllowed(remove, "curses", "hex")).toBe(false);
  });
  it("se relever par sa Réaction : seulement Mot de pouvoir guérisseur", () => {
    expect(cureAllowed({ standsWithReaction: true }, "standReaction")).toBe(true);
    expect(cureAllowed(restoration, "standReaction")).toBe(false);
  });
});

describe("bornes des valeurs envoyées", () => {
  it("un soin ne blesse pas et ne dépasse pas le maximum", () => {
    const hp = { current: 20, max: 30 };
    expect(healedHp(0, hp)).toBe(20);
    expect(healedHp(25, hp)).toBe(25);
    expect(healedHp(999, hp)).toBe(30);
    expect(healedHp("x", hp)).toBe(20);
  });
  it("des PV temporaires positifs, au plus le plafond connu", () => {
    expect(grantedTempHp(500, 120)).toBe(120);
    expect(grantedTempHp(40, 120)).toBe(40);
    expect(grantedTempHp(-5)).toBe(0);
    expect(grantedTempHp("x")).toBe(0);
  });
});

describe("une réaction demandée par un joueur", () => {
  const forged = {
    actor: "Actor.pnj", prompt: { key: "NePasReagir", data: {} }, auto: true,
    options: [{ name: "x", activity: "Actor.pnj.Item.i.Activity.a", consume: false, drop: ["JournalEntry.j"],
      usage: { scaling: 3, spell: { slot: "spell3" }, consume: { spellSlot: false }, create: { summons: true }, "dnd5e-combat": { confirmed: true } },
      flags: { readiedRelease: true, cost: "free" } }]
  };

  it("la fenêtre est toujours posée", () => {
    expect(plainReaction(forged).auto).toBe(false);
  });
  it("l'utilisation ne garde que les formes légitimes (niveau, sort préparé déjà payé, Égide)", () => {
    const [option] = plainReaction(forged).options;
    expect(option.usage).toEqual({ scaling: 3, spell: { slot: "spell3" }, consume: { spellSlot: false } });
    expect(option.flags).toEqual({ readiedRelease: true });
    expect(option.consume).toBe(false);
    expect(option.activity).toBe(forged.options[0].activity);   // revérifiée sur le receveur (adapter/reactions.mjs)
  });
  it("un emplacement ou un niveau inventé tombe", () => {
    const [option] = plainReaction({ options: [{ usage: { scaling: 99, spell: { slot: "<img src=x>" } }, flags: { cost: "free" } }] }).options;
    expect(option.usage).toBe(null);
    expect(option.flags).toBeUndefined();
  });
  it("une requête sans options ne casse rien", () => {
    expect(plainReaction({ actor: "Actor.a" }).options).toEqual([]);
  });
});
