import { describe, it, expect } from "vitest";
import { MERGE, mergeEntries } from "../module/scripts/core/content/merge.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

/**
 * La fusion des couches (core/content/merge.mjs) suit une table : une clé du schéma sans stratégie disparaîtrait sans bruit à la
 * fusion (une entrée du monde ou d'un item ne changerait rien).
 */
describe("fusion des couches", () => {
  it("chaque clé du schéma a sa stratégie, et la table n'en a pas d'autre", () => {
    expect(Object.keys(MERGE).filter(k => !ENTRY_KEYS.includes(k))).toEqual([]);
    expect(ENTRY_KEYS.filter(k => !(k in MERGE))).toEqual([]);
  });
  it("les stratégies : remplacer, fusionner champ par champ, copier", () => {
    const out = mergeEntries([
      { aura: { radius: 10, units: "ft" }, triggers: [{ on: "hit" }], recast: true, reactions: { perRound: 2 } },
      { aura: { radius: 30 }, triggers: { on: "isHit" }, recast: false },
      null
    ]);
    expect(out).toEqual({ triggers: [{ on: "isHit" }], aura: { radius: 30, units: "ft" }, recast: false, reactions: { perRound: 2 } });
  });
  it("les clés d'une couche sortent dans l'ordre de la table, quel que soit l'ordre où la couche les écrit", () => {
    const [a, b, c] = Object.keys(MERGE);
    expect(Object.keys(mergeEntries([{ [c]: 1, [a]: 2, [b]: 3 }]))).toEqual([a, b, c]);
    // Une couche plus spécifique ajoute ses clés à la suite, et remplace celles qu'elle reprend sans les déplacer.
    const last = Object.keys(MERGE).at(-1);
    expect(Object.keys(mergeEntries([{ [last]: {}, [b]: 1 }, { [a]: 2, [b]: 4 }]))).toEqual([b, last, a]);
  });
  it("une clé hors schéma, ou du nom d'un membre d'Object, est ignorée ; aucune couche parlante : null", () => {
    const a = "halfOnMiss";
    expect(mergeEntries([{ inconnue: 1, toString: 2, constructor: 3, __proto__: null, [a]: 5 }])).toEqual({ [a]: 5 });
    expect(mergeEntries([{ inconnue: 1 }])).toEqual({});
    expect(mergeEntries([null, undefined, {}, [], "x"])).toBe(null);
  });
});
