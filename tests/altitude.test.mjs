import { describe, it, expect } from "vitest";
import {
  placementOf, modeRefusal, coherentElevation, modeShift, alignPath, groundStepAllowed, flightChoice
} from "../module/scripts/core/altitude.mjs";

const opts = { clearance: 5, step: 5 };

describe("mode and elevation", () => {
  it("place le corps selon le mode", () => {
    expect(placementOf("walk")).toBe("ground");
    expect(placementOf("crawl")).toBe("ground");
    expect(placementOf("fly")).toBe("air");
    expect(placementOf("burrow")).toBe("under");
    expect(placementOf("climb")).toBeNull();
    expect(placementOf("displace")).toBeNull();
  });

  it("voler ou fouir demande la vitesse correspondante", () => {
    expect(modeRefusal("fly", { walk: 30 })).toBe("noSpeed");
    expect(modeRefusal("fly", { walk: 30, fly: 60 })).toBeNull();
    expect(modeRefusal("burrow", { burrow: 0 })).toBe("noSpeed");
    expect(modeRefusal("walk", {})).toBeNull();
  });

  it("walking and crawling stick to the ground, flying stays at 5 ft or more, burrowing at −5 ft or less", () => {
    expect(coherentElevation("walk", 30, 0, 5)).toBe(0);
    expect(coherentElevation("crawl", -10, 20, 5)).toBe(20);
    expect(coherentElevation("fly", 0, 0, 5)).toBe(5);
    expect(coherentElevation("fly", 30, 0, 5)).toBe(30);
    expect(coherentElevation("fly", 22, 20, 5)).toBe(25);
    expect(coherentElevation("burrow", 0, 0, 5)).toBe(-5);
    expect(coherentElevation("burrow", -15, 0, 5)).toBe(-15);
    expect(coherentElevation("climb", 12, 0, 5)).toBe(12);
  });
});

describe("plafond", () => {
  it("in flight, the feet stay under the ceiling (head included)", () => {
    // Ground floor from 0 to 15 ft, 5 ft creature: feet at 10 ft at most.
    expect(coherentElevation("fly", 15, 0, 5, 10)).toBe(10);
    expect(coherentElevation("fly", 8, 0, 5, 10)).toBe(8);
    expect(modeShift("walk", "fly", 0, 0, 5, 10)).toEqual({ elevation: 5, action: "fly" });
  });

  it("a ceiling that is too low does not override the 5 ft of flight", () => {
    expect(coherentElevation("fly", 0, 0, 5, 2)).toBe(5);
  });

  it("le plafond ne touche ni la marche ni le fouissement", () => {
    expect(coherentElevation("walk", 12, 0, 5, 10)).toBe(0);
    expect(coherentElevation("burrow", 0, 0, 5, -20)).toBe(-5);
  });

  it("alignPath caps a flying path at the ceiling of each point", () => {
    const r = alignPath({ elevation: 10 }, [{ action: "fly", ground: 0, ceiling: 10, elevation: 20 }], { clearance: 5, step: 5 });
    expect(r.elevations).toEqual([10]);
  });
});

describe("changement de mode", () => {
  it("take off, land, burrow, resurface", () => {
    expect(modeShift("walk", "fly", 0, 0, 5)).toEqual({ elevation: 5, action: "fly" });
    expect(modeShift("fly", "walk", 30, 0, 5)).toEqual({ elevation: 0, action: "fly" });
    expect(modeShift("walk", "burrow", 0, 0, 5)).toEqual({ elevation: -5, action: "burrow" });
    expect(modeShift("burrow", "walk", -15, 0, 5)).toEqual({ elevation: 0, action: "burrow" });
  });

  it("nothing to do when the elevation already fits", () => {
    expect(modeShift("fly", "fly", 30, 0, 5)).toBeNull();
    expect(modeShift("walk", "crawl", 0, 0, 5)).toBeNull();
    expect(modeShift("walk", "fly", 20, 0, 5)).toBeNull();
  });

  it("from a free mode to the ground, in the air: a fall, left to dnd5e", () => {
    expect(modeShift("climb", "walk", 15, 0, 5)).toBeNull();
  });
});

describe("alignPath", () => {
  const walk = (ground, elevation=0) => ({ action: "walk", ground, elevation });

  it("follows the ground when walking, one step of 5 ft at most", () => {
    const r = alignPath({ elevation: 0 }, [walk(0), walk(5, 0), walk(5, 0), walk(0, 5)], opts);
    expect(r).toMatchObject({ elevations: [0, 5, 5, 0], kept: 4, issue: null, changed: true });
  });

  it("changes nothing on a path that is already consistent", () => {
    expect(alignPath({ elevation: 0 }, [walk(0), walk(0)], opts).changed).toBe(false);
  });

  it("refuses to go up higher than one step without climbing", () => {
    const r = alignPath({ elevation: 0 }, [walk(0), walk(10)], opts);
    expect(r.issue).toBe("tooHigh");
    expect(r.kept).toBe(1);
  });

  it("stops at the edge of the void, over the void: that is a fall", () => {
    const r = alignPath({ elevation: 20 }, [walk(20, 20), walk(0, 20), walk(0, 20)], opts);
    expect(r).toMatchObject({ elevations: [20, 20], kept: 2, issue: "falls" });
  });

  it("le MJ suit le sol quoi qu'il arrive", () => {
    const r = alignPath({ elevation: 0 }, [walk(20), walk(0, 20)], { ...opts, lenient: true });
    expect(r).toMatchObject({ elevations: [20, 0], issue: null });
  });

  it("in flight, rises above the ground without ever descending on its own", () => {
    const r = alignPath({ elevation: 30 }, [
      { action: "fly", ground: 0, elevation: 30 }, { action: "fly", ground: 30, elevation: 30 }, { action: "fly", ground: 0, elevation: 35 }
    ], opts);
    expect(r.elevations).toEqual([30, 35, 35]);
  });

  it("en fouissement, reste sous le sol", () => {
    const r = alignPath({ elevation: -5 }, [{ action: "burrow", ground: 0, elevation: 0 }], opts);
    expect(r.elevations).toEqual([-5]);
  });

  it("laisse les autres modes tels quels", () => {
    const r = alignPath({ elevation: 0 }, [{ action: "climb", ground: 0, elevation: 15 }, { action: "displace", ground: 0, elevation: 40 }], opts);
    expect(r).toMatchObject({ elevations: [15, 40], changed: false });
  });

  it("the A* crosses only one step", () => {
    expect(groundStepAllowed(0, 5, 5)).toBe(true);
    expect(groundStepAllowed(0, 10, 5)).toBe(false);
    expect(groundStepAllowed(10, 0, 5)).toBe(false);
  });
});

describe("§238 : s'envoler, atterrir (menu)", () => {
  const base = { mode: "walk", airborne: false, flySpeed: 60, ground: 0, ceiling: Infinity, clearance: 5 };
  it("on the ground with a flying Speed: take off", () => {
    expect(flightChoice(base)).toBe("takeOff");
    expect(flightChoice({ ...base, mode: "crawl" })).toBe("takeOff");
  });
  it("without a flying Speed (or reduced to 0): nothing", () => {
    expect(flightChoice({ ...base, flySpeed: 0 })).toBeNull();
    expect(flightChoice({ ...base, flySpeed: undefined })).toBeNull();
  });
  it("no room under the ceiling: nothing", () => {
    expect(flightChoice({ ...base, ceiling: 3 })).toBeNull();
    expect(flightChoice({ ...base, ceiling: 5 })).toBe("takeOff");
  });
  it("in flight: land, even without a readable speed", () => {
    expect(flightChoice({ ...base, mode: "fly", airborne: true })).toBe("land");
    expect(flightChoice({ ...base, mode: "fly", airborne: true, flySpeed: 0 })).toBe("land");
  });
  it("in the air in a ground mode: land if it flies, otherwise nothing (it is a fall)", () => {
    expect(flightChoice({ ...base, airborne: true })).toBe("land");
    expect(flightChoice({ ...base, airborne: true, flySpeed: 0 })).toBeNull();
  });
  it("escalade, nage, fouissement : rien", () => {
    for ( const mode of ["climb", "swim", "burrow"] ) expect(flightChoice({ ...base, mode })).toBeNull();
  });
});
