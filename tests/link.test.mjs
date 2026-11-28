import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Does the module LINK under Node as in the browser? Vitest transforms the files and lets through what a browser refuses at
 * import (on 2026-09-28: a duplicate `import { ROGUE }` in content/index.mjs — the engine no longer loaded for the GM, all
 * tests passed). Outside Foundry, the import stops at the first missing global (`foundry`, `Hooks`…): that is
 * expected; a SyntaxError or a missing export is not.
 */
describe("liaison du module", () => {
  it("dnd5e-combat.mjs se lie sans erreur de syntaxe ni d'export", () => {
    const entry = fileURLToPath(new URL("../module/scripts/dnd5e-combat.mjs", import.meta.url)).replace(/\\/g, "/");
    const out = execFileSync(process.execPath, ["-e",
      `import(${JSON.stringify("file:///" + entry.replace(/^\//, ""))}).then(() => console.log("ok"), e => console.log(e.name + ": " + e.message))`],
      { encoding: "utf8" }).trim();
    expect(out).not.toMatch(/^SyntaxError/);
    expect(out === "ok" || /^ReferenceError: (foundry|Hooks|game|CONFIG|canvas) is not defined/.test(out)).toBe(true);
  });
});
