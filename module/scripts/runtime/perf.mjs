/**
 * §98: survey of the engine's timings, on each client (the active GM resolves almost everything; a player, their own gestures).
 *  - The router times each registrant (runtime/router.mjs → `recordTiming`): above the threshold (CLIENT setting `perfWarnMs`,
 *    50 ms by default, 0 = silent), one console line — at most one per registrant every 10 s. Written with `console.info`: a
 *    measurement is not an error, and the debugger picks up every `console.warn` of the module (runtime/debug.mjs, issue #49).
 *  - The browser's "long tasks" (PerformanceObserver `longtask`, Chromium: any block longer than 50 ms, rendering of the core
 *    and of other modules included) are counted, to place the engine in the whole.
 *  - `game.modules.get("dnd5e-combat").api.perf`: `report()` (sorted lines, the costliest first), `table()` (in console),
 *    `longTasks()`, `reset()`. The same survey: `api.mcp.perf` (connector).
 * Nothing is written to the world: everything stays in the client's memory, erased on reload.
 */

import { MODULE_ID } from "../constants.mjs";
import { createPerf } from "../core/perf.mjs";

export const PERF_SETTING = "perfWarnMs";

const warned = new Map();
const perf = createPerf({
  threshold: 50,
  onSlow(row, ms) {
    const key = `${row.hook}|${row.label}`;
    const now = Date.now();
    if ( (now - (warned.get(key) ?? 0)) < 10000 ) return;
    warned.set(key, now);
    console.info(`${MODULE_ID} | slow: ${row.hook} "${row.label}" ${Math.round(ms)} ms (threshold ${perf.threshold} ms; ${row.slow} times out of ${row.calls})`);
  }
});

/** Called by the router for each registrant. */
export function recordTiming(hook, label, kind, ms) {
  perf.record(hook, label, kind, ms);
}

const long = { count: 0, totalMs: 0, maxMs: 0, since: Date.now() };
function observeLongTasks() {
  try {
    if ( !globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask") ) return false;
    new PerformanceObserver(list => {
      for ( const e of list.getEntries() ) {
        long.count++;
        long.totalMs += e.duration;
        long.maxMs = Math.max(long.maxMs, e.duration);
      }
    }).observe({ type: "longtask", buffered: false });
    return true;
  } catch { return false; }
}

export const perfApi = Object.freeze({
  /**
   * The time spent by each router registrant on this client, the costliest first: `[{ hook, label, calls, totalMs, avgMs, maxMs,
   * slow, asyncMaxMs }]`.
   */
  report: () => perf.report(),
  /**
   * The browser's "long tasks" since loading or `reset()`: `{ count, totalMs, maxMs, sinceMinutes }` (Chromium
   * only).
   */
  longTasks: () => ({ count: long.count, totalMs: Math.round(long.totalMs), maxMs: Math.round(long.maxMs), sinceMinutes: Math.round((Date.now() - long.since) / 60000) }),
  /** Prints to the console the `limit` costliest lines of `report()`, then the long tasks; returns nothing. */
  table(limit=25) {
    console.table(perf.report().slice(0, limit));
    console.log(`${MODULE_ID} | browser long tasks:`, perfApi.longTasks());
  },
  /** Resets this client's survey (registrant timings, warnings, long tasks). */
  reset() {
    perf.reset();
    warned.clear();
    Object.assign(long, { count: 0, totalMs: 0, maxMs: 0, since: Date.now() });
  }
});

export function registerPerf() {
  game.settings.register(MODULE_ID, PERF_SETTING, {
    name: "DND5ECOMBAT.Reglage.perfWarnMs.Nom", hint: "DND5ECOMBAT.Reglage.perfWarnMs.Aide",
    scope: "client", config: true, type: Number, default: 50, range: { min: 0, max: 500, step: 10 },
    onChange: value => perf.setThreshold(value)
  });
  try { perf.setThreshold(game.settings.get(MODULE_ID, PERF_SETTING)); } catch { /* unreadable setting: 50 ms */ }
  observeLongTasks();
}
