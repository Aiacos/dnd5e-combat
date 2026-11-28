/**
 * Client of the universal MCP connector through its HTTP transport (Streamable HTTP), without depending on
 * the frozen tool list of a Claude session. Shared by `tools/mcp.mjs` (one call) and
 * `tools/scenario.mjs` (a series of calls). The server must be running and the world open on
 * the GM's side: it is THEIR client that executes, with the engine code it has loaded (F5 after a pull).
 */

export const DEFAULT_URL = "http://localhost:31416/mcp";

export async function connect({ url=process.env.MCP_URL ?? DEFAULT_URL, client="dnd5e-combat-tests" }={}) {
  let sessionId = null;
  let nextId = 1;

  async function rpc(method, params, { notification=false }={}) {
    const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if ( !notification ) body.id = nextId++;
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if ( sessionId ) headers["Mcp-Session-Id"] = sessionId;
    let response;
    try { response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }); }
    catch(err) { throw new Error(`connecteur injoignable sur ${url} (${err.cause?.code ?? err.message}) : lancer le serveur`); }
    sessionId ??= response.headers.get("mcp-session-id");
    if ( notification ) return null;
    const text = await response.text();
    if ( !response.ok ) throw new Error(`HTTP ${response.status} : ${text.slice(0, 300)}`);
    // Direct JSON response, or SSE stream whose last "data:" line carries the response.
    const payload = text.trimStart().startsWith("{") ? text
      : text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).pop();
    const message = JSON.parse(payload);
    if ( message.error ) throw new Error(`${message.error.code} ${message.error.message}`);
    return message.result;
  }

  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: client, version: "1" } });
  await rpc("notifications/initialized", undefined, { notification: true });

  return {
    /** The names of the server's tools. */
    async list() {
      const { tools } = await rpc("tools/list", {});
      return tools.map(t => t.name);
    },

    /**
     * Calls a tool. Returns the JSON object of the response (or the raw text). A tool's error
     * response throws, with its text.
     */
    async call(tool, args={}) {
      const result = await rpc("tools/call", { name: tool, arguments: args });
      const text = (result.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
      if ( result.isError ) throw new Error(`${tool} : ${text}`);
      try { return JSON.parse(text); }
      catch { return text; }
    },

    /**
     * Closes the session on the server side (DELETE). Without it each call left a session open:
     * 844 in one day of tests, and the connector went down. No effect if already closed.
     */
    async close() {
      if ( !sessionId ) return;
      const id = sessionId;
      sessionId = null;
      try { await fetch(url, { method: "DELETE", headers: { "Mcp-Session-Id": id } }); }
      catch { /* server stopped: nothing to close */ }
    }
  };
}
