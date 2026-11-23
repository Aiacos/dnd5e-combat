import { describe, it, expect } from "vitest";
import { foldRiderStatuses, KEPT_RIDERS } from "../module/scripts/core/effect-riders.mjs";

const conditions = ["unconscious", "frightened", "prone", "poisoned", "incapacitated"];
const implied = { unconscious: ["incapacitated"] };

describe("§526 (#255) : un état de condition demandé en cavalier finit avec l'effet", () => {
  it("Dard du pseudodragon : Inconscient passe dans l'effet, avec Neutralisé", () => {
    expect(foldRiderStatuses({ statuses: ["poisoned"], riders: ["unconscious"], conditions, implied }))
      .toEqual({ statuses: ["poisoned", "unconscious", "incapacitated"], riders: [], folded: ["unconscious"] });
  });
  it("un « Frightened » sans état propre : l'état passe dans l'effet", () => {
    expect(foldRiderStatuses({ statuses: [], riders: ["frightened"], conditions, implied }))
      .toEqual({ statuses: ["frightened"], riders: [], folded: ["frightened"] });
  });
  it("À terre reste un cavalier à part", () => {
    expect(KEPT_RIDERS).toContain("prone");
    expect(foldRiderStatuses({ statuses: [], riders: ["prone", "unconscious"], conditions, implied }).riders).toEqual(["prone"]);
  });
  it("un cavalier qui n'est pas une condition reste à part ; rien à faire sans cavalier", () => {
    expect(foldRiderStatuses({ statuses: ["poisoned"], riders: ["burning"], conditions, implied }))
      .toEqual({ statuses: ["poisoned"], riders: ["burning"], folded: [] });
    expect(foldRiderStatuses()).toEqual({ statuses: [], riders: [], folded: [] });
  });
});
