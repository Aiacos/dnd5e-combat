import { describe, it, expect } from "vitest";
import { createCanvasWait } from "../module/scripts/runtime/shared.mjs";

/** A canvas that becomes ready after `after` simulated milliseconds. */
function fakeCanvas(after) {
  let now = 0;
  return {
    ports: { isReady: () => now >= after, sleep: async ms => { now += ms; } },
    elapsed: () => now
  };
}

describe("canvas wait (redraw after a level change)", () => {
  it("already ready: no wait", async () => {
    const c = fakeCanvas(0);
    expect(await createCanvasWait(c.ports)()).toBe(true);
    expect(c.elapsed()).toBe(0);
  });

  it("being redrawn: waits until it is ready", async () => {
    const c = fakeCanvas(300);
    expect(await createCanvasWait(c.ports, 5000, 50)()).toBe(true);
    expect(c.elapsed()).toBe(300);
  });

  it("never ready: gives control back at the end of the timeout, and says so", async () => {
    const c = fakeCanvas(Infinity);
    expect(await createCanvasWait(c.ports, 500, 50)()).toBe(false);
    expect(c.elapsed()).toBe(500);
  });
});
