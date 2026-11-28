import { describe, it, expect } from "vitest";
import { coverBetween, segmentCrossesRect, corners, shrink, COVER } from "../module/scripts/core/cover.mjs";

// Cells of 100 px. Attacker at (0,0), target two cells to the right.
const cell = (i, j, w=1, h=1) => ({ x: j * 100, y: i * 100, width: w * 100, height: h * 100 });
const attacker = cell(0, 0);
const target = cell(0, 3);

/** A vertical wall at x, between y0 and y1: blocks every line that crosses it. */
const wall = (x, y0, y1) => (a, b) => {
  if ( (a.x < x) === (b.x < x) ) return false;
  const t = (x - a.x) / (b.x - a.x);
  const y = a.y + t * (b.y - a.y);
  return (y >= y0) && (y <= y1);
};

describe("geometry", () => {
  it("a segment crosses a rectangle, not if it grazes it or misses it", () => {
    const r = cell(0, 1);
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 250, y: 50 }, r)).toBe(true);
    expect(segmentCrossesRect({ x: 50, y: 150 }, { x: 250, y: 150 }, r)).toBe(false);   // passe dessous
    expect(segmentCrossesRect({ x: 0, y: 100 }, { x: 200, y: 100 }, r)).toBe(false);     // longe le bord
    expect(segmentCrossesRect({ x: 100, y: 0 }, { x: 100, y: 100 }, r)).toBe(false);     // longe le bord
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 80, y: 50 }, r)).toBe(false);       // stops before
  });

  it("coins et retrait", () => {
    expect(corners(cell(0, 0))).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]);
    expect(shrink(cell(0, 0), 10)).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    expect(shrink(cell(0, 0), 500).width).toBeGreaterThan(0);   // never beyond the center
  });
});

describe("cover (DMG rule, 2024)", () => {
  it("in the open: no cover", () => {
    expect(coverBetween({ attacker, target })).toMatchObject({ degree: "none", bonus: 0, blockedLines: 0 });
  });

  it("a wall that cuts all lines: Total Cover, untouchable", () => {
    const cover = coverBetween({ attacker, target, blocked: wall(200, -1000, 1000), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", bonus: null, blockedLines: 4 });
  });

  it("a low wall that cuts only the low lines: Half Cover from the best corner", () => {
    // Wall at x=200 from y=40 to y=1000. From the top-right corner (90,10): only the line toward (310,90)
    // cuts it (y=50 at x=200); from the bottom corners, everything is cut. The best corner gives Half Cover.
    const cover = coverBetween({ attacker, target, blocked: wall(200, 40, 1000), inset: 10 });
    expect(cover.degree).toBe("half");
    expect(cover.bonus).toBe(COVER.half.bonus);
  });

  it("three lines blocked from the best corner: Three-Quarters Cover", () => {
    // Everything is blocked except one line, from the attacker's top corner toward the target's top-left corner.
    const blocked = (a, b) => !((a.y === 10) && (b.y === 10) && (b.x === 310));
    const cover = coverBetween({ attacker, target, blocked, inset: 10 });
    expect(cover).toMatchObject({ degree: "threeQuarters", bonus: 5, blockedLines: 3 });
  });

  it("the attacker picks the corner that leaves the least cover", () => {
    // Bloque tout depuis les coins de gauche (x=10), rien depuis ceux de droite (x=90).
    const blocked = a => a.x === 10;
    expect(coverBetween({ attacker, target, blocked, inset: 10 }).degree).toBe("none");
  });

  it("an interposed creature gives Half Cover, never more", () => {
    // A body two cells tall, between the two: all lines cross it.
    const bodies = [cell(-1, 1, 1, 3)];
    const cover = coverBetween({ attacker, target, bodies, inset: 10 });
    expect(cover).toMatchObject({ degree: "half", bonus: 2, byCreature: true });
  });

  it("a wall and a creature: the wall's cover takes precedence, the creature does not worsen it", () => {
    const cover = coverBetween({ attacker, target, bodies: [cell(0, 1)], blocked: wall(250, -1000, 1000), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", byCreature: false });
  });

  it("a creature that is not between the two does not count", () => {
    expect(coverBetween({ attacker, target, bodies: [cell(3, 3)], inset: 10 }).degree).toBe("none");
  });
});

import { bodyGivesCover } from "../module/scripts/core/cover.mjs";

describe("a dead creature interposed", () => {
  it("covers only if it is Large or bigger", () => {
    expect(bodyGivesCover({ dead: false, size: "med" })).toBe(true);
    expect(bodyGivesCover({ dead: true, size: "med" })).toBe(false);
    expect(bodyGivesCover({ dead: true, size: "sm" })).toBe(false);
    expect(bodyGivesCover({ dead: true, size: "lg" })).toBe(true);
    expect(bodyGivesCover({ dead: true, size: "huge" })).toBe(true);
  });
});

import { pullBack } from "../module/scripts/core/cover.mjs";

/** The point where [a, b] cuts the segment [p, q], or null. */
function intersection(a, b, p, q) {
  const d = ((b.x - a.x) * (q.y - p.y)) - ((b.y - a.y) * (q.x - p.x));
  if ( Math.abs(d) < 1e-12 ) return null;
  const t = (((p.x - a.x) * (q.y - p.y)) - ((p.y - a.y) * (q.x - p.x))) / d;
  const u = (((p.x - a.x) * (b.y - a.y)) - ((p.y - a.y) * (b.x - a.x))) / d;
  return ((t >= 0) && (t <= 1) && (u >= 0) && (u <= 1)) ? { x: a.x + (t * (b.x - a.x)), y: a.y + (t * (b.y - a.y)) } : null;
}

describe("§239: cell cut by a wall that does not follow the grid (issue #14)", () => {
  // A cave: a diagonal wall cuts the top-right corner of the target's cell, (1, 4) = x 400–500, y 100–200.
  const p = { x: 440, y: 100 }, q = { x: 500, y: 160 };
  const blocked = (a, b) => !!intersection(a, b, p, q);
  const clip = (centre, corner) => pullBack(centre, corner, intersection(centre, corner, p, q), 10);
  const cave = cell(1, 4);
  const shooter = cell(4, 1);   // diagonally, on the other side of the room

  it("without pulling the corners back, the corner inside the rock gives Half Cover", () => {
    expect(coverBetween({ attacker: shooter, target: cave, blocked, inset: 10 }).degree).toBe("half");
  });

  it("the corner pulled back in front of the wall: no cover against a shooter in the room", () => {
    const cover = coverBetween({ attacker: shooter, target: cave, blocked, inset: 10, clipAttacker: clip, clipTarget: clip });
    expect(cover).toMatchObject({ degree: "none", bonus: 0 });
  });

  it("un vrai mur entre les deux donne toujours l'abri", () => {
    const between = wall(200, -1000, 1000);
    const clipWall = (centre, corner) => pullBack(centre, corner, between(centre, corner) ? { x: 200, y: centre.y } : null, 10);
    const cover = coverBetween({ attacker, target, blocked: between, inset: 10, clipAttacker: clipWall, clipTarget: clipWall });
    expect(cover.degree).toBe("total");
  });

  it("pullBack: stopped before the obstacle, the corner intact without an obstacle", () => {
    expect(pullBack({ x: 0, y: 0 }, { x: 100, y: 0 }, null, 10)).toEqual({ x: 100, y: 0 });
    expect(pullBack({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 60, y: 0 }, 10)).toEqual({ x: 50, y: 0 });
    expect(pullBack({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 5, y: 0 }, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("§468: a grate (bars, portcullis) is not Total Cover", () => {
  const grate = (x, y0, y1) => (a, b) => (wall(x, y0, y1)(a, b) ? "grate" : false);

  it("a grate that cuts all lines: Three-Quarters Cover (+5), not total", () => {
    const cover = coverBetween({ attacker, target, blocked: grate(200, -1000, 1000), inset: 10 });
    expect(cover).toMatchObject({ degree: "threeQuarters", bonus: 5, blockedLines: 4, byCreature: false, sources: ["wall"] });
  });

  it("a grate that cuts only the low lines: Half Cover, like a low wall", () => {
    const cover = coverBetween({ attacker, target, blocked: grate(200, 40, 1000), inset: 10 });
    expect(cover.degree).toBe("half");
  });

  it("a solid wall behind the grate: Total Cover comes back", () => {
    const both = (a, b) => (wall(250, -1000, 1000)(a, b) ? "wall" : grate(200, -1000, 1000)(a, b));
    expect(coverBetween({ attacker, target, blocked: both, inset: 10 }).degree).toBe("total");
  });
});

import { grateOf, GRATE_MODES } from "../module/scripts/core/cover.mjs";

describe("§476: walls that are grates by default (world setting) and wall choice", () => {
  it("three choices, \"auto\" first", () => {
    expect(GRATE_MODES).toEqual(["auto", "grate", "solid"]);
  });

  it("setting off: only a wall chosen \"grate\" is one", () => {
    expect(grateOf({ mode: "auto", auto: false, blocksSight: false })).toBe(false);
    expect(grateOf({ mode: "grate", auto: false, blocksSight: true })).toBe(true);
    expect(grateOf({})).toBe(false);
  });

  it("setting on: a wall that lets you see is a grate, a wall that blocks sight (window, terrain, solid) is not", () => {
    expect(grateOf({ mode: "auto", auto: true, blocksSight: false })).toBe(true);
    expect(grateOf({ mode: "auto", auto: true, blocksSight: true })).toBe(false);
  });

  it("setting on: a wall placed by a spell (Wall of Force) or ethereal stays solid", () => {
    expect(grateOf({ mode: "auto", auto: true, blocksSight: false, spellWall: true })).toBe(false);
  });

  it("the choice \"solid wall\" takes precedence over the setting (a glass pane)", () => {
    expect(grateOf({ mode: "solid", auto: true, blocksSight: false })).toBe(false);
  });

  it("an unknown choice is \"auto\"", () => {
    expect(grateOf({ mode: "bizarre", auto: true, blocksSight: false })).toBe(true);
    expect(grateOf({ mode: "bizarre", auto: false, blocksSight: false })).toBe(false);
  });
});

import { windowOpen, forcedCover } from "../module/scripts/core/cover.mjs";

describe("§518: windows (Discord, SpitFire) — open for whoever sees through; forced attack despite Total Cover", () => {
  it("a window whose sight threshold the attacker reaches is open", () => {
    expect(windowOpen({ seenThrough: true })).toBe(true);
    expect(windowOpen({ mode: "auto", seenThrough: true })).toBe(true);
  });

  it("beyond the threshold, the window stays a wall", () => {
    expect(windowOpen({ seenThrough: false })).toBe(false);
    expect(windowOpen({})).toBe(false);
  });

  it("the wall's choice takes precedence (\"solid wall\": a closed pane; \"grate\": never more than Three-Quarters Cover)", () => {
    expect(windowOpen({ mode: "solid", seenThrough: true })).toBe(false);
    expect(windowOpen({ mode: "grate", seenThrough: true })).toBe(false);
  });

  it("un mur de sort ne s'ouvre jamais", () => {
    expect(windowOpen({ spellWall: true, seenThrough: true })).toBe(false);
  });

  it("an open window cuts no line: no cover", () => {
    const attacker = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 500, y: 0, width: 100, height: 100 };
    // The window between the two, open for the attacker: `blocked` does not return it (adapter/cover.mjs, `wallKindBetween`).
    expect(coverBetween({ attacker, target, blocked: () => false, inset: 10 }).degree).toBe("none");
  });

  it("forced, Total Cover becomes Three-Quarters (+5): the attack can hit", () => {
    const cover = forcedCover({ degree: "total", bonus: null, sources: ["wall"] });
    expect(cover).toMatchObject({ degree: "threeQuarters", bonus: 5, forced: true, sources: ["wall"] });
  });

  it("forced, the other covers do not change", () => {
    const half = { degree: "half", bonus: 2 };
    expect(forcedCover(half)).toBe(half);
    expect(forcedCover(null)).toBe(null);
    expect(forcedCover(undefined)).toBe(null);
  });
});
