import { describe, it, expect } from "vitest";
import { createWindowLine } from "../module/scripts/core/window-line.mjs";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("§401: a station's window queue", () => {
  it("a window waits for the previous one to close", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });   // pas de plafond
    const opened = [];
    let closeFirst;
    const first = inLine(() => { opened.push("A"); return new Promise(r => { closeFirst = r; }); });
    const second = inLine(async () => { opened.push("B"); return "b"; });
    await tick(); await tick();
    expect(opened).toEqual(["A"]);
    closeFirst("a");
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(opened).toEqual(["A", "B"]);
  });

  it("three windows open in the order in which they were requested", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const order = [];
    const slow = name => () => new Promise(r => setTimeout(() => { order.push(name); r(name); }, 5));
    await Promise.all([inLine(slow("A")), inLine(slow("B")), inLine(slow("C"))]);
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("at the end of the ceiling, the window opens even if the previous one stays open", async () => {
    let fire;
    const inLine = createWindowLine({ wait: () => new Promise(r => { fire = r; }) });
    inLine(() => new Promise(() => {}));   // never closed
    const opened = [];
    const second = inLine(async () => { opened.push("B"); return "b"; });
    await tick();
    expect(opened).toEqual([]);
    fire();
    expect(await second).toBe("b");
  });

  it("an entry never closed only delays the window that follows it, not all the following ones", async () => {
    const fires = [];
    const inLine = createWindowLine({ wait: () => new Promise(r => { fires.push(r); }) });
    inLine(() => new Promise(() => {}), "fuite");
    const opened = [];
    const second = inLine(async () => { opened.push("B"); return "b"; }, "B");
    const third = inLine(async () => { opened.push("C"); return "c"; }, "C");
    await tick();
    expect(opened).toEqual([]);
    fires[1]();   // B's ceiling (fires[0]: the leak's, behind an empty queue)
    expect(await second).toBe("b");
    expect(await third).toBe("c");   // C only waits for B, not the leak
    expect(inLine.state().map(e => e.label)).toEqual(["fuite"]);
  });

  it("a window that fails frees the next one", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const first = inLine(async () => { throw new Error("fermée"); });
    const second = inLine(async () => "b");
    await expect(first).rejects.toThrow("fermée");
    expect(await second).toBe("b");
  });
});
