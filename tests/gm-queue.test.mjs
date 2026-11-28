import { describe, it, expect } from "vitest";
import { gmQueue, queueSignature } from "../module/scripts/core/gm-queue.mjs";

// §421: the GM Queue — one line per window that makes the table wait, sorted for the GM.
describe("gmQueue", () => {
  const awaiting = [
    { id: "a1", userId: "gm", userName: "MJ", actor: "Actor.ogre", kind: "reaction", gm: true, player: false, since: 30, seconds: 10 },
    { id: "a2", userId: "u1", userName: "Alara", actor: "Actor.sylaene", kind: "roll", gm: false, player: true, since: 10, seconds: null },
    { id: "a3", userId: "u2", userName: "Bramo", actor: "Actor.bramo", kind: "reaction", gm: false, player: true, since: 20, seconds: 10 }
  ];

  it("sorts the GM's windows on one side, the players' on the other, the oldest first", () => {
    const q = gmQueue({ awaiting });
    expect(q.mine.map(l => l.id)).toEqual(["a1"]);
    expect(q.players.map(l => l.id)).toEqual(["a2", "a3"]);
    expect(q.count).toBe(3);
  });

  it("a window open at the author's (no question asked by the GM) still has its line, forceable by its player", () => {
    const q = gmQueue({ awaiting, waits: [] });
    expect(q.players[0]).toMatchObject({ id: "a2", userId: "u1", kind: "roll", label: "", waitIds: [] });
  });

  it("the question put to the player gives the window its label, without making a second line", () => {
    const waits = [{ id: "w1", userId: "u2", userName: "Bramo", actor: "Actor.bramo", label: "Réaction", since: 19 }];
    const q = gmQueue({ awaiting, waits });
    expect(q.players.map(l => l.id)).toEqual(["a2", "a3"]);
    expect(q.players[1]).toMatchObject({ label: "Réaction", waitIds: ["w1"] });
  });

  it("a question without an announced window keeps its line", () => {
    const waits = [{ id: "w9", userId: "u3", userName: "Kaalisti", actor: "Actor.k", label: "Présage", since: 5 }];
    const q = gmQueue({ awaiting, waits });
    expect(q.players[0]).toMatchObject({ id: "wait:w9", source: "wait", label: "Présage", waitIds: ["w9"] });
  });

  it("blocked actions (author gone) have their share", () => {
    const q = gmQueue({ blocked: [{ messageId: "m1", userName: "Bramo", actorName: "Bramo", item: "Épée longue" }] });
    expect(q.blocked).toEqual([{ id: "blocked:m1", messageId: "m1", userName: "Bramo", actorName: "Bramo", item: "Épée longue" }]);
    expect(q.count).toBe(1);
  });

  it("the fingerprint changes only when a line arrives, leaves or gets its label", () => {
    const a = queueSignature(gmQueue({ awaiting }));
    expect(queueSignature(gmQueue({ awaiting: awaiting.map(e => ({ ...e, since: e.since + 1000 })) }))).toBe(a);
    expect(queueSignature(gmQueue({ awaiting: awaiting.slice(1) }))).not.toBe(a);
    expect(queueSignature(gmQueue({ awaiting, waits: [{ id: "w1", userId: "u2", actor: "Actor.bramo", label: "Réaction" }] }))).not.toBe(a);
  });

  it("vide sans rien", () => {
    expect(gmQueue()).toEqual({ mine: [], players: [], blocked: [], count: 0 });
  });
});

// §422: the buttons of the requests made to the GM, the requested rolls.
describe("gmQueue — this station's windows and requested rolls", () => {
  const awaiting = [
    { id: "a1", userId: "gm", userName: "MJ", actor: "Actor.ogre", kind: "reaction", gm: true, since: 30 },
    { id: "a2", userId: "u1", userName: "Alara", actor: "Actor.sylaene", kind: "roll", gm: false, since: 10 },
    { id: "a3", userId: "u2", userName: "Bramo", actor: "Actor.bramo", kind: "choice", gm: false, since: 20 }
  ];
  const prompts = [{ id: "a1", awaitingId: "a1", title: "Réaction — Ogre", text: "Le Guerrier quitte votre allonge.", buttons: [{ action: "use0", label: "Gourdin" }, { action: "none", label: "Ne pas réagir" }] }];

  it("the window open on this station gives the GM's line its text and its buttons", () => {
    const q = gmQueue({ awaiting, prompts });
    expect(q.mine[0].prompt).toEqual({ id: "a1", text: "Le Guerrier quitte votre allonge.", buttons: prompts[0].buttons });
    expect(q.mine[0].label).toBe("Réaction — Ogre");
    expect(q.players.every(l => l.prompt === null)).toBe(true);
  });

  it("without a window known to this station (another GM), the line stays without buttons", () => {
    expect(gmQueue({ awaiting }).mine[0].prompt).toBeNull();
  });

  it("§423: a roll request fits in ONE line — the check, the expected characters, the players — and the roll windows merge into it", () => {
    const groupRolls = [{ messageId: "m7", actor: "Actor.sylaene", label: "Jet d'initiative", since: 99 }, { messageId: "m7", actor: "Actor.kaalisti", label: "Jet d'initiative", since: 99 }];
    const q = gmQueue({ awaiting, groupRolls });
    const group = q.players.find(l => l.source === "group");
    expect(group).toMatchObject({ id: "group:m7", groupRoll: "m7", label: "Jet d'initiative", count: 2, actors: ["Actor.sylaene", "Actor.kaalisti"], userName: "Alara", since: 10 });
    expect(q.players.some(l => l.id === "a2")).toBe(false);   // Alara's roll window no longer has a line of its own
    expect(q.players.map(l => l.id)).toEqual(["group:m7", "a3"]);
  });

  it("§423: a request without an announced window keeps its line (the moment of the request as its age)", () => {
    const q = gmQueue({ groupRolls: [{ messageId: "m9", actor: "Actor.x", label: "Test", since: 42 }] });
    expect(q.players).toHaveLength(1);
    expect(q.players[0]).toMatchObject({ id: "group:m9", count: 1, userName: "", since: 42 });
  });

  it("only a roll (not a choice) of the same character merges into the request", () => {
    const q = gmQueue({ awaiting, groupRolls: [{ messageId: "m7", actor: "Actor.bramo", label: "Test" }] });
    expect(q.players.find(l => l.id === "a3")).toBeTruthy();
  });

  it("§423: the fingerprint changes when a character has rolled (one fewer expected)", () => {
    const two = [{ messageId: "m7", actor: "Actor.a", label: "T" }, { messageId: "m7", actor: "Actor.b", label: "T" }];
    expect(queueSignature(gmQueue({ groupRolls: two }))).not.toBe(queueSignature(gmQueue({ groupRolls: two.slice(1) })));
  });

  it("the fingerprint changes when the window arrives", () => {
    expect(queueSignature(gmQueue({ awaiting, prompts }))).not.toBe(queueSignature(gmQueue({ awaiting })));
  });
});

// §426: what a player's window asks, known to the GMs only.
describe("gmQueue — labels reserved for GMs", () => {
  const awaiting = [{ id: "a2", userId: "u1", userName: "Alara", actor: "Actor.sylaene", kind: "choice", gm: false, since: 10 }];
  it("a window opened at a player's own initiative takes the label the GM received", () => {
    expect(gmQueue({ awaiting, labels: { a2: "Inspiration héroïque — Sylaene" } }).players[0].label).toBe("Inspiration héroïque — Sylaene");
  });
  it("the label of a question put by the GM keeps the priority", () => {
    const waits = [{ id: "w1", userId: "u1", actor: "Actor.sylaene", label: "Réaction" }];
    expect(gmQueue({ awaiting, waits, labels: { a2: "Autre" } }).players[0].label).toBe("Réaction");
  });
  it("without a received label, the line stays without a label (the panel states the kind)", () => {
    expect(gmQueue({ awaiting }).players[0].label).toBe("");
  });
  it("the fingerprint changes when the label arrives", () => {
    expect(queueSignature(gmQueue({ awaiting, labels: { a2: "X" } }))).not.toBe(queueSignature(gmQueue({ awaiting })));
  });
});
