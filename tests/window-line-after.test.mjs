import { describe, it, expect } from "vitest";
import { createWindowLine } from "../module/scripts/core/window-line.mjs";

const tick = () => new Promise(r => setTimeout(r, 0));

// §422: a window without delay (a refusal) goes after the current question, without holding back the next ones; the "then" counter.
describe("§422: go after the current window, count those that are waiting", () => {
  it("`after` waits for the open window before opening", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });   // pas de plafond
    const opened = [];
    let closeFirst;
    inLine(() => { opened.push("question"); return new Promise(r => { closeFirst = r; }); });
    const refusal = inLine.after(async () => { opened.push("refus"); return "ok"; });
    await tick();
    expect(opened).toEqual(["question"]);
    closeFirst();
    expect(await refusal).toBe("ok");
    expect(opened).toEqual(["question", "refus"]);
  });

  it("`after` does not hold back the following questions: they do not wait for it to close", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const opened = [];
    inLine.after(() => { opened.push("refus"); return new Promise(() => {}); });   // never closed
    const question = inLine(async () => { opened.push("question"); return "q"; });
    expect(await question).toBe("q");
    expect(opened).toEqual(["refus", "question"]);
  });

  it("with nothing open, `after` opens right away", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    expect(await inLine.after(async () => "tout de suite")).toBe("tout de suite");
  });

  it("`waiting` counts the windows that do not have their turn yet", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    let closeFirst;
    const first = inLine(() => new Promise(r => { closeFirst = r; }));
    const second = inLine(async () => "b");
    const third = inLine(async () => "c");
    await tick();
    expect(inLine.waiting()).toBe(2);
    closeFirst();
    await Promise.all([first, second, third]);
    expect(inLine.waiting()).toBe(0);
  });
});
