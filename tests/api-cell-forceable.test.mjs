/**
 * Issue #46: `api.ui.cell(activity).forceable` follows the "Impossible action" setting (`refusalMode`, §417). Under strict
 * refusal, a player reads the reasons but cannot override: an interface (Combat UI) can then show a padlock instead of plain grey.
 * The GM keeps control; in the other modes, nothing changes (`forceable` stays true).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// The legality check and the movable areas are replaced: only the link between the setting and `forceable` is tested here.
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

describe("api.ui.cell — forceable follows the \"Impossible action\" setting (issue #46)", () => {
  beforeEach(() => { mode = "level"; isGM = false; });

  it("by default and with the window: the creature that acts can override", () => {
    for ( const m of ["level", "window"] ) {
      expect(forceableFor(m, false)).toBe(true);
      expect(forceableFor(m, true)).toBe(true);
    }
  });

  it("strict refusal: a player cannot override, the GM keeps control", () => {
    expect(forceableFor("strict", false)).toBe(false);
    expect(forceableFor("strict", true)).toBe(true);
  });

  it("simple warning, no check: the action goes through, nothing is locked", () => {
    for ( const m of ["notice", "off"] ) expect(forceableFor(m, false)).toBe(true);
  });

  it("the reasons and the cost stay those of the legality check, whatever the setting", () => {
    mode = "strict";
    expect(cell(activity)).toMatchObject({ issues: ["Hors de portée"], cost: "action", resources: true });
  });
});
