/**
 * Test functions (api.mcp): shared helpers — non-GM refusal, token of the displayed scene, cell or point, position in
 * JSON, windows open on the GM. Extracted from runtime/testing.mjs.
 */

import { cellOf } from "../adapter/movement.mjs";

/** These tools act as the GM: a player client calling them is refused. */
export function gmOnly() {
  if ( !game.user.isGM ) throw new Error("GM only");
}

/** The designated token, on the scene displayed by the GM. */
export function viewedToken({ tokenId }) {
  gmOnly();
  const scene = canvas.scene;
  if ( !scene || !canvas.ready ) throw new Error("no scene displayed");
  const token = scene.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} missing from the viewed scene (${scene.name})`);
  if ( !token.object ) throw new Error(`token ${token.name} not drawn`);
  return token;
}

/** The aimed cell: `cell` ({ i, j }) or `point` ({ x, y } in pixels, like a click). */
export function cellArg(token, { cell, point }) {
  if ( cell ) return { i: cell.i, j: cell.j };
  if ( point ) return token.parent.grid.getOffset(point);
  throw new Error("cell { i, j } or point { x, y } required");
}

export const finite = n => (Number.isFinite(n) ? n : null);

/** Validated position of a token: what the engine reads. */
export function positionJson(token) {
  const { x, y, elevation, level } = token._source;
  return { x, y, elevation: elevation ?? 0, level: level ?? null, cell: cellOf(token), movementAction: token.movementAction ?? null };
}

export const waypointOf = ({ x, y, elevation, level, action, climb }) =>
  ({ x, y, elevation: finite(elevation), level: level ?? null, action: action ?? null, climb: finite(climb) });

/**
 * The windows open on the GM (ApplicationV2): to find a dialog that a blocked move is waiting for. The core's fixed interface
 * (sidebar, chat log, tokens tab, macro bar…) is also an ApplicationV2, without a frame: not a window. A sweep that "closes the
 * windows" closed the sidebar, and `ui.chat.element` stayed null until F5.
 */
export function windows() {
  gmOnly();
  return [...foundry.applications.instances.entries()].filter(([, app]) => app.hasFrame !== false)
    .map(([id, app]) => ({ id, title: app.title ?? null, className: app.constructor?.name ?? null }));
}
