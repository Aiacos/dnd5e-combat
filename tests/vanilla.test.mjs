import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isVanilla, concernsVanilla, markPending, clearPending, isPending, resetVanilla, PENDING_MS } from "../module/scripts/adapter/vanilla-state.mjs";

const ID = "dnd5e-combat";
const flagged = (extra={}) => ({ flags: { [ID]: { vanilla: true } }, ...extra });

describe("§395: what comes from an action cast without DAS", () => {
  const messages = new Map();
  const uuids = new Map();
  beforeEach(() => {
    resetVanilla();
    messages.clear(); uuids.clear();
    globalThis.game = { messages: { get: id => messages.get(id) ?? null } };
    globalThis.fromUuidSync = uuid => uuids.get(uuid) ?? messages.get(uuid.split(".").pop()) ?? null;
  });
  afterEach(() => { delete globalThis.game; delete globalThis.fromUuidSync; });

  it("the use configuration, a marked document, a marked message configuration", () => {
    expect(isVanilla({ [ID]: { vanilla: true } })).toBe(true);
    expect(isVanilla(flagged())).toBe(true);
    expect(isVanilla({ data: flagged() })).toBe(true);
    expect(isVanilla({ flags: {} })).toBe(false);
    expect(isVanilla(null)).toBe(false);
  });

  it("a roll attached to the marked card, and the damage applied from that roll", () => {
    messages.set("use1", flagged());
    const damage = { system: { origin: "use1" } };
    messages.set("dmg1", damage);
    expect(isVanilla({ system: { origin: "use1" } })).toBe(true);
    expect(isVanilla({ data: { system: { origin: "use1" } } })).toBe(true);
    expect(isVanilla({ originatingMessage: damage })).toBe(true);
    expect(isVanilla({ options: { originatingMessage: "dmg1" } })).toBe(true);
    expect(isVanilla({ system: { origin: "autre" } })).toBe(false);
  });

  it("an effect placed by the card, or attached to a marked Concentration", () => {
    messages.set("use1", flagged());
    expect(isVanilla({ system: { origin: { message: "ChatMessage.use1" } } })).toBe(true);
    uuids.set("Actor.a.ActiveEffect.c", flagged());
    expect(isVanilla({ flags: { dnd5e: { dependentOn: "Actor.a.ActiveEffect.c" } } })).toBe(true);
    expect(isVanilla({ flags: { dnd5e: { dependentOn: "Actor.a.ActiveEffect.x" } } })).toBe(false);
  });

  it("an activity noted on this client, while its area or summon is placed", () => {
    markPending(["Item.i.Activity.a", "Item.i"], 1000);
    expect(isPending("Item.i.Activity.a", 1000 + PENDING_MS - 1)).toBe(true);
    expect(isPending("Item.i.Activity.a", 1000 + PENDING_MS + 1)).toBe(false);
    markPending(["Item.i.Activity.a"]);
    expect(isVanilla({ uuid: "Item.i.Activity.a" })).toBe(true);
    expect(isVanilla({ subject: { uuid: "Item.i.Activity.a" } })).toBe(true);
    clearPending(["Item.i.Activity.a"]);
    expect(isVanilla({ uuid: "Item.i.Activity.a" })).toBe(false);
  });

  it("the router stays silent for the arguments concerned, the correction card included (it alone)", () => {
    messages.set("fix", { flags: { [ID]: { correction: true } } });
    expect(concernsVanilla([{ a: 1 }, flagged()])).toBe(true);
    expect(concernsVanilla([[flagged()]])).toBe(true);
    expect(concernsVanilla([messages.get("fix")])).toBe(true);
    // An effect placed by the correction becomes DAS's business again.
    expect(concernsVanilla([{ system: { origin: { message: "ChatMessage.fix" } } }])).toBe(false);
    expect(concernsVanilla([{ a: 1 }])).toBe(false);
  });
});
