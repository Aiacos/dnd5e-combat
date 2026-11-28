/**
 * §380: debugger test functions, for scenarios (`api.mcp`, `call-module-api` connector). A probe deliberately makes a router
 * subscriber fail; `debugReport` returns the report as the window would build it, with the GitHub address it would open.
 */

import { issueUrl, reportJson } from "../core/debug.mjs";
import { buildDebugReport, debugApi, DEBUG_PROBE_HOOK, flush, reportRepos } from "./debug.mjs";
import { gmOnly } from "./testing-shared.mjs";
import { testConnection } from "./connection.mjs";

/** Makes the router probe fail (`via: "route"`) or rejects an unhandled promise (`via: "rejection"`). */
export function debugThrow({ message="test", via="route" }={}) {
  gmOnly();
  if ( via === "rejection" ) Promise.reject(new Error(`DAS debug probe: ${message}`));
  else Hooks.callAll(DEBUG_PROBE_HOOK, { message });
  return { total: debugApi.total() };
}

/**
 * This client's report (GM): groups captured, Markdown, length of the JSON and of the GitHub address, proposed repositories.
 * By default, like the window, without the entries outside the suite; `all` keeps them all.
 */
export function debugReport({ description="", includeNames=false, token=null, all=false }={}) {
  gmOnly();
  const doc = token ? canvas.scene?.tokens.get(token) ?? null : null;
  const { report, markdown } = buildDebugReport({ description, includeNames, token: doc,
    selected: all ? debugApi.errors().map(g => g.sig) : undefined });
  const repos = reportRepos(report);
  const url = issueUrl({ repo: repos[0]?.repo, title: "test", body: markdown, note: "(cut)" });
  return {
    total: debugApi.total(),
    errors: report.errors.map(e => ({ sig: e.sig, module: e.module, kind: e.kind, label: e.label, hook: e.hook, count: e.count,
      thirdParty: e.thirdParty, deprecation: e.deprecation,
      clients: e.clients, message: e.message, trail: e.trail.length })),
    trail: report.trail.length, context: report.context, environment: { ...report.environment, modules: report.environment.modules?.length },
    markdown, jsonLength: reportJson(report).length, urlLength: url?.length ?? 0, repos: repos.map(r => r.repo)
  };
}

/** Clears what this client recorded (errors, trail, log). */
export function debugClear() {
  gmOnly();
  debugApi.clear();
  return { total: debugApi.total() };
}

/** This client's verbose mode, and an immediate send to the active GM (no effect on the GM itself). */
export async function debugVerbose({ on }={}) {
  gmOnly();
  const verbose = debugApi.verbose(on);
  await flush();
  return { verbose };
}

/** §388: the connection test of a connected player, as the player list menu entry launches it (without the window). */
export async function connectionTest({ userId, count=5 }={}) {
  gmOnly();
  const user = game.users.get(userId) ?? game.users.find(u => u.active && !u.isGM);
  if ( !user ) throw new Error("no connected player");
  const r = await testConnection(user, { count });
  return { role: r.role, pings: r.pings, findings: r.findings, probe: r.probe ? { ...r.probe, settings: r.probe.settings } : null };
}
