/**
 * #33 (continued): the aiming line at targeting — from the attacker (to their arrival cell if approaching) to the target,
 * green where the view is clear, orange from whatever gives Cover, red from Total Cover or beyond range, blue when the attacker
 * cannot see their target; the distance written in the middle. Drawn on this client only (`canvas.controls`), erased with the
 * cursor badge; nothing is placed on the scene. World setting `attackLine`, disabled by default.
 */

import { MODULE_ID } from "../constants.mjs";
import { attackLineOf } from "../adapter/attack-line.mjs";
import { loc } from "../runtime/shared.mjs";

const COLORS = { clear: 0x4fc35a, unseen: 0x4a9ce8, cover: 0xf09a2a, blocked: 0xe0473c };
let layer = null;

/** Is the line in service (world setting)? */
export function attackLineOn() {
  try { return game.settings.get(MODULE_ID, "attackLine") === true; } catch { return false; }
}

/**
 * A contact attack: a melee attack that is not thrown (a thrown weapon, when thrown, keeps its line). The world setting
 * `attackLineMelee` (enabled by default) shows it or not.
 */
export function meleeAttack(activity, attackMode=null) {
  return (activity?.attack?.type?.value === "melee") && !String(attackMode ?? "").includes("thrown");
}

function meleeLineOn() {
  try { return game.settings.get(MODULE_ID, "attackLineMelee") !== false; } catch { return true; }
}

function container() {
  if ( layer && !layer.destroyed && layer.parent ) return layer;
  if ( !canvas?.controls ) return null;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  canvas.controls.addChild(layer);
  return layer;
}

/** Is the line drawn? */
export function attackLineShown() {
  return !!layer && !layer.destroyed && (layer.children.length > 0);
}

export function hideAttackLine() {
  if ( layer && !layer.destroyed ) layer.removeChildren().forEach(c => c.destroy());
}

/** The distance text: "35 ft", "35 ft · long range", "70 ft · out of range". */
function distanceText(line) {
  const value = Math.round(line.distance.value * 10) / 10;
  let text;
  try { text = dnd5e.utils.formatLength(value, line.distance.units); }
  catch { text = `${value} ${line.distance.units}`; }
  if ( line.range === "longRange" ) text += ` · ${loc("LigneVisee.Longue")}`;
  else if ( line.range === "outOfRange" ) text += ` · ${loc("LigneVisee.HorsPortee")}`;
  return text;
}

/**
 * Draws the aiming line from `attacker` to `target` for `activity` (an attack).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]  `posA`: the attacker's arrival position; `unreachable`: all in red; `attackMode`: the attack
 *                            mode of dnd5e ("thrown"…).
 */
export function showAttackLine(attacker, target, activity, options={}) {
  if ( !attackLineOn() ) return hideAttackLine();
  if ( !meleeLineOn() && meleeAttack(activity, options.attackMode) ) return hideAttackLine();
  let line = null;
  try { line = attackLineOf(attacker, target, activity, options); }
  catch(err) { console.warn(`${MODULE_ID} | attack line`, err); }
  const root = line ? container() : null;
  if ( !root ) return hideAttackLine();
  hideAttackLine();
  const { from, to } = line;
  const at = t => ({ x: from.x + ((to.x - from.x) * t), y: from.y + ((to.y - from.y) * t) });
  const width = Math.max(4, canvas.dimensions.size / 14);
  const g = new PIXI.Graphics();
  // A dark fringe under the whole line, readable on any map.
  g.lineStyle({ width: width + 4, color: 0x000000, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND });
  g.moveTo(from.x, from.y).lineTo(to.x, to.y);
  for ( const s of line.segments ) {
    const a = at(s.from), b = at(s.to);
    g.lineStyle({ width, color: COLORS[s.kind], alpha: 0.95, cap: PIXI.LINE_CAP.ROUND });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  // A mark at each color change: where the obstacle, or the end of range, cuts the line.
  for ( const s of line.segments.slice(1) ) {
    const p = at(s.from);
    g.lineStyle({ width: 2, color: 0x000000, alpha: 0.8 });
    g.beginFill(COLORS[s.kind], 1).drawCircle(p.x, p.y, width * 1.2).endFill();
  }
  root.addChild(g);

  const { PreciseText } = foundry.canvas.containers;
  const style = PreciseText.getTextStyle({ fill: 0xffffff, fontSize: Math.max(16, canvas.dimensions.size / 4), stroke: 0x000000, strokeThickness: 4 });
  const label = new PreciseText(distanceText(line), style);
  label.anchor.set(0.5, 1);
  const mid = at(0.5);
  label.position.set(mid.x, mid.y - (width * 2));
  root.addChild(label);
}

export function registerAttackLine() {
  game.settings.register(MODULE_ID, "attackLine", { scope: "world", config: true, type: Boolean, default: false,
    name: "DND5ECOMBAT.Reglage.attackLine.Nom", hint: "DND5ECOMBAT.Reglage.attackLine.Aide" });
  game.settings.register(MODULE_ID, "attackLineMelee", { scope: "world", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.attackLineMelee.Nom", hint: "DND5ECOMBAT.Reglage.attackLineMelee.Aide" });
}
