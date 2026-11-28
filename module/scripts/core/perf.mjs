/**
 * §98: engine timing survey — per router registrant (hook + label): the SYNCHRONOUS time of each call (the computation that
 * blocks the browser) and, for a registrant that returns a promise, the time until it settles (waits included: a player's
 * answer, a 3D dice roll — informational, not a computation cost). Pure: the clock is given.
 */

/**
 * @param {object} [options]
 * @param {number} [options.threshold=50]  Beyond this (ms, synchronous), the call is "slow" and reported (`onSlow`).
 * @param {(row: object, ms: number) => void} [options.onSlow]
 */
export function createPerf({ threshold=50, onSlow=() => {} }={}) {
  let rows = new Map();
  let limit = threshold;
  const rowOf = (hook, label) => {
    const key = `${hook}|${label}`;
    let row = rows.get(key);
    if ( !row ) rows.set(key, row = { hook, label, calls: 0, syncTotal: 0, syncMax: 0, slow: 0, asyncCalls: 0, asyncMax: 0 });
    return row;
  };
  return {
    /** A call: `kind` "sync" (the blocking time) or "async" (until the promise settles). */
    record(hook, label, kind, ms) {
      if ( !Number.isFinite(ms) || (ms < 0) ) return;
      const row = rowOf(hook, label);
      if ( kind === "async" ) {
        row.asyncCalls++;
        row.asyncMax = Math.max(row.asyncMax, ms);
        return;
      }
      row.calls++;
      row.syncTotal += ms;
      row.syncMax = Math.max(row.syncMax, ms);
      if ( limit && (ms > limit) ) {
        row.slow++;
        onSlow(row, ms);
      }
    },
    /** The rows, most expensive first (cumulative synchronous time), rounded to a tenth of a ms. */
    report() {
      const r = n => Math.round(n * 10) / 10;
      return Array.from(rows.values())
        .map(x => ({ hook: x.hook, label: x.label, calls: x.calls, totalMs: r(x.syncTotal), avgMs: x.calls ? r(x.syncTotal / x.calls) : 0,
          maxMs: r(x.syncMax), slow: x.slow, asyncMaxMs: r(x.asyncMax) }))
        .sort((a, b) => (b.totalMs - a.totalMs) || (b.maxMs - a.maxMs));
    },
    reset() { rows = new Map(); },
    setThreshold(ms) { limit = Math.max(0, Number(ms) || 0); },
    get threshold() { return limit; }
  };
}
