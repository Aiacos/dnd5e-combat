/**
 * Complete scenarios, outside Foundry: the core and the dispatcher, with fake ports in place of
 * chat messages and adapters. What these tests hold: the order (write BEFORE
 * executing), the queue per bearer, and the whole path of an action.
 */
import { describe, it, expect } from "vitest";
import { createDispatcher } from "../module/scripts/runtime/dispatcher.mjs";
import { STEPS } from "../module/scripts/core/action.mjs";

function world({ reaction=null, coalesce=false, flushMs=250, think=5, writeMs=0 }={}) {
  const flags = new Map();
  const peeks = [];
  let dispatcher = null;
  const journal = [];
  const published = [];
  const queues = new Map();
  const enqueue = (key, task) => {
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(key, next.catch(() => {}));
    return next;
  };
  const execute = async (command, carrier, resolution) => {
    journal.push(`${command.type}${command.on ? `:${command.on}` : ""} @${flags.get(carrier).step}`);
    if ( command.type === "askReactions" ) {
      await new Promise(resolve => setTimeout(resolve, think));   // someone is thinking
      peeks.push(dispatcher.peek(carrier)?.step ?? null);         // ce qu'un lecteur voit pendant l'attente
      return command.tokens.map(token => ({ type: "reactionResolved", token, ...(reaction ?? { used: null, ac: 12 }) }));
    }
    if ( command.type === "apply" ) return [{ type: "applied", entries: command.entries.map(e => ({
      token: e.token, actor: e.actor, effects: e.effects.map(x => `fx:${x.id}`),
      before: e.multiplier ? { value: 20, temp: 0 } : null,
      after: e.multiplier ? { value: 20 - (8 * e.multiplier), temp: 0 } : null
    })) }];
  };
  dispatcher = createDispatcher({
    read: id => flags.get(id) ?? null,
    write: async (id, resolution) => {
      if ( writeMs ) await new Promise(resolve => setTimeout(resolve, writeMs));   // the write takes time to arrive
      flags.set(id, resolution); journal.push(`écrit ${resolution.step}`);
    },
    execute, enqueue, coalesce: () => coalesce, flushMs,
    publish: (resolution, event) => published.push(`${event.type}→${resolution.step}`)
  });
  return { flags, journal, published, dispatcher, peeks };
}

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
const opening = (plan, targets) => async () => ({ id: "r", origin: "U", activity: "Act", source: "Src", plan, targets });
const FIRE = [{ type: "fire", value: 8, properties: [] }];

describe("dispatcher", () => {
  it("attack with Shield: the \"reaction\" step is written before we wait for the answer", async () => {
    const { dispatcher, journal, flags } = world({ reaction: { used: "Bouclier", ac: 17 } });
    await dispatcher.open("U", opening({ attack: true, damage: "author" }, []));
    await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
      targets: [T(1, { canReact: true })] });
    expect(journal).toEqual([
      "écrit awaitingAttack",
      "écrit awaitingReaction", "askReactions @awaitingReaction",
      "écrit missed", "echo:attack @missed"
    ]);
    expect(flags.get("U").targets[0]).toMatchObject({ hit: false, reaction: "Bouclier" });
  });

  it("area save: simultaneous rolls put in series, applied once, everything is published", async () => {
    const { dispatcher, journal, flags, published } = world();
    const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
    await dispatcher.open("U", opening({ save, damage: "author", effects: [{ id: "E", activity: "Act", when: "failedSave" }] }, [T(1), T(2), T(3)]));
    const results = await Promise.all([
      dispatcher.send("U", { type: "saveRolled", actor: "A1", total: 18, messageId: "s1" }),
      dispatcher.send("U", { type: "saveRolled", actor: "A2", total: 4, messageId: "s2" }),
      dispatcher.send("U", { type: "damageRolled", messageId: "D", damages: FIRE }),
      dispatcher.send("U", { type: "saveRolled", actor: "A3", total: 9, messageId: "s3" }),
      dispatcher.send("U", { type: "saveRolled", actor: "A3", total: 20, messageId: "s4" })   // double click: ignored
    ]);
    expect(results).toEqual([true, true, true, true, false]);
    expect(journal.filter(l => l.startsWith("apply"))).toHaveLength(1);
    const done = flags.get("U");
    expect(done.step).toBe(STEPS.DONE);
    expect(done.targets.map(t => [t.save.success, t.damage.applied, t.effects])).toEqual([
      [true, 4, []], [false, 8, ["fx:E"]], [false, 8, ["fx:E"]]
    ]);
    expect(published.at(0)).toBe("opened→awaitingRolls");
    expect(published.at(-1)).toBe("applied→done");
  });

  it("an event computed in the queue sees the state of the moment, and can give up", async () => {
    const { dispatcher } = world();
    await dispatcher.open("U", opening({ attack: true }, []));
    const seen = [];
    const taken = await dispatcher.send("U", resolution => { seen.push(resolution.step); return null; });
    expect(seen).toEqual([STEPS.AWAITING_ATTACK]);
    expect(taken).toBe(false);
  });

  it("does not open the same bearer twice, opens nothing if the builder gives up, ignores a bearer without a resolution", async () => {
    const { dispatcher, journal } = world();
    expect(await dispatcher.open("X", async () => null)).toBe(null);
    await dispatcher.open("U", opening({ attack: true }, []));
    expect(await dispatcher.open("U", opening({ attack: true }, []))).toBe(null);
    expect(journal).toEqual(["écrit awaitingAttack"]);
    expect(await dispatcher.send("inconnu", { type: "undone" })).toBe(false);
  });

  it("drained waits for the end of what is queued", async () => {
    const { dispatcher, flags } = world();
    dispatcher.open("U", opening({ effects: [{ id: "Bouclier", activity: "Act", when: "always" }] }, [T(1)]));
    await dispatcher.drained("U");
    expect(flags.get("U").step).toBe(STEPS.DONE);
  });

  describe("batched writes (lightened journal)", () => {
    const attack = async dispatcher => {
      await dispatcher.open("U", opening({ attack: true, damage: "author", effects: [{ id: "E", activity: "Act", when: "hit" }] }, []));
      await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1)] });
      await dispatcher.send("U", { type: "damageRolled", messageId: "D", damages: FIRE });
    };
    const writes = journal => journal.filter(l => l.startsWith("écrit"));

    it("a hit attack: one write per task instead of one per step, same final state", async () => {
      const off = world();
      await attack(off.dispatcher);
      const on = world({ coalesce: true });
      await attack(on.dispatcher);
      expect(writes(on.journal).length).toBeLessThan(writes(off.journal).length);
      expect(writes(on.journal)).toEqual(["écrit awaitingAttack", "écrit awaitingRolls", "écrit done"]);
      expect(on.flags.get("U")).toEqual(off.flags.get("U"));
      expect(on.published).toEqual(off.published);   // each step stays published
    });

    it("peek returns the in-memory state before it is written", async () => {
      const { dispatcher, flags } = world({ coalesce: true, flushMs: 1000 });
      const seen = [];
      await dispatcher.open("U", async () => {
        seen.push(dispatcher.peek("U"));
        return { id: "r", origin: "U", activity: "Act", source: "Src", plan: { attack: true }, targets: [] };
      });
      expect(seen).toEqual([null]);
      expect(flags.get("U").step).toBe(STEPS.AWAITING_ATTACK);   // written at the end of the task, without waiting for the delay
      expect(dispatcher.peek("U").step).toBe(STEPS.AWAITING_ATTACK);
    });

    it("a command that waits for someone: the waiting state is written at the end of the delay, not at the end", async () => {
      const { dispatcher, journal } = world({ coalesce: true, flushMs: 10, think: 60, reaction: { used: null, ac: 12 } });
      await dispatcher.open("U", opening({ attack: true, damage: "author" }, []));
      await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { canReact: true })] });
      const i = journal.indexOf("écrit awaitingReaction");
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(journal.indexOf("echo:attack @awaitingReaction"));   // written during the wait, before the answer
    });

    it("§153: while a batched write is in flight, peek returns the departed state, not the previous bearer", async () => {
      // Write sent at 10 ms, arrived at 80 ms; the reader looks at 30 ms, during the trip.
      const { dispatcher, peeks } = world({ coalesce: true, flushMs: 10, writeMs: 70, think: 30, reaction: { used: null, ac: 12 } });
      await dispatcher.open("U", opening({ attack: true, damage: "author" }, []));
      await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { canReact: true })] });
      expect(peeks).toEqual([STEPS.AWAITING_REACTION]);
    });
  });
});
