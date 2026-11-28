/**
 * The wait for 3D dice is bounded (SPEC §12): an animation that does not play — window in the
 * background, rendering suspended — must never hold up a resolution.
 */
import { describe, it, expect } from "vitest";
import { createDiceWait, dice3dAnimation } from "../module/scripts/runtime/shared.mjs";

const never = () => new Promise(() => {});
const message = { id: "msg0000000000001" };

function setup({ animation, hidden=false, sleep=never, maxMs=8000 }) {
  const reports = [];
  const calls = [];
  const wait = createDiceWait({
    animation: id => { calls.push(id); return animation?.(id) ?? null; },
    isHidden: () => hidden,
    sleep,
    report: why => reports.push(why)
  }, maxMs);
  return { wait, reports, calls };
}

describe("waiting for 3D dice", () => {
  it("returns control at once without 3D dice, logging nothing", async () => {
    const { wait, reports } = setup({ animation: null });
    await wait(message);
    expect(reports).toEqual([]);
  });

  it("waits for the end of the animation when it arrives in time", async () => {
    let finish;
    const { wait, reports } = setup({ animation: () => new Promise(resolve => { finish = resolve; }) });
    let done = false;
    const waiting = wait(message).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(done).toBe(true);
    expect(reports).toEqual([]);
  });

  it("continues without the dice after the delay, and logs it", async () => {
    const { wait, reports } = setup({ animation: never, sleep: () => Promise.resolve(), maxMs: 8000 });
    await wait(message);
    expect(reports).toEqual(["over 8000 ms"]);
  });

  it("does not wait at all when the window is in the background: the animation is not even requested", async () => {
    const { wait, reports, calls } = setup({ animation: never, hidden: true });
    await wait(message);
    expect(calls).toEqual([]);
    expect(reports).toEqual(["window in the background"]);
  });

  it("queries 3D dice with the message identifier", async () => {
    const { wait, calls } = setup({ animation: () => Promise.resolve() });
    await wait(message);
    expect(calls).toEqual(["msg0000000000001"]);
  });
});

// #286: Dicer provides Dice So Nice's `game.dice3d` API while the `dice-so-nice` module is off. The wait follows the API, not the id.
describe("3D dice API, whichever module provides it", () => {
  it("waits through game.dice3d with no dice-so-nice module (Dicer)", async () => {
    let finish;
    const asked = [];
    const dice3d = { waitFor3DAnimationByMessageID: id => { asked.push(id); return new Promise(resolve => { finish = resolve; }); } };
    const wait = createDiceWait({ animation: dice3dAnimation(dice3d), isHidden: () => false, sleep: never });
    let done = false;
    const waiting = wait(message).then(() => { done = true; });
    await Promise.resolve();
    expect(asked).toEqual(["msg0000000000001"]);
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(done).toBe(true);
  });

  it("does not wait when there is no game.dice3d", () => {
    expect(dice3dAnimation(undefined)(message.id)).toBeNull();
  });

  it("does not wait when game.dice3d lacks the wait function", () => {
    expect(dice3dAnimation({})(message.id)).toBeNull();
  });
});
