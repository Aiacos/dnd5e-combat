import { describe, it, expect } from "vitest";
import { somaticBlocked, handsUsed, handsCheckedFor } from "../module/scripts/core/hands.mjs";
import { conditionUseIssues } from "../module/scripts/core/conditions.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

// §409 (issue #44, batch 2): the free hand for the somatic component; the Incapacitated creature casting a ritual or a long spell.
const mace = { name: "Masse", hands: 1, armament: true };
const shield = { name: "Bouclier", hands: 1, armament: true };
const staff = { name: "Bâton", hands: 1, focus: true, armament: true };
const greatsword = { name: "Épée à deux mains", hands: 2, twoHanded: true, armament: true };
const torch = { name: "Torche", hands: 1 };
const crystal = { name: "Cristal", hands: 1, focus: true };
const spell = (held, extra={}) => ({ spell: true, somatic: true, material: false, held, ...extra });

describe("somaticBlocked", () => {
  it("a free hand: the spell goes through", () => {
    expect(somaticBlocked(spell([]))).toBeNull();
    expect(somaticBlocked(spell([mace]))).toBeNull();
    expect(somaticBlocked(spell([staff]))).toBeNull();
  });

  it("two hands taken: refused, with what occupies them", () => {
    expect(somaticBlocked(spell([mace, shield]))).toEqual({ items: ["Masse", "Bouclier"] });
    expect(somaticBlocked(spell([shield, torch]))).toEqual({ items: ["Bouclier", "Torche"] });
  });

  it("a two-handed weapon takes only one hand outside the attack (2024)", () => {
    expect(handsUsed([greatsword])).toBe(1);
    expect(somaticBlocked(spell([greatsword]))).toBeNull();
    expect(somaticBlocked(spell([greatsword, shield]))).not.toBeNull();
  });

  it("the focus hand is enough if the spell also has a material component", () => {
    expect(somaticBlocked(spell([crystal, shield], { material: true }))).toBeNull();
    expect(somaticBlocked(spell([crystal, shield], { material: false }))).toEqual({ items: ["Cristal", "Bouclier"] });
    expect(somaticBlocked(spell([mace, shield], { material: true }))).not.toBeNull();
  });

  it("War Caster: weapons and shield in hand, not a torch", () => {
    expect(somaticBlocked(spell([mace, shield], { freeSomatic: true }))).toBeNull();
    expect(somaticBlocked(spell([shield, torch], { freeSomatic: true }))).not.toBeNull();
  });

  it("without an S component, component removed (Subtle Spell), not a spell: nothing", () => {
    expect(somaticBlocked(spell([mace, shield], { somatic: false }))).toBeNull();
    expect(somaticBlocked(spell([mace, shield], { waived: true }))).toBeNull();
    expect(somaticBlocked({ spell: false, somatic: true, held: [mace, shield] })).toBeNull();
  });
});

describe("handsCheckedFor", () => {
  it("player characters by default, all, or nobody", () => {
    expect(handsCheckedFor("pc", true)).toBe(true);
    expect(handsCheckedFor("pc", false)).toBe(false);
    expect(handsCheckedFor(undefined, true)).toBe(true);
    expect(handsCheckedFor("all", false)).toBe(true);
    expect(handsCheckedFor("off", true)).toBe(false);
  });
});

describe("Incapacitated: long spells, rituals, long activities", () => {
  it("a cast spell is refused, whatever its cost", () => {
    expect(conditionUseIssues({ statuses: ["paralyzed"], cost: null, castsSpell: true })).toEqual(["incapacitatedCasting"]);
    expect(conditionUseIssues({ statuses: ["stunned"], cost: "action", castsSpell: true })).toEqual(["incapacitated"]);
  });

  it("an activity of one minute or more too", () => {
    expect(conditionUseIssues({ statuses: ["unconscious"], cost: null, longActivation: true })).toEqual(["incapacitatedCasting"]);
  });

  it("without an incapacitating condition, nothing; without a long spell or activity, as before", () => {
    expect(conditionUseIssues({ statuses: [], cost: null, castsSpell: true })).toEqual([]);
    expect(conditionUseIssues({ statuses: ["incapacitated"], cost: null })).toEqual([]);
  });
});

describe("contenu `freeSomatic`", () => {
  it("War Caster declares it, the key is validated", () => {
    expect(SHIPPED["war-caster"]?.freeSomatic).toBe(true);
    expect(validateEntry({ freeSomatic: true })).toEqual([]);
    expect(validateEntry({ freeSomatic: "yes" }).length).toBeGreaterThan(0);
  });
});
