import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §372: `hitRider` as a list — exclusive options of the same item, named by an activity; own dice, weapon kinds, raised limit.
const A = "aaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbb", E = "eeeeeeeeeeeeeeee";

describe("contenu hitRider en liste", () => {
  it("une faveur seule reste valable", () => expect(validateEntry({ hitRider: { damage: A, oncePerTurn: true } })).toEqual([]));

  it("a list of named options, per-turn limit raised", () => {
    const turn = { oncePerTurn: true, perTurn: { count: 2, while: "other-feature" }, weapons: ["unarmed", "simpleM"] };
    expect(validateEntry({ hitRider: [{ name: A, formula: "1d12", weaponDamage: true, ...turn }, { name: B, effect: E, ...turn }] })).toEqual([]);
  });

  it("refuses a list of a single option, an option without a name, an unknown weapon kind, perTurn without oncePerTurn", () => {
    for ( const bad of [
      [{ name: A }],
      [{ name: A }, { effect: E }],
      [{ name: A, weapons: ["laser"] }, { name: B }],
      [{ name: A, perTurn: { count: 2, while: "x" } }, { name: B }],
      [{ name: A, perTurn: { count: 1, while: "x" }, oncePerTurn: true }, { name: B }],
      [{ name: A, formula: "" }, { name: B }]
    ] ) expect(validateEntry({ hitRider: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });

  it("maxNextHit : true ou un id d'effet", () => {
    expect(validateEntry({ maxNextHit: true })).toEqual([]);
    expect(validateEntry({ maxNextHit: E })).toEqual([]);
    expect(validateEntry({ maxNextHit: "court" }).length).toBeGreaterThan(0);
  });
});
