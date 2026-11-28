/**
 * The dispatcher (SPEC §13, S2): it runs the core's action machine.
 *
 *   event → advance() → WRITE the resolution → run the commands → new events → …
 *
 * Writing always precedes execution: a command that waits for someone (reaction window) leaves behind a readable state, resumed
 * after an F5. Everything that touches the same bearer goes through a single queue, in arrival order.
 *
 * Grouped writes ("light chat log" setting, `coalesce`): each write of the flag redoes the chat card on all clients.
 * Grouped, the steps that follow each other quickly in the same task make only one write: the last stays in memory
 * (`peek` returns it), goes out `flushMs` after at the latest, and always at the end of the task. A command that waits for
 * someone (reaction, saving throw, choice) therefore leaves its state readable after `flushMs` instead of right away.
 *
 * `createDispatcher` references no global: it is tested outside Foundry, with fake ports.
 */

import { advance, open, current } from "../core/action.mjs";

/**
 * @param {object} ports
 * @param {(carrierId: string) => object|null} ports.read             Resolution carried by a message.
 * @param {(carrierId: string, resolution: object) => Promise} ports.write
 * @param {(command: object, carrierId: string, resolution: object) => Promise<object[]|void>} ports.execute
 *        Runs a core command; returns the events it produces right away, if any.
 * @param {(key: string, task: Function) => Promise} ports.enqueue    Queue by key.
 * @param {(resolution: object, event: object) => void} [ports.publish]  Output for passive consumers (SPEC §5.6).
 * @param {() => boolean} [ports.coalesce]  Group the writes (re-read at each write).
 * @param {number} [ports.flushMs]           Maximum delay of a grouped write.
 */
export function createDispatcher({ read, write, execute, enqueue, publish=() => {}, coalesce=() => false, flushMs=250 }) {

  /** Bearer → { resolution, timer }: the last resolution not yet written. */
  const staged = new Map();
  /** Bearer → last write sent: those of the same bearer arrive in order. */
  const writing = new Map();
  /**
   * §153: bearer → resolution sent for writing, not yet on the bearer. Without it, a reader placed between the start of a
   * grouped write and its arrival would re-read the old bearer (no resolution): the first saving throw of an area, launched in
   * that interval, passed for a free saving throw and was lost ("Cowardly Spirit", without Dice So Nice to delay the rolls).
   */
  const inflight = new Map();

  const peek = carrierId => staged.has(carrierId) ? staged.get(carrierId).resolution
    : (inflight.has(carrierId) ? inflight.get(carrierId) : read(carrierId));

  function writeInOrder(carrierId, resolution) {
    inflight.set(carrierId, resolution);
    const next = (writing.get(carrierId) ?? Promise.resolve()).then(() => write(carrierId, resolution));
    const settled = () => { if ( inflight.get(carrierId) === resolution ) inflight.delete(carrierId); };
    writing.set(carrierId, next.then(settled, settled));
    return next;
  }

  function flush(carrierId) {
    const entry = staged.get(carrierId);
    if ( !entry ) return writing.get(carrierId);
    staged.delete(carrierId);
    clearTimeout(entry.timer);
    return writeInOrder(carrierId, entry.resolution);
  }

  function store(carrierId, resolution) {
    const entry = staged.get(carrierId);
    if ( entry ) { entry.resolution = resolution; return; }
    if ( !coalesce() ) return writeInOrder(carrierId, resolution);
    const timer = setTimeout(() => flush(carrierId)?.catch(err => console.error("dnd5e-combat | batched write", err)), flushMs);
    staged.set(carrierId, { resolution, timer });
  }

  /** A queue task: what it changed is written before it hands back control. */
  async function task(carrierId, fn) {
    try { return await fn(); }
    finally { await flush(carrierId); }
  }

  /** Advances an already written resolution, event after event. */
  async function pump(carrierId, resolution, events) {
    const queue = [...events];
    while ( queue.length ) {
      const event = queue.shift();
      const step = advance(resolution, event);
      if ( step.resolution === resolution ) continue;   // event with no effect: nothing to write, nothing to do
      resolution = step.resolution;
      await store(carrierId, resolution);
      publish(resolution, event);
      queue.push(...await run(carrierId, resolution, step.commands));
    }
    return resolution;
  }

  async function run(carrierId, resolution, commands) {
    const events = [];
    for ( const command of commands ) events.push(...(await execute(command, carrierId, resolution) ?? []));
    return events;
  }

  return {
    /**
     * Opens a resolution on a bearer. `build` is called INSIDE the bearer's queue, and returns the
     * core's `open()` data, or null if there is nothing to resolve.
     */
    open(carrierId, build) {
      return enqueue(carrierId, () => task(carrierId, async () => {
        if ( current(peek(carrierId)) ) return null;   // already open (hook received twice)
        const data = await build();
        if ( !data ) return null;
        const first = open({ ...data, carrier: carrierId });
        await store(carrierId, first.resolution);
        publish(first.resolution, { type: "opened" });
        return pump(carrierId, first.resolution, await run(carrierId, first.resolution, first.commands));
      }));
    },

    /**
     * Submits an event to a bearer's resolution. `event` can be a function
     * `(résolution) => évènement | null`, called INSIDE the queue: it sees the current state.
     * @returns {Promise<boolean>}  false if the bearer has no resolution, or if the event did not change it.
     */
    send(carrierId, event) {
      return enqueue(carrierId, () => task(carrierId, async () => {
        const resolution = current(peek(carrierId));
        if ( !resolution ) return false;
        const actual = (typeof event === "function") ? await event(resolution) : event;
        if ( !actual ) return false;
        return (await pump(carrierId, resolution, [actual])) !== resolution;
      }));
    },

    /** Waits until everything queued for this bearer is processed. */
    drained(carrierId) {
      return enqueue(carrierId, async () => {});
    },

    /** The current resolution: still in memory (grouped writes) or written on the bearer. */
    peek
  };
}
