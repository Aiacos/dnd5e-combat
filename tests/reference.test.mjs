/**
 * The generated reference (`docs/reference/`) follows the code: public API, hooks, settings, content, scenarios, and
 * `surface.json` (the neighbors' contract). An API function, hook, setting or scenario added, renamed or removed without
 * regenerating fails this test: `npm run reference`, review the diff (an API path or hook that disappears from `surface.json`
 * may break a neighboring module), commit.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build, undocumented, REFERENCE_DIR } from "../tools/lib/reference.mjs";

// The first `build()` loads the whole module: 11 to 13 s in the full `npm test` pass on this PC (measured on
// 2026-11-11, against 5 to 7 s alone). Same timeout and same reason as `load.test.mjs`.
const LOAD_TIMEOUT = 60000;

describe("generated reference", () => {
  it("docs/reference/ is up to date (if not: npm run reference)", async () => {
    const pages = await build();
    const stale = Object.entries(pages)
      .filter(([name, text]) => !existsSync(join(REFERENCE_DIR, name)) || (readFileSync(join(REFERENCE_DIR, name), "utf8") !== text))
      .map(([name]) => name);
    expect(stale, "pages à régénérer par `npm run reference`").toEqual([]);
  }, LOAD_TIMEOUT);

  it("every emitted hook is named (no unresolved name)", async () => {
    const pages = await build();
    expect(pages["HOOKS.md"]).not.toMatch(/Non résolus/);
  }, LOAD_TIMEOUT);

  // The API.md and HOOKS.md pages are what neighboring modules and pack authors read: an empty cell sends them back to the code.
  // The `api.mcp` group (test functions called by the connector) is counted like the rest: it is public too (a scenario, or a
  // neighbor that tests through the connector calls it), and a comment line costs less than an exception to maintain.
  it("every public API function and every emitted hook has a description", async () => {
    const { api, hooks } = await undocumented();
    expect(api.map(g => `${g.path} (${g.file || "fichier introuvable"})`),
      "fonctions d'API sans description : écrire un commentaire /** … */ juste avant leur définition (une fonction écrite en ligne dans "
      + "un objet prend une ligne à elle, son commentaire juste au-dessus ; la première phrase doit suffire), puis `npm run reference`").toEqual([]);
    expect(hooks.map(g => `${g.name} (${g.files.join(", ")})`),
      "hooks émis sans description : écrire un commentaire juste avant la constante qui nomme le hook, sinon juste avant la ligne "
      + "`Hooks.call…` (quand il part, sur quel client, ses arguments, l'effet de `false` s'il est annulable), puis `npm run reference`").toEqual([]);
  }, LOAD_TIMEOUT);
});
