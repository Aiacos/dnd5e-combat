import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enqueue } from "../module/scripts/runtime/queue.mjs";

/**
 * The per-key queue runs tasks in series; a task that fails does not block the following ones. Its error, however, must not
 * disappear: whoever awaits the promise receives it, and when nobody awaits it (a router registrant that does not return the
 * promise), it remains a rejected promise with no handler — which the console and the debugger report.
 */
describe("per-key queue", () => {
  it("tasks of the same key run one after the other, in order", async () => {
    const seen = [];
    const slow = enqueue("ordre", async () => { await new Promise(r => setTimeout(r, 10)); seen.push("a"); return 1; });
    const fast = enqueue("ordre", async () => { seen.push("b"); return 2; });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("a task that fails: its error returns to whoever awaits it, the next one runs anyway", async () => {
    const failed = enqueue("echec", async () => { throw new Error("écriture refusée"); });
    const after = enqueue("echec", async () => "suite");
    await expect(failed).rejects.toThrow("écriture refusée");
    expect(await after).toBe("suite");
  });

  it("a task that fails when nobody awaits its promise: the error is not swallowed", () => {
    const queue = fileURLToPath(new URL("../module/scripts/runtime/queue.mjs", import.meta.url)).replace(/\\/g, "/");
    const script = `
      const { enqueue } = await import(${JSON.stringify("file:///" + queue.replace(/^\//, ""))});
      const unhandled = [];
      process.on("unhandledRejection", err => unhandled.push(err.message));
      enqueue("tour", async () => { throw new Error("effet introuvable"); });
      const after = await enqueue("tour", async () => "suite");
      await new Promise(r => setTimeout(r, 20));
      console.log(JSON.stringify({ unhandled, after }));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
    expect(JSON.parse(out)).toEqual({ unhandled: ["effet introuvable"], after: "suite" });
  });
  it("whoever awaits its task resumes before the next of the same key begins", async () => {
    const log = [];
    const first = enqueue("ordre", async () => { log.push("A"); });
    const second = enqueue("ordre", async () => { log.push("B"); });
    await first;
    log.push("après");
    await second;
    expect(log).toEqual(["A", "après", "B"]);
  });
});
