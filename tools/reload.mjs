#!/usr/bin/env node
/**
 * The GM client's F5, without a human hand: `api.mcp.reload` (runtime/testing.mjs) through the connector, then waiting for the
 * client to come back with the fresh code (`api.mcp.status`, load time changed). Run after any engine change, before a scenario:
 *
 *   node tools/reload.mjs && node tools/scenario.mjs entrave
 *
 * Prerequisite: the GM client has already loaded a version that has `reload` (0.112.0 and later) — otherwise, an F5 by hand.
 * `call-module-api` exists only in a world where the connector's "Test tools" setting is enabled.
 */

import { connect } from "./lib/connector.mjs";

const MODULE_ID = "dnd5e-combat";
const TIMEOUT_MS = 90000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function engine(mcp, fn) {
  const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args: {}, waitMs: 5000 });
  if ( !r.settled ) throw new Error(`${fn} : pas de réponse`);
  return r.result;
}

let mcp;
try {
  mcp = await connect();
  const before = await engine(mcp, "status");
  await engine(mcp, "reload");
  process.stdout.write(`F5 du client de ${before.user} (moteur ${before.version})`);
  const until = Date.now() + TIMEOUT_MS;
  let after = null;
  while ( Date.now() < until ) {
    await sleep(2000);
    process.stdout.write(".");
    after = await engine(mcp, "status").catch(() => null);
    if ( after?.ready && (after.bootedAt !== before.bootedAt) ) break;
    after = null;
  }
  if ( !after ) throw new Error(`le client n'est pas revenu en ${TIMEOUT_MS / 1000} s`);
  console.log(` rechargé : moteur ${after.version}${after.activeGM ? "" : " — ATTENTION : ce client n'est pas le MJ actif"}`);
  // The canvas and the engine's hooks finish installing after `ready`.
  await sleep(3000);
} catch(err) {
  console.error(`\nreload : ${err.message}`);
  process.exitCode = 1;
} finally {
  await mcp?.close();
}
