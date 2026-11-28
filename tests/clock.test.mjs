import { describe, it, expect } from "vitest";
import { clockHalt, clockTick, rivalClock, CLOCK_STEP_SECONDS } from "../module/scripts/core/clock.mjs";

describe("§251: real-time clock out of combat", () => {
  const on = { enabled: true, executor: true, rival: null, paused: false, inCombat: false };
  it("runs when nothing stops it", () => expect(clockHalt(on)).toBe(null));
  it("cut by the setting", () => expect(clockHalt({ ...on, enabled: false })).toBe("off"));
  it("seul le MJ actif l'avance", () => expect(clockHalt({ ...on, executor: false })).toBe("notExecutor"));
  it("s'efface devant un module d'horloge", () => expect(clockHalt({ ...on, rival: "simple-timekeeping" })).toBe("rival"));
  it("stopped during the pause", () => expect(clockHalt({ ...on, paused: true })).toBe("paused"));
  it("stopped in combat", () => expect(clockHalt({ ...on, inCombat: true })).toBe("combat"));

  it("repart de maintenant", () => expect(clockTick(null, 5000)).toEqual({ advance: 0, counted: 5000 }));
  it("under one step: nothing, counted time does not move", () => expect(clockTick(0, 4999)).toEqual({ advance: 0, counted: 0 }));
  it("one step elapsed: advances whole seconds, the rest waits", () =>
    expect(clockTick(0, 6500)).toEqual({ advance: 6, counted: 6000 }));
  it("a gap that is too large (sleep mode): a single step", () =>
    expect(clockTick(0, 3600000)).toEqual({ advance: CLOCK_STEP_SECONDS, counted: 3600000 }));
  it("real clock gone backwards: restarts", () => expect(clockTick(10000, 5000)).toEqual({ advance: 0, counted: 5000 }));

  it("recognizes an active clock module", () => {
    expect(rivalClock(id => id === "calendaria")).toBe("calendaria");
    expect(rivalClock(() => false)).toBe(null);
  });
});
