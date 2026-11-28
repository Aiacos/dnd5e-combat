/**
 * Issue #148: Scorching Ray at level 2, caster with Portent — two rays out of three are fired. The Portent gate suspends the
 * second ray to ask its question and relaunches it itself; the chain, which had received nothing from `activity.use()`,
 * stopped. It now reads the relaunch recorded here.
 */
import { describe, it, expect, vi } from "vitest";
import { suspendUse, suspendedUse } from "../module/scripts/runtime/suspended-uses.mjs";

describe("uses suspended by a gate", () => {
  it("nothing recorded: no relaunch to wait for", () => {
    expect(suspendedUse("Actor.a.Item.b.Activity.c")).toBe(null);
  });
  it("the recorded relaunch is read during the question, and returns the result with its card", async () => {
    let answer;
    const relaunch = new Promise(resolve => { answer = resolve; });
    suspendUse("act.1", relaunch);
    const read = suspendedUse("act.1");
    expect(read).not.toBe(null);
    answer({ message: { id: "m1" } });
    expect(await read).toEqual({ message: { id: "m1" } });
  });
  it("a use that does not go through (countered spell, interrupted relaunch): null, not an error", async () => {
    expect(await suspendUse("act.2", Promise.resolve(undefined))).toBe(null);
    expect(await suspendUse("act.3", Promise.resolve({}))).toBe(null);
    expect(await suspendUse("act.4", Promise.reject(new Error("interrompue")))).toBe(null);
  });
  it("still readable just after being settled, then forgotten", async () => {
    vi.useFakeTimers();
    const settled = suspendUse("act.5", Promise.resolve({ message: { id: "m5" } }));
    await settled;
    await Promise.resolve();
    expect(suspendedUse("act.5")).toBe(settled);
    vi.advanceTimersByTime(2500);
    expect(suspendedUse("act.5")).toBe(null);
    vi.useRealTimers();
  });
  it("a more recent relaunch of the same activity is not erased by forgetting the previous one", async () => {
    vi.useFakeTimers();
    const first = suspendUse("act.6", Promise.resolve({ message: { id: "a" } }));
    await first; await Promise.resolve();
    vi.advanceTimersByTime(1500);
    const second = suspendUse("act.6", new Promise(() => {}));
    vi.advanceTimersByTime(1000);
    expect(suspendedUse("act.6")).toBe(second);
    vi.useRealTimers();
  });
});
