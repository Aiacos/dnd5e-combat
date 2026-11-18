/** §105 : partager la case d'une autre créature. */
import { describe, it, expect, beforeAll } from "vitest";
import { mayShareSpace, widerShare } from "../module/scripts/core/space-sharing.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("partage de case (§105)", () => {
  it("entrer dans la case d'une créature, ou l'inverse pour une nuée", () => {
    expect(mayShareSpace("enter", null)).toBe(true);
    expect(mayShareSpace("mutual", null)).toBe(true);
    expect(mayShareSpace(null, "mutual")).toBe(true);    // « and vice versa »
    expect(mayShareSpace(null, "enter")).toBe(false);    // une Forme d'air ne s'ouvre pas aux autres
    expect(mayShareSpace(null, null)).toBe(false);
  });

  it("la plus large l'emporte", () => {
    expect(widerShare(null, "enter")).toBe("enter");
    expect(widerShare("mutual", "enter")).toBe("mutual");
    expect(widerShare("enter", null)).toBe("enter");
  });

  it("contenu livré", () => {
    expect(CONTENT["air-form"].sharesSpace).toBe("enter");
    expect(CONTENT.swarm.sharesSpace).toBe("mutual");
    for ( const id of ["air-form", "fire-form", "water-form", "gaseous-form", "swarm", "misty-form"] ) {
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ sharesSpace: true })).toHaveLength(1);
  });
});

/**
 * Le chemin du moteur (adapter/path-world.mjs, `worldFor`) : les cases où l'on ne peut pas finir sont celles des autres tokens,
 * sauf ceux dont on peut partager la case. Ce que celui qui bouge sait faire ne dépend pas de l'autre : ses objets ne sont lus
 * qu'une fois par recherche, pas une fois par token de la scène.
 */
describe("partage de case dans le chemin du moteur (§105)", () => {
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

  it("une scène de 40 tokens : les objets de celui qui bouge sont lus une fois, pas une fois par token", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword", "second-wind"]), { i: 0, j: 0 });
    for ( let n = 0; n < 39; n++ ) tokenOf(scene, actorOf(["claws"]), { i: 2 + (n % 7), j: 2 + Math.floor(n / 7) });
    const world = worldFor(mover);
    expect(mover.actor.reads.items).toBe(1);
    expect(world.canEnd({ i: 2, j: 2 })).toBe(false);   // la case d'un autre
    expect(world.canEnd({ i: 1, j: 1 })).toBe(true);
  });

  it("mêmes cases interdites qu'en demandant token par token (`sharesSpaceWith`)", () => {
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

  it("rien n'est gardé d'une recherche à l'autre : une Forme d'air gagnée, perdue ou changée compte à la suivante", () => {
    const scene = sceneOf();
    const mover = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    tokenOf(scene, actorOf(["claws"]), { i: 3, j: 3 });
    const cell = { i: 3, j: 3 };
    expect(worldFor(mover).canEnd(cell)).toBe(false);
    const form = itemOf(mover.actor, "air-form", "form");
    mover.actor.list.push(form);                       // objet ajouté
    expect(worldFor(mover).canEnd(cell)).toBe(true);
    form.system.identifier = "plain-feature";          // objet changé
    expect(worldFor(mover).canEnd(cell)).toBe(false);
    form.system.identifier = "air-form";
    expect(worldFor(mover).canEnd(cell)).toBe(true);
    mover.actor.list.pop();                            // objet retiré
    expect(worldFor(mover).canEnd(cell)).toBe(false);
  });

  it("`sharesSpaceWith` avec ce que sait faire celui qui bouge déjà lu : même réponse, ses objets ne sont pas relus", () => {
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
    // Sans acteur, ou d'un plan à l'autre (§225) : comme avant.
    const scene = sceneOf();
    const ghost = tokenOf(scene, actorOf(["longsword"]), { i: 0, j: 0 });
    ghost.actor.statuses.add("ethereal");
    const other = tokenOf(scene, actorOf(["claws"]), { i: 1, j: 1 });
    expect(sharesSpaceWith(ghost, other, { moverKind: null })).toBe(true);
    expect(sharesSpaceWith({ actor: null }, other, { moverKind: "enter" })).toBe(false);
  });
});
