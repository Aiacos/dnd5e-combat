/**
 * §491 : fait `target.wearsArmor` — la cible porte une armure (de corps), d'une catégorie, ou en métal. Exemple générique : une décharge
 * électrique qui a l'Avantage contre une cible en armure de métal.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { wearsArmor, isMetal, validArmorArg, METAL_ARMOR } from "../module/scripts/core/armor.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const plate = { category: "heavy", base: "plate", identifier: "plate-armor" };
const leather = { category: "light", base: "leather", identifier: "leather-armor" };
const shield = { category: "shield", base: "shield", identifier: "shield" };

describe("§491 : règle pure", () => {
  it("les huit armures de base en métal, et pas les armures de cuir ni le bouclier", () => {
    for ( const base of ["chainshirt", "scalemail", "breastplate", "halfplate", "ringmail", "chainmail", "splint", "plate"] ) {
      expect(METAL_ARMOR.has(base)).toBe(true);
    }
    for ( const base of ["padded", "leather", "studded", "hide", "shield"] ) expect(METAL_ARMOR.has(base)).toBe(false);
  });
  it("matière : le drapeau de l'item l'emporte, puis l'armure de base, puis l'identifiant", () => {
    expect(isMetal(plate)).toBe(true);
    expect(isMetal({ ...plate, metal: false })).toBe(false);
    expect(isMetal({ ...leather, metal: true })).toBe(true);
    expect(isMetal({ category: "medium", base: null, identifier: "chain-shirt" })).toBe(true);
    expect(isMetal(shield)).toBe(false);
    expect(isMetal({ ...shield, metal: true })).toBe(true);
  });
  it("true / false : une armure de corps, le bouclier seul ne compte pas", () => {
    expect(wearsArmor([leather], true)).toBe(true);
    expect(wearsArmor([], true)).toBe(false);
    expect(wearsArmor([], false)).toBe(true);
    expect(wearsArmor([shield], true)).toBe(false);
    expect(wearsArmor([{ category: "natural" }], true)).toBe(false);
    expect(wearsArmor([{ category: "trinket" }], false)).toBe(true);
  });
  it("une catégorie ou une liste de catégories", () => {
    expect(wearsArmor([plate], "heavy")).toBe(true);
    expect(wearsArmor([leather], "heavy")).toBe(false);
    expect(wearsArmor([leather], ["light", "medium"])).toBe(true);
    expect(wearsArmor([leather, shield], "shield")).toBe(true);
  });
  it("{ material: \"metal\" } : une pièce en métal, catégorie en plus si elle est donnée", () => {
    expect(wearsArmor([plate], { material: "metal" })).toBe(true);
    expect(wearsArmor([leather, shield], { material: "metal" })).toBe(false);
    expect(wearsArmor([leather, { ...shield, metal: true }], { material: "metal" })).toBe(true);
    expect(wearsArmor([leather, { ...shield, metal: true }], { material: "metal", category: ["light", "medium", "heavy"] })).toBe(false);
    expect(wearsArmor([plate], { material: "metal", category: "heavy" })).toBe(true);
  });
  it("une forme inconnue ne tient jamais", () => {
    expect(wearsArmor([plate], "mithral")).toBe(false);
    expect(wearsArmor([plate], { material: "wood" })).toBe(false);
    expect(wearsArmor([plate], { colour: "black" })).toBe(false);
    expect(wearsArmor([plate], 3)).toBe(false);
    expect(validArmorArg({ material: "metal" })).toBe(true);
    expect(validArmorArg({})).toBe(false);
    expect(validArmorArg([])).toBe(false);
  });
});

/* -------------------------------------------- */

describe("§491 : le fait `target.wearsArmor`", () => {
  let factsFor, armorPieces, KNOWN_FACTS;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // même ordre de chargement que self-facts.test.mjs (cycle facts ↔ content)
    ({ factsFor, armorPieces } = await import("../module/scripts/adapter/facts.mjs"));
    KNOWN_FACTS = factsFor();
  });

  /** Un item d'équipement dnd5e 6 réduit à ce que lit le fait. */
  const item = (value, baseItem, { equipped=true, identifier="", metal }={}) => ({
    type: "equipment", system: { equipped, identifier, type: { value, baseItem } },
    flags: (metal === undefined) ? {} : { "dnd5e-combat": { metal } }
  });

  it("lit les items d'équipement équipés, pas ceux du sac ni les armes", () => {
    const actor = { items: [item("heavy", "chainmail"), item("light", "leather", { equipped: false }),
      { type: "weapon", system: { equipped: true, type: { value: "martialM", baseItem: "longsword" } } }] };
    expect(armorPieces(actor)).toEqual([{ category: "heavy", base: "chainmail", identifier: "" }]);
  });
  it("une cible en cotte de mailles porte une armure en métal ; en cuir, non ; son drapeau peut en décider", () => {
    const metal = factsFor({ target: { items: [item("heavy", "chainmail")] } });
    const hide = factsFor({ target: { items: [item("medium", "hide")] } });
    const forged = factsFor({ target: { items: [item("medium", "hide", { metal: true })] } });
    expect(metal["target.wearsArmor"]({ material: "metal" })).toBe(true);
    expect(hide["target.wearsArmor"]({ material: "metal" })).toBe(false);
    expect(hide["target.wearsArmor"](true)).toBe(true);
    expect(forged["target.wearsArmor"]({ material: "metal" })).toBe(true);
  });
  it("sans cible : ne porte rien", () => {
    expect(factsFor({})["target.wearsArmor"](false)).toBe(true);
  });
  it("une déclaration d'Avantage sur la cible en métal est valide et tient", () => {
    const entry = { triggers: [{ on: "preAttackRoll", if: { "activity.identifier": "das-test-shock", "target.wearsArmor": { material: "metal" } },
      do: [{ type: "advantage" }] }] };
    expect(validateEntry(entry, { facts: KNOWN_FACTS })).toEqual([]);
    const facts = factsFor({ target: { items: [item("medium", "breastplate")] } });
    facts["activity.identifier"] = "das-test-shock";
    expect(holds(entry.triggers[0].if, facts)).toBe(true);
    facts["activity.identifier"] = "other";
    expect(holds(entry.triggers[0].if, facts)).toBe(false);
  });
});
