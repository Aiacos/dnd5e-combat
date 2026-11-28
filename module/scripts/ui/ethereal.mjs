/**
 * §225, batch 2: what the Ethereal changes on screen, on each client, writing nothing.
 *  - an Ethereal token is displayed as a ghost (transparent) for whoever perceives it — "creatures there appear
 *    ghostly" (See Invisibility); for the others, the detection modes hide it (ui/perception.mjs);
 *  - when the client's point of view is Ethereal (its controlled tokens, otherwise, for a player, their character), the scene turns
 *    grey — "the plane you left … in shades of grey" (Blink, Etherealness) — and Ethereal tokens are no longer
 *    ghosts: it is the Material Plane that is. A neighbor that draws a richer view takes it by answering false to the hook
 *    `dnd5e-combat.etherealView` (`{ active }`): the engine then removes its grey.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { theaterActive } from "../runtime/theater-state.mjs";
import { isEthereal } from "../adapter/plane.mjs";
import { etherealLight } from "../core/plane.mjs";

const GHOST_ALPHA = 0.45;

let gray = null;

/** The tokens this client looks from: the controlled ones, otherwise those of a player's character. */
function viewpoint() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if ( controlled.length || game.user.isGM ) return controlled;
  return game.user.character?.getActiveTokens?.() ?? [];
}

let ghost = null;

/**
 * The ghost: a transparency filter on the token image, applied or removed at each refresh. Not `mesh.alpha`, which the core
 * recomputes and a neighbor rewrites after us (DAS · Shadows & Ambience, elevation perspective: seen in play).
 */
function onRefresh(token) {
  shadeLight(token);
  const mesh = token?.mesh;
  if ( !mesh || mesh.destroyed ) return;
  const want = !theaterActive() && isEthereal(token.document) && !viewpointEthereal();
  const has = !!mesh.filters?.includes(ghost);
  if ( want === has ) return;
  ghost ??= new PIXI.AlphaFilter(GHOST_ALPHA);
  const filters = (mesh.filters ?? []).filter(f => f !== ghost);
  if ( want ) filters.push(ghost);
  mesh.filters = filters.length ? filters : null;
}

/**
 * An Ethereal token does not light (core/plane.mjs `etherealLight`): its prepared radii are set to zero in memory, on each
 * client, and its light source rebuilt — nothing is written, the torch stays on the sheet and relights on return. The token
 * data preparation resets its radii at each update: we pass here again at each token refresh.
 */
const shaded = new Set();   // ids of the tokens we turned off
function shadeLight(token) {
  const doc = token?.document;
  const light = doc?.light;
  if ( !light || token.destroyed ) return;
  const action = etherealLight({ ethereal: !theaterActive() && isEthereal(doc), dim: light.dim, bright: light.bright,
    shaded: shaded.has(doc.id) });
  if ( !action ) return;
  if ( action === "shade" ) {
    shaded.add(doc.id);
    light.dim = 0;
    light.bright = 0;
  }
  else {
    shaded.delete(doc.id);
    if ( action === "reprepare" ) doc.reset();
  }
  token.initializeLightSource();
}

/** Is this client's point of view in the Ethereal? */
const viewpointEthereal = () => viewpoint().some(t => isEthereal(t.document));

/** The scene in grey when the point of view is Ethereal — unless a neighbor takes the view over. */
function updateView() {
  if ( !canvas?.ready || !canvas.stage ) return;
  const on = !theaterActive() && viewpointEthereal();
  // §225: on this client, at each recomputation of its view (control of a token, Ethereal condition applied or removed):
  // `({ active })` — is its point of view in the Ethereal? Cancellable: `false` and the engine does not grey the scene
  // (the neighbor draws its own view).
  const claimed = Hooks.call(`${MODULE_ID}.etherealView`, { active: on }) === false;
  const filters = (canvas.stage.filters ?? []).filter(f => f !== gray);
  if ( on && !claimed ) {
    if ( !gray ) {
      gray = new PIXI.ColorMatrixFilter();
      gray.desaturate();
    }
    filters.push(gray);
  }
  canvas.stage.filters = filters.length ? filters : null;
}

/**
 * A condition applied or removed: the tokens' opacity, who sees whom, and the view. On the loop's next tick: at the time of the
 * hook, the synthetic actor of an unlinked token does not have its new statuses yet (seen in play: the core test said "hidden",
 * the token stayed displayed).
 */
function refreshAll(effect) {
  if ( !canvas?.ready || !(effect?.statuses?.has?.("ethereal")) ) return;
  setTimeout(() => {
    if ( !canvas?.ready ) return;
    canvas.perception.update({ refreshVision: true });
    for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true, refreshVisibility: true });
    updateView();
  }, 0);
}

export function registerEtherealUI() {
  route("refreshToken", onRefresh, { label: "ethereal: ghost not drawn" });
  const label = { label: "ethereal: view not updated" };
  // Changing point of view also changes who is a ghost.
  const viewChanged = () => {
    updateView();
    for ( const token of canvas?.tokens?.placeables ?? [] ) token.renderFlags.set({ refreshState: true });
  };
  for ( const hook of ["canvasReady", "controlToken", `${MODULE_ID}.etherealPlane`] ) route(hook, viewChanged, label);
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) route(hook, refreshAll, label);
  route("destroyToken", token => shaded.delete(token?.document?.id), { label: "ethereal: kept light forgotten" });
  route("canvasTearDown", () => { if ( canvas?.stage?.filters ) canvas.stage.filters = canvas.stage.filters.filter(f => f !== gray); },
    { label: "ethereal: gray filter removed" });
}
