/**
 * Hook router (SPEC §13, S1). Each Foundry hook is wired ONCE; the
 * features register with it, and are called in the order of their registration — an order
 * that is read in `dnd5e-combat.mjs` instead of being deduced from the import order.
 *
 * Three things that each file used to do by hand:
 *  - `executor`: runs only on the active GM's client (SPEC §5.3)
 *  - an error, synchronous or in a promise, is logged and stops neither the following ones nor the game
 *  - `cancellable`: for a hook that Foundry calls with `Hooks.call` (`pre…`), a `false`
 *    stops the chain and cancels the operation. Without this option the return value is ignored,
 *    as `Hooks.callAll` does.
 *
 * `createRouter` references no global: it can be tested outside Foundry.
 */

import { MODULE_ID } from "../constants.mjs";
import { recordTiming } from "./perf.mjs";
import { isExecutor } from "./shared.mjs";
import { theaterActive } from "./theater-state.mjs";
import { concernsVanilla } from "../adapter/vanilla-state.mjs";
import { noteRouterError, noteRefused } from "./debug.mjs";

/** §220: the startup hooks always pass — their listeners must be installed so that we can switch back on without reloading. */
export const STARTUP_HOOKS = Object.freeze(["init", "i18nInit", "setup", "ready"]);

/**
 * @param {object} deps
 * @param {(hook: string, fn: Function) => void} deps.subscribe  Wires `fn` to a Foundry hook.
 * @param {() => boolean} deps.isExecutor
 * @param {(entry: {hook: string, label: string, notify?: string, level?: string}, err: Error) => void} deps.report
 * @param {(entry: {hook: string, label: string}) => void} [deps.refused]  A registrant cancelled the operation (trace).
 * @param {{now: () => number, record: (hook: string, label: string, kind: "sync"|"async", ms: number) => void}} [deps.timing]
 *   §98: times each call — the synchronous time, and for a promise, the time until it ends (core/perf.mjs).
 * @param {(hook: string, args: any[]) => boolean} [deps.paused]  §220: Theater of the Mind — nothing passes, except the
 *   startup hooks and the `always` registrations. §395: receives the hook and its arguments (an action launched without DAS
 *   silences only its hooks).
 */
export function createRouter({ subscribe, isExecutor, report, refused=() => {}, timing=null, paused=() => false }) {
  const routes = new Map();
  // §117: during `withoutRoutes`, a registration is noted but nothing is wired (feature above the chosen level).
  let suspended = null;
  const skipped = [];

  function dispatch(hook, args) {
    const startup = STARTUP_HOOKS.includes(hook);
    let off = !startup && paused(hook, args);
    for ( const entry of routes.get(hook) ) {
      if ( off && !entry.always ) continue;
      if ( entry.executor && !isExecutor() ) continue;
      let result;
      const t0 = timing ? timing.now() : 0;
      try { result = entry.handler(...args); }
      catch(err) { report(entry, err); continue; }
      finally { if ( timing ) timing.record(hook, entry.label, "sync", timing.now() - t0); }
      // §395: a registrant that marks what is created ("without DAS") — the following ones re-read the state.
      if ( entry.marks && !off ) off = !startup && paused(hook, args);
      if ( typeof result?.then === "function" ) {
        result.then(timing ? () => timing.record(hook, entry.label, "async", timing.now() - t0) : null, err => report(entry, err));
      }
      else if ( entry.cancellable && (result === false) ) {
        refused(entry);
        return false;
      }
    }
    return true;
  }

  return {
    /**
     * @param {string} hook
     * @param {Function} handler
     * @param {object} [options]
     * @param {string} [options.label]        What is read in the console if the processing fails.
     * @param {boolean} [options.executor]    Active GM only.
     * @param {boolean} [options.cancellable] `false` cancels the operation and stops the chain.
     * @param {string} [options.notify]       Translation key of an error notification.
     * @param {"error"|"warn"} [options.level]
     * @param {boolean} [options.always]      §220: also passes during Theater of the Mind (its own button).
     * @param {boolean} [options.marks]       §395: marks the document being created; the following registrants re-read `paused`.
     */
    on(hook, handler, { label=hook, executor=false, cancellable=false, notify=null, level="error", always=false, marks=false }={}) {
      if ( suspended ) { skipped.push({ hook, label, feature: suspended }); return; }
      if ( !routes.has(hook) ) {
        routes.set(hook, []);
        subscribe(hook, (...args) => dispatch(hook, args));
      }
      routes.get(hook).push({ hook, handler, label, executor, cancellable, notify, level, always, marks });
    },

    /**
     * §117: runs `register` without wiring its listeners — its settings and its queries are declared, its hooks are not.
     * @param {string} feature   Its name, for inspection.
     * @param {Function} register
     */
    withoutRoutes(feature, register) {
      suspended = feature;
      try { return register(); }
      finally { suspended = null; }
    },

    /** The registrations set aside by `withoutRoutes`: `[{ hook, label, feature }]`. */
    skipped() {
      return skipped.slice();
    },

    /** Who listens to what, in which order: for inspection (`api.routes()`). */
    describe() {
      return Object.fromEntries(Array.from(routes, ([hook, entries]) =>
        [hook, entries.map(({ label, executor, cancellable }) => ({ label, executor, cancellable }))]));
    }
  };
}

const router = createRouter({
  subscribe: (hook, fn) => Hooks.on(hook, fn),
  isExecutor,
  report: (entry, err) => {
    noteRouterError(entry, err);   // §380: the debugger, with the label and the hook (the console does not pick it up twice)
    console[entry.level](`${MODULE_ID} | ${entry.label}`, err);
    if ( entry.notify ) ui.notifications.error(entry.notify, { localize: true });
  },
  // Who cancels what: a move stopped along the way is read like this in the console (get-client-errors, watch).
  refused: entry => {
    noteRefused(entry);   // §380 : un geste de la piste
    console.log(`${MODULE_ID} | ${entry.hook} cancelled by "${entry.label}"`);
  },
  // §98: timing survey (runtime/perf.mjs).
  timing: { now: () => performance.now(), record: recordTiming },
  // §220: Theater of the Mind; §395: an action launched without DAS, and what follows from it.
  paused: (hook, args) => theaterActive() || concernsVanilla(args)
});

export const route = router.on;
export const describeRoutes = router.describe;
export const withoutRoutes = router.withoutRoutes;
export const skippedRoutes = router.skipped;
