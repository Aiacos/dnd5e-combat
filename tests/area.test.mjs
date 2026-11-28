import { describe, it, expect } from "vitest";
import {
  selectAreaTargets, turnKeyOf, openArea, shouldTrigger, markHit, entersArea, firstEntry, burnedOut, eligibleAreaTargets, zoneChoiceNeeded, pickedAtPose, positionBeforeAreaMove, sliceOf
} from "../module/scripts/core/area.mjs";

const c = (name, disposition, extra = {}) => ({ token: `T.${name}`, actor: `A.${name}`, name, disposition, ...extra });
const mage = c("Magicien", 1);
const guerrier = c("Guerrier", 1);
const zombi = c("Zombi", -1);
const goule = c("Goule", -1);
const all = [mage, guerrier, zombi, goule];
const names = list => list.map(t => t.name);

describe("selectAreaTargets", () => {
  it("a Cone starting from the caster does not hit the caster, but hits its allies", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: true, affects: "creature" });
    expect(names(out)).toEqual(["Guerrier", "Zombi", "Goule"]);
  });
  it("a Fireball placed at range also hits the caster if inside it", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Magicien", "Guerrier", "Zombi", "Goule"]);
  });
  it("an \"enemies\" area spares the caster's side and the caster", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "enemy" });
    expect(names(out)).toEqual(["Zombi", "Goule"]);
  });
  it("an \"allies\" area keeps only the caster's side", () => {
    const out = selectAreaTargets(all, { origin: zombi.token, originDisposition: -1, excludeOrigin: true, affects: "ally" });
    expect(names(out)).toEqual(["Goule"]);
  });
  it("ignores creatures that are out of combat", () => {
    const out = selectAreaTargets([zombi, c("Squelette", -1, { defeated: true })], { origin: mage.token, originDisposition: 1, excludeOrigin: true });
    expect(names(out)).toEqual(["Zombi"]);
  });
  it("without a known side for the caster, does not filter by side", () => {
    const out = selectAreaTargets(all, { origin: null, originDisposition: null, excludeOrigin: false, affects: "enemy" });
    expect(out).toHaveLength(4);
  });
});

describe("lasting area (Moonbeam 2024: entering or ending a turn, once per turn)", () => {
  const key = turnKeyOf(2, 1);
  const moonbeam = openArea(["enter", "turnEnd"], key, ["T.Zombi"]);

  it("those it hit when placed are not hit again this turn", () => {
    expect(shouldTrigger(moonbeam, { event: "turnEnd", token: "T.Zombi", turnKey: key })).toBe(false);
  });
  it("a creature that enters during this turn is hit", () => {
    expect(shouldTrigger(moonbeam, { event: "enter", token: "T.Goule", turnKey: key })).toBe(true);
  });
  it("on the next turn of play, the memory is reset", () => {
    expect(shouldTrigger(moonbeam, { event: "turnEnd", token: "T.Zombi", turnKey: turnKeyOf(2, 2) })).toBe(true);
  });
  it("ignores the moments the area does not know", () => {
    expect(shouldTrigger(moonbeam, { event: "turnStart", token: "T.Goule", turnKey: key })).toBe(false);
  });
  it("entering then ending one's turn in the area: only once", () => {
    const after = markHit(moonbeam, { token: "T.Goule", turnKey: key });
    expect(shouldTrigger(after, { event: "turnEnd", token: "T.Goule", turnKey: key })).toBe(false);
  });
  it("noting a token at a new turn forgets those of the previous turn", () => {
    const next = turnKeyOf(2, 2);
    const after = markHit(moonbeam, { token: "T.Goule", turnKey: next });
    expect(after).toMatchObject({ turnKey: next, hit: ["T.Goule"] });
    expect(moonbeam.hit).toEqual(["T.Zombi"]);
  });
  it("out of combat, a single turn key", () => {
    expect(turnKeyOf(null, null)).toBe("hors-combat");
  });
});

describe("entering an area", () => {
  it("arriving inside from the outside", () => expect(entersArea(false, [false, true])).toBe(true));
  it("crossing it without stopping there counts too", () => expect(entersArea(false, [true, false])).toBe(true));
  it("moving within it while already inside is not an entry", () => expect(entersArea(true, [true, true])).toBe(false));
  it("rester dehors", () => expect(entersArea(false, [false, false])).toBe(false));
});

describe("selectAreaTargets — ligne d'effet (P2)", () => {
  it("a creature the area does not reach (floor, ceiling) is discarded; unknown does not discard it", () => {
    const below = c("Rat", -1, { lineOfEffect: false });
    const unknown = c("Chauve-souris", -1, { lineOfEffect: null });
    const out = selectAreaTargets([mage, zombi, below, unknown], { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Magicien", "Zombi", "Chauve-souris"]);
  });
});

describe("selectAreaTargets — true Sphere (P2)", () => {
  it("a creature in the region's cylinder but outside the Sphere is discarded", () => {
    const corner = c("Harpie", -1, { inVolume: false });
    const inside = c("Rat", -1, { inVolume: true });
    const out = selectAreaTargets([zombi, corner, inside], { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Zombi", "Rat"]);
  });
});

describe("scattered objects (§187): the first cell of the path that enters an area", () => {
  it("returns the cell where one enters, not those before or after", () => {
    // start, then three cells; an area, entered at the second cell
    expect(firstEntry([[false], [false], [true], [true]])).toBe(2);
  });
  it("partir de la zone, ou ne jamais y entrer : -1", () => {
    expect(firstEntry([[true], [true], [false]])).toBe(-1);
    expect(firstEntry([[false], [false]])).toBe(-1);
    expect(firstEntry([])).toBe(-1);
  });
  it("several areas: the first entry, whichever the area; leaving one for another counts", () => {
    expect(firstEntry([[false, false], [false, false], [false, true], [true, true]])).toBe(2);
    expect(firstEntry([[true, false], [false, true]])).toBe(1);
  });
});

describe("flammable areas (§188): the end of the fire", () => {
  const until = { round: 5, turn: 2 };   // set ablaze at round 3, turn 2, for 2 rounds
  it("goes out at the end of the same turn, rounds later — not before", () => {
    expect(burnedOut(until, { round: 5, turn: 1 })).toBe(false);
    expect(burnedOut(until, { round: 4, turn: 3 })).toBe(false);
    expect(burnedOut(until, { round: 5, turn: 2 })).toBe(true);
  });
  it("a skipped turn (combatant removed) or a passed round puts it out too", () => {
    expect(burnedOut(until, { round: 5, turn: 3 })).toBe(true);
    expect(burnedOut(until, { round: 6, turn: 0 })).toBe(true);
  });
  it("sans terme (hors combat) ou sans tour fini : rien", () => {
    expect(burnedOut(null, { round: 9, turn: 0 })).toBe(false);
    expect(burnedOut(until, null)).toBe(false);
  });
});

describe("§401: \"creatures of your choice\" areas", () => {
  const c = (token, disposition, extra={}) => ({ token, actor: `A.${token}`, name: token, disposition, ...extra });
  const opts = { origin: "me", originDisposition: 1, excludeOrigin: false, affects: "enemy", max: null };
  const candidates = [c("me", 1), c("ami", 1), c("orc", -1), c("mort", -1, { defeated: true }), c("neutre", 0)];

  it("offers all those the area can affect, without the caster or the dead", () => {
    expect(eligibleAreaTargets(candidates, opts).map(x => x.token)).toEqual(["ami", "orc", "neutre"]);
  });

  it("\"mixed\": asks only if the automatic choice leaves someone out", () => {
    const eligible = eligibleAreaTargets(candidates, opts);
    const chosen = selectAreaTargets(candidates, opts);
    expect(zoneChoiceNeeded("mixed", eligible, chosen)).toBe(true);
    const enemies = [c("orc", -1), c("gob", -1)];
    expect(zoneChoiceNeeded("mixed", eligibleAreaTargets(enemies, opts), selectAreaTargets(enemies, opts))).toBe(false);
    expect(zoneChoiceNeeded("always", eligibleAreaTargets(enemies, opts), selectAreaTargets(enemies, opts))).toBe(true);
    expect(zoneChoiceNeeded("never", eligible, chosen)).toBe(false);
    expect(zoneChoiceNeeded("always", [], [])).toBe(false);
  });

  it("\"mixed\": also asks when the cap (`zoneMax`) discards enemies", () => {
    const three = [c("a", -1, { distance: 1 }), c("b", -1, { distance: 2 }), c("d", -1, { distance: 3 })];
    const capped = { ...opts, max: 2 };
    expect(zoneChoiceNeeded("mixed", eligibleAreaTargets(three, capped), selectAreaTargets(three, capped))).toBe(true);
  });

  it("a lasting area follows the placement choice, then the automatic rule for newcomers", () => {
    const state = { picked: ["orc"], spared: ["ami"] };
    expect(pickedAtPose(state, "orc")).toBe(true);
    expect(pickedAtPose(state, "ami")).toBe(false);
    expect(pickedAtPose(state, "nouveau")).toBe(null);
    expect(pickedAtPose({}, "orc")).toBe(null);
  });
});

// §551: an Emanation that follows its caster up or down (Spirit Guardians, a flying Cleric).
describe("sliceOf — the elevation slice noted in an area's state", () => {
  it("finite bounds kept", () => expect(sliceOf({ bottom: -15, top: 20 })).toEqual({ bottom: -15, top: 20 }));
  it("a column without a slice is null", () => expect(sliceOf({ bottom: null, top: null })).toBe(null));
  it("one open bound stays null", () => expect(sliceOf({ bottom: 0, top: null })).toEqual({ bottom: 0, top: null }));
  it("nothing given", () => expect(sliceOf(undefined)).toBe(null));
});

describe("positionBeforeAreaMove — the token as seen from the area before it moved", () => {
  const zombie = { x: 100, y: 200, elevation: 0 };
  // A disc of radius 30 centred on `c`, and a slice: the area as the core would test it.
  const inside = (p, c, slice=null) => (Math.hypot(p.x - c.x, p.y - c.y) <= 30)
    && (!slice || ((p.elevation + 5 > slice.bottom) && (p.elevation < slice.top)));
  it("a horizontal move shifts the token by the area's own move (§300)", () => {
    expect(positionBeforeAreaMove(zombie, { at: { x: 0, y: 0 }, now: { x: 50, y: 0 } })).toEqual({ x: 150, y: 200, elevation: 0 });
  });
  it("the caster steps towards a creature at the edge: it was outside, it enters", () => {
    const p = { x: 25, y: 0, elevation: 0 };
    const move = { at: { x: -10, y: 0 }, now: { x: 0, y: 0 } };
    expect(inside(p, move.now)).toBe(true);
    expect(inside(positionBeforeAreaMove(p, move), move.now)).toBe(false);   // = inside(p, move.at)
  });
  it("a creature trailing behind, inside before and after: already inside", () => {
    const p = { x: -15, y: 0, elevation: 0 };
    const move = { at: { x: -10, y: 0 }, now: { x: 0, y: 0 } };
    expect(inside(p, move.at) && inside(p, move.now)).toBe(true);
    expect(inside(positionBeforeAreaMove(p, move), move.now)).toBe(true);
  });
  it("the caster comes down 30 ft onto the Zombie: it was out of the slice, it enters", () => {
    const move = { at: { x: 0, y: 0 }, now: { x: 0, y: 0 }, sliceBefore: { bottom: 15, top: 50 }, sliceNow: { bottom: -15, top: 20 } };
    const p = { x: 10, y: 0, elevation: 0 };
    const before = positionBeforeAreaMove(p, move);
    expect(before.elevation).toBe(-30);
    expect(inside(before, move.now, move.sliceNow)).toBe(false);
    expect(inside(p, move.now, move.sliceNow)).toBe(true);
  });
  it("the caster rises 10 ft above the Zombie: it was inside, no new entry", () => {
    const move = { at: { x: 0, y: 0 }, now: { x: 0, y: 0 }, sliceBefore: { bottom: -15, top: 20 }, sliceNow: { bottom: -5, top: 30 } };
    const before = positionBeforeAreaMove({ x: 10, y: 0, elevation: 0 }, move);
    expect(before.elevation).toBe(10);
    expect(inside(before, move.now, move.sliceNow)).toBe(true);
  });
  it("only the top is finite: the shift reads the top", () => {
    expect(positionBeforeAreaMove(zombie, { sliceBefore: { bottom: null, top: 20 }, sliceNow: { bottom: null, top: 50 } }).elevation).toBe(30);
  });
  it("no slice noted (a column, or an area from before §551): horizontal shift only", () => {
    expect(positionBeforeAreaMove(zombie, { at: { x: 0, y: 0 }, now: { x: 0, y: 0 }, sliceBefore: null, sliceNow: { bottom: -15, top: 20 } })).toEqual(zombie);
  });
  it("nothing known about the move (an area from before §300): null", () => expect(positionBeforeAreaMove(zombie, {})).toBe(null));
  it("vertical only, no centre noted: still known", () => {
    expect(positionBeforeAreaMove(zombie, { sliceBefore: { bottom: 0, top: 10 }, sliceNow: { bottom: 5, top: 15 } })).toEqual({ x: 100, y: 200, elevation: 5 });
  });
});
