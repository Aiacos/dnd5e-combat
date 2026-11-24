import { describe, it, expect } from "vitest";
import { freshBudget, checkUse, spendUse, refundUse, effectiveCost, basicAction, movementAllowance } from "../module/scripts/core/turn.mjs";

const mine = { isOwnTurn: true, attacksPerAction: 1 };
const dagger = { cost: "action", weaponAttack: true, usesSpellSlot: false, lightWeapon: true };
const sword = { cost: "action", weaponAttack: true, usesSpellSlot: false, lightWeapon: false };
const offhand = { cost: "action", weaponAttack: true, usesSpellSlot: false, lightWeapon: true, offhand: true };
const offhandNick = { ...offhand, nick: true };

describe("attaque de la main secondaire (§15.2, propriété Légère)", () => {
  it("sans attaque d'arme Légère ce tour : signalée", () => {
    expect(checkUse(freshBudget(), offhand, mine)).toEqual(["noLightAttack"]);
    const afterSword = spendUse(freshBudget(), sword, mine);
    expect(checkUse(afterSword, offhand, mine)).toEqual(["noLightAttack"]);
  });

  it("après une attaque à la dague : l'action Bonus, et elle seule", () => {
    const b = spendUse(freshBudget(), dagger, mine);
    expect(b.lightAttack).toBe(true);
    expect(checkUse(b, offhand, mine)).toEqual([]);
    const after = spendUse(b, offhand, mine);
    expect(after.bonus).toBe(0);
    expect(after.action).toBe(b.action);
    expect(after.attacks).toEqual(b.attacks);
    expect(checkUse(after, offhand, mine)).toEqual(["lightExtraUsed", "noBonus"]);
  });

  it("Nick: the Light extra attack is free once, then a second off-hand attack is refused (forceable, Bonus Action) — §532", () => {
    const b = spendUse(freshBudget(), dagger, mine);
    expect(effectiveCost(b, offhandNick)).toBe(null);
    expect(checkUse(b, offhandNick, mine)).toEqual([]);
    const once = spendUse(b, offhandNick, mine);
    expect(once.bonus).toBe(1);
    expect(once.nickUsed).toBe(true);
    expect(once.offhandUsed).toBe(true);
    // SRD 5.2: Nick moves the one extra attack into the Attack action; it does not add another.
    expect(checkUse(once, offhandNick, mine)).toEqual(["lightExtraUsed"]);
    expect(checkUse(once, offhand, mine)).toEqual(["lightExtraUsed"]);
    // Forced anyway: it costs the Bonus Action.
    expect(effectiveCost(once, offhandNick)).toBe("bonus");
    expect(spendUse(once, offhandNick, mine).bonus).toBe(0);
  });

  it("Bonus Action off-hand attack first: Nick does not open a second, free one — §532", () => {
    const b = spendUse(freshBudget(), dagger, mine);
    const bonus = spendUse(b, offhand, mine);
    expect(bonus.offhandUsed).toBe(true);
    expect(effectiveCost(bonus, offhandNick)).toBe("bonus");
    expect(checkUse(bonus, offhandNick, mine)).toEqual(["lightExtraUsed", "noBonus"]);
  });

  it("budget stored before §532 (nickUsed without offhandUsed): still refused", () => {
    const legacy = { ...spendUse(freshBudget(), dagger, mine), nickUsed: true };
    delete legacy.offhandUsed;
    expect(checkUse(legacy, offhandNick, mine)).toEqual(["lightExtraUsed"]);
  });

  it("hors de son tour : signalée", () => {
    const b = spendUse(freshBudget(), dagger, mine);
    expect(checkUse(b, offhandNick, { isOwnTurn: false })).toContain("notYourTurn");
    expect(checkUse(b, offhand, { isOwnTurn: false })).toContain("notYourTurn");
  });

  it("annulée avant tout jet : Coup double et action Bonus reviennent", () => {
    const b = spendUse(freshBudget(), dagger, mine);
    const nick = spendUse(b, offhandNick, mine);
    expect(refundUse(nick, b, nick)).toEqual(b);
    const bonus = spendUse(b, offhand, mine);
    expect(refundUse(bonus, b, bonus)).toEqual(b);
  });
});

describe("actions de base par leur item (Pointe, Désengagement, Esquive)", () => {
  it("dépensent l'action et posent l'état du tour", () => {
    const dashed = basicAction(freshBudget(), "dash");
    expect(dashed.action).toBe(0);
    expect(dashed.dashed).toBe(true);
    expect(movementAllowance(dashed, 30)).toBe(60);
    expect(basicAction(freshBudget(), "disengage").disengaged).toBe(true);
    expect(basicAction(freshBudget(), "dodge").dodging).toBe(true);
  });

  it("confirmée sans action restante (mode souple) : l'état est posé quand même", () => {
    const spent = { ...freshBudget(), action: 0 };
    expect(basicAction(spent, "dash")).toMatchObject({ action: 0, dashed: true });
  });

  it("type inconnu : rien", () => {
    expect(basicAction(freshBudget(), "help")).toEqual(freshBudget());
  });
});
