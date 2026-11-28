/**
 * Card in rows (`chatRows`): the card of a settled action loses dnd5e's roll buttons and its effects drawer; that
 * of a cancelled action keeps them — the GM may want to reroll. And its tooltips are text, never reread as HTML.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { settled, STEPS } from "../module/scripts/core/action.mjs";

describe("settled — the action is settled for good", () => {
  it("finished or missed: yes", () => {
    expect(settled(STEPS.DONE)).toBe(true);
    expect(settled(STEPS.MISSED)).toBe(true);
  });
  it("cancelled, or still in progress: no", () => {
    for ( const step of [STEPS.UNDONE, STEPS.AWAITING_ATTACK, STEPS.AWAITING_REACTION, STEPS.AWAITING_ROLLS, undefined] ) {
      expect(settled(step), String(step)).toBe(false);
    }
  });
});

describe("the card in rows", () => {
  const source = readFileSync(new URL("../module/scripts/ui/chat.mjs", import.meta.url), "utf8");
  it("is pruned only for a settled action", () => {
    expect(source).toMatch(/rowsEnabled\(\) && settled\(step\) \) trimCard\(/);
    expect(source).not.toMatch(/STEPS\.UNDONE\]\.includes\(step\) \) trimCard/);
  });
  it("sets its row and saving throw tooltips as text (`tooltipText`)", () => {
    expect(source).toMatch(/li\.dataset\.tooltipText = line\.detail/);
    expect(source).toMatch(/total\.dataset\.tooltipText = /);
    expect(source).not.toMatch(/li\.dataset\.tooltip = line\.detail/);
    expect(source).not.toMatch(/total\.dataset\.tooltip = /);
  });
});
