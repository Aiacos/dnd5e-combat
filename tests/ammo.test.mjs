import { describe, it, expect } from "vitest";
import { ammoChoice } from "../module/scripts/core/ammo.mjs";

const fleches = { id: "fleches0000000001", quantity: 20 };
const plusUn = { id: "flechesPlus000001", quantity: 5 };
const vides = { id: "flechesVides00001", quantity: 0 };

describe("ammoChoice (§274)", () => {
  it("a single usable ammunition: fired without asking", () => {
    expect(ammoChoice({ options: [fleches, vides] })).toMatchObject({ use: fleches.id, ask: false });
  });
  it("several usable: asks, the last one preselected", () => {
    expect(ammoChoice({ options: [fleches, plusUn], remembered: plusUn.id })).toMatchObject({ use: plusUn.id, ask: true });
  });
  it("a last ammunition that is used up or forgotten: the first usable one is preselected", () => {
    expect(ammoChoice({ options: [vides, plusUn, fleches], remembered: vides.id })).toMatchObject({ use: plusUn.id, ask: true });
    expect(ammoChoice({ options: [fleches, plusUn], remembered: "" }).use).toBe(fleches.id);
  });
  it("an ammunition imposed by the caller asks nothing", () => {
    expect(ammoChoice({ options: [fleches, plusUn], remembered: fleches.id, explicit: plusUn.id })).toMatchObject({ use: plusUn.id, ask: false });
  });
  it("an imposed ammunition unknown to the weapon is ignored", () => {
    expect(ammoChoice({ options: [fleches, plusUn], explicit: "inconnue00000000" }).ask).toBe(true);
  });
  it("nothing usable left: dnd5e's memory is left alone, without asking", () => {
    expect(ammoChoice({ options: [vides], remembered: vides.id })).toMatchObject({ use: vides.id, ask: false });
    expect(ammoChoice({ options: [] })).toMatchObject({ use: null, ask: false });
  });
});
