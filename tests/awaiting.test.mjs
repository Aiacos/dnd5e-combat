/** §381 (issue #35): who the table is waiting for — what is computed without Foundry. */
import { describe, it, expect } from "vitest";
import { gmLabel } from "../module/scripts/core/awaiting.mjs";
import { AWAITING_STALE_MS, applyAwaiting, awaitingAlive, awaitingEntry, awaitingLeft, awaitingPlacement, pruneAwaiting }
  from "../module/scripts/core/awaiting.mjs";

const base = { id: "a1", userId: "u1", userName: "Alice", token: "Scene.s.Token.t", actor: "Actor.x", kind: "reaction", since: 1000 };

describe("broadcast wait", () => {
  it("keeps only its public form: never the name of the Reaction or the prompt", () => {
    const e = awaitingEntry({ ...base, label: "Bouclier", prompt: "Utiliser Bouclier ?", item: "Bouclier", options: [{ id: "x" }] });
    expect(Object.keys(e).sort()).toEqual(["actor", "gm", "id", "kind", "player", "refreshed", "seconds", "since", "token", "userId", "userName"]);
    expect(JSON.stringify(e)).not.toMatch(/Bouclier/);
  });
  it("an unknown kind becomes a choice; without an id or a user, nothing", () => {
    expect(awaitingEntry({ ...base, kind: "shield" }).kind).toBe("choice");
    expect(awaitingEntry({ ...base, id: "" })).toBeNull();
    expect(awaitingEntry({ ...base, userId: null })).toBeNull();
  });
});

describe("expiration", () => {
  it("a wait with no news for too long is forgotten (frozen tab)", () => {
    const e = awaitingEntry(base);
    expect(awaitingAlive(e, 1000 + AWAITING_STALE_MS)).toBe(true);
    expect(awaitingAlive(e, 1001 + AWAITING_STALE_MS)).toBe(false);
    expect(awaitingAlive({ ...e, refreshed: 50000 }, 1001 + AWAITING_STALE_MS)).toBe(true);
  });
  it("a window with a timeout expires after its timeout plus a margin", () => {
    const e = awaitingEntry({ ...base, seconds: 10 });
    expect(awaitingAlive(e, 1000 + 14000)).toBe(true);
    expect(awaitingAlive(e, 1000 + 16000)).toBe(false);
  });
  it("the rest of the timeout, for the gauge; nothing without a timeout", () => {
    expect(awaitingLeft(awaitingEntry({ ...base, seconds: 10 }), 6000)).toBe(0.5);
    expect(awaitingLeft(awaitingEntry({ ...base, seconds: 10 }), 99000)).toBe(0);
    expect(awaitingLeft(awaitingEntry(base), 6000)).toBeNull();
  });
  it("pruneAwaiting removes what has expired", () => {
    const list = [awaitingEntry(base), awaitingEntry({ ...base, id: "a2", seconds: 1 })];
    expect(pruneAwaiting(list, 10000).map(e => e.id)).toEqual(["a1"]);
  });
});

describe("where to show it", () => {
  const player = awaitingEntry({ ...base, player: true });
  const gmNpc = awaitingEntry({ ...base, id: "g", userId: "gm", gm: true, player: false });
  const gmForPc = awaitingEntry({ ...base, id: "h", userId: "gm", gm: true, player: true });
  const viewer = { userId: "u2", isGM: false };
  it("above the token for the others, nothing for the one who answers", () => {
    expect(awaitingPlacement(player, viewer)).toBe("token");
    expect(awaitingPlacement(player, { userId: "u1", isGM: false })).toBe("none");
  });
  it("turned off by the table or hidden locally: nothing", () => {
    expect(awaitingPlacement(player, { ...viewer, enabled: false })).toBe("none");
    expect(awaitingPlacement(player, { ...viewer, hidden: true })).toBe("none");
  });
  it("a GM window for a monster: discreet banner by default, or token, or nothing; the GM sees everything", () => {
    expect(awaitingPlacement(gmNpc, viewer)).toBe("banner");
    expect(awaitingPlacement(gmNpc, { ...viewer, gmMode: "token" })).toBe("token");
    expect(awaitingPlacement(gmNpc, { ...viewer, gmMode: "hidden" })).toBe("none");
    expect(awaitingPlacement(gmNpc, { userId: "gm2", isGM: true, gmMode: "hidden" })).toBe("token");
  });
  it("the GM answering for an absent player character: on the token, it is not a secret", () => {
    expect(awaitingPlacement(gmForPc, viewer)).toBe("token");
  });
  it("without a token on the scene: nothing (or the banner for a GM secret)", () => {
    expect(awaitingPlacement({ ...player, token: null }, viewer)).toBe("none");
    expect(awaitingPlacement({ ...gmNpc, token: null }, { ...viewer, gmMode: "token" })).toBe("banner");
  });
});

describe("tableau des attentes", () => {
  it("arrival, departure, replacement per user, disconnection", () => {
    let list = applyAwaiting([], { type: "add", entry: base });
    list = applyAwaiting(list, { type: "add", entry: { ...base, id: "b", userId: "u2", since: 500 } });
    expect(list.map(e => e.id)).toEqual(["b", "a1"]);
    list = applyAwaiting(list, { type: "add", entry: { ...base, kind: "roll" } });
    expect(list.filter(e => e.id === "a1").map(e => e.kind)).toEqual(["roll"]);
    list = applyAwaiting(list, { type: "replace", userId: "u1", list: [{ ...base, id: "c" }, { ...base, id: "intrus", userId: "u2" }] });
    expect(list.map(e => e.id)).toEqual(["b", "c"]);
    list = applyAwaiting(list, { type: "drop", userId: "u2" });
    expect(list.map(e => e.id)).toEqual(["c"]);
    expect(applyAwaiting(list, { type: "remove", id: "c" })).toEqual([]);
  });
});

// §426: the label reserved for GMs travels separately; the broadcast wait still does not carry it.
describe("label reserved for GMs", () => {
  it("a short line: spaces tightened, 80 characters at most", () => {
    expect(gmLabel("  Inspiration   héroïque\n— Paladin ")).toBe("Inspiration héroïque — Paladin");
    expect(gmLabel("x".repeat(200))).toHaveLength(80);
    expect(gmLabel(null)).toBe("");
  });
  it("the broadcast wait does not keep it, even if it is given to it", () => {
    const e = awaitingEntry({ id: "a1", userId: "u1", kind: "choice", since: 1, label: "Inspiration héroïque", gmLabel: "Inspiration héroïque" });
    expect(JSON.stringify(e)).not.toMatch(/Inspiration/);
  });
});
