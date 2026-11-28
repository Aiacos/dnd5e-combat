/** M8 (SPEC §18.17): Swallow / Engulf — reading the original English text, damage moment, regurgitation. */
import { describe, it, expect } from "vitest";
import { readSwallow, swallowDamageNow, mustRegurgitateSave, fitsSize, enteredSpaces, sizeLimit } from "../module/scripts/core/swallow.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Excerpts in the form of those in the 2024 Monster Manual, enrichers included: SRD 5.2 creatures (Behir, Kraken, Giant
// Toad, Giant Frog, Tarrasque, Gelatinous Cube); the anonymous engulf text further down is synthetic.
const BEHIR = `<p><em>Failure</em>: The [[lookup @name lowercase]] swallows the target… and takes [[/damage average activity=zrWNjO9mkbN28spL]] damage at the start of each of the [[lookup @name lowercase]]'s turns. If the [[lookup @name lowercase]] takes 30 damage or more on a single turn from the swallowed creature, the [[lookup @name lowercase]] must succeed on a [[/save format=long activity=rGeGukkm2t2fXsoy]] at the end of that turn or regurgitate the creature.</p>`;
const KRAKEN = `<p>A swallowed creature has the &amp;Reference[Restrained apply=false] condition… and takes [[/damage average]] damage at the start of each of its turns. If the [[lookup @name lowercase]] takes 50 damage or more on a single turn from a creature inside it…</p>`;
const TOAD = `<p>In addition, the target takes [[/damage average]] damage at the end of each of the [[lookup @name lowercase]]’s turns.</p>`;
const FROG = `<p>At the end of the [[lookup @name lowercase]]’s next turn, the swallowed target takes [[/damage 2d4 acid average]] damage. If that damage doesn’t kill it, the [[lookup @name lowercase]] disgorges it.</p>`;

describe("Avaler / Engloutir (M8)", () => {
  it("reads the damage moment and the regurgitation threshold", () => {
    expect(readSwallow(BEHIR)).toMatchObject({ damageAt: "ownerStart", threshold: 30 });
    expect(readSwallow(KRAKEN)).toMatchObject({ damageAt: "targetStart", threshold: 50 });
    expect(readSwallow(TOAD)).toMatchObject({ damageAt: "ownerEnd", threshold: null });
    expect(readSwallow(FROG)).toMatchObject({ damageAt: "ownerEndOnce", threshold: null });
  });

  it("who takes the damage at this change of turn", () => {
    expect(swallowDamageNow("ownerStart", { started: true })).toBe(true);
    expect(swallowDamageNow("ownerStart", { ended: true })).toBe(false);
    expect(swallowDamageNow("ownerEnd", { ended: true })).toBe(true);
    expect(swallowDamageNow("targetStart", { targetStarted: true })).toBe(true);
    expect(swallowDamageNow("targetStart", { started: true })).toBe(false);
    // The Frog: "at the end of its NEXT turn" — not at the end of the turn when it swallowed.
    expect(swallowDamageNow("ownerEndOnce", { ended: true, sameTurn: true })).toBe(false);
    expect(swallowDamageNow("ownerEndOnce", { ended: true, sameTurn: false })).toBe(true);
    expect(swallowDamageNow(null, { started: true })).toBe(false);
  });

  it("regurgitate: at the threshold, not below, never without a threshold", () => {
    expect(mustRegurgitateSave(30, 29)).toBe(false);
    expect(mustRegurgitateSave(30, 30)).toBe(true);
    expect(mustRegurgitateSave(null, 100)).toBe(false);
  });

  it("shipped content", () => {
    expect(CONTENT.swallow.swallow).toBe(true);
    expect(CONTENT.engulf).toMatchObject({ swallow: true, noOpportunity: "afterUse" });
    for ( const id of ["swallow", "engulf"] ) expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
  });
});

// §18.21: excerpts of the same form (SRD 5.2 creatures, except ENGULFER, synthetic).
const TOAD_FULL = `<p>The [[lookup @name lowercase]] swallows a Medium or smaller target it is grappling. … The [[lookup @name lowercase]] can have only one target swallowed at a time, and it can’t use Bite while it has a swallowed target.</p>`;
const TARRASQUE = `<p><em>Strength Saving Throw</em>: DC …, … by the … (it can have up to six creatures swallowed at a time).</p>`;
const CUBE = `<p>The … can move through the spaces of Large or smaller creatures if it has room inside itself to contain them. <em>Dexterity Saving Throw</em>: DC …, each creature whose space the [[lookup @name lowercase]] enters for the first time during this move.</p>`;
const ENGULFER = `<p>While engulfed, a creature … has the &amp;Reference[Restrained apply=long] condition, and repeats the save at the end of each of its turns.</p>`;

describe("Avaler / Engloutir : limites et engloutir en marchant (§18.21)", () => {
  it("ability, grappled target, forbidden item", () => {
    expect(readSwallow(TOAD_FULL)).toMatchObject({ capacity: 1, grappling: true, forbids: "Bite" });
    expect(readSwallow(TARRASQUE)).toMatchObject({ capacity: 6, grappling: false, forbids: null });
  });

  it("the size of what is swallowed (§45): the Giant Toad's text, or the activity's target, in English or translated", () => {
    expect(readSwallow(TOAD_FULL).targetMaxSize).toBe("med");
    expect(readSwallow(TARRASQUE).targetMaxSize).toBeNull();
    expect(sizeLimit("Small or smaller")).toBe("sm");
    expect(sizeLimit("de taille P ou inférieure")).toBe("sm");
    expect(sizeLimit("une créature de taille G ou inférieure agrippée par le béhir")).toBe("lg");
    expect(sizeLimit("Swallowed by the behir")).toBeNull();
    expect(sizeLimit(undefined)).toBeNull();
  });

  it("engulf while walking, maximum size; repeated save", () => {
    expect(readSwallow(CUBE)).toMatchObject({ moving: true, maxSize: "lg", repeatsSave: false });
    expect(readSwallow(ENGULFER)).toMatchObject({ repeatsSave: true, moving: false });
    expect(fitsSize("med", "lg")).toBe(true);
    expect(fitsSize("huge", "lg")).toBe(false);
    expect(fitsSize("grg", null)).toBe(true);
  });

  it("spaces crossed: entering counts, already being on it at the start does not", () => {
    const cell = (x, y) => ({ x, y, w: 100, h: 100 });
    const path = [cell(0, 0), cell(50, 0), cell(100, 0), cell(150, 0), cell(200, 0)];   // the cube goes from 0 to 200
    expect(enteredSpaces(path, [
      { id: "sur le chemin", ...cell(200, 0) }, { id: "à côté", ...cell(100, 100) }, { id: "déjà dessous", ...cell(0, 0) }
    ])).toEqual(["sur le chemin"]);
  });
});
