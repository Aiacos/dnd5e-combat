/**
 * Issue #148 : Rayon ardent au niveau 2, lanceur avec le Présage — deux rayons partent sur trois. La porte du Présage suspend le
 * deuxième rayon pour poser sa question et le relance elle-même ; l'enchaînement, qui n'avait rien reçu de `activity.use()`,
 * s'arrêtait. Il lit maintenant la relance inscrite ici.
 */
import { describe, it, expect, vi } from "vitest";
import { suspendUse, suspendedUse } from "../module/scripts/runtime/suspended-uses.mjs";

describe("les utilisations suspendues par une porte", () => {
  it("rien d'inscrit : aucune relance à attendre", () => {
    expect(suspendedUse("Actor.a.Item.b.Activity.c")).toBe(null);
  });
  it("la relance inscrite se lit pendant la question, et rend le résultat avec sa carte", async () => {
    let answer;
    const relaunch = new Promise(resolve => { answer = resolve; });
    suspendUse("act.1", relaunch);
    const read = suspendedUse("act.1");
    expect(read).not.toBe(null);
    answer({ message: { id: "m1" } });
    expect(await read).toEqual({ message: { id: "m1" } });
  });
  it("une utilisation qui ne part pas (sort contré, relance interrompue) : null, pas une erreur", async () => {
    expect(await suspendUse("act.2", Promise.resolve(undefined))).toBe(null);
    expect(await suspendUse("act.3", Promise.resolve({}))).toBe(null);
    expect(await suspendUse("act.4", Promise.reject(new Error("interrompue")))).toBe(null);
  });
  it("encore lisible juste après avoir été tranchée, puis oubliée", async () => {
    vi.useFakeTimers();
    const settled = suspendUse("act.5", Promise.resolve({ message: { id: "m5" } }));
    await settled;
    await Promise.resolve();
    expect(suspendedUse("act.5")).toBe(settled);
    vi.advanceTimersByTime(2500);
    expect(suspendedUse("act.5")).toBe(null);
    vi.useRealTimers();
  });
  it("une relance plus récente de la même activité n'est pas effacée par l'oubli de la précédente", async () => {
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
