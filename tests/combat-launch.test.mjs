import { describe, it, expect } from "vitest";
import { classify, initiativeGroups, allRolled } from "../module/scripts/core/combat-launch.mjs";
import { normalizeRequest } from "../module/scripts/core/group-roll.mjs";

const base = { creature: true, alive: true, sameLevel: true, notCombatant: false, summon: null, seen: false, player: false, online: false };
const e = (id, extra={}) => ({ ...base, id, actorKey: id, ...extra });

describe("§397 : lancer un combat", () => {
  it("sorts the tokens: connected players, seen by players, rest of the map", () => {
    const { players, seen, rest } = classify([
      e("pj", { player: true, online: true }),
      e("absent", { player: true, online: false }),        // disconnected player: treated like the rest
      e("familier", { player: true, online: true, summon: "own" }),
      e("serviteur", { player: true, online: true, summon: "none" }),
      e("gobelin", { seen: true }),
      e("cache"),
      e("mort", { alive: false, seen: true }),
      e("coffre", { creature: false }),
      e("piege", { notCombatant: true }),
      e("etage", { sameLevel: false })
    ]);
    expect(players.map(p => p.id)).toEqual(["pj", "familier"]);
    expect(players.every(p => p.checked)).toBe(true);
    expect(seen.map(p => [p.id, p.checked])).toEqual([["gobelin", true]]);
    expect(rest.map(p => [p.id, p.checked])).toEqual([["absent", false], ["cache", false]]);
  });

  it("a PC at 0 HP stays in the player list, unchecked", () => {
    expect(classify([e("pj", { player: true, online: true, alive: false })]).players[0].checked).toBe(false);
  });

  it("one roll per NPC, or one per actor; \"after\" summons do not roll", () => {
    const npcs = [{ id: "g1", actorKey: "gob" }, { id: "g2", actorKey: "gob" }, { id: "o", actorKey: "orc" }, { id: "s", actorKey: "x", summon: "after" }];
    expect(initiativeGroups(npcs, false)).toEqual([{ roll: "g1", copies: [] }, { roll: "g2", copies: [] }, { roll: "o", copies: [] }]);
    expect(initiativeGroups(npcs, true)).toEqual([{ roll: "g1", copies: ["g2"] }, { roll: "o", copies: [] }]);
  });

  it("le premier round attend toutes les initiatives", () => {
    expect(allRolled([12, 8.5])).toBe(true);
    expect(allRolled([12, null])).toBe(false);
    expect(allRolled([])).toBe(false);
  });

  it("an Initiative request: fixed key, combat kept, never a group check", () => {
    const { request } = normalizeRequest({ type: "initiative", combat: "abc", group: true });
    expect(request).toMatchObject({ type: "initiative", key: "init", combat: "abc", group: false });
    expect(normalizeRequest({ type: "skill", key: "ath" }).request.combat).toBeUndefined();
  });
});
