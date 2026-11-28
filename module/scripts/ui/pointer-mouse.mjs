/**
 * The engine's mouse: left and right clicks on the canvas, path preview and cursor on hover, Dash, recall,
 * teleportation, keys. Extracted from ui/pointer.mjs.
 */

import { forwardsIssue } from "../core/forced.mjs";
import { typingIn } from "../core/typing.mjs";
import { MODULE_ID } from "../constants.mjs";
import { footprintGap } from "../core/movement.mjs";
import { positionOf, distanceBetween } from "../adapter/turn.mjs";
import { planPath, previewPath, cellUnder, footprintOf, stairsEntry, stairsDestinations } from "../adapter/movement.mjs";
import { strike } from "../runtime/storm.mjs";
import { movementCap, reachCells, basicAttack, hostileTo, moveTo, approaches, contactAction, contactRefusal, planeRefusal, rangeStatus, currentTeleport, teleportClick, dashStrike, dashRefusal, dashPreview, gapCells, tooHighFor } from "../runtime/actions.mjs";
import { pocketedFamiliar, recallFamiliar, recallRefusal } from "../runtime/familiar.mjs";
import { leapProblem } from "../runtime/projectiles.mjs";
import { chainOf, chainLimit, chainOutliers } from "../adapter/chain.mjs";
import { tetherOfActivity, tetheredToken } from "../adapter/tether.mjs";
import { askAnyway, closeLegalityDialogs, openLegalityDialogs } from "../runtime/turn.mjs";
import { doorState, setDoorOpen } from "../runtime/doors.mjs";
import { cleaveCandidates } from "../adapter/mastery.mjs";
import { cancelPendingRoll, pendingRoll } from "../runtime/cancel.mjs";
import { loc } from "../runtime/shared.mjs";
import { fireTargetAt, igniteWithActivity } from "../runtime/flammable.mjs";
import { showHitChance, showSaveChance, hideHitChance, showBadge, hitChanceShown } from "./hitchance.mjs";
import { showAttackLine } from "./attack-line.mjs";
import { floatNotice } from "./feedback.mjs";
import { actingToken, busy, dashing, engageWith, exclusive, finishGroup, inCombat, interruptWalk, markTargeting, openRecall, pickTarget, picking, placing, promptTargeting, recalling, setReticleRefused, setting, stopTargeting, targetTypeRefusal, targeting } from "./pointer.mjs";
import { closeMenu, doorEntries, groundEntries, hasSelfMenu, hoveredDoor, menu, openMenu, openTokenMenu, selfEntries, stairsEntries } from "./pointer-menu.mjs";
import { clearTargets } from "./pointer-offers.mjs";

/* -------------------------------------------- */
/*  Souris                                      */
/* -------------------------------------------- */

const onBoard = event => !!canvas.ready && (event.target === canvas.app?.view);
const plain = event => !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
/** An attack click accepts Alt and Ctrl: these are dnd5e's Advantage and Disadvantage keys (§15.1). */
const attackClick = event => !event.shiftKey && !event.metaKey;

/** Is a dnd5e Advantage or Disadvantage key (configurable in its shortcuts) held? */
function keyHeld(event, action) {
  try { return !!event && dnd5e.utils.areKeysPressed(event, action); }
  catch { return false; }
}

/**
 * The keys that the roll will read: those held now (dnd5e also consults the keyboard at the time of the
 * roll) and, in aim mode, those of the click that chose the action (sheet, action bar), which the suspended
 * use carries along to the roll.
 */
function heldKeys(event) {
  const origin = targeting?.usage?.[0]?.event;
  return {
    advantage: keyHeld(event, "skipDialogAdvantage") || keyHeld(origin, "skipDialogAdvantage"),
    disadvantage: keyHeld(event, "skipDialogDisadvantage") || keyHeld(origin, "skipDialogDisadvantage")
  };
}
const selecting = () => canvas.tokens?.active && (ui.controls?.tool?.name ?? game.activeTool ?? "select") === "select";
const scenePoint = event => canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });

function clickMoveAllowed() {
  const mode = setting("clickToMove");
  return (mode === "always") || ((mode === "combat") && inCombat());
}

/**
 * Does the attack click apply now? Setting "always" / "combat" / "off" (§100); a boolean value saved
 * before (checkbox, true = in combat only) is read back as such.
 */
function clickAttackAllowed() {
  let mode = setting("clickToAttack");
  // Read back as text by a setting that became a String ("true" / "false", seen on 2026-10-06), or as a boolean.
  if ( (mode === true) || (mode === "true") ) mode = "combat";
  else if ( (mode === false) || (mode === "false") ) mode = "off";
  return (mode === "always") || ((mode === "combat") && inCombat());
}

function clickAttackApplies(me, other) {
  // §110: for the GM, the left click on a token stays the core's (selection); its actions go through the right click.
  if ( game.user.isGM ) return false;
  // §411: an enemy on another plane also receives the attack click — the legality window says why (`otherPlane`), one can force.
  return clickAttackAllowed() && hostileTo(me, other) && !!basicAttack(me.actor);
}

export let down = null;
const LONG_PRESS_MS = 350;

function swallow(event) {
  event.stopImmediatePropagation();
  event.preventDefault();
}

/** An aim that waits for a player click (target, projectiles or group, Dash, familiar recall); not the placing of an area. */
const aimingByClick = () => !!(targeting || picking || dashing || recalling);

/** Close the current aim; a multiple aim also releases the targets already chosen. */
function cancelAiming() {
  if ( picking ) clearTargets();
  stopTargeting();
}

/** A pending action that a right click would cancel (outside aim mode): legality dialog, roll not yet made. */
export const cancellable = () => (openLegalityDialogs().length > 0) || !!pendingRoll();

/** Right click (§15.1): the legality dialog closes ("Give up"), or the roll not yet made is cancelled. */
async function cancelInProgress() {
  if ( await closeLegalityDialogs() ) return ui.notifications.info(loc("Visee.Annulee"));
  await cancelPendingRoll();
}

/**
 * The core is planning a movement (dnd5e's native teleportation, §16.10: Token#planMovement sets
 * `canvas.tokens._movementPlanningContext`): its clicks validate the destination, the engine's mouse steps aside.
 */
const corePlanning = () => !!canvas?.tokens?._movementPlanningContext;

export function onPointerDown(event) {
  // §67 ter: while aiming a teleportation, a left click on the ground chooses the destination (the core only accepts a drag
  // of the token, which stays possible: a click on the token itself is left to the core).
  const tp = currentTeleport();
  if ( tp && corePlanning() && (event.button === 0) && onBoard(event) && (hoveredToken()?.id !== tp.token.id) ) {
    down = null;
    teleportClick(scenePoint(event));
    return;
  }
  if ( corePlanning() || placing ) { down = null; return; }
  if ( menu && !menu.contains(event.target) ) closeMenu();
  hideHitChance();
  lastHoverKey = null;
  down = null;
  if ( !onBoard(event) || ![0, 2].includes(event.button) ) return;
  // `me`: the token in hand at the press. Without a token in hand, the core takes the right click on a token (it selects it and
  // opens its HUD); at the release, this token is in hand, but the engine does not open its menu on top (feedback of 2026-10-18).
  down = { x: event.clientX, y: event.clientY, button: event.button, at: Date.now(), me: actingToken()?.id ?? null };
  if ( aimingByClick() || ((event.button === 2) && cancellable()) ) return swallow(event);
  // §39.3: on this client, at the press of a left click on the board, before the engine handles it: `(event)`. Cancellable: a
  // neighbouring module that claims the click (search a chest, a corpse, a ground pile — Darsh Loot) returns `false`, and the
  // engine ignores it entirely (no movement, no attack). The engine knows none of these modules; without them nothing changes.
  if ( (event.button === 0) && (Hooks.call(`${MODULE_ID}.claimClick`, event) === false) ) { down = null; return; }
  const me = actingToken();
  const hover = hoveredToken();
  // Right click on one's own grappled token or controlled object: the menu (Escape, Dismiss) instead of the core's HUD.
  if ( me && (hover === me) && (event.button === 2) && plain(event) && selecting() && hasSelfMenu(me) ) return swallow(event);
  // §18.24: right click on a door, a token in hand — the door menu instead of the core's lock (GM).
  if ( me && !hover && (event.button === 2) && plain(event) && selecting() && hoveredDoor() ) return swallow(event);
  // §18.25: left click on a door, when a click moves — step up, then open or close it, not open it from afar.
  if ( me && !hover && (event.button === 0) && plain(event) && selecting() && hoveredDoor() && clickMoveAllowed() ) return swallow(event);
  if ( !me || !hover || (hover === me) || !selecting() ) return;
  // The engine takes this click: no selection of the targeted token (GM), no token HUD.
  if ( ((event.button === 2) && plain(event)) || ((event.button === 0) && attackClick(event) && clickAttackApplies(me, hover)) ) swallow(event);
}

export function onPointerUp(event) {
  const start = down;
  down = null;
  if ( corePlanning() || placing ) return;
  if ( !start || (start.button !== event.button) || !onBoard(event) ) return;
  if ( Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ) return;   // it was a drag
  // A long press is the core's ping (500 ms): it is not a movement order.
  if ( !aimingByClick() && ((Date.now() - start.at) > LONG_PRESS_MS) ) return;
  if ( !targeting && !picking && (event.button === 2) && cancellable() ) return exclusive(cancelInProgress);
  const hover = hoveredToken();
  const left = event.button === 0;

  // Right click during an aim: it closes.
  if ( !left && aimingByClick() ) {
    cancelAiming();
    return ui.notifications.info(loc("Visee.Annulee"));
  }
  if ( dashing ) return dashTo(scenePoint(event));
  if ( recalling ) return recallTo(scenePoint(event));
  if ( picking ) return pickTarget(hover);
  if ( targeting ) {
    // §189: no creature under the mouse — an oil puddle, a web, for a fire action (a token on the area takes precedence).
    if ( !hover ) {
      const aim = fireTargetAt(targeting.token, targeting.activity, scenePoint(event));
      if ( !aim ) return;
      if ( aim.refused ) return floatNotice(targeting.token, loc("Retour.HorsDePortee"), "refused");
      const { token, activity, usage } = targeting;
      stopTargeting();
      return exclusive(() => igniteWithActivity(token, activity, usage, aim.zone));
    }
    // §411 (issue #44, batch 4): a refused target (out of range, wrong type, impossible bounce) is no longer a lost click — the
    // gesture goes off, and the legality window says what is wrong (Give up, or do it anyway: the GM is warned). The red
    // reticle stays the preview.
    const issues = refusalIssues(targeting.token, hover, targeting.activity, targeting.usage?.[0]);
    const { token, activity, usage } = targeting;
    stopTargeting();
    return exclusive(() => engageWith(token, hover, activity, { usage, event, issues }));
  }

  const me = actingToken();
  if ( !me || !selecting() ) return;
  // §99: the token is still walking — a left click on the ground sends it elsewhere, on an enemy makes it attack there, any other
  // click stops it on the spot.
  if ( busy ) {
    const point = scenePoint(event);
    if ( left && hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      if ( interruptWalk(me, () => engageWith(me, hover, basicAttack(me.actor).activity, { event })) ) return;
    }
    else if ( left && !hover && plain(event) && clickMoveAllowed() ) {
      if ( interruptWalk(me, () => moveTo(me, point)) ) { lastHoverKey = null; return; }
    }
    else if ( interruptWalk(me) ) return;
  }
  if ( left ) {
    if ( hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      return exclusive(() => engageWith(me, hover, basicAttack(me.actor).activity, { event }));
    }
    const door = (!hover && plain(event) && clickMoveAllowed()) ? hoveredDoor() : null;
    if ( door ) return exclusive(() => setDoorOpen(me, door, doorState(door) !== "open"));
    // §41.2: a staircase — it is taken with a click (a single level at the end), or the level is chosen (elevator). Like any
    // click on the ground, only if click-to-move is active (decision of 2026-10-16); the right click always offers it.
    const steps = (!hover && plain(event) && clickMoveAllowed()) ? stairsEntries(me, scenePoint(event)) : [];
    if ( steps.length === 1 ) { lastHoverKey = null; return exclusive(() => steps[0].run(event)); }
    if ( steps.length > 1 ) return openMenu(event, steps);
    if ( !hover && plain(event) && clickMoveAllowed() ) { lastHoverKey = null; return exclusive(() => moveTo(me, scenePoint(event))); }
    return;
  }
  if ( !plain(event) ) return;
  if ( doubleRightOnToken(hover, me) ) {
    closeMenu();
    return hover.sheet?.render(true);
  }
  if ( hover && (hover === me) && hasSelfMenu(me) ) {
    if ( start.me !== me.id ) return;   // the core took this click: selection and HUD
    return openMenu(event, selfEntries(me));
  }
  if ( hover && (hover !== me) ) return openTokenMenu(event, me, hover);
  const door = hover ? null : hoveredDoor();
  if ( door ) return openMenu(event, doorEntries(me, door));
  if ( !hover ) openMenu(event, groundEntries(me, scenePoint(event)));
}

/* ---- path preview, in combat ---- */

let lastHoverKey = null;
let previewed = null;

export function clearPreview() {
  if ( previewed ) previewPath(previewed, null);
  previewed = null;
  lastHoverKey = null;
  hideHitChance();
  setCursor(null);
}

/** The canvas is torn down: the preview and the hover have no object any more (nothing to clear). */
export function forgetHover() {
  previewed = null;
  lastHoverKey = null;
}

/**
 * Cursor according to what a click would do (§15.3): move, attack in melee or at range, cast
 * a spell, out of range, impossible. An attribute on `body`, which the stylesheet translates into the
 * module's SVG cursor on the canvas (`#board`). null: Foundry's cursor (or the aim crosshair).
 */
export function setCursor(kind) {
  const wanted = (kind && setting("situationalCursor")) ? kind : null;
  if ( (document.body.dataset.dnd5eCombatCursor ?? null) === wanted ) return;
  if ( wanted ) document.body.dataset.dnd5eCombatCursor = wanted;
  else delete document.body.dataset.dnd5eCombatCursor;
}

/** Le token sous la souris. */
/**
 * GM: a double right click on a token opens its configuration — the core's gesture (Token#_onClickRight2), which the engine's menu
 * intercepted as soon as a token was in hand (user's request, 2026-10-18). The first click opens the menu as before;
 * the second, on the same token within the delay, closes it and opens the configuration. The cases the engine does not take
 * (its own token without a menu of its own, no token in hand) stay with the core, which already does the same.
 */
const DOUBLE_RIGHT_MS = 400;
let lastRight = null;
function doubleRightOnToken(hover, me) {
  if ( !game.user.isGM || !hover || ((hover === me) && !hasSelfMenu(me)) ) { lastRight = null; return false; }
  const now = Date.now();
  const double = !!lastRight && (lastRight.id === hover.id) && ((now - lastRight.at) <= DOUBLE_RIGHT_MS);
  lastRight = double ? null : { id: hover.id, at: now };
  return double;
}

function hoveredToken() {
  return canvas.tokens.hover?.document ?? null;
}

/**
 * §16.29: what a click on this creature would give, outside melee (which moves closer) — null if nothing opposes it,
 * otherwise the refusal text ("Out of range", "Out of sight", or the bounce's: "Already targeted…", "… more than 30 ft away").
 */
export function refusalFor(me, hover, activity, usageConfig=null, mode=null) {
  return refusalOf(me, hover, activity, usageConfig, mode)?.text ?? null;
}

/**
 * What an attack by `me` on `hover` would do, like `engage`: a refusal (`refusal`), or the approach (`far`, `plan`), the arrival
 * cell (`posA`) and `outOfReach` when the approach does not arrive. Shared by the canvas hover and the menu hover (#33).
 * @param {object} [options]  `mode`: dnd5e's attack mode ("thrown"…); `usage`: the usage config in aim mode.
 */
export function attackPlanOf(me, hover, activity, { mode=null, usage=null }={}) {
  const refusal = refusalOf(me, hover, activity, usage, mode);
  if ( refusal ) return { refusal };
  const reach = reachCells(activity, mode);
  // §192: in three dimensions — a target on the ceiling is out of reach from the floor, and the approach does not
  // lead there (`tooHigh`).
  const gap = reach ? gapCells(me, hover) : 0;
  const tooHigh = !!reach && approaches(activity, mode) && tooHighFor(me, hover, reach);
  const far = !!reach && (gap > reach.normal) && approaches(activity, mode) && !tooHigh;
  const plan = far ? planPath(me, { target: hover, reachCells: reach.normal }, { maxCost: movementCap(me) }) : null;
  // Like `engage`: out of range if the approach does not arrive and the target is beyond the long range.
  // §18.22: a contact gesture (unarmed, Grapple, Help) only advances if it arrives.
  const outOfReach = tooHigh || (far && !plan?.arrives && (contactAction(activity) || (gap > reach.long)));
  const end = (far && plan?.arrives) ? plan.waypoints.at(-1) : null;
  return { refusal: null, far, plan, outOfReach, posA: end ? positionOf(end) : undefined };
}

/**
 * #33: the hover of a context menu attack — the same badge as the canvas hover (chance to hit, Cover), placed
 * under the menu (`rect`), and the line of aim.
 */
export function previewMenuAttack(rect, me, target, activity, mode=null) {
  if ( activity?.type !== "attack" ) return hideHitChance();
  // §39.2: the contact attack of a thrown weapon does not take up the "throw" that dnd5e remembers — `engage` restarts from the
  // weapon's default mode; the preview too (otherwise: Disadvantage of a ranged attack in melee).
  if ( !mode && approaches(activity) ) {
    const remembered = activity.item?.getFlag?.("dnd5e", `last.${activity.id}.attackMode`) ?? null;
    if ( String(remembered ?? "").startsWith("thrown") ) mode = activity.item.system.attackModes?.[0]?.value ?? null;
  }
  const { refusal, outOfReach, posA } = attackPlanOf(me, target, activity, { mode });
  if ( refusal ) {
    showBadge(null, refusal.text, { at: rect });
    if ( refusal.kind === "outOfRange" ) showAttackLine(me, target, activity, { unreachable: true, attackMode: mode });
    return;
  }
  showHitChance(null, me, target, activity, { posA, outOfReach, attackMode: mode, at: rect });
  showAttackLine(me, target, activity, { posA, unreachable: outOfReach, attackMode: mode });
}

/**
 * The refusal and its kind, without comparing a translated text: `outOfRange` (the "out of range" cursor), `blind`, `plane`,
 * `chain`, `contact`, or `other` (target type, link, Cleave, bounce).
 */
function refusalOf(me, hover, activity, usageConfig=null, mode=null) {
  const status = refusalBeforeRange(me, hover, activity, usageConfig);
  if ( status ) return status;
  if ( approaches(activity, mode) ) return null;
  const range = rangeStatus(me, hover, activity, mode);
  if ( range?.out ) return { text: loc("Retour.HorsDePortee"), kind: "outOfRange" };
  if ( range?.blind ) return { text: loc("Retour.NonVue"), kind: "blind" };
  return null;
}

/**
 * §411: the reasons for a refused aim click that the legality window does not itself pick up — it sees range, plane, Chain
 * Lightning (designated targets); `engage` sees contact and line of sight. The rest (target type, link, Cleave, bounce) goes
 * with the use (`issues`), in sentences: "Goblin: not the linked creature".
 */
export function refusalIssues(me, hover, activity, usageConfig=null, { mode=null, blind=false }={}) {
  const refusal = refusalOf(me, hover, activity, usageConfig, mode);
  if ( !refusal || !forwardsIssue(refusal.kind, { blind }) ) return [];
  // The multiple aim does not always go through `engage` (target spells): the line of sight goes with the use there.
  if ( refusal.kind === "blind" ) return [loc("Souci.noLineOfSight", { name: hover.name })];
  return [loc("LabelValue", { label: hover.name, value: refusal.text })];
}

/** The refusals not due to range: plane, target type, link, Cleave, bounce, Chain Lightning, contact. */
function refusalBeforeRange(me, hover, activity, usageConfig) {
  const otherPlane = planeRefusal(me, hover);   // §225
  if ( otherPlane ) return { text: otherPlane, kind: "plane" };
  const wrongTarget = targetTypeRefusal(me, hover, activity);
  if ( wrongTarget ) return { text: wrongTarget, kind: "other" };
  // §16.43: the next action of a link (Witch Bolt) only targets the linked creature.
  if ( tetherOfActivity(activity)?.role === "follow" ) {
    const bound = tetheredToken(activity.item);
    if ( !bound || (bound !== hover) ) return { text: loc("Retour.PasLiee"), kind: "other" };
  }
  // §21: Cleave — only a creature within 1,50 m of the first and within reach (adapter/mastery.mjs).
  const cleave = usageConfig?.[MODULE_ID]?.cleave;
  if ( cleave ) {
    const first = fromUuidSync(cleave, { strict: false });
    if ( !first || !cleaveCandidates(me, first, activity).includes(hover) ) return { text: loc("Botte.Enchainement.Refus"), kind: "other" };
  }
  const leap = usageConfig?.[MODULE_ID]?.leap;
  if ( leap ) {
    const problem = leapProblem(activity, leap, hover);
    if ( problem ) return { text: problem.replace(/^[^:]*:\s*/, ""), kind: "other" };
  }
  // §286: Chain Lightning — a secondary target within 9 m of the first.
  const chainFrom = usageConfig?.[MODULE_ID]?.chainFrom;
  if ( chainFrom ) {
    const first = fromUuidSync(chainFrom, { strict: false });
    const rule = chainOf(activity?.item);
    if ( first && rule && chainOutliers(activity, [first, hover]).length ) {
      return { text: loc("Retour.ChaineTropLoin", { name: first.name, distance: chainLimit(rule, first), units: first.parent.grid.units }), kind: "chain" };
    }
  }
  const contact = contactRefusal(me, hover, activity);
  return contact ? { text: contact, kind: "contact" } : null;
}

/** The arrival cell of a Dash under this point: the top-left corner of a token of its size, centered on the point. */
function dashCell(point) {
  const grid = dashing.token.parent.grid;
  return grid.getTopLeftPoint(cellUnder(dashing.token, point));
}

/** §57: on hover, what refuses the cell, or the creatures that the Dash would hit. */
function dashHover(event) {
  const at = dashCell(scenePoint(event));
  const key = `dash|${at.x},${at.y}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal ) {
    setCursor("outOfRange");
    return showBadge(event, refusal.short);
  }
  setCursor(null);
  const names = dashPreview(dashing.activity, at).map(t => t.name);
  showBadge(event, names.length ? names.join(", ") : loc("Ruee.Personne"));
}

/** §57: a click on the arrival cell — refused, the aim stays open; accepted, the Dash goes off. */
function dashTo(point) {
  const at = dashCell(point);
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal && !refusal.forceable ) { ui.notifications.warn(refusal.text); return floatNotice(dashing.token, refusal.short, "refused"); }
  const { activity, usage } = dashing;
  // §412 (issue #44, batch 5): too far, cell taken, not in sight — the legality window; forced, the Dash goes off (the GM
  // warned); given up, the aim stays open as before.
  if ( refusal ) {
    floatNotice(dashing.token, refusal.short, "refused");
    return exclusive(async () => {
      if ( !(await askAnyway(`${activity.item.name} — ${dashing.token.name}`, [refusal.text], { actor: activity.actor, item: activity.item, token: dashing.token })) ) return;
      stopTargeting();
      await dashStrike(activity, usage, at, { forced: true });
    }).catch(err => console.error(`${MODULE_ID} | dash strike`, err));
  }
  stopTargeting();
  return exclusive(() => dashStrike(activity, usage, at)).catch(err => console.error(`${MODULE_ID} | dash strike`, err));
}

/** §107: on hover, what refuses the familiar's reappearance cell, or its name. */
function recallHover(event) {
  const point = scenePoint(event);
  const cell = recalling.token.parent.grid.getOffset(point);
  const key = `recall|${cell.i},${cell.j}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = recallRefusal(recalling.token, point);
  setCursor(refusal ? "outOfRange" : null);
  showBadge(event, refusal ?? pocketedFamiliar(recalling.token)?.name ?? "");
}

/** §107: the cell of the returning familiar — refused, the aim stays open; accepted, it reappears. */
function recallTo(point) {
  const { token } = recalling;
  const refusal = recallRefusal(token, point);
  if ( refusal ) return floatNotice(token, refusal, "refused");
  stopTargeting();
  return exclusive(() => recallFamiliar(token, point));
}

/** §107: "Recall" — the cell is chosen with a click (9 m around the master), right click or Esc to give up. */
export function startRecall(token) {
  if ( !canvas.ready || !token?.object ) return;
  stopTargeting();
  const familiar = pocketedFamiliar(token);
  promptTargeting(loc("Familier.Choisir", { name: familiar?.name ?? "" }));
  openRecall(token);
  markTargeting();
}

/** §16.29: while choosing a teleportation's destination (core), the range is read at the cursor. */
function teleportHover(event) {
  const tp = currentTeleport();
  if ( !tp || !corePlanning() || !tp.token?.parent || (tp.limit === null) ) return false;
  const grid = tp.token.parent.grid;
  const cell = cellUnder(tp.token, scenePoint(event));
  const at = grid.getTopLeftPoint(cell);
  const far = distanceBetween(tp.token, tp.token, { posB: { x: at.x, y: at.y } }).value > tp.limit + 1e-6;
  setCursor(far ? "outOfRange" : null);
  if ( far ) showBadge(event, loc("Retour.HorsDePortee"));
  else hideHitChance();
  return true;
}

/**
 * Hover: path preview (in combat) and chance to hit (§15.3) when a click on this token
 * would launch an attack — base attack in combat, or the pending activity in aim mode. If the
 * click would first make it approach, the chance is computed from the arrival cell, like `engage`.
 */
export const onPointerMove = foundry.utils.throttle(event => {
  if ( menu ) return;   // #33: menu open, its badge (attack hover) stays; the canvas previews nothing
  if ( onBoard(event) && teleportHover(event) ) return;
  if ( dashing ) return onBoard(event) ? dashHover(event) : undefined;
  if ( recalling ) return onBoard(event) ? recallHover(event) : undefined;
  if ( busy || !onBoard(event) || event.buttons || !selecting() ) return clearPreview();
  // §16.14: the core's placing shows the area under the mouse — no path or chance to hit.
  if ( placing ) return clearPreview();
  const me = picking?.token ?? targeting?.token ?? actingToken();
  if ( !me?.object || me.object.animationContexts?.has(me.object.movementAnimationName) ) return clearPreview();
  const hover = hoveredToken();
  const point = scenePoint(event);
  const cell = cellUnder(me, point);
  const keys = heldKeys(event);
  // §41.2: the edge of a staircase may cut a cell — the cursor follows the point, not the cell.
  const onStairs = !hover && !targeting && !picking && clickMoveAllowed() && (stairsDestinations(me, point).length > 0);
  const id = `${me.id}|${hover?.id ?? ""}|${cell.i},${cell.j}|${(picking ?? targeting)?.activity.uuid ?? ""}|${picking?.picks.length ?? ""}|${keys.advantage}${keys.disadvantage}|${onStairs}`;
  if ( id === lastHoverKey ) return;
  lastHoverKey = id;

  const preview = inCombat() && setting("pathPreview");
  let plan = null;
  let cursor = null;
  hideHitChance();
  if ( !hover || (hover === me) ) setReticleRefused(false);
  // In aim mode, the caster is a target like any other (Invisibility on oneself): its target type decides.
  if ( hover && ((hover !== me) || targeting || picking) ) {
    const activity = (picking ?? targeting)?.activity ?? (clickAttackApplies(me, hover) ? basicAttack(me.actor).activity : null);
    // §16.29: outside melee, no approach — the range is read as is, and a refusal is announced at the cursor.
    const attempt = activity ? attackPlanOf(me, hover, activity, { usage: targeting?.usage?.[0] }) : {};
    const { refusal, outOfReach, posA } = attempt;
    setReticleRefused(!!refusal);
    if ( refusal ) {
      setCursor(refusal.kind === "outOfRange" ? "outOfRange" : "invalid");
      showBadge(event, refusal.text);
      // #33: out of range, the line of aim is all red, with the distance.
      if ( (refusal.kind === "outOfRange") && (activity.type === "attack") ) showAttackLine(me, hover, activity, { unreachable: true });
      if ( previewed ) previewPath(previewed, null);
      previewed = null;
      return;
    }
    if ( attempt.far ) plan = attempt.plan;
    if ( activity?.type === "attack" ) {
      showHitChance(event, me, hover, activity, { posA, outOfReach, keys });
      showAttackLine(me, hover, activity, { posA, unreachable: outOfReach });   // #33
    }
    // §15.3: a saving throw — the chance that the target fails it (aim mode only aims with a chosen activity).
    else if ( activity?.type === "save" ) showSaveChance(event, me, hover, activity, { outOfReach });
    if ( activity ) {
      cursor = outOfReach ? "outOfRange"
        : (activity.type !== "attack") ? "spell"
        : (activity.attack?.type?.value === "ranged") ? "ranged" : "melee";
    }
  }
  // §189: when aiming a fire action, an oil puddle, a web, is aimed like a target.
  else if ( !hover && targeting && fireTargetAt(me, targeting.activity, point) ) {
    const refused = !!fireTargetAt(me, targeting.activity, point).refused;
    setReticleRefused(refused);
    cursor = refused ? "outOfRange" : "spell";
  }
  else if ( !hover && !targeting && hoveredDoor() ) cursor = null;   // §18.25: the door icon keeps the core's cursor
  // §41.2: a staircase the token can take — the click leads it there (click-to-move active).
  else if ( onStairs ) {
    cursor = "stairs";
    if ( preview ) {
      const stairs = stairsEntry(me, cell);
      plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    }
  }
  else if ( !hover && !targeting && clickMoveAllowed() ) {
    // §18.26: on a staircase, the preview goes up to the neighbouring cell (the last step enters it by walking).
    const stairs = preview ? stairsEntry(me, cell) : null;
    if ( preview ) plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    // In combat, one knows whether the click will lead anywhere: no path, or no more movement this turn.
    cursor = (preview && (!plan || (!plan.waypoints.length && !plan.arrives))) ? "invalid" : "move";
  }
  setCursor(cursor);
  if ( !preview ) {
    if ( previewed ) previewPath(previewed, null);
    previewed = null;
    return;
  }
  if ( previewed && (previewed !== me) ) previewPath(previewed, null);
  previewPath(me, plan);
  previewed = plan ? me : null;
}, 60);

/** Alt or Ctrl pressed or released without moving the mouse: the displayed chance follows (after Foundry has noted the key). */
export let lastPointer = null;
/** The last mouse movement, to replay the hover when a key changes (`onModifierKey`). */
export function trackPointer(event) {
  lastPointer = event;
}

/**
 * #33: a token moved while the badge is displayed (the attacker, the target, an interposed creature): Cover may have
 * changed without the mouse moving — the hover is replayed at the same point. Nothing if the badge is hidden.
 */
export function replayHover() {
  if ( !lastPointer || !hitChanceShown() ) return;
  lastHoverKey = null;
  onPointerMove({ target: lastPointer.target, clientX: lastPointer.clientX, clientY: lastPointer.clientY, buttons: 0,
    altKey: lastPointer.altKey, ctrlKey: lastPointer.ctrlKey, shiftKey: lastPointer.shiftKey, metaKey: lastPointer.metaKey });
}

export function onModifierKey(event) {
  if ( !["Alt", "Control", "Meta", "OS"].includes(event.key) || !lastPointer ) return;
  setTimeout(() => onPointerMove({ target: lastPointer.target, clientX: lastPointer.clientX, clientY: lastPointer.clientY,
    buttons: 0, altKey: event.type === "keydown" ? event.altKey || event.key === "Alt" : event.altKey && event.key !== "Alt",
    ctrlKey: event.type === "keydown" ? event.ctrlKey || event.key === "Control" : event.ctrlKey && event.key !== "Control",
    shiftKey: event.shiftKey, metaKey: event.metaKey }), 0);
}

export function onKeyDown(event) {
  onModifierKey(event);
  // A key typed in an input field (the chat, a sheet) belongs to the field: neither Enter nor Esc drives the aim from there.
  if ( typingIn(event.target) ) return;
  // §16.33: Enter casts a group spell with the creatures already chosen ("up to five creatures").
  if ( (event.key === "Enter") && (picking?.group || picking?.unique) && picking.picks.length ) { swallow(event); return finishGroup(); }
  if ( event.key !== "Escape" ) return;
  if ( menu ) { closeMenu(); swallow(event); }
  else if ( aimingByClick() ) {   // an area being placed: Esc belongs to the core
    cancelAiming();
    swallow(event);
  }
}
