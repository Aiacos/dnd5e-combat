import { describe, it, expect } from "vitest";
import { auraRecipients, wantedAuraEffects, planAuraChanges } from "../module/scripts/core/aura.mjs";
import { AURAS } from "../module/scripts/content/auras.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const paladin = over => ({
  token: "T.pal", key: "aura-of-protection", disposition: 1, inactive: false,
  radius: 10, affects: "ally", includeSelf: false, value: 3, ...over
});
const at = (token, distance, disposition = 1) => ({ token, distance, disposition });

describe("who receives the aura", () => {
  const around = [at("T.pal", 0), at("T.mage", 5), at("T.roublard", 10), at("T.loin", 15), at("T.zombi", 5, -1)];

  it("allies within 10 ft, not enemies, not those who are too far", () => {
    expect(auraRecipients(paladin(), around)).toEqual(["T.mage", "T.roublard"]);
  });
  it("the bearer only if the aura provides for it (it already has the original effect)", () => {
    expect(auraRecipients(paladin({ includeSelf: true }), around)).toContain("T.pal");
    expect(auraRecipients(paladin(), around)).not.toContain("T.pal");
  });
  it("an extinguished aura affects no one", () => {
    expect(auraRecipients(paladin({ inactive: true }), around)).toEqual([]);
  });
  it("une aura hostile vise l'autre camp", () => {
    expect(auraRecipients(paladin({ affects: "enemy" }), around)).toEqual(["T.zombi"]);
  });
  it("an aura without a side affects everyone in range", () => {
    expect(auraRecipients(paladin({ affects: "any" }), around)).toEqual(["T.mage", "T.roublard", "T.zombi"]);
  });
});

describe("plusieurs auras", () => {
  it("two auras of the same name do not stack: the stronger one wins", () => {
    const wanted = wantedAuraEffects([
      { source: paladin({ value: 2 }), recipients: ["T.mage"] },
      { source: paladin({ token: "T.pal2", value: 4 }), recipients: ["T.mage", "T.roublard"] }
    ]);
    expect(wanted).toEqual([
      { target: "T.mage", key: "aura-of-protection", source: "T.pal2", value: 4 },
      { target: "T.roublard", key: "aura-of-protection", source: "T.pal2", value: 4 }
    ]);
  });
  it("two auras with different names coexist on the same creature", () => {
    const wanted = wantedAuraEffects([
      { source: paladin(), recipients: ["T.mage"] },
      { source: paladin({ key: "aura-of-courage" }), recipients: ["T.mage"] }
    ]);
    expect(wanted.map(w => w.key)).toEqual(["aura-of-protection", "aura-of-courage"]);
  });
});

describe("update plan", () => {
  const wanted = [{ target: "T.mage", key: "aura-of-protection", source: "T.pal", value: 3 }];

  it("creates what is missing", () => {
    expect(planAuraChanges([], wanted)).toEqual({ create: wanted, update: [], remove: [] });
  });
  it("touches nothing when everything is in place", () => {
    const existing = [{ id: "e1", ...wanted[0] }];
    expect(planAuraChanges(existing, wanted)).toEqual({ create: [], update: [], remove: [] });
  });
  it("removes the copy of the one who left the aura", () => {
    const existing = [{ id: "e1", target: "T.roublard", key: "aura-of-protection", source: "T.pal", value: 3 }];
    expect(planAuraChanges(existing, wanted).remove).toEqual(existing);
  });
  it("updates when the bearer's bonus changes, or when another bearer takes over", () => {
    const existing = [{ id: "e1", ...wanted[0], value: 2 }];
    expect(planAuraChanges(existing, wanted).update).toEqual([{ ...wanted[0], id: "e1" }]);
    const other = [{ id: "e1", ...wanted[0], source: "T.pal2" }];
    expect(planAuraChanges(other, wanted).update).toEqual([{ ...wanted[0], id: "e1" }]);
  });
  it("retire un doublon", () => {
    const existing = [{ id: "e1", ...wanted[0] }, { id: "e2", ...wanted[0] }];
    expect(planAuraChanges(existing, wanted).remove.map(e => e.id)).toEqual(["e2"]);
  });
});

describe("auraRecipients — ligne d'effet (P2)", () => {
  it("an ally in range but without line of effect (floor between them) does not receive the aura; unknown receives it", () => {
    const source = { token: "T.pal", key: "protection", disposition: 1, inactive: false, radius: 10, affects: "ally", includeSelf: false, value: 3 };
    const out = auraRecipients(source, [
      { token: "T.a", disposition: 1, distance: 5, lineOfEffect: true },
      { token: "T.b", disposition: 1, distance: 5, lineOfEffect: false },
      { token: "T.c", disposition: 1, distance: 5, lineOfEffect: null },
      { token: "T.d", disposition: 1, distance: 5 }
    ]);
    expect(out).toEqual(["T.a", "T.c", "T.d"]);
  });
});

describe("Monster Manual bonus auras (§18.12)", () => {
  it("types: only allied Undead, the bearer excluded", async () => {
    const source = { token: "DK", disposition: -1, inactive: false, radius: 60, affects: "ally", includeSelf: false, value: 12, types: ["undead"] };
    expect(auraRecipients(source, [
      { token: "DK", disposition: -1, distance: 0, type: "undead" },
      { token: "Squelette", disposition: -1, distance: 30, type: "undead" },
      { token: "Cultiste", disposition: -1, distance: 10, type: "humanoid" },
      { token: "Zombi PJ", disposition: 1, distance: 10, type: "undead" }
    ])).toEqual(["Squelette"]);
  });

  it("the shipped content declares valid changes, without a condition", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    const { validateEntry } = await import("../module/scripts/core/content.mjs");
    for ( const id of ["aura-of-authority", "marshal-undead", "aura-of-bravery"] ) {
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(CONTENT["aura-of-authority"].aura.changes).toHaveLength(12);
    expect(CONTENT["aura-of-authority"].aura.changes[0]).toEqual({ key: "system.abilities.str.attack.roll.mode", value: "1", type: "add" });
    expect(validateEntry({ aura: { changes: [{ key: "x", value: 1, type: "add" }] } })).toHaveLength(1);   // string value
    expect(validateEntry({ aura: { types: ["mort-vivant"] } })).toHaveLength(1);
  });
});

describe("Weapon of Warning (SRD 5.2): the Advantage on Initiative also goes to allies within 9 m", () => {
  const aura = AURAS["weapon-of-warning-enchanted"];
  it("9 m aura on allies, without the bearer (the enchantment already gives it to them)", () => {
    expect(aura).toMatchObject({ includeSelf: false, affects: "ally", radius: 30, units: "ft" });
    expect(aura.changes).toEqual([{ key: "system.attributes.init.roll.mode", value: "1", type: "add" }]);
  });
  it("the entry is valid", () => {
    expect(validateEntry({ aura })).toEqual([]);
  });
});
