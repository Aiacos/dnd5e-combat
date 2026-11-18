import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enqueue } from "../module/scripts/runtime/queue.mjs";

/**
 * La file par clé met les tâches en série ; une tâche qui échoue ne bloque pas les suivantes. Son erreur, elle, ne doit pas
 * disparaître : celui qui attend la promesse la reçoit, et quand personne ne l'attend (un inscrit du routeur qui ne rend pas la
 * promesse), elle reste une promesse rejetée sans traitement — ce que la console et le débogueur relèvent.
 */
describe("file par clé", () => {
  it("les tâches d'une même clé passent l'une après l'autre, dans l'ordre", async () => {
    const seen = [];
    const slow = enqueue("ordre", async () => { await new Promise(r => setTimeout(r, 10)); seen.push("a"); return 1; });
    const fast = enqueue("ordre", async () => { seen.push("b"); return 2; });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("une tâche qui échoue : son erreur revient à qui l'attend, la suivante passe quand même", async () => {
    const failed = enqueue("echec", async () => { throw new Error("écriture refusée"); });
    const after = enqueue("echec", async () => "suite");
    await expect(failed).rejects.toThrow("écriture refusée");
    expect(await after).toBe("suite");
  });

  it("une tâche qui échoue sans que personne n'attende sa promesse : l'erreur n'est pas avalée", () => {
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
});
