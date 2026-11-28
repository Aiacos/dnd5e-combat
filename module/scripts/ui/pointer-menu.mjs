/**
 * The engine's context menu (right click): movement, jump, attacks, doors, stairs, oneself, familiar, follow, effect
 * endings. Extracted from ui/pointer.mjs.
 */

import { isObjectToken } from "../adapter/bodies.mjs";
import { MODULE_ID } from "../constants.mjs";
import { canBeThrown } from "../adapter/turn.mjs";
import { areAdjacent } from "../adapter/conditions.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { isNonLethal, isKnockedOut, setNonLethal } from "../adapter/knockout.mjs";
import { firstAid } from "../runtime/knockout.mjs";
import { administerPotion } from "../runtime/potion-choice.mjs";
import { healingPotionActivity } from "../adapter/potions.mjs";
import { stairsDestinations } from "../adapter/movement.mjs";
import { grappleShoveOf, unarmedAttackOf, helpActivityOf } from "../adapter/basics.mjs";
import { pilotOf, commandActivities, commandLabel, transposeOf } from "../adapter/pilot.mjs";
import { grappleEffectsOf, grapplerOf } from "../adapter/grapple.mjs";
import { weaponAttacks, hostileTo, moveTo, jumpTo, transpose, takeStairs } from "../runtime/actions.mjs";
import { leaderOf, canFollow, follow, unfollow } from "../runtime/follow.mjs";
import { canDismiss, dismissPilot, useCommand } from "../runtime/pilot.mjs";
import { canPocket, canRecall, pocketedFamiliar, dismissFamiliar } from "../runtime/familiar.mjs";
import { revertActivityOf } from "../adapter/wildshape.mjs";
import { formRevertOf } from "../adapter/coven.mjs";
import { revertShape } from "../runtime/coven.mjs";
import { traceAttacks } from "../adapter/traces.mjs";
import { tetheredToken, tetherItems, tetherRuleOf } from "../adapter/tether.mjs";
import { leaveForm } from "../runtime/wildshape.mjs";
import { canStandUp, standUp } from "../runtime/prone.mjs";
import { upkeepsOf, canMaintain, maintain } from "../runtime/control.mjs";
import { escapableRestraintsOf } from "../adapter/escape.mjs";
import { escapeGrapple, holdsOf, releaseGrapple } from "../runtime/grapple.mjs";
import { ownEndingsOf, endingsOn, endFor } from "../runtime/action-end.mjs";
import { doorState, setDoorOpen, setDoorLocked, pickLock, forceDoor, unlockWithKey, lockEntriesFor, hasLockTries, resetLockTries } from "../runtime/doors.mjs";
import { swallowerOf } from "../adapter/swallow.mjs";
import { loc, notice } from "../runtime/shared.mjs";
import { effectOfProfile } from "../adapter/usage.mjs";
import { wallsOfCaster } from "../adapter/wall-side.mjs";
import { flipWallSide } from "../runtime/wall-side.mjs";
import { pickUpEntries } from "../runtime/scatter.mjs";
import { igniteEntries } from "../runtime/flammable.mjs";
import { burningEntries } from "../runtime/burning.mjs";
import { climbEntries } from "../runtime/climb.mjs";
import { flightEntries } from "../runtime/altitude.mjs";
import { standingMasteryEntries } from "./standing-mastery.mjs";
import { actingToken, engageWith, exclusive, inCombat, observe } from "./pointer.mjs";
import { down, startRecall, clearPreview, previewMenuAttack, refusalFor } from "./pointer-mouse.mjs";
import { hideHitChance } from "./hitchance.mjs";
import { groupRollEntry } from "./group-roll.mjs";
import { debugMenuEntry } from "./debug-report.mjs";
import { setHeroic } from "../runtime/heroic.mjs";
import { atCostMenuEntry } from "./success-at-cost.mjs";
import { armCatalyst, catalystArmed, catalystOf } from "../runtime/catalyst.mjs";
import { forceWait, waitsOf } from "../runtime/player-waits.mjs";
import { commandActivitiesFor, mountEntry } from "../runtime/mount.mjs";

/* -------------------------------------------- */
/*  Menu contextuel                             */
/* -------------------------------------------- */

export let menu = null;
/**
 * §16.44: the menu of a neutral or friendly token hides its offensive actions; **once the menu is open**, holding Shift shows
 * them (released, they hide). `{ point, build(aggressive), hidden, shown }`, or null.
 */
let menuSource = null;
/** #33: a menu attack is hovered — its badge (chance to hit, Cover) and its line are shown. */
let menuPreview = false;
export function closeMenu() {
  menu?.remove();
  menu = null;
  menuSource = null;
  endMenuPreview();
}

function endMenuPreview() {
  if ( !menuPreview ) return;
  menuPreview = false;
  hideHitChance();
}

/** The help line of a menu whose offensive actions are hidden. */
const shiftHint = () => ({ hint: true, icon: "fa-solid fa-keyboard", label: loc("Menu.MajOffensives") });

export function openMenu(event, entries, source=null) {
  closeMenu();
  if ( !entries.length ) return;
  clearPreview();   // #33: the badge and line of the canvas hover give way to those of the menu
  renderMenu({ clientX: event.clientX, clientY: event.clientY }, entries);
  menuSource = source;
}

/** §411: the reason an attack entry would be refused (without looking for a path: the hover shows it), or null. */
function entryRefusal(entry) {
  if ( !entry.preview ) return null;
  const { token, target, activity, mode } = entry.preview;
  try { return refusalFor(token, target, activity, null, mode ?? null); }
  catch(err) { console.warn(`${MODULE_ID} | menu refusal`, err); return null; }
}

function renderMenu(point, entries) {
  menu = document.createElement("nav");
  menu.classList.add("dnd5e-combat-menu");
  for ( const entry of entries ) {
    if ( entry.hint ) {
      const hint = document.createElement("div");
      hint.classList.add("hint");
      hint.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
      hint.querySelector("span").textContent = entry.label;
      menu.append(hint);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
    button.querySelector("span").textContent = entry.label;
    // §411 (issue #44, batch 4): a refused attack (out of range, other plane, not an enemy…) stays in the menu, greyed out, its
    // reason in the tooltip — the click opens the legality window, from which one can force.
    const refused = entryRefusal(entry);
    if ( refused ) { button.classList.add("refused"); button.title = refused; }
    button.addEventListener("click", event => { closeMenu(); exclusive(() => entry.run(event)); });
    // #33: hovering an attack shows, under the menu, the same badge as hovering the target (and the line of aim).
    if ( entry.preview ) {
      const { token, target, activity, mode } = entry.preview;
      button.addEventListener("pointerenter", () => {
        if ( !menu ) return;
        menuPreview = true;
        try { previewMenuAttack(menu.getBoundingClientRect(), token, target, activity, mode ?? null); }
        catch(err) { console.warn(`${MODULE_ID} | menu attack preview`, err); }
      });
      button.addEventListener("pointerleave", endMenuPreview);
    }
    menu.append(button);
  }
  document.body.append(menu);
  const { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${Math.min(point.clientX, window.innerWidth - w - 4)}px`;
  menu.style.top = `${Math.min(point.clientY, window.innerHeight - h - 4)}px`;
}

/**
 * §16.44: the menu of another creature. The offensive actions (attacks, unarmed strikes, attack spells) are only there from the
 * start against a hostile creature; on a neutral or friendly creature, Shift held once the menu is open shows them.
 */
export function openTokenMenu(event, me, target) {
  const hostile = hostileTo(me, target);
  const build = aggressive => withNeighbourEntries(tokenEntries(me, target, { aggressive: hostile || aggressive }), me, target,
    hostile || aggressive);
  const calm = build(false);
  const hidden = !hostile && (build(true).length > calm.length);
  const point = { clientX: event.clientX, clientY: event.clientY };
  openMenu(event, hidden ? [...calm, shiftHint()] : calm, hidden ? { point, build, hidden, shown: false } : null);
}

/**
 * §41.4: the entries of a token's context menu, for an interface that wants to offer them elsewhere than on the canvas
 * (the Party portrait of Darsh UI DnD5): what the token in hand (the only one controlled, one's own) can do to that one —
 * the same as the right click, entries of neighbouring modules included, without the offensive actions on a creature that
 * is not hostile. Empty without a token in hand, or on another scene. `run(event)` plays the entry (one at a time). §411:
 * `refused`, the reason for a refused attack (to grey out; the click opens the legality window, from which one can force).
 * @param {Token|TokenDocument} target
 * @returns {{icon: string, label: string, refused?: string, run: (event?: Event) => void}[]}
 */
export function menuEntriesFor(target) {
  const me = actingToken();
  const doc = target?.document ?? target;
  if ( !me || !doc?.parent || (doc.parent !== me.parent) ) return [];
  const hostile = (doc !== me) && hostileTo(me, doc);
  const raw = (doc === me) ? selfEntries(me) : withNeighbourEntries(tokenEntries(me, doc, { aggressive: hostile }), me, doc, hostile);
  // §411: `refused` — the reason for an attack that the legality window will state (the entry stays clickable: one can force).
  return raw.filter(e => !e.hint).map(e => {
    const refused = entryRefusal(e);
    return { icon: e.icon, label: e.label, ...(refused ? { refused } : {}), run: event => exclusive(() => e.run(event)) };
  });
}

/**
 * The menu of a door (`wall`: Wall, WallDocument or id) and that of a cell (`point`: `{ x, y }` of the scene) for the token in
 * hand, like `menuEntriesFor`: the same entries as the right click, those of the neighbours included (`doorMenu` §247,
 * `groundMenu` §243). Empty without a token in hand or on another scene.
 */
export function doorMenuFor(wall) {
  const me = actingToken();
  const placeable = (typeof wall === "string") ? canvas.walls?.get(wall) : (wall?.object ?? wall);
  if ( !me || !placeable?.isDoor || (placeable.document.parent !== me.parent) ) return [];
  return doorEntries(me, placeable).map(e => ({ icon: e.icon, label: e.label, run: event => exclusive(() => e.run(event)) }));
}
/**
 * The menu of a cell (`point`: `{ x, y }` of the scene) for the token in hand: `[{ icon, label, run }]`, neighbours included;
 * empty without a token in hand.
 */
export function groundMenuFor(point) {
  const me = actingToken();
  if ( !me || (me.parent !== canvas.scene) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) ) return [];
  return groundEntries(me, { x: point.x, y: point.y }).map(e => ({ icon: e.icon, label: e.label, run: event => exclusive(() => e.run(event)) }));
}

/**
 * §39.4: neighbouring modules add their entries to a token's menu (Darsh Loot: "Trade" on another PC) through the
 * hook `dnd5e-combat.tokenMenu` — `(entries, { token, target, aggressive })`, each entry `{ icon, label, run(event) }`
 * pushed into `entries`. The engine knows none of them; with none registered, the menu is its own. The hook may fire several
 * times for one right click (the menu is built, then rebuilt with Shift, and `api.ui` reads its entries): a listener only
 * adds entries, with no other effect — the action goes in `run`.
 */
function withNeighbourEntries(entries, token, target, aggressive) {
  // §39.4: on the client that builds another token's menu (right click, `api.ui.tokenMenu`):
  // `(entries, { token, target, aggressive })` — push `{ icon, label, run(event) }` into `entries`; nothing else (the hook fires
  // several times per right click).
  Hooks.callAll(`${MODULE_ID}.tokenMenu`, entries, { token, target, aggressive });
  return entries.filter(e => e && (typeof e.run === "function") && e.label);
}

/** Shift pressed or released, menu open: the offensive actions appear or hide. */
export function onMenuShift(event) {
  if ( (event.key !== "Shift") || !menu || !menuSource?.hidden ) return;
  const shown = event.type === "keydown";
  if ( shown === menuSource.shown ) return;
  const source = menuSource;
  menu.remove();
  endMenuPreview();   // the hovered entry disappears with the old menu
  renderMenu(source.point, shown ? source.build(true) : [...source.build(false), shiftHint()]);
  source.shown = shown;
  menuSource = source;
}

/**
 * §18.24: the door under the mouse — the core notes in `canvas.walls.hover` the wall whose door icon is hovered
 * (door-control.mjs, `_onMouseOver`, only for whoever has the "WALL_DOORS" permission).
 */
export function hoveredDoor() {
  const wall = canvas.walls?.hover;
  return (wall?.isDoor && wall.doorControl?.visible !== false) ? wall : null;
}

const LOCK_ENTRIES = {
  key: { icon: "fa-solid fa-key", label: "Serrure.AvecCle", run: (token, wall) => unlockWithKey(token, wall) },
  pick: { icon: "fa-solid fa-unlock-keyhole", label: "Menu.Crocheter", run: (token, wall, options) => pickLock(token, wall, options) },
  force: { icon: "fa-solid fa-hand-fist", label: "Menu.Forcer", run: (token, wall, options) => forceDoor(token, wall, options) }
};

/**
 * Open / close; in front of a locked door, the key, pick the lock and force (§244); for the GM, lock / unlock, and
 * reset the attempts.
 */
export function doorEntries(token, wall) {
  const state = doorState(wall);
  const entries = [];
  if ( state === "open" ) entries.push({ icon: "fa-solid fa-door-closed", label: loc("Menu.Fermer"), run: () => setDoorOpen(token, wall, false) });
  else entries.push({ icon: "fa-solid fa-door-open", label: loc("Menu.Ouvrir"), run: () => setDoorOpen(token, wall, true) });
  // §244: the key if it is carried, pick the lock, force (except a door that cannot be); an attempt already made says so.
  if ( state === "locked" ) for ( const { method, spent } of lockEntriesFor(token, wall) ) {
    const entry = LOCK_ENTRIES[method];
    const label = loc(entry.label) + (spent ? ` — ${loc("Serrure.Essaye")}` : "");
    entries.push({ icon: entry.icon, label, run: event => entry.run(token, wall, { event }) });
  }
  // §247: on the client that builds a door's menu (right click, `api.ui.doorMenu`), hook `dnd5e-combat.doorMenu`:
  // `(entries, { token, wall })` — `wall` the WallDocument; push `{ icon, label, run(event) }` (a trapped door: "Disarm the
  // trap"), placed after those of the engine for the player; nothing else (the hook may fire several times).
  entries.push(...neighbourEntries("doorMenu", { token, wall: wall.document }));
  if ( game.user.isGM && (state !== "open") ) {
    const locked = state === "locked";
    entries.push({ icon: locked ? "fa-solid fa-lock-open" : "fa-solid fa-lock", label: loc(locked ? "Menu.Deverrouiller" : "Menu.Verrouiller"),
      run: () => setDoorLocked(wall, !locked) });
    if ( locked && hasLockTries(wall) ) entries.push({ icon: "fa-solid fa-rotate-left", label: loc("Serrure.RemettreEssais"), run: () => resetLockTries(wall) });
  }
  return entries;
}

/**
 * §41.2: on a staircase, ladder or elevator — one entry per level it leads to ("Go up", "Go down").
 */
const STAIRS_ICONS = { up: "fa-solid fa-arrow-up-right-dots", down: "fa-solid fa-arrow-down-wide-short", level: "fa-solid fa-right-left" };
const STAIRS_LABELS = { up: "Menu.Monter", down: "Menu.Descendre", level: "Menu.Rejoindre" };
export function stairsEntries(token, point) {
  return stairsDestinations(token, point).map(d => ({ icon: STAIRS_ICONS[d.direction], label: loc(STAIRS_LABELS[d.direction], { level: d.name }),
    run: () => takeStairs(token, point, d.id) }));
}

/**
 * §208: the entry "Jump up here" (climbing by a jump onto a higher surface: dais, ledge) — in beta, behind a
 * world setting off by default (user's decision, 2026-10-21: of little use for now, it cluttered the menu).
 */
export const HIGH_JUMP_MENU_SETTING = "highJumpMenu";
const highJumpOffered = () => { try { return game.settings.get(MODULE_ID, HIGH_JUMP_MENU_SETTING) === true; } catch { return false; } };

/**
 * §210: the non-lethal blows switch in its token's context menu — hidden by default (user's decision,
 * 2026-10-21); it stays on the fist button of the Combat UI bar. World setting.
 */
export const NONLETHAL_MENU_SETTING = "nonLethalMenu";
const nonLethalOffered = () => { try { return game.settings.get(MODULE_ID, NONLETHAL_MENU_SETTING) === true; } catch { return false; } };

/**
 * §243: neighbouring modules add their entries to a cell's menu (a chest lying on the ground: "Search") through the hook
 * `dnd5e-combat.groundMenu` — `(entries, { token, point })`, `point` the clicked scene point, each entry `{ icon, label,
 * run(event) }` pushed into `entries`. They go **before** those of the engine (what is on the cell first, then moving there).
 * Like `tokenMenu`, the hook may fire several times for one right click: a listener only adds entries.
 */
function neighbourGroundEntries(token, point) {
  // §243: on the client that builds a cell's menu (right click, `api.ui.groundMenu`):
  // `(entries, { token, point })` — push `{ icon, label, run(event) }`, placed before those of the engine; nothing else (the
  // hook fires several times per right click).
  return neighbourEntries("groundMenu", { token, point });
}

/**
 * The entries that neighbouring modules add through the hook `dnd5e-combat.<name>` — `(entries, context)`, push `{ icon, label,
 * run(event) }`; an entry without a label or without `run` is ignored. `groundMenu` (§243) and `doorMenu` (§247: `{ token,
 * wall }`, the door's WallDocument).
 */
function neighbourEntries(name, context) {
  const entries = [];
  Hooks.callAll(`${MODULE_ID}.${name}`, entries, context);
  return entries.filter(e => e && (typeof e.run === "function") && e.label);
}

export function groundEntries(token, point) {
  const high = highJumpOffered();
  return [
    ...neighbourGroundEntries(token, point),
    ...stairsEntries(token, point),
    { icon: "fa-solid fa-person-walking", label: loc("Menu.SeDeplacer"), run: () => moveTo(token, point) },
    { icon: "fa-solid fa-person-running", label: loc("Menu.Sauter"), run: () => jumpTo(token, point, { highOffered: high }) },
    ...(high ? [{ icon: "fa-solid fa-arrow-up-from-ground-water", label: loc("Menu.SauterHauteur"),
      run: () => jumpTo(token, point, { high: true, highOffered: true }) }] : [])
  ];
}

/**
 * On one's own token: Escape, if grappled (any creature, NPCs included); Dismiss, if it is a controlled object
 * that ends the spell (§16.15: a player has no right to delete a token, not even their own).
 */
const grappledSelf = token => (token?.actor?.statuses?.has("grappled") === true) || !!swallowerOf(token)?.rule.escape   // §18.21
  || (escapableRestraintsOf(token?.actor).length > 0)   // §16.54: restrained, with a check to break free
  || (ownEndingsOf(token?.actor).length > 0);   // §43.2: an effect that its action ends (Otto's Irresistible Dance)
/** §43.2: the label of "Escape" when there is neither grapple nor restraint — "End: Gaseous Form". */
function escapeLabel(token) {
  const actor = token?.actor;
  if ( actor?.statuses?.has("grappled") || swallowerOf(token)?.rule.escape || escapableRestraintsOf(actor).length ) return loc("Menu.Echapper");
  const endings = ownEndingsOf(actor);
  return (endings.length === 1) ? loc("Menu.MettreFin", { item: endings[0].item.name }) : loc("Menu.Echapper");
}
/** §102: the menu of one's own token opens as soon as it has an entry — from the engine or a neighbouring module. */
export const hasSelfMenu = token => selfEntries(token).length > 0;
export function selfEntries(token) {
  const entries = [];
  if ( canStandUp(token) ) entries.push({ icon: "fa-solid fa-person-arrow-up-from-line", label: loc("Menu.SeRelever"), run: () => standUp(token) });
  // §285: sustain a spell with the Magic action (Crown of Madness).
  for ( const { effect, item } of token.isOwner ? upkeepsOf(token.actor) : [] ) {
    if ( canMaintain(token, effect) ) entries.push({ icon: "fa-solid fa-crown", label: loc("Controle.Maintenir", { item: item.name }), run: () => maintain(token, effect, item) });
  }
  if ( grappledSelf(token) ) entries.push({ icon: "fa-solid fa-person-running", label: escapeLabel(token), run: event => escapeGrapple(token, { event }) });
  // §16.39 : quitter la Forme sauvage (action Bonus).
  const revert = revertActivityOf(token.actor);
  if ( revert ) entries.push({ icon: "fa-solid fa-paw", label: loc("Forme.Reprendre"), run: event => leaveForm(revert, event) });
  // §498: a form taken for a time (`changesForm.revertAfter`) — reverting by hand, before the end of the duration or when it
  // is not automatic (`auto: false`).
  else if ( token.isOwner && formRevertOf(token) ) entries.push({ icon: "fa-solid fa-rotate-left", label: loc("Forme.Reprendre"), run: () => revertShape(token) });
  // §16.15: the commands that only target the object (Interposing Hand).
  const pilot = pilotOf(token);
  for ( const activity of pilot ? commandActivities(pilot, { self: true }) : [] ) {
    entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.Utiliser", { name: commandLabel(activity) }), run: event => useCommand(token, activity, event) });
  }
  // §169: flip the burning side of a Wall of Fire it has placed.
  if ( token.isOwner ) for ( const wall of wallsOfCaster(token) ) {
    const item = fromUuidSync(wall.getFlag("dnd5e", "item") ?? "", { strict: false });
    entries.push({ icon: "fa-solid fa-fire", label: loc("MurFace.Retourner", { item: item?.name ?? wall.name }), run: () => flipWallSide(wall) });
  }
  // §187: pick up caltrops, ball bearings scattered on its cell or in contact (out of combat).
  entries.push(...pickUpEntries(token));
  // §188: light an oil puddle, a web, in contact, with a flame.
  entries.push(...burningEntries(token));   // §212: put out one's flames
  entries.push(...igniteEntries(token));
  // §192 : grimper au mur qu'on touche ; en escalade, se laisser tomber.
  entries.push(...climbEntries(token));
  // §238 : s'envoler ou atterrir, selon les vitesses de sa fiche.
  entries.push(...flightEntries(token));
  // §537 : the standing mastery of each weapon that offers a choice (Tactical Master).
  entries.push(...standingMasteryEntries(token));
  // §210: non-lethal blows (like BG3's switch) — turn on or off, if the world setting shows it in this menu.
  if ( token.isOwner && token.actor && nonLethalOffered() ) {
    const on = isNonLethal(token.actor);
    entries.push({ icon: on ? "fa-solid fa-hand-fist" : "fa-regular fa-hand-fist", label: loc(on ? "Menu.NonLetalCouper" : "Menu.NonLetalActiver"),
      run: () => setNonLethal(token.actor, !on).then(v => notice(token, loc(v ? "Assomme.Actif" : "Assomme.Inactif"))) });
  }
  // §38.2: "Trickster's Barter" — from the illusion or from its caster.
  const swap = transposeOf(token);
  if ( swap ) entries.push({ icon: "fa-solid fa-arrows-rotate", label: loc("Menu.Echanger", { name: (swap.illusion === token ? swap.caster : swap.illusion).name }), run: () => transpose(token) });
  if ( canDismiss(token) ) entries.push({ icon: "fa-solid fa-xmark", label: loc("Menu.Renvoyer", { name: token.name }), run: () => dismissPilot(token) });
  // §107: the familiar goes into its pocket dimension (from its token); its master recalls it from there (from theirs).
  entries.push(...familiarEntries(token, token));
  // §490 (B08) : descendre de sa monture.
  entries.push(...mountEntries(token, token));
  // §41.3 : ce token suit quelqu'un.
  const leader = leaderOf(token);
  if ( leader ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: leader.name }), run: () => unfollow(token) });
  pushGroupRoll(entries, token);   // §242 : MJ
  // §102: neighbouring modules also add their entries on one's own token (hook `tokenMenu`, `target === token`).
  const all = withNeighbourEntries(entries, token, token, false);
  // The menu replaces the core's HUD on right click: its owner (not only the GM) finds it again through this entry.
  if ( all.length && token.isOwner ) all.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(token.object) });
  return all;
}

/**
 * §107: on a familiar, "Dismiss to its pocket dimension" (for whoever owns its master); on the token of a master
 * whose pocket keeps a familiar, "Recall X" (their own token only: the cell is chosen around them).
 */
function familiarEntries(token, target) {
  const entries = [];
  if ( canPocket(target) ) {
    entries.push({ icon: "fa-solid fa-box-archive", label: loc("Familier.Renvoyer", { name: target.name }), run: () => dismissFamiliar(target) });
  }
  if ( (token === target) && canRecall(token) ) {
    entries.push({ icon: "fa-solid fa-dove", label: loc("Familier.Rappeler", { name: pocketedFamiliar(token).name }), run: () => startRecall(token) });
  }
  return entries;
}

/**
 * §490 (B08): mount this creature (or dismount), and the order to a companion — its master's gesture, `commands`.
 */
function mountEntries(token, target) {
  const entries = [];
  const mount = mountEntry(token, target);
  if ( mount ) entries.push(mount);
  if ( token !== target ) {
    for ( const activity of commandActivitiesFor(token, target) ) {
      entries.push({ icon: "fa-solid fa-bullhorn", label: loc("Monture.Commander", { name: target.name, item: activity.item.name }),
        run: event => engageWith(token, target, activity, { event }) });
    }
  }
  return entries;
}

/**
 * §41.3: follow this creature, or — if it is one's own (familiar, summon, other character) — tell it to follow.
 * Nothing on a hostile creature.
 */
function followEntries(token, target) {
  const entries = [];
  // §255: one does not follow an object (placed trap, spiritual weapon), and it follows no one.
  if ( hostileTo(token, target) || isObjectToken(target) || isObjectToken(token) ) return entries;
  if ( leaderOf(token) === target ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: target.name }), run: () => unfollow(token) });
  else if ( canFollow(token, target) ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.Suivre", { name: target.name }), run: () => follow(token, target) });
  if ( target.isOwner ) {
    if ( leaderOf(target) === token ) entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.ResteIci", { name: target.name }), run: () => unfollow(target) });
    else if ( canFollow(target, token) ) entries.push({ icon: "fa-solid fa-paw", label: loc("Menu.SuisMoi", { name: target.name }), run: () => follow(target, token) });
  }
  return entries;
}

/**
 * §43.2: end, by one's action, an effect that another creature bears (content `actionEnds`, `by: "other"`) —
 * shake a sleeper (Sleep, Hypnotic Pattern), free by a check (Ensnaring Strike). The token comes into contact first.
 */
function endingEntries(token, target) {
  return endingsOn(target).map(ending => ({
    icon: (ending.rule.verb === "wake") ? "fa-solid fa-bell" : "fa-solid fa-hand-holding-hand",
    label: (ending.rule.verb === "wake") ? loc("Menu.Reveiller", { name: target.name }) : loc("Menu.Liberer", { name: target.name, item: ending.item.name }),
    run: () => endFor(token, target, ending)
  }));
}

/**
 * Issue #31: "Give a drink" of each healing potion on its sheet to a non-hostile creature in contact (2024 rule: drinking or
 * giving a potion to drink, Bonus Action), GM and players. One entry per potion (same name: only one).
 */
function potionEntries(token, target) {
  if ( !token.isOwner || !target.actor || (target === token) || hostileTo(token, target) ) return [];
  if ( !areAdjacent(token, target, readUnitFactors()) ) return [];
  const seen = new Set();
  const entries = [];
  for ( const item of token.actor?.items ?? [] ) {
    const activity = healingPotionActivity(item);
    if ( !activity || seen.has(item.name) ) continue;
    seen.add(item.name);
    entries.push({ icon: "fa-solid fa-flask", label: loc("Menu.FaireBoire", { item: item.name, name: target.name }),
      run: event => administerPotion(target, activity, { event }) });
  }
  return entries;
}

function tokenEntries(token, target, { aggressive=true }={}) {
  const entries = [];
  // §16.15: a controlled object offers the activities of its commands (Spiritual Weapon's attack, the Hand's effects).
  const pilot = pilotOf(token);
  // Damage without a roll (Grasping Hand's "Crush") only applies against the creature that the object grapples.
  const heldByPilot = pilot && grappleEffectsOf(target.actor).some(e => grapplerOf(e)?.uuid === token.actor?.uuid);
  for ( const activity of pilot ? commandActivities(pilot) : [] ) {
    if ( (activity.type === "damage") && !heldByPilot ) continue;
    if ( !aggressive && ["attack", "damage", "save"].includes(activity.type) ) continue;
    const attack = activity.type === "attack";
    entries.push({ icon: attack ? "fa-solid fa-sword" : "fa-solid fa-wand-sparkles",
      label: loc(attack ? "Menu.Attaquer" : "Menu.Utiliser", { name: commandLabel(activity) }),
      run: event => engageWith(token, target, activity, { event }), preview: { token, target, activity } });
  }
  if ( pilot ) {   // ni arme, ni mains nues, ni Lutte : un objet n'a que ses commandes
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    return entries;
  }
  // §210: first aid to a creature knocked out in contact (Medicine DC 10), friend or enemy.
  if ( isKnockedOut(target.actor) && areAdjacent(token, target, readUnitFactors()) ) {
    entries.push({ icon: "fa-solid fa-kit-medical", label: loc("Menu.PremiersSoins", { name: target.name }), run: () => firstAid(token, target) });
  }
  entries.push(...potionEntries(token, target));   // issue #31 : faire boire une potion de soins
  // §16.44: on a neutral or friendly creature, nothing offensive (Shift, menu open, to show it).
  if ( !aggressive ) {
    // Releasing is not offensive: it stays at hand, even on a friendly creature.
    if ( holdsOf(token, target).length ) entries.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
    entries.push(...endingEntries(token, target));
    entries.push(...followEntries(token, target));
    entries.push(...familiarEntries(token, target));
    entries.push(...mountEntries(token, target));
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
    pushGroupRoll(entries, target);
    return entries;
  }
  for ( const { activity, melee } of weaponAttacks(token.actor) ) {
    entries.push({ icon: melee ? "fa-solid fa-sword" : "fa-solid fa-bow-arrow",
      label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }),
      preview: { token, target, activity } });
    // §15.2: a Light weapon offers dnd5e's "off hand" mode (Bonus Action, or Nick).
    if ( activity.item.system.attackModes?.some(m => m.value === "offhand") ) {
      entries.push({ icon: "fa-solid fa-hand-back-fist",
        label: loc("Menu.MainSecondaire", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "offhand", event }),
        preview: { token, target, activity, mode: "offhand" } });
    }
    if ( canBeThrown(activity) ) {
      entries.push({ icon: "fa-solid fa-hand-point-right",
        label: loc("Menu.Lancer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "thrown", event }),
        preview: { token, target, activity, mode: "thrown" } });
      // §240 (issue #13): a Light and Thrown weapon also offers the off-hand throw (dnd5e's `thrown-offhand`,
      // weapon.mjs:204) — same cost as the off hand (Bonus Action, or Nick).
      if ( activity.item.system.attackModes?.some(m => m.value === "thrown-offhand") ) {
        entries.push({ icon: "fa-solid fa-hand-point-right",
          label: loc("Menu.LancerMainSecondaire", { name: activity.item.name }),
          run: event => engageWith(token, target, activity, { mode: "thrown-offhand", event }),
          preview: { token, target, activity, mode: "thrown-offhand" } });
      }
    }
  }
  // §16.43: the next action of a link (Witch Bolt: 1d12, Bonus Action), on the linked creature.
  for ( const item of tetherItems(token.actor) ) {
    const activity = item.system.activities?.get(tetherRuleOf(item)?.activity ?? "");
    if ( activity && (tetheredToken(item) === target) ) {
      entries.push({ icon: "fa-solid fa-bolt", label: loc("Menu.Utiliser", { name: item.name }), run: event => engageWith(token, target, activity, { event }),
        preview: { token, target, activity } });
    }
  }
  // §16.41: a weapon summoned by a spell (Flame Blade), as long as its trace is there.
  for ( const activity of traceAttacks(token.actor) ) {
    entries.push({ icon: "fa-solid fa-fire", label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }),
      preview: { token, target, activity } });
  }
  // §15.2: the unarmed strike and its Grapple / Shove (ours, or a class's), on another creature.
  // §16.44: a single button, which opens the choice (unarmed strike, Grapple, Shove: prone, Shove: pushed back).
  const unarmed = unarmedAttackOf(token.actor);
  const grapple = grappleShoveOf(token.actor);
  const bare = [];
  if ( unarmed ) bare.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNues"), run: event => engageWith(token, target, unarmed, { event }),
    preview: { token, target, activity: unarmed } });
  // §18.23: a creature one already grapples is not grappled again — the Grapple gives way to "Release".
  const holding = holdsOf(token, target).length > 0;
  if ( holding ) bare.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
  for ( const profile of grapple?.effects ?? [] ) {
    const effect = effectOfProfile(profile, grapple.item);
    const name = effect?.name;
    if ( !name ) continue;
    if ( holding && effect.statuses?.has("grappled") ) continue;
    bare.push({ icon: "fa-solid fa-hands", label: name, run: event => engageWith(token, target, grapple, { event, choice: profile._id }) });
  }
  if ( bare.length === 1 ) entries.push(bare[0]);
  else if ( bare.length ) entries.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNuesChoix"), run: event => openMenu(event, bare) });
  // §18.22: Help (attack part), in combat, on an enemy — move up to it if it is reachable this turn.
  const help = helpActivityOf(token.actor);
  // §411: on a creature that is not an enemy (Shift), Help stays offered, greyed out — the click says why and can force.
  if ( help && inCombat() ) {
    entries.push({ icon: "fa-solid fa-handshake-angle", label: loc("Menu.Soutien"), run: event => engageWith(token, target, help, { event }),
      preview: { token, target, activity: help } });
  }
  entries.push(...endingEntries(token, target));
  entries.push(...followEntries(token, target));
  entries.push(...familiarEntries(token, target));
  entries.push(...mountEntries(token, target));
  entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
  if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
  pushGroupRoll(entries, target);
  return entries;
}

/**
 * §242: GM, on a creature — "Request a roll" (the request window, this token and the selection ticked). In the engine's menu only
 * (user feedback, 2026-10-25: not in the token HUD); on one's own token too, where the "HUD" entry keeps it within reach.
 */
function pushGroupRoll(entries, target) {
  // Issue #32: GM — during the pause of a roll that this token failed by 1 or 2: offer success at a price.
  const atCost = atCostMenuEntry(target);
  if ( atCost ) entries.unshift(atCost);
  const entry = groupRollEntry(target);
  if ( entry ) entries.push(entry);
  // §282: GM, on a player character — give or remove Heroic Inspiration.
  const heroic = heroicEntry(target);
  if ( heroic ) entries.push(heroic);
  // §289: GM — "Second Skin": the trigger of the lived change.
  const change = game.user.isGM ? catalystOf(target?.actor) : null;
  if ( change && !catalystArmed(target.actor) ) {
    entries.push({ icon: "fa-solid fa-paw-claws", label: loc("Catalyseur.Menu", { item: change.item.name }), run: () => armCatalyst(target.actor) });
  }
  // §290: GM — windows without delay: force the answer that this character's player is slow to give.
  for ( const wait of game.user.isGM ? waitsOf(target?.actor) : [] ) {
    entries.push({ icon: "fa-solid fa-forward", label: loc("Attente.Menu", { name: wait.userName, what: wait.label }), run: () => forceWait(wait.id) });
  }
  // §380: "Bug report…" — the GM on any creature, a player on their own (this token's context is attached).
  const bug = debugMenuEntry(target);
  if ( bug ) entries.push(bug);
}

function heroicEntry(target) {
  const actor = target?.actor;
  if ( !game.user.isGM || (actor?.type !== "character") ) return null;
  const on = !!actor.system.attributes?.inspiration;
  return { icon: on ? "fa-regular fa-star" : "fa-solid fa-star", label: loc(on ? "Heroique.MenuRetirer" : "Heroique.MenuDonner"),
    run: () => setHeroic(actor, !on) };
}
