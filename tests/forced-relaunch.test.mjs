import { describe, it, expect, vi } from "vitest";
import { askKey } from "../module/scripts/core/forced.mjs";

/**
 * §448 : un forçage dans un champ antimagie tient jusqu'au bout de l'utilisation. Le moteur suspend souvent la première utilisation
 * (visée des projectiles, fenêtre de légalité, choix d'une forme…) et la relance ensuite : la relance d'une configuration déjà forcée
 * lève encore le champ (`relaunchUse`), un projectile enchaîné ne dépense rien (`chainedConsumption`), et la même question ouverte deux
 * fois sur un poste (double clic) n'en fait qu'une (`askKey`).
 */
vi.mock("../module/scripts/runtime/antimagic.mjs", () => ({
  withAntimagicLifted: vi.fn(async (actor, item, run) => {
    actor.lifted = true;
    try { return await run(); } finally { actor.lifted = false; }
  })
}));
const { relaunchUse } = await import("../module/scripts/runtime/relaunch.mjs");
const { chainedConsumption } = await import("../module/scripts/runtime/projectiles.mjs");

/** Une activité qui note si le champ était levé au moment de `use`. */
function activity() {
  const actor = { name: "Paladin", lifted: false };
  const a = { actor, item: { name: "Baguette de projectiles magiques" }, calls: [] };
  a.use = vi.fn(async (usage, dialog, message) => { a.calls.push({ usage, dialog, message, lifted: actor.lifted }); return { message: { id: "m" } }; });
  return a;
}

describe("§448 : la relance d'une utilisation forcée garde le champ levé", () => {
  it("forcée (antimagicForced) : le champ est levé pendant l'appel, rétabli après", async () => {
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

  it("non forcée : `activity.use` tel quel, le champ n'est pas touché", async () => {
    const a = activity();
    await relaunchUse(a, { "dnd5e-combat": { picks: ["x"] } }, {}, {});
    await relaunchUse(a, undefined, undefined, undefined);
    expect(a.calls.map(c => c.lifted)).toEqual([false, false]);
  });
});

describe("§448 : un projectile enchaîné ne dépense rien", () => {
  const flagged = cachedFor => ({ item: { getFlag: (scope, key) => ((scope === "dnd5e") && (key === "cachedFor") ? cachedFor : undefined) } });

  it("sort de l'acteur : ni action, ni ressource, ni emplacement ; pas de `cause`", () => {
    expect(chainedConsumption(flagged(undefined))).toEqual({ consume: { action: false, resources: false, spellSlot: false } });
  });

  it("sort lancé par un objet (mis en cache) : la charge de l'objet non plus (`cause.resources`)", () => {
    expect(chainedConsumption(flagged(".Item.wand.Activity.cast"))).toEqual({
      consume: { action: false, resources: false, spellSlot: false }, cause: { resources: false } });
  });

  it("activité sans item : la consommation coupée quand même", () => {
    expect(chainedConsumption(null)).toEqual({ consume: { action: false, resources: false, spellSlot: false } });
  });
});

describe("§448 : la même question « le faire quand même » deux fois = un double clic", () => {
  it("même titre, mêmes raisons : même clé", () => {
    const lines = ["Champ antimagie : aucun sort ne peut être lancé.", "Hors de portée."];
    expect(askKey("Projectile magique — Paladin", lines)).toBe(askKey("Projectile magique — Paladin", [...lines]));
  });

  it("un autre objet, un autre acteur ou une autre raison : une autre question", () => {
    const key = askKey("Projectile magique — Paladin", ["Champ"]);
    expect(askKey("Potion de soins — Paladin", ["Champ"])).not.toBe(key);
    expect(askKey("Projectile magique — Magicien", ["Champ"])).not.toBe(key);
    expect(askKey("Projectile magique — Paladin", ["Champ", "Pas de cible"])).not.toBe(key);
  });

  it("sans raisons ou titre manquant : une clé quand même", () => {
    expect(askKey("A")).toBe("A");
    expect(askKey(null, null)).toBe("");
  });
});
