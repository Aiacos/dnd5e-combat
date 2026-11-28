import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { bondBreaker, bondBroken, isControlled, mountProblem, needsCommand, riderSeat, MOUNT_FREE_ACTIONS }
  from "../module/scripts/core/mount.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

const RIDER = "riderActor000001";

describe("§490 (B08): schema of `mount` and `commands`", () => {
  it("accepts the documented forms", () => {
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
  it("the dry refusals first: not a mount, already in the saddle, already mounted", () => {
    expect(mountProblem({ ...base, rule: null })).toBe("notMount");
    expect(mountProblem({ ...base, riding: true })).toBe("riding");
    expect(mountProblem({ ...base, alreadyRidden: true })).toBe("ridden");
  });
  it("a reserved mount refuses another rider, even a smaller one", () => {
    expect(mountProblem({ ...base, riderActorIds: ["someoneElse00001"], riderSize: "sm" })).toBe("notRider");
  });
  it("with no designated rider: an allied creature at least one size smaller", () => {
    const open = { ...base, rule: {}, riderActorIds: [] };
    expect(mountProblem(open)).toBe(null);
    expect(mountProblem({ ...open, mountSize: "med" })).toBe("tooBig");
    expect(mountProblem({ ...open, enemies: true })).toBe("enemy");
  });
  it("neither Prone nor Incapacitated; in contact", () => {
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
  it("the mount Prone, dead or at 0 HP", () => {
    expect(bondBroken({ rider: ok, mount: { statuses: ["prone"], hp: 10 } })).toEqual({ who: "mount", status: "prone" });
    expect(bondBroken({ rider: ok, mount: { statuses: [], hp: 0 } })).toEqual({ who: "mount", status: "zeroHp" });
  });
  it("the rider Incapacitated or Unconscious", () => {
    expect(bondBroken({ rider: { statuses: ["unconscious", "prone"], hp: 0 }, mount: ok })).toEqual({ who: "rider", status: "prone" });
    expect(bondBroken({ rider: { statuses: ["incapacitated"], hp: 3 }, mount: ok })).toEqual({ who: "rider", status: "incapacitated" });
  });
  it("Grappled or Frightened do not make it fall", () => {
    expect(bondBreaker(["grappled", "frightened"])).toBe(null);
  });
});

describe("§490: controlled mount and command", () => {
  const at = { rule: { rider: RIDER }, ridden: true, inCombat: true, activation: "action", basicAction: null, commandedRound: null, round: 3 };
  it("controlled by default; independent on request", () => {
    expect(isControlled({})).toBe(true);
    expect(isControlled({ controlled: false })).toBe(false);
    expect(isControlled(null)).toBe(false);
  });
  it("without a command: an attack requires the command, Dash / Disengage / Dodge do not", () => {
    expect(needsCommand(at)).toBe(true);
    for ( const basicAction of MOUNT_FREE_ACTIONS ) expect(needsCommand({ ...at, basicAction })).toBe(false);
  });
  it("commanded this round: free; a command from another round does not count", () => {
    expect(needsCommand({ ...at, commandedRound: 3 })).toBe(false);
    expect(needsCommand({ ...at, commandedRound: 2 })).toBe(true);
  });
  it("outside combat, without a rider, independent, or not an action: nothing", () => {
    expect(needsCommand({ ...at, inCombat: false })).toBe(false);
    expect(needsCommand({ ...at, ridden: false })).toBe(false);
    expect(needsCommand({ ...at, rule: { controlled: false } })).toBe(false);
    expect(needsCommand({ ...at, activation: "bonus" })).toBe(false);
  });
  it("a sound for each gesture, seen and heard by everyone", () => {
    for ( const action of ["mount", "dismount", "command"] ) expect(actionSound(action, "success")).toBeTruthy();
    expect(actionSound("thrown", "failure")).toBeTruthy();
  });
});
