/**
 * §401: a client's window queue — an engine question (choice, reaction, split, requested roll) waits for the previous one to
 * be closed before opening, so that windows chain instead of piling up. A wait is capped (`capMs`): a window that
 * would wait for another left open (or that would depend on it) opens anyway at the end of the cap, as before the queue.
 * Pure: timers are passed as arguments (testable outside Foundry).
 */

/**
 * @param {object} [ports]
 * @param {() => number} [ports.capMs]  The maximum wait of a window behind the previous one.
 * @param {(ms: number) => Promise<void>} [ports.wait]
 * @param {() => number} [ports.now]
 * @returns {(<T>(open: () => Promise<T>, label?: string) => Promise<T>) &
 *   { state: () => Array<{label: string, since: number, open: boolean}> }}
 *   Opens `open` in its turn; returns what it returns. `state()`: the entries in progress (for debugging).
 */
export function createWindowLine({ capMs=() => 13000, wait=ms => new Promise(resolve => setTimeout(resolve, ms)), now=() => Date.now() }={}) {
  let last = Promise.resolve();
  const entries = new Set();
  function inLine(open, label="") {
    const before = last;
    let release;
    const mine = new Promise(resolve => { release = resolve; });
    last = mine;
    const entry = { label, since: now(), open: false };
    entries.add(entry);
    const turn = Promise.race([before, wait(capMs())]);
    return turn.then(() => { entry.open = true; return open(); }).finally(() => { entries.delete(entry); release(); });
  }
  /**
   * §422: `open` after the current window (same cap), without taking a place in the queue — the following ones do not wait
   * for it. For a window without delay that the user triggered themselves (a refusal): it does not pile on top of a question, but
   * holds back none of the questions that follow.
   */
  inLine.after = (open, label="") => {
    const entry = { label, since: now(), open: false, aside: true };
    entries.add(entry);
    return Promise.race([last, wait(capMs())]).then(() => { entry.open = true; return open(); }).finally(() => entries.delete(entry));
  };
  /** §422: how many windows are still waiting for their turn (not yet open). */
  inLine.waiting = () => [...entries].filter(e => !e.open).length;
  inLine.state = () => [...entries].map(e => ({ ...e }));
  return inLine;
}
