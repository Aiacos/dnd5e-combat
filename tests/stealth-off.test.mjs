import { describe, it, expect, afterEach } from "vitest";
import "../module/scripts/adapter/content.mjs";   // ordre des imports circulaires des adaptateurs

const { stealthRules, isHidden } = await import("../module/scripts/adapter/stealth.mjs");

/**
 * Issue #65: an "off" choice for the `stealthRules` setting — the engine does not handle Stealth (narrative table). Nobody is
 * Hidden for it, even a token that still carries a Stealth effect applied before the setting changed.
 */
const withRules = value => {
  globalThis.game = { settings: { get: (module, key) => {
    if ( (module === "dnd5e-combat") && (key === "stealthRules") ) return value;
    throw new Error(`setting ${module}.${key} not registered`);
  } } };
};
const hiddenActor = () => ({ effects: [{ disabled: false, getFlag: (scope, key) => ((scope === "dnd5e-combat") && (key === "hidden")) ? { dc: 15 } : undefined }] });

describe("Stealth not handled (issue #65)", () => {
  afterEach(() => { delete globalThis.game; });

  it("the setting returns \"off\", \"bg3\" or \"2024\"; an unknown value or a missing setting means 2024", () => {
    withRules("off");
    expect(stealthRules()).toBe("off");
    withRules("bg3");
    expect(stealthRules()).toBe("bg3");
    withRules("autre");
    expect(stealthRules()).toBe("2024");
    delete globalThis.game;
    expect(stealthRules()).toBe("2024");
  });

  it("\"off\": an actor carrying the Stealth effect is not Hidden for the engine", () => {
    withRules("off");
    expect(isHidden({ actor: hiddenActor() })).toBe(false);
  });

  it("2024 and BG3: the same actor is Hidden", () => {
    withRules("2024");
    expect(isHidden({ actor: hiddenActor() })).toBe(true);
    withRules("bg3");
    expect(isHidden({ actor: hiddenActor() })).toBe(true);
  });
});
