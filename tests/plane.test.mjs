import { describe, it, expect } from "vitest";
import { etherealLight, planeOf, samePlane, perceivesAcross, crossesEtherealWall, etherealStepCost, nearestFreeCell, shuntDamage, etherealPlaneOn, setEtherealPlaneState, ETHEREAL } from "../module/scripts/core/plane.mjs";
import { selectAreaTargets } from "../module/scripts/core/area.mjs";

describe("§225: Ethereal plane (`ethereal` status)", () => {
  const ethereal = new Set([ETHEREAL]);
  const material = new Set(["prone"]);

  it("the `ethereal` status puts the creature in the Ethereal Plane, everything else is the Material Plane", () => {
    expect(planeOf(ethereal)).toBe("ethereal");
    expect(planeOf(material)).toBe("material");
    expect(planeOf(new Set())).toBe("material");
    expect(planeOf(null)).toBe("material");
  });

  it("two creatures affect each other only on the same plane", () => {
    expect(samePlane(ethereal, new Set([ETHEREAL, "prone"]))).toBe(true);
    expect(samePlane(material, new Set())).toBe(true);
    expect(samePlane(ethereal, material)).toBe(false);
    expect(samePlane(material, ethereal)).toBe(false);
  });

  it("what is not a creature (a point, null) is on the Material Plane", () => {
    expect(samePlane(null, material)).toBe(true);
    expect(samePlane(null, ethereal)).toBe(false);
  });

  it("an area leaves out creatures of a plane other than its caster's", () => {
    const candidates = [{ token: "a", disposition: -1 }, { token: "b", disposition: -1, offPlane: true }];
    const picked = selectAreaTargets(candidates, { origin: "o", originDisposition: 1, excludeOrigin: false, affects: "" });
    expect(picked.map(c => c.token)).toEqual(["a"]);
  });

  it("perception from one plane to the other: Ethereal sight at its range, 60 ft from the Ethereal, the visible ghost", () => {
    const base = { observerPlane: "material", targetPlane: ETHEREAL, distance: 30 };
    expect(perceivesAcross({ ...base, observerPlane: ETHEREAL })).toBe(true);
    expect(perceivesAcross(base)).toBe(false);
    expect(perceivesAcross({ ...base, etherealSight: Infinity })).toBe(true);
    expect(perceivesAcross({ ...base, etherealSight: 20 })).toBe(false);
    expect(perceivesAcross({ ...base, etherealSight: 60 })).toBe(true);
    expect(perceivesAcross({ ...base, visibleAcross: true })).toBe(true);
    const fromEthereal = { observerPlane: ETHEREAL, targetPlane: "material", limit: 60 };
    expect(perceivesAcross({ ...fromEthereal, distance: 60 })).toBe(true);
    expect(perceivesAcross({ ...fromEthereal, distance: 65 })).toBe(false);
  });

  it("batch 3: a step crosses a wall of force, ends included; vertical costs double", () => {
    const wall = [[100, 0, 100, 100]];
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 50 }, wall)).toBe(true);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 90, y: 50 }, wall)).toBe(false);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 150 }, wall)).toBe(true);
    expect(crossesEtherealWall({ x: 50, y: 150 }, { x: 150, y: 150 }, wall)).toBe(false);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 50 }, [])).toBe(false);
    expect(etherealStepCost(5, 0)).toBe(5);
    expect(etherealStepCost(5, -5)).toBe(10);
  });

  it("batch 4: the nearest free cell, ring by ring, orthogonal first; damage 2 × feet", () => {
    const taken = new Set(["5,5", "5,6", "4,5"]);
    const free = c => !taken.has(`${c.i},${c.j}`);
    expect(nearestFreeCell({ i: 5, j: 5 }, free)).toEqual({ i: 5, j: 4, rings: 1 });
    expect(nearestFreeCell({ i: 1, j: 1 }, free)).toEqual({ i: 1, j: 1, rings: 0 });
    expect(nearestFreeCell({ i: 0, j: 0 }, () => false, 3)).toBe(null);
    const ring2 = c => (Math.max(Math.abs(c.i), Math.abs(c.j)) >= 2);
    expect(nearestFreeCell({ i: 0, j: 0 }, ring2)?.rings).toBe(2);
    expect(shuntDamage(5)).toBe(10);
    expect(shuntDamage(0)).toBe(0);
  });

  it("the GM's switch: off, everyone is on the Material Plane", () => {
    expect(etherealPlaneOn()).toBe(true);
    setEtherealPlaneState(false);
    try {
      expect(planeOf(ethereal)).toBe("material");
      expect(samePlane(ethereal, material)).toBe(true);
    }
    finally { setEtherealPlaneState(true); }
    expect(planeOf(ethereal)).toBe("ethereal");
  });
});

describe("an Ethereal token does not light", () => {
  const torch = { dim: 40, bright: 20 };
  it("Ethereal and it emits: its radii are set to zero", () => {
    expect(etherealLight({ ethereal: true, ...torch })).toBe("shade");
    expect(etherealLight({ ethereal: true, dim: 10, bright: 0 })).toBe("shade");
    expect(etherealLight({ ethereal: true, ...torch, shaded: true })).toBe("shade");   // preparation had restored them
  });
  it("Ethereal and already off, or without light: nothing", () => {
    expect(etherealLight({ ethereal: true, dim: 0, bright: 0, shaded: true })).toBe(null);
    expect(etherealLight({ ethereal: true })).toBe(null);
  });
  it("back, radii still at zero: its data is re-prepared — never the previous radii restored as they were", () => {
    expect(etherealLight({ ethereal: false, dim: 0, bright: 0, shaded: true })).toBe("reprepare");
  });
  it("back, token preparation already restored its radii: only the source needs redoing", () => {
    expect(etherealLight({ ethereal: false, ...torch, shaded: true })).toBe("refresh");
  });
  it("never turned off by us: nothing, whether it emits or not", () => {
    expect(etherealLight({ ethereal: false, ...torch })).toBe(null);
    expect(etherealLight({ ethereal: false, dim: 0, bright: 0 })).toBe(null);
  });
});
