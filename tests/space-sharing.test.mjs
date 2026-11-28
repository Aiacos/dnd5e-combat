/** §105: sharing another creature's cell. */
import { describe, it, expect, beforeAll } from "vitest";
import { mayShareSpace, widerShare } from "../module/scripts/core/space-sharing.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("partage de case (§105)", () => {
  it("entering a creature's cell, or the reverse for a swarm", () => {
    expect(mayShareSpace("enter", null)).toBe(true);
    expect(mayShareSpace("mutual", null)).toBe(true);
    expect(mayShareSpace(null, "mutual")).toBe(true);    // "and vice versa"
    expect(mayShareSpace(null, "enter")).toBe(false);    // an "Air Form" does not open to others
    expect(mayShareSpace(null, null)).toBe(false);
  });

  it("la plus large l'emporte", () => {
    expect(widerShare(null, "enter")).toBe("enter");
    expect(widerShare("mutual", "enter")).toBe("mutual");
    expect(widerShare("enter", null)).toBe("enter");
  });

  it("shipped content", () => {
    expect(CONTENT["air-form"].sharesSpace).toBe("enter");
    expect(CONTENT.swarm.sharesSpace).toBe("mutual");
    for ( const id of ["air-form", "fire-form", "water-form", "gaseous-form", "swarm", "misty-form"] ) {
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ sharesSpace: true })).toHaveLength(1);
  });
});

/**
 * The engine's path (adapter/path-world.mjs, `worldFor`): the cells where one cannot end up are those of the other tokens,
 * except those whose cell can be shared. What the mover can do does not depend on the other: its items are read only once
 * per search, not once per scene token.
 */
describe("cell sharing in the engine's path (§105)", () => {
  let worldFor, sharesSpaceWith, shareKindOf;
  const SIZE = 100;
  const grid = { size: SIZE, sizeX: SIZE, sizeY: SIZE, distance: 5, units: "ft",
    getOffset: p => ({ i: Math.floor(p.y / SIZE), j: Math.floor(p.x / SIZE) }),
    getTopLeftPoint: c => ({ x: c.j * SIZE, y: c.i * SIZE }) };

  /** Un acteur factice ; `reads.items` compte les lectures de sa collection d'objets. */
  function actorOf(identifiers) {
    const actor = { type: "character", effects: [], statuses: new Set(), flags: {}, system: {}, reads: { items: 0 } };
    actor.list = identifiers.map((identifier, n) => itemOf(actor, identifier, `item${n}`));
    Object.defineProperty(actor, "items", { get() { actor.reads.items++; return actor.list; } });
    return actor;
  }
  function itemOf(actor, identifier, id) {
    return { id, name: identifier, type: "feat", flags: {}, effects: [], actor,
      system: { identifier, activities: new Map(), description: { value: "" } } };
  }
  function sceneOf() {
    return { grid, tokens: [], regions: [], levels: { get: () => null }, getFlag: () => undefined, flags: {} };
  }
  function tokenOf(scene, actor, cell) {
    const source = { x: cell.j * SIZE, y: cell.i * SIZE, elevation: 0, width: 1, height: 1, depth: 1, level: "sol", flags: {} };
    const doc = { parent: scene, actor, _source: source, flags: {}, hidden: false, getFlag: () => undefined,
      getContainmentTestPoints: () => [] };
    doc.object = { document: doc, visible: true, checkCollision: () => false };
    scene.tokens.push(doc);
    return doc;
  }

  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game = { settings: { get: () => undefined, register() {} }, user: { isGM: true }, users: {},
      modules: { get: () => null }, i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.fromUuidSync = () => null;
    globalThis.CONFIG = { DND5E: {}, specialStatusEffects: {}, queries: {}, Token: { movement: { actions: {} } },
      Canvas: { polygonBackends: { move: { testCollision: () => false } } } };
    globalThis.canvas = { dimensions: { sceneRect: { contains: () => true } }, tokens: {}, level: null };
    ({ worldFor } = await import("../module/scripts/adapter/path-world.mjs"));
    ({ sharesSpaceWith, shareKindOf } = await import("../module/scripts/adapter/space-sharing.mjs"));
  }, 60000);

  it("a scene of 40 tokens: the mover's items are read once, not once per token", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword", "second-wind"]), { i: 0, j: 0 });
    for ( let n = 0; n < 39; n++ ) tokenOf(scene, actorOf(["claws"]), { i: 2 + (n % 7), j: 2 + Math.floor(n / 7) });
    const world = worldFor(mover);
    expect(world.canEnd({ i: 2, j: 2 })).toBe(false);   // la case d'un autre
    expect(world.canEnd({ i: 1, j: 1 })).toBe(true);
    for ( let n = 0; n < 39; n++ ) expect(world.canEnd({ i: 2 + (n % 7), j: 2 + Math.floor(n / 7) })).toBe(false);
    expect(mover.actor.reads.items).toBe(1);
  });

  it("issue #92: another token's sheet is read only when the search wants to end on its cell, and once", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    const near = tokenOf(scene, actorOf(["claws"]), { i: 0, j: 3 });
    const far = tokenOf(scene, actorOf(["claws"]), { i: 9, j: 9 });
    const world = worldFor(mover);
    expect([mover, near, far].map(t => t.actor.reads.items)).toEqual([0, 0, 0]);   // nothing read to set the world up
    expect(world.canEnd({ i: 0, j: 1 })).toBe(true);    // open ground: still nothing read
    expect([mover, near, far].map(t => t.actor.reads.items)).toEqual([0, 0, 0]);
    expect(world.canEnd({ i: 0, j: 3 })).toBe(false);
    expect(world.canEnd({ i: 0, j: 3 })).toBe(false);
    expect([mover, near, far].map(t => t.actor.reads.items)).toEqual([1, 1, 0]);
  });

  it("issue #92: asked late or not, the same tokens take their cells — hidden, defeated, sharing, unseen by a previewing player", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    const plain = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 1 });
    const hidden = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 2 });
    hidden.hidden = true;
    const dead = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 3 });
    dead.actor.statuses.add("dead");
    const swarm = tokenOf(scene, actorOf(["swarm"]), { i: 1, j: 4 });
    const unseen = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 5 });
    unseen.object.visible = false;
    const cellOfToken = t => ({ i: 1, j: scene.tokens.indexOf(t) });
    const before = CONFIG.specialStatusEffects.DEFEATED;
    CONFIG.specialStatusEffects.DEFEATED = "dead";
    try {
      // As GM: an unseen token still takes its cell.
      const gm = worldFor(mover);
      expect([plain, hidden, dead, swarm, unseen].map(t => gm.canEnd(cellOfToken(t)))).toEqual([false, true, true, true, false]);
      // As a previewing player: it does not (its cell must not be revealed).
      game.user.isGM = false;
      const player = worldFor(mover);
      expect([plain, hidden, dead, swarm, unseen].map(t => player.canEnd(cellOfToken(t)))).toEqual([false, true, true, true, true]);
    }
    finally { game.user.isGM = true; CONFIG.specialStatusEffects.DEFEATED = before; }
  });

  it("same forbidden cells as when asking token by token (`sharesSpaceWith`)", () => {
    const kinds = [["longsword"], ["air-form"], ["swarm"]];
    for ( const own of kinds ) {
      const scene = sceneOf();
      const mover = tokenOf(scene, actorOf(own), { i: 0, j: 0 });
      const others = kinds.map((theirs, n) => tokenOf(scene, actorOf(theirs), { i: 3, j: 3 + n }));
      const world = worldFor(mover);
      for ( const other of others ) {
        const cell = { i: 3, j: 3 + others.indexOf(other) };
        expect(world.canEnd(cell), `${own} sur la case de ${other.actor.list[0].name}`).toBe(sharesSpaceWith(mover, other));
      }
    }
  });

  it("nothing is kept from one search to the next: an \"Air Form\" gained, lost or changed counts at the next one", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    tokenOf(scene, actorOf(["claws"]), { i: 3, j: 3 });
    const cell = { i: 3, j: 3 };
    expect(worldFor(mover).canEnd(cell)).toBe(false);
    const form = itemOf(mover.actor, "air-form", "form");
    mover.actor.list.push(form);                       // item added
    expect(worldFor(mover).canEnd(cell)).toBe(true);
    form.system.identifier = "plain-feature";          // item changed
    expect(worldFor(mover).canEnd(cell)).toBe(false);
    form.system.identifier = "air-form";
    expect(worldFor(mover).canEnd(cell)).toBe(true);
    mover.actor.list.pop();                            // item removed
    expect(worldFor(mover).canEnd(cell)).toBe(false);
  });

  it("`sharesSpaceWith` with what the mover can do already read: same answer, its items are not re-read", () => {
    for ( const own of [["longsword"], ["air-form"], ["swarm"]] ) for ( const theirs of [["claws"], ["air-form"], ["swarm"]] ) {
      const scene = sceneOf();
      const mover = tokenOf(scene, actorOf(own), { i: 0, j: 0 });
      const other = tokenOf(scene, actorOf(theirs), { i: 1, j: 1 });
      const expected = sharesSpaceWith(mover, other);
      const moverKind = shareKindOf(mover.actor);
      mover.actor.reads.items = 0;
      expect(sharesSpaceWith(mover, other, { moverKind }), `${own} / ${theirs}`).toBe(expected);
      expect(mover.actor.reads.items).toBe(0);
    }
    // Without an actor, or from one plane to another (§225): as before.
    const scene = sceneOf();
    const ghost = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    ghost.actor.statuses.add("ethereal");
    const other = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 1 });
    expect(sharesSpaceWith(ghost, other, { moverKind: null })).toBe(true);
    expect(sharesSpaceWith({ actor: null }, other, { moverKind: "enter" })).toBe(false);
  });
});
