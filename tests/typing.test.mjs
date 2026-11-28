/**
 * During targeting, the engine listens to the document keyboard (Enter: cast the group spell; Escape: cancel). A key
 * typed in an input field stays with the field — seen in play: Enter in the chat did not post the message and cast the spell.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { typingIn } from "../module/scripts/core/typing.mjs";

describe("typingIn — is the target of a key an input field", () => {
  it("the chat editor (editable content), a text area, a list, a text field: yes", () => {
    expect(typingIn({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(typingIn({ tagName: "TEXTAREA" })).toBe(true);
    expect(typingIn({ tagName: "SELECT" })).toBe(true);
    expect(typingIn({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(typingIn({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(typingIn({ tagName: "input" })).toBe(true);
  });
  it("the canvas, a button, a checkbox: no", () => {
    expect(typingIn({ tagName: "CANVAS" })).toBe(false);
    expect(typingIn({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(typingIn({ tagName: "BUTTON" })).toBe(false);
    expect(typingIn({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(typingIn({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(typingIn(null)).toBe(false);
    expect(typingIn({})).toBe(false);
  });
});

describe("targeting does not take the keys of an input field", () => {
  it("`onKeyDown` yields before reading Enter or Escape", () => {
    const source = readFileSync(new URL("../module/scripts/ui/pointer-mouse.mjs", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("export function onKeyDown(event) {"));
    expect(body.indexOf("if ( typingIn(event.target) ) return;")).toBeGreaterThan(0);
    expect(body.indexOf("if ( typingIn(event.target) ) return;")).toBeLessThan(body.indexOf('event.key === "Enter"'));
  });
});
