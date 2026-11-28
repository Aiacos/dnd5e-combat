import { describe, it, expect } from "vitest";
import { offersReaction, REACTION_MODES, damageDialog, criticalButtonLocked, damageSteps as steps } from "../module/scripts/core/flow.mjs";

// §418: the "Reactions" setting of the "Flow" frame.
describe("offersReaction", () => {
  it("by default and \"by level\": offered to everyone", () => {
    for ( const mode of ["level", "ask", undefined, "inconnu"] ) {
      expect(offersReaction(mode, { playerOwned: true })).toBe(true);
      expect(offersReaction(mode, { playerOwned: false })).toBe(true);
    }
  });
  it("players only: not for a GM creature", () => {
    expect(offersReaction("players", { playerOwned: true })).toBe(true);
    expect(offersReaction("players", { playerOwned: false })).toBe(false);
    expect(offersReaction("players")).toBe(false);
  });
  it("jamais : pour personne", () => {
    expect(offersReaction("off", { playerOwned: true })).toBe(false);
    expect(offersReaction("off", { playerOwned: false })).toBe(false);
  });
  it("four modes, \"level\" first (the default)", () => {
    expect(REACTION_MODES).toEqual(["level", "ask", "players", "off"]);
  });
});

// §419: the "Damage" setting.
describe("damageSteps", async () => {
  const { damageSteps, DAMAGE_MODES } = await import("../module/scripts/core/flow.mjs");
  it("by default and \"by level\": neither click nor validation", () => {
    for ( const mode of ["level", "auto", undefined, "inconnu"] ) expect(damageSteps(mode)).toEqual({ click: false, validate: false });
  });
  it("on click, validated, or both", () => {
    expect(damageSteps("click")).toEqual({ click: true, validate: false });
    expect(damageSteps("validate")).toEqual({ click: false, validate: true });
    expect(damageSteps("clickValidate")).toEqual({ click: true, validate: true });
  });
  it("§524 (#173): on click for players — a player clicks, the GM's creatures stay automatic", () => {
    expect(damageSteps("clickPlayers", { playerAuthor: true })).toEqual({ click: true, validate: false });
    expect(damageSteps("clickPlayers", { playerAuthor: false })).toEqual({ click: false, validate: false });
    expect(damageSteps("clickPlayers")).toEqual({ click: false, validate: false });
  });
  it("§524: the same thing validated by the GM — the validation holds for everyone", () => {
    expect(damageSteps("clickPlayersValidate", { playerAuthor: true })).toEqual({ click: true, validate: true });
    expect(damageSteps("clickPlayersValidate", { playerAuthor: false })).toEqual({ click: false, validate: true });
  });
  it("\"on click\" for everyone does not depend on the author", () => {
    expect(damageSteps("click", { playerAuthor: false })).toEqual({ click: true, validate: false });
  });
  it("seven modes, \"level\" first (the default)", () => {
    expect(DAMAGE_MODES).toEqual(["level", "auto", "click", "validate", "clickValidate", "clickPlayers", "clickPlayersValidate"]);
  });
});

// #173 (§556): dnd5e's damage dialog for the damage the engine rolls.
describe("damageDialog", () => {
  it("required when the setting asks the author to roll, offered otherwise", () => {
    expect(damageDialog(steps("click"))).toBe("required");
    expect(damageDialog(steps("clickPlayers", { playerAuthor: true }))).toBe("required");
    expect(damageDialog(steps("clickPlayers", { playerAuthor: false }))).toBe("offered");
    expect(damageDialog(steps("level"))).toBe("offered");
    expect(damageDialog(steps("validate"))).toBe("offered");
    expect(damageDialog(undefined)).toBe("offered");
  });
});

describe("criticalButtonLocked", () => {
  it("free when the engine settled nothing else", () => {
    expect(criticalButtonLocked({})).toBe(false);
    expect(criticalButtonLocked()).toBe(false);
    expect(criticalButtonLocked({ dialog: "required", damageType: "fire" })).toBe(false);
  });
  it("locked by critical dice apart (#269), a critical table (§207) or a target that cannot be critically hit", () => {
    expect(criticalButtonLocked({ criticalExtra: { tokens: ["a"] } })).toBe(true);
    expect(criticalButtonLocked({ criticalHit: "table" })).toBe(true);
    expect(criticalButtonLocked({ noCritical: true })).toBe(true);
  });
});
