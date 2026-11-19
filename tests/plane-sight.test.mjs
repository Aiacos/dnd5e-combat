import { describe, it, expect } from "vitest";
import { etherealSightOf, seenAcrossPlanes } from "../module/scripts/adapter/plane.mjs";

/** Un acteur réduit à ce que lit adapter/plane.mjs : ses sens et ses items. */
const actorWith = (items, senses={ ranges: {}, units: "ft", special: "" }) => ({ system: { attributes: { senses } }, items });
const feat = identifier => ({ type: "feat", name: identifier, system: { identifier } });
const FACTORS = { ft: 1 };

describe("§225 : voir d'un plan à l'autre, par les traits de la créature", () => {
  it("le trait de vision de l'Éthéré donne 60 ft, sans autre sens", () => {
    expect(etherealSightOf(actorWith([feat("ethereal-sight")]), "ft", FACTORS)).toBe(60);
  });
  it("sans ce trait ni sens spécial : rien", () => {
    expect(etherealSightOf(actorWith([feat("multiattack")]), "ft", FACTORS)).toBe(null);
  });
  it("la plus grande portée l'emporte sur une Vision véritable plus courte", () => {
    const senses = { ranges: { truesight: 30 }, units: "ft", special: "" };
    expect(etherealSightOf(actorWith([feat("ethereal-sight")], senses), "ft", FACTORS)).toBe(60);
  });
  it("la créature dont la forme éthérée reste visible depuis l'autre plan est reconnue à son trait", () => {
    expect(seenAcrossPlanes(actorWith([feat("etherealness")]))).toBe(true);
    expect(seenAcrossPlanes(actorWith([feat("ethereal-sight")]))).toBe(false);
    expect(seenAcrossPlanes(actorWith([{ type: "spell", name: "etherealness", system: { identifier: "etherealness" } }]))).toBe(false);
  });
});
