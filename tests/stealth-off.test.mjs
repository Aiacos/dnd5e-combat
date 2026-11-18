import { describe, it, expect, afterEach } from "vitest";
import "../module/scripts/adapter/content.mjs";   // ordre des imports circulaires des adaptateurs

const { stealthRules, isHidden } = await import("../module/scripts/adapter/stealth.mjs");

/**
 * Issue #65 : un choix « off » pour le réglage `stealthRules` — le moteur ne gère pas la Furtivité (table narrative). Personne n'est
 * caché pour lui, même un token qui porte encore un effet de Furtivité posé avant le changement de réglage.
 */
const withRules = value => {
  globalThis.game = { settings: { get: (module, key) => {
    if ( (module === "dnd5e-combat") && (key === "stealthRules") ) return value;
    throw new Error(`setting ${module}.${key} not registered`);
  } } };
};
const hiddenActor = () => ({ effects: [{ disabled: false, getFlag: (scope, key) => ((scope === "dnd5e-combat") && (key === "hidden")) ? { dc: 15 } : undefined }] });

describe("Furtivité non gérée (issue #65)", () => {
  afterEach(() => { delete globalThis.game; });

  it("le réglage rend « off », « bg3 » ou « 2024 » ; une valeur inconnue ou un réglage absent valent 2024", () => {
    withRules("off");
    expect(stealthRules()).toBe("off");
    withRules("bg3");
    expect(stealthRules()).toBe("bg3");
    withRules("autre");
    expect(stealthRules()).toBe("2024");
    delete globalThis.game;
    expect(stealthRules()).toBe("2024");
  });

  it("« off » : un acteur qui porte l'effet de Furtivité n'est pas caché pour le moteur", () => {
    withRules("off");
    expect(isHidden({ actor: hiddenActor() })).toBe(false);
  });

  it("2024 et BG3 : le même acteur est caché", () => {
    withRules("2024");
    expect(isHidden({ actor: hiddenActor() })).toBe(true);
    withRules("bg3");
    expect(isHidden({ actor: hiddenActor() })).toBe(true);
  });
});
