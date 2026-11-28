#!/usr/bin/env node
// Calls a tool of the universal MCP connector through its HTTP transport (Streamable HTTP), without
// depending on the frozen tool list of a Claude session: the desktop extension bundles its
// own copy of the definitions and does not see tools added since it was packaged.
//
//   node tools/mcp.mjs <tool> '<parameters json>'          result on stdout (JSON)
//   node tools/mcp.mjs --list                               names of the server's tools
//
// The server must be running (lancer-connecteur.bat) and the world open on the GM's side.
// The client itself is in lib/connector.mjs (shared with tools/scenario.mjs).

import { connect } from "./lib/connector.mjs";

const [tool, rawParams] = process.argv.slice(2);
if ( !tool ) {
  console.error("usage : node tools/mcp.mjs <tool> '<json>' | --list");
  process.exit(2);
}

let mcp;
try {
  mcp = await connect();
  if ( tool === "--list" ) console.log((await mcp.list()).join("\n"));
  else {
    const result = await mcp.call(tool, rawParams ? JSON.parse(rawParams) : {});
    console.log((typeof result === "string") ? result : JSON.stringify(result, null, 2));
  }
} catch(err) {
  console.error(`mcp : ${err.message}`);
  process.exitCode = 1;
} finally {
  await mcp?.close();
}
