import { describe, it, expect } from "vitest";
import { offersReaction, REACTION_MODES, damageDialog, criticalButtonLocked, damageSteps as steps } from "../module/scripts/core/flow.mjs";

// §418 : le réglage « Réactions » du cadre « Déroulement ».
describe("offersReaction", () => {
  it("par défaut et « selon le niveau » : proposée à chacun", () => {
    for ( const mode of ["level", "ask", undefined, "inconnu"] ) {
      expect(offersReaction(mode, { playerOwned: true })).toBe(true);
      expect(offersReaction(mode, { playerOwned: false })).toBe(true);
    }
  });
  it("aux joueurs seulement : pas pour une créature du MJ", () => {
    expect(offersReaction("players", { playerOwned: true })).toBe(true);
    expect(offersReaction("players", { playerOwned: false })).toBe(false);
    expect(offersReaction("players")).toBe(false);
  });
  it("jamais : pour personne", () => {
    expect(offersReaction("off", { playerOwned: true })).toBe(false);
    expect(offersReaction("off", { playerOwned: false })).toBe(false);
  });
  it("quatre modes, « level » en tête (le défaut)", () => {
    expect(REACTION_MODES).toEqual(["level", "ask", "players", "off"]);
  });
});

// §419 : le réglage « Dégâts ».
describe("damageSteps", async () => {
  const { damageSteps, DAMAGE_MODES } = await import("../module/scripts/core/flow.mjs");
  it("par défaut et « selon le niveau » : ni clic ni validation", () => {
    for ( const mode of ["level", "auto", undefined, "inconnu"] ) expect(damageSteps(mode)).toEqual({ click: false, validate: false });
  });
  it("au clic, validés, ou les deux", () => {
    expect(damageSteps("click")).toEqual({ click: true, validate: false });
    expect(damageSteps("validate")).toEqual({ click: false, validate: true });
    expect(damageSteps("clickValidate")).toEqual({ click: true, validate: true });
  });
  it("§524 (#173) : au clic pour les joueurs — un joueur clique, les créatures du MJ restent automatiques", () => {
    expect(damageSteps("clickPlayers", { playerAuthor: true })).toEqual({ click: true, validate: false });
    expect(damageSteps("clickPlayers", { playerAuthor: false })).toEqual({ click: false, validate: false });
    expect(damageSteps("clickPlayers")).toEqual({ click: false, validate: false });
  });
  it("§524 : la même chose validée par le MJ — la validation vaut pour tous", () => {
    expect(damageSteps("clickPlayersValidate", { playerAuthor: true })).toEqual({ click: true, validate: true });
    expect(damageSteps("clickPlayersValidate", { playerAuthor: false })).toEqual({ click: false, validate: true });
  });
  it("« au clic » pour tous ne dépend pas de l'auteur", () => {
    expect(damageSteps("click", { playerAuthor: false })).toEqual({ click: true, validate: false });
  });
  it("sept modes, « level » en tête (le défaut)", () => {
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
