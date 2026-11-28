import { describe, it, expect } from "vitest";
import { foldRiderStatuses, KEPT_RIDERS } from "../module/scripts/core/effect-riders.mjs";

const conditions = ["unconscious", "frightened", "prone", "poisoned", "incapacitated"];
const implied = { unconscious: ["incapacitated"] };

describe("§526 (#255): a condition requested as a rider ends with the effect", () => {
  it("Pseudodragon's Sting: Unconscious goes into the effect, with Incapacitated", () => {
    expect(foldRiderStatuses({ statuses: ["poisoned"], riders: ["unconscious"], conditions, implied }))
      .toEqual({ statuses: ["poisoned", "unconscious", "incapacitated"], riders: [], folded: ["unconscious"] });
  });
  it("a \"Frightened\" without its own condition: the condition goes into the effect", () => {
    expect(foldRiderStatuses({ statuses: [], riders: ["frightened"], conditions, implied }))
      .toEqual({ statuses: ["frightened"], riders: [], folded: ["frightened"] });
  });
  it("Prone stays a separate rider", () => {
    expect(KEPT_RIDERS).toContain("prone");
    expect(foldRiderStatuses({ statuses: [], riders: ["prone", "unconscious"], conditions, implied }).riders).toEqual(["prone"]);
  });
  it("a rider that is not a condition stays separate; nothing to do without a rider", () => {
    expect(foldRiderStatuses({ statuses: ["poisoned"], riders: ["burning"], conditions, implied }))
      .toEqual({ statuses: ["poisoned"], riders: ["burning"], folded: [] });
    expect(foldRiderStatuses()).toEqual({ statuses: [], riders: [], folded: [] });
  });
});
