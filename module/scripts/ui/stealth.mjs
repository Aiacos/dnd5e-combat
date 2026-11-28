/**
 * §183, §185: the Stealth interface — the shortcut (Alt+C by default, configurable in Foundry's controls) that takes the
 * Stealth action out of combat for the controlled tokens (or leaves it), and, on the client of a player with a hidden token, the
 * **vision cones** (§182) of the creatures they see on the scene, cut by the walls (the core's vision polygon,
 * `ClockwiseSweepPolygon`, token angle and rotation: the core's convention, shapes/limited-angle-polygon.mjs:53).
 * Nothing is written: a local drawing.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { coneOf } from "../adapter/cone.mjs";
import { isHidden, setHidden, OUT } from "../runtime/stealth.mjs";

const FILL = 0xd94040;
const RANGE_CELLS = 12;   // range drawn when the token has no sight range: twelve cells

let layer = null;
let pending = false;

/** A creature that watches for nothing any more: at 0 HP, dead, Unconscious, Incapacitated or defeated. */
function outOfPlay(doc) {
  const actor = doc.actor;
  if ( !actor || ((actor.system?.attributes?.hp?.value ?? 1) <= 0) ) return true;
  return [...OUT, CONFIG.specialStatusEffects.DEFEATED].some(s => actor.statuses?.has(s));
}

/** The stealth-mode tokens that this client owns (on the displayed scene). */
function mySneakers() {
  return (canvas?.tokens?.placeables ?? []).filter(t => t.document.isOwner && isHidden(t.document)
    && !(game.user.isGM && !t.controlled));
}

function ensureLayer() {
  if ( layer && !layer.destroyed ) return layer;
  layer = new PIXI.Graphics();
  layer.eventMode = "none";
  layer.zIndex = 50;
  canvas.interface?.addChild(layer);
  return layer;
}

/** A cone's polygon, cut by the walls. */
function conePolygon(token, cone) {
  const doc = token.document;
  const cells = Number(doc.sight?.range) > 0 ? Number(doc.sight.range) / canvas.dimensions.distance : RANGE_CELLS;
  const radius = cells * canvas.dimensions.size;
  const config = { type: "sight", angle: cone.angle, rotation: cone.rotation, radius, level: doc.level ? canvas.scene.levels?.get?.(doc.level) : undefined };
  try { return CONFIG.Canvas.polygonBackends.sight.create(token.center, config); }
  catch { return null; }
}

function draw() {
  pending = false;
  if ( !canvas?.ready ) return;
  const g = ensureLayer();
  g.clear();
  const sneakers = mySneakers();
  if ( !sneakers.length ) return;
  for ( const token of canvas.tokens.placeables ) {
    if ( sneakers.includes(token) || !token.visible || token.document.hidden || outOfPlay(token.document) ) continue;
    const cone = coneOf(token.document);
    if ( !cone ) continue;
    const poly = conePolygon(token, cone);
    if ( !poly?.points?.length ) continue;
    g.lineStyle(2, FILL, 0.8).beginFill(FILL, 0.18).drawPolygon(poly.points).endFill();
  }
}

/** Redraw at the next frame (once, whatever the number of events). */
function schedule() {
  if ( pending ) return;
  pending = true;
  requestAnimationFrame(draw);
}

export function registerStealthUI() {
  game.keybindings?.register?.(MODULE_ID, "sneak", {
    name: "DND5ECOMBAT.Furtif.Raccourci", hint: "DND5ECOMBAT.Furtif.RaccourciAide",
    editable: [{ key: "KeyC", modifiers: ["Alt"] }],
    onDown: () => {
      const tokens = (canvas?.tokens?.controlled ?? []).filter(t => t.document.isOwner);
      if ( !tokens.length ) return false;
      // §185: the Stealth action (out of combat, no cost) or leaving it; its messages come from runtime/hide.mjs.
      Promise.all(tokens.map(t => setHidden(t.document))).then(results => {
        if ( results.some(r => r.reason === "inCombat") ) ui.notifications.info(loc("Furtif.EnCombat"));
      });
      return true;
    }
  });
  const label = { label: "sneak: cones redrawn" };
  for ( const hook of ["canvasReady", "refreshToken", "controlToken", "sightRefresh", "createToken", "deleteToken",
    "updateCombat", "deleteCombat", `${MODULE_ID}.sneak`, `${MODULE_ID}.conesChanged`] ) route(hook, schedule, label);
  route("updateToken", (doc, changes) => {
    if ( ("rotation" in changes) || ("hidden" in changes) || ("sight" in changes) || (changes.flags?.[MODULE_ID]) ) schedule();
  }, label);
  // HP and conditions: a creature that falls loses its cone.
  route("updateActor", (actor, changes) => { if ( changes.system?.attributes?.hp ) schedule(); }, label);
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"] ) route(hook, schedule, label);
  route("canvasTearDown", () => { layer?.destroy?.(); layer = null; }, { label: "sneak: layer removed" });
}
