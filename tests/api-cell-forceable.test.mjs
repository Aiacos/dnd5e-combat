/**
 * Issue #46 : `api.ui.cell(activity).forceable` suit le réglage « Action impossible » (`refusalMode`, §417). En refus strict, un joueur
 * lit les raisons mais ne peut pas passer outre : une interface (Combat UI) peut alors montrer un cadenas au lieu d'un simple gris.
 * Le MJ garde la main ; dans les autres modes, rien ne change (`forceable` reste vrai).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Le contrôle de légalité et les zones déplaçables sont remplacés : seul le lien entre le réglage et `forceable` est testé ici.
vi.mock("../module/scripts/runtime/turn.mjs", async importOriginal => ({
  ...(await importOriginal()), useIssues: () => ({ lines: ["Hors de portée"], request: { cost: "action" } })
}));
vi.mock("../module/scripts/runtime/zones.mjs", async importOriginal => ({ ...(await importOriginal()), movableZoneOf: () => null }));

let cell;
let mode = "level";
let isGM = false;

beforeAll(async () => {
  const same = fn => fn;
  globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
  globalThis.foundry = { utils: { throttle: same, debounce: same, isNewerVersion: () => false } };
  globalThis.CONFIG = { queries: {}, DND5E: { statusEffects: {} } };
  globalThis.game = {
    modules: { get: () => null }, system: { version: "6.0.3" }, users: {},
    settings: { register() {}, get: (ns, key) => ((key === "refusalMode") ? mode : undefined) },
    get user() { return { isGM }; }
  };
  ({ uiApi: { cell } } = await import("../module/scripts/ui/api.mjs"));
}, 60000);

const activity = { actor: {}, item: {} };
const forceableFor = (m, gm) => { mode = m; isGM = gm; return cell(activity).forceable; };

describe("api.ui.cell — forceable suit le réglage « Action impossible » (issue #46)", () => {
  beforeEach(() => { mode = "level"; isGM = false; });

  it("par défaut et avec la fenêtre : celui qui agit peut passer outre", () => {
    for ( const m of ["level", "window"] ) {
      expect(forceableFor(m, false)).toBe(true);
      expect(forceableFor(m, true)).toBe(true);
    }
  });

  it("refus strict : un joueur ne peut pas passer outre, le MJ garde la main", () => {
    expect(forceableFor("strict", false)).toBe(false);
    expect(forceableFor("strict", true)).toBe(true);
  });

  it("simple avertissement, aucun contrôle : l'action part, rien n'est verrouillé", () => {
    for ( const m of ["notice", "off"] ) expect(forceableFor(m, false)).toBe(true);
  });

  it("les raisons et le coût restent ceux du contrôle de légalité, quel que soit le réglage", () => {
    mode = "strict";
    expect(cell(activity)).toMatchObject({ issues: ["Hors de portée"], cost: "action", resources: true });
  });
});
