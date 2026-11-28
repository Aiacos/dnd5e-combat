import { describe, it, expect } from "vitest";
import { etherealSightOf, seenAcrossPlanes } from "../module/scripts/adapter/plane.mjs";

/** An actor reduced to what adapter/plane.mjs reads: its senses and its items. */
const actorWith = (items, senses={ ranges: {}, units: "ft", special: "" }) => ({ system: { attributes: { senses } }, items });
const feat = identifier => ({ type: "feat", name: identifier, system: { identifier } });
const FACTORS = { ft: 1 };

describe("§225: seeing from one plane to the other, by the creature's traits", () => {
  it("the Ethereal's sight trait gives 60 ft, with no other sense", () => {
    expect(etherealSightOf(actorWith([feat("ethereal-sight")]), "ft", FACTORS)).toBe(60);
  });
  it("without this trait or special sense: nothing", () => {
    expect(etherealSightOf(actorWith([feat("multiattack")]), "ft", FACTORS)).toBe(null);
  });
  it("the greatest range wins over a shorter Truesight", () => {
    const senses = { ranges: { truesight: 30 }, units: "ft", special: "" };
    expect(etherealSightOf(actorWith([feat("ethereal-sight")], senses), "ft", FACTORS)).toBe(60);
  });
  it("the creature whose ethereal form remains visible from the other plane is recognized by its trait", () => {
    expect(seenAcrossPlanes(actorWith([feat("etherealness")]))).toBe(true);
    expect(seenAcrossPlanes(actorWith([feat("ethereal-sight")]))).toBe(false);
    expect(seenAcrossPlanes(actorWith([{ type: "spell", name: "etherealness", system: { identifier: "etherealness" } }]))).toBe(false);
  });
});
