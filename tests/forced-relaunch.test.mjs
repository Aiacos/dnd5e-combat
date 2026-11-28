import { describe, it, expect, vi } from "vitest";
import { askKey } from "../module/scripts/core/forced.mjs";

/**
 * §448: a forcing in an antimagic field holds to the end of the use. The engine often suspends the first use
 * (aiming projectiles, legality window, choice of a form…) and relaunches it afterwards: relaunching an already forced
 * configuration still lifts the field (`relaunchUse`), a chained projectile spends nothing (`chainedConsumption`), and the same
 * question opened twice on one station (double click) makes only one (`askKey`).
 */
vi.mock("../module/scripts/runtime/antimagic.mjs", () => ({
  withAntimagicLifted: vi.fn(async (actor, item, run) => {
    actor.lifted = true;
    try { return await run(); } finally { actor.lifted = false; }
  })
}));
const { relaunchUse } = await import("../module/scripts/runtime/relaunch.mjs");
const { chainedConsumption } = await import("../module/scripts/runtime/projectiles.mjs");

/** An activity that records whether the field was lifted at the time of `use`. */
function activity() {
  const actor = { name: "Paladin", lifted: false };
  const a = { actor, item: { name: "Baguette de projectiles magiques" }, calls: [] };
  a.use = vi.fn(async (usage, dialog, message) => { a.calls.push({ usage, dialog, message, lifted: actor.lifted }); return { message: { id: "m" } }; });
  return a;
}

describe("§448: relaunching a forced use keeps the field lifted", () => {
  it("forced (antimagicForced): the field is lifted during the call, restored afterwards", async () => {
    const a = activity();
    const usage = { "dnd5e-combat": { antimagicForced: true, picks: ["Scene.s.Token.a", "Scene.s.Token.b", "Scene.s.Token.a"] } };
    const result = await relaunchUse(a, usage, { configure: false }, { data: {} });
    expect(result).toEqual({ message: { id: "m" } });
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].lifted).toBe(true);
    expect(a.calls[0].usage).toBe(usage);
    expect(a.calls[0].dialog).toEqual({ configure: false });
    expect(a.actor.lifted).toBe(false);
  });

  it("not forced: `activity.use` as is, the field is not touched", async () => {
    const a = activity();
    await relaunchUse(a, { "dnd5e-combat": { picks: ["x"] } }, {}, {});
    await relaunchUse(a, undefined, undefined, undefined);
    expect(a.calls.map(c => c.lifted)).toEqual([false, false]);
  });
});

describe("§448: a chained projectile spends nothing", () => {
  const flagged = cachedFor => ({ item: { getFlag: (scope, key) => ((scope === "dnd5e") && (key === "cachedFor") ? cachedFor : undefined) } });

  it("sort de l'acteur : ni action, ni ressource, ni emplacement ; pas de `cause`", () => {
    expect(chainedConsumption(flagged(undefined))).toEqual({ consume: { action: false, resources: false, spellSlot: false } });
  });

  it("spell cast by an item (cached): the item's charge neither (`cause.resources`)", () => {
    expect(chainedConsumption(flagged(".Item.wand.Activity.cast"))).toEqual({
      consume: { action: false, resources: false, spellSlot: false }, cause: { resources: false } });
  });

  it("activity without an item: the consumption cut all the same", () => {
    expect(chainedConsumption(null)).toEqual({ consume: { action: false, resources: false, spellSlot: false } });
  });
});

describe("§448: the same \"do it anyway\" question twice = a double click", () => {
  it("same title, same reasons: same key", () => {
    const lines = ["Champ antimagie : aucun sort ne peut être lancé.", "Hors de portée."];
    expect(askKey("Projectile magique — Paladin", lines)).toBe(askKey("Projectile magique — Paladin", [...lines]));
  });

  it("another item, another actor or another reason: another question", () => {
    const key = askKey("Projectile magique — Paladin", ["Champ"]);
    expect(askKey("Potion de soins — Paladin", ["Champ"])).not.toBe(key);
    expect(askKey("Projectile magique — Magicien", ["Champ"])).not.toBe(key);
    expect(askKey("Projectile magique — Paladin", ["Champ", "Pas de cible"])).not.toBe(key);
  });

  it("without reasons or missing title: a key all the same", () => {
    expect(askKey("A")).toBe("A");
    expect(askKey(null, null)).toBe("");
  });
});
