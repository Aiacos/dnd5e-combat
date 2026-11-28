import { describe, it, expect, afterEach } from "vitest";
import { climbSystemOn, setClimbSystemState, whileClimbSystem } from "../module/scripts/core/climb-system.mjs";
import { SETTINGS_TABS } from "../module/scripts/core/settings-layout.mjs";
import { FEATURE_LEVELS } from "../module/scripts/core/levels.mjs";

describe("§224: switch of the climbing and falling system", () => {
  afterEach(() => setClimbSystemState(true));

  it("on by default; only `false` turns it off", () => {
    expect(climbSystemOn()).toBe(true);
    setClimbSystemState(false);
    expect(climbSystemOn()).toBe(false);
    setClimbSystemState(undefined);
    expect(climbSystemOn()).toBe(true);
  });

  it("off: no entry offered, and nothing is computed", () => {
    setClimbSystemState(false);
    let called = 0;
    const entries = whileClimbSystem(() => { called++; return [{ label: "Grimper au mur" }]; });
    expect(entries).toEqual([]);
    expect(called).toBe(0);
  });

  it("on: the entries as they are; the state can be passed explicitly", () => {
    expect(whileClimbSystem(() => ["a", "b"])).toEqual(["a", "b"]);
    expect(whileClimbSystem(() => ["a"], false)).toEqual([]);
    setClimbSystemState(false);
    expect(whileClimbSystem(() => ["a"], true)).toEqual(["a"]);
  });

  it("both settings are at the top of the Movement tab, and the switch exists at every automation level", () => {
    const movement = SETTINGS_TABS.find(t => t.id === "movement");
    expect(movement.keys.slice(0, 3)).toEqual(["climbSystem", "climbSystemButton", "altitude"]);
    expect(FEATURE_LEVELS.registerClimbSystem).toBe("essentials");
  });
});
