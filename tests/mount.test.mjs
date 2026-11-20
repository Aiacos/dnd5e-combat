import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { bondBreaker, bondBroken, isControlled, mountProblem, needsCommand, riderSeat, MOUNT_FREE_ACTIONS }
  from "../module/scripts/core/mount.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

const RIDER = "riderActor000001";

describe("§490 (B08) : schéma de `mount` et `commands`", () => {
  it("accepte les formes documentées", () => {
    expect(validateEntry({ mount: {} })).toEqual([]);
    expect(validateEntry({ mount: { rider: RIDER } })).toEqual([]);
    expect(validateEntry({ mount: { rider: RIDER, controlled: false } })).toEqual([]);
    expect(validateEntry({ commands: { actor: "companion0000001", distance: 60, units: "ft", cost: "bonus" } })).toEqual([]);
    expect(validateEntry({ commands: { identifier: "a-steed", distance: 18, units: "m" } })).toEqual([]);
  });
  it("refuse le reste", () => {
    expect(validateEntry({ mount: { rider: "court", controlled: "oui", saddle: true } })).toEqual([
      "mount.saddle: unknown key", "mount.rider: an actor id (16 characters)", "mount.controlled: true or false"]);
    expect(validateEntry({ mount: true })).toEqual(["mount: { rider?: actor id, controlled?: boolean }"]);
    expect(validateEntry({ commands: { actor: "companion0000001", identifier: "x", distance: 0, units: "", cost: "reaction" } })).toEqual([
      "commands: exactly one of actor (actor id) or identifier (item identifier)", "commands.distance: a positive number",
      "commands.units: \"ft\", \"m\"…", "commands.cost: action, bonus, free"]);
    expect(validateEntry({ commands: { distance: 60, units: "ft" } })).toEqual([
      "commands: exactly one of actor (actor id) or identifier (item identifier)"]);
  });
});

describe("§490 : monter", () => {
  const base = { rule: { rider: RIDER }, riderActorIds: [RIDER], riderSize: "med", mountSize: "lg" };
  it("son cavalier, au contact : rien ne cloche", () => {
    expect(mountProblem(base)).toBe(null);
  });
  it("les refus secs d'abord : pas une monture, déjà en selle, déjà montée", () => {
    expect(mountProblem({ ...base, rule: null })).toBe("notMount");
    expect(mountProblem({ ...base, riding: true })).toBe("riding");
    expect(mountProblem({ ...base, alreadyRidden: true })).toBe("ridden");
  });
  it("une monture réservée refuse un autre cavalier, même plus petit", () => {
    expect(mountProblem({ ...base, riderActorIds: ["someoneElse00001"], riderSize: "sm" })).toBe("notRider");
  });
  it("sans cavalier désigné : une créature alliée plus petite d'au moins une taille", () => {
    const open = { ...base, rule: {}, riderActorIds: [] };
    expect(mountProblem(open)).toBe(null);
    expect(mountProblem({ ...open, mountSize: "med" })).toBe("tooBig");
    expect(mountProblem({ ...open, enemies: true })).toBe("enemy");
  });
  it("ni À terre, ni Neutralisé ; au contact", () => {
    expect(mountProblem({ ...base, mountStatuses: ["prone"] })).toBe("cannot");
    expect(mountProblem({ ...base, riderStatuses: ["stunned"] })).toBe("cannot");
    expect(mountProblem({ ...base, adjacent: false })).toBe("far");
  });
  it("le cavalier s'assied au centre de sa monture", () => {
    expect(riderSeat({ x: 100, y: 200 }, { w: 2, h: 2 }, { w: 1, h: 1 }, { sizeX: 100, sizeY: 100 })).toEqual({ x: 150, y: 250 });
    expect(riderSeat({ x: 100, y: 200 }, { w: 3, h: 3 }, { w: 1, h: 1 }, { sizeX: 100, sizeY: 100 })).toEqual({ x: 200, y: 300 });
  });
});

describe("§490 : chute — le lien tombe", () => {
  const ok = { statuses: [], hp: 10 };
  it("rien : en selle", () => expect(bondBroken({ rider: ok, mount: ok })).toBe(null));
  it("la monture À terre, morte ou à 0 PV", () => {
    expect(bondBroken({ rider: ok, mount: { statuses: ["prone"], hp: 10 } })).toEqual({ who: "mount", status: "prone" });
    expect(bondBroken({ rider: ok, mount: { statuses: [], hp: 0 } })).toEqual({ who: "mount", status: "zeroHp" });
  });
  it("le cavalier Neutralisé ou Inconscient", () => {
    expect(bondBroken({ rider: { statuses: ["unconscious", "prone"], hp: 0 }, mount: ok })).toEqual({ who: "rider", status: "prone" });
    expect(bondBroken({ rider: { statuses: ["incapacitated"], hp: 3 }, mount: ok })).toEqual({ who: "rider", status: "incapacitated" });
  });
  it("Agrippé ou Effrayé ne font pas tomber", () => {
    expect(bondBreaker(["grappled", "frightened"])).toBe(null);
  });
});

describe("§490 : monture contrôlée et ordre", () => {
  const at = { rule: { rider: RIDER }, ridden: true, inCombat: true, activation: "action", basicAction: null, commandedRound: null, round: 3 };
  it("contrôlée par défaut ; indépendante sur demande", () => {
    expect(isControlled({})).toBe(true);
    expect(isControlled({ controlled: false })).toBe(false);
    expect(isControlled(null)).toBe(false);
  });
  it("sans ordre : une attaque demande l'ordre, Foncer / Se désengager / Esquiver non", () => {
    expect(needsCommand(at)).toBe(true);
    for ( const basicAction of MOUNT_FREE_ACTIONS ) expect(needsCommand({ ...at, basicAction })).toBe(false);
  });
  it("commandée à ce round : libre ; l'ordre d'un autre round ne compte pas", () => {
    expect(needsCommand({ ...at, commandedRound: 3 })).toBe(false);
    expect(needsCommand({ ...at, commandedRound: 2 })).toBe(true);
  });
  it("hors combat, sans cavalier, indépendante, ou pas une action : rien", () => {
    expect(needsCommand({ ...at, inCombat: false })).toBe(false);
    expect(needsCommand({ ...at, ridden: false })).toBe(false);
    expect(needsCommand({ ...at, rule: { controlled: false } })).toBe(false);
    expect(needsCommand({ ...at, activation: "bonus" })).toBe(false);
  });
  it("un son pour chaque geste, vu et entendu de tous", () => {
    for ( const action of ["mount", "dismount", "command"] ) expect(actionSound(action, "success")).toBeTruthy();
    expect(actionSound("thrown", "failure")).toBeTruthy();
  });
});
