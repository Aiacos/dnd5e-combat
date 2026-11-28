import { describe, it, expect } from "vitest";
import { isMagicalSource, isMagicalUse, shouldMarkMagical, blockedByAntimagic, ANTIMAGIC_STATUS, ANTIMAGIC_BEHAVIOR } from "../module/scripts/core/antimagic.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

/** §436: dnd5e 6.1's antimagic — what is magical, what the field forbids, what the engine marks. */
describe("§436 : antimagie", () => {
  it("the system's names", () => {
    expect(ANTIMAGIC_STATUS).toBe("antimagic");
    expect(ANTIMAGIC_BEHAVIOR).toBe("dnd5e.antimagic");
  });

  it("a magical source: spell, scroll, mgc item (dnd5e's migration rule), a so-called magical ability", () => {
    expect(isMagicalSource({ type: "spell" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "scroll" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "potion", properties: ["mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin", "mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin"] })).toBe(false);
    expect(isMagicalSource({ type: "feat" })).toBe(false);
    expect(isMagicalSource({ type: "feat", magical: true })).toBe(true);
    expect(isMagicalSource(null)).toBe(false);
  });

  it("a magical use: a cast spell, a magic item activity, not the attack of a magic weapon", () => {
    expect(isMagicalUse({ spellCast: true, item: { type: "spell" }, activityType: "attack" })).toBe(true);
    expect(isMagicalUse({ item: { type: "consumable", subtype: "potion", properties: ["mgc"] }, activityType: "heal" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "utility" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: [] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "feat" }, activityType: "damage" })).toBe(false);
    expect(isMagicalUse({ item: { type: "feat" }, activityType: "cast" })).toBe(true);
    expect(isMagicalUse({ item: { type: "feat", magical: true }, activityType: "save" })).toBe(true);
  });

  it("forceable: refused by dnd5e only because the field removes magic", () => {
    const base = { inAntimagic: true, canUse: false, itemCanUse: true, requireMagic: true, magicAvailable: false, magicalUse: true };
    expect(blockedByAntimagic(base)).toBe(true);
    expect(blockedByAntimagic({ ...base, inAntimagic: false })).toBe(false);          // hors du champ
    expect(blockedByAntimagic({ ...base, canUse: true })).toBe(false);                // dnd5e allows it: engine legality is enough
    expect(blockedByAntimagic({ ...base, requireMagic: false })).toBe(false);         // hidden for something else
    expect(blockedByAntimagic({ ...base, magicAvailable: true })).toBe(false);
    expect(blockedByAntimagic({ ...base, otherHidden: true })).toBe(false);           // attunement, level…: forcing can do nothing
    expect(blockedByAntimagic({ ...base, itemCanUse: false })).toBe(false);
    expect(blockedByAntimagic({ ...base, magicalUse: false })).toBe(false);
    expect(blockedByAntimagic()).toBe(false);
  });

  it("the magic mark: ordinary effect of a magical source, neither a condition, nor Concentration, nor already marked", () => {
    const spell = { type: "spell" };
    expect(shouldMarkMagical({ type: "base" }, spell)).toBe(true);
    expect(shouldMarkMagical({}, spell)).toBe(true);
    expect(shouldMarkMagical({ type: "base", statuses: ["paralyzed"] }, spell)).toBe(true);
    expect(shouldMarkMagical({ type: "base", magical: true }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "enchantment" }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base", statuses: ["concentrating"] }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base", statuses: ["antimagic"] }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base" }, { type: "feat" })).toBe(false);
    expect(shouldMarkMagical({ type: "base" }, null)).toBe(false);
  });
});

describe("§436 : le contenu de l'antimagie", () => {
  it("magical monster abilities, antimagic areas, duration of the Cone", () => {
    for ( const id of ["eye-rays", "teleport", "etherealness", "possession", "telekinetic-thrust", "shape-shift", "roar"] ) expect(SHIPPED[id].magical).toBe(true);
    expect(SHIPPED["shape-shift"]?.magical).toBe(true);   // added at the user's request (2026-11-14)
    expect(SHIPPED["antimagic-field"].antimagicZone).toBe(true);
    expect(SHIPPED["antimagic-cone"]).toMatchObject({ antimagicZone: true, zoneLasts: { seconds: 6 } });
    expect(SHIPPED["antimagic-field"].globe.everywhere).toBe(true);
  });

  it("the schema accepts both keys, and only with true", () => {
    expect(validateEntry({ magical: true, antimagicZone: true })).toEqual([]);
    expect(validateEntry({ magical: "yes" }).length).toBeGreaterThan(0);
  });
});
