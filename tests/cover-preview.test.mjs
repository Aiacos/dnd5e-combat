import { describe, it, expect } from "vitest";
import { coverBetween } from "../module/scripts/core/cover.mjs";
import { coverPreviewText } from "../module/scripts/core/cover-preview.mjs";

// #33: cover preview — sources of the pure calculation, then text of the badge.
const cell = (i, j) => ({ x: j * 100, y: i * 100, width: 100, height: 100 });
const attacker = cell(0, 0);
const target = cell(0, 3);
const vertical = (x, kind) => (a, b) => (((a.x < x) !== (b.x < x)) ? kind : false);

describe("sources de l'abri (core)", () => {
  it("aucune source sans abri", () => {
    expect(coverBetween({ attacker, target }).sources).toEqual([]);
  });
  it("a wall: \"wall\" (true also means a wall)", () => {
    expect(coverBetween({ attacker, target, blocked: vertical(200, "wall"), inset: 10 }).sources).toEqual(["wall"]);
    expect(coverBetween({ attacker, target, blocked: vertical(200, true), inset: 10 }).sources).toEqual(["wall"]);
  });
  it("a surface: \"surface\"", () => {
    const cover = coverBetween({ attacker, target, blocked: vertical(200, "surface"), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", sources: ["surface"] });
  });
  it("an interposed creature: \"creature\"", () => {
    const cover = coverBetween({ attacker, target, bodies: [cell(0, 1)], inset: 10 });
    expect(cover).toMatchObject({ degree: "half", byCreature: true, sources: ["creature"] });
  });
});

const t = (key, data) => data ? `${key}${JSON.stringify(data)}` : key;
const base = { degree: "none", bonus: 0, sources: [], zone: null, manual: false, ignored: null };

describe("preview text", () => {
  it("clear", () => {
    expect(coverPreviewText(base, t)).toEqual({ css: "clear", main: "Apercu.Degage", sub: null });
  });
  it("Half Cover from an obstacle and a creature, sources in order", () => {
    const text = coverPreviewText({ ...base, degree: "half", bonus: 2, sources: ["creature", "wall"] }, t);
    expect(text.css).toBe("half");
    expect(text.main).toBe('Apercu.Bonus{"cover":"Apercu.Nom.half","bonus":2}');
    expect(text.sub).toBe('Apercu.Par{"sources":"Apercu.Source.wall, Apercu.Source.creature"}');
  });
  it("Total Cover: blocked", () => {
    expect(coverPreviewText({ ...base, degree: "total", bonus: null, sources: ["surface"] }, t).main).toBe("Apercu.Total");
  });
  it("a spell area is named", () => {
    const text = coverPreviewText({ ...base, degree: "threeQuarters", bonus: 5, sources: ["zone"], zone: "Barrière de lames" }, t);
    expect(text.sub).toBe('Apercu.Par{"sources":"Barrière de lames"}');
  });
  it("cover set by hand", () => {
    const text = coverPreviewText({ ...base, degree: "half", bonus: 2, sources: ["manual"], manual: true }, t);
    expect(text.sub).toBe('Apercu.Par{"sources":"Apercu.Source.manual"}');
  });
  it("cover ignored, with what ignores it", () => {
    const text = coverPreviewText({ ...base, ignored: { degree: "threeQuarters", by: "Tireur d'élite" } }, t);
    expect(text).toEqual({ css: "ignored", main: 'Apercu.Ignore{"cover":"Apercu.Nom.threeQuarters","by":"Tireur d\'élite"}', sub: null });
  });
  it("nothing without a preview", () => {
    expect(coverPreviewText(null, t)).toBeNull();
  });
});

describe("#33: a creature that also cuts the chosen corner is cited", () => {
  it("wall and creature: the wall decides, both are cited", () => {
    const blocked = (a, b) => (b.y < 50 ? "wall" : false);   // the wall cuts the lines toward the top of the target
    const cover = coverBetween({ attacker, target, bodies: [{ x: 100, y: 0, width: 100, height: 100 }], blocked, inset: 10 });
    expect(cover.degree).toBe("half");
    expect(cover.byCreature).toBe(false);
    expect(cover.sources).toEqual(["wall", "creature"]);
  });
});
