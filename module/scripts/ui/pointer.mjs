/**
 * The mouse, in the spirit of BG3 (SPEC §11, step 6 bis; §13.3: `ui/` reads the state, emits
 * intentions, decides nothing):
 *
 *  - left click on the ground: move (path preview in combat)
 *  - left click on an enemy, in combat: base attack
 *  - right click: context menu (on the ground: move, jump; on a token: attacks, observe)
 *  - aim mode: an attack or spell chosen without a target waits for a click on its target
 *
 * Each click becomes a call to `runtime/actions.mjs` (`moveTo`, `jumpTo`, `engage`), which
 * carries the turn's ceiling and the Opportunity Attacks. Nothing is patched: the mouse is
 * listened to on the document (capture phase, so before PIXI), and a click is only "swallowed"
 * when the engine takes it for itself.
 */

import { mergeIssues } from "../core/forced.mjs";
import { theaterActive } from "../runtime/theater-state.mjs";
import { MODULE_ID } from "../constants.mjs";
import { stopWalking, forgetAllWalks, stopDeadMovements } from "../adapter/movement.mjs";
import { stormOf, cloudOf, cloudCircle, boltRadiusPx } from "../adapter/storm.mjs";
import { dressStorm, strike, setBoltAim, freshCloudOf, castStorm, strikeActivityOf, launchStrike } from "../runtime/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { askStorm } from "./storm.mjs";
import { contentOf, rangeUnitsOf, identifierOf } from "../adapter/content.mjs";
import { projectilesOf, projectileCount, targetCount } from "../adapter/projectiles.mjs";
import { concentrationOn, summonChoicesOf } from "../adapter/summons.mjs";
import { engage, castOnTargets, lineDashOf } from "../runtime/actions.mjs";
import { movableZoneOf, moveZone, tooFarForZone } from "../runtime/zones.mjs";
import { askAnyway } from "../runtime/turn.mjs";
import { castWithPicks } from "../runtime/projectiles.mjs";
import { pendingMetamagic } from "../adapter/metamagic.mjs";
import { castLight, putOutLight } from "../runtime/lights.mjs";
import { lightChoiceOf } from "../adapter/lights.mjs";
import { askLightChoice } from "./light.mjs";
import { pickTargetsOf } from "../adapter/pick-targets.mjs";
import { castOnPicked } from "../runtime/pick-targets.mjs";
import { askPickTargets } from "./pick-targets.mjs";
import { askWildForm } from "./wildshape.mjs";
import { isWildShape } from "../adapter/wildshape.mjs";
import { enchantTargetOf } from "../adapter/enchant.mjs";
import { tetherOfActivity, tetheredToken } from "../adapter/tether.mjs";
import { enchantWith, pactWith } from "../runtime/enchant.mjs";
import { askPact } from "./pact.mjs";
import { askEnchantWeapon } from "./enchant.mjs";
import { takeForm } from "../runtime/wildshape.mjs";
import { askSummonForm, askProfile } from "./summon-form.mjs";
import { castWithForm, castWithProfile } from "../runtime/summon-handover.mjs";
import { asksSummonForm, asksProfile } from "../core/summon.mjs";
import { shapeCenter } from "../core/area.mjs";
import { targetRule, targetRefusal } from "../core/targeting.mjs";
import { relationForTargeting } from "../adapter/factions.mjs";
import { route } from "../runtime/router.mjs";
import { loc, log } from "../runtime/shared.mjs";
import { registerHitChance, hideHitChance, placeHitChance } from "./hitchance.mjs";
import { registerAttackLine } from "./attack-line.mjs";
import { floatNotice } from "./feedback.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { potionCastsOnDrinker } from "../adapter/usage.mjs";
import { isPotion } from "../adapter/potions.mjs";
import { chainOf } from "../adapter/chain.mjs";
import { aimedAreaOf, aimedShapeData, aimedRegionData, wallAreaOf, rangedAreaOf, rangedPlacementProblem } from "../adapter/self-area.mjs";
import { castAimed, placeAimed, placeWall } from "../runtime/self-area.mjs";
import { clampPolyline, polylineLength, orthogonalize } from "../core/wall.mjs";
import { closeMenu, onMenuShift, HIGH_JUMP_MENU_SETTING, NONLETHAL_MENU_SETTING } from "./pointer-menu.mjs";
import { cancellable, clearPreview, forgetHover, lastPointer, onKeyDown, onModifierKey, onPointerDown, onPointerMove, onPointerUp, refusalFor, refusalIssues, replayHover, setCursor, trackPointer } from "./pointer-mouse.mjs";
import { clearTargets, leftoverTargets, noteInFlight, offerEnchantedAttack, onFlurryUsed, onPostUseActivity, onPreRollDamage, onResolutionSettled, onTurnChange } from "./pointer-offers.mjs";
export { menuEntriesFor, doorMenuFor, groundMenuFor } from "./pointer-menu.mjs";

export const setting = key => game.settings.get(MODULE_ID, key);
export const inCombat = () => game.combat?.started === true;

/** The token that acts: the only controlled token, if it is one's own. */
export function actingToken() {
  const controlled = canvas.tokens?.controlled ?? [];
  return ((controlled.length === 1) && controlled[0].document.isOwner) ? controlled[0].document : null;
}

/**
 * One intention at a time: a second click while an action is playing is ignored. `generation`: an intention released by
 * `releaseMouse` (scene change) that would finish later does not release the one that replaced it.
 */
export let busy = false;
let running = null;
let generation = 0;
export function exclusive(fn) {
  if ( busy ) return Promise.resolve();
  busy = true;
  const mine = ++generation;
  const current = (async () => {
    try { await fn(); }
    catch(err) { console.error(`${MODULE_ID} | mouse`, err); }
    finally { if ( generation === mine ) { busy = false; running = null; } }
  })();
  running = current;
  return current;
}

/** The canvas was torn down for another scene (not for another level of the same one). */
let sceneLeft = false;

/**
 * B12: when the canvas is torn down for another scene (the GM changes scene), a walk in progress never completes —
 * the core's `move` or its animation waits for a token that is no longer displayed — and the mouse stayed busy until F5.
 * The walks are stopped and the mouse is released.
 */
function releaseMouse() {
  forgetAllWalks();
  generation++;
  busy = false;
  running = null;
}

/**
 * §99: a click while the token walks (movement, approach to an attack, to a door) stops it at the next free cell
 * — the current intention stops there (no attack at the end) — then `then`, if there is one, goes off like a new click.
 * Returns false if the token was not walking: the click is then ignored, like any click during an action.
 */
export function interruptWalk(token, then=null) {
  if ( !busy || !stopWalking(token) ) return false;
  const current = running;
  current.then(() => (then ? exclusive(then) : null));
  return true;
}

export const engageWith = (token, target, activity, options={}) => engage(token, target, activity, { fast: setting("fastAttack"), ...options });

export function observe(target) {
  const actor = target.actor;
  if ( actor?.testUserPermission(game.user, "LIMITED") ) return actor.sheet.render(true);
  ui.notifications.info(target.name);
}

/* -------------------------------------------- */
/*  Aiming mode                                 */
/* -------------------------------------------- */

export let targeting = null;
/**
 * §16.27: multiple aiming of a projectile spell (Magic Missile, Scorching Ray, Eldritch Blast) — after the level is chosen,
 * each click on a creature sends it a projectile (the same one can be clicked several times); a counter follows the cursor;
 * on the last one, the spell goes off. `{ token, activity, count, picks, usage }`.
 */
export let picking = null;
/** §16.14: a zone to move waits for the cell to place it on (`{ activity }`), via the core's placement (placeZone). */
export let placing = null;
/** §57: a straight-line rush ("Wind Strike") waits for the click on its arrival cell (`{ token, activity, usage }`). */
export let dashing = null;
/** §107: a familiar's recall waits for the click on the cell where it reappears (`{ token }`: the master's token). */
export let recalling = null;
/** Opens the wait for a familiar's recall (the click on the cell, `startRecall`). */
export function openRecall(token) {
  recalling = { token };
}
/** Tint of the preview when the cell is out of movement range. */
const TOO_FAR_COLOR = "#d03030";

/** §119: the instruction of the open aiming (the text of its notification), which the banner keeps on screen. */
let promptText = null;

/**
 * End of a placement: `placing` is reset to null only if it is still the one of this placement. A placement waits for the
 * mouse (`await`); meanwhile another aiming may open (`stopTargeting` cancels the placement, then an offer or another spell
 * sets its own state), which the end of the old one must not erase.
 */
function endPlacing(mine) {
  if ( placing !== mine ) return false;
  placing = null;
  return true;
}

/** §118: which aiming is open, for neighbouring modules. */
function targetingKind() {
  if ( picking ) return picking.group ? "group" : "projectiles";
  if ( targeting ) return "target";
  if ( dashing ) return "dash";
  if ( recalling ) return "recall";
  if ( placing ) return "area";
  return null;
}

/**
 * §118: the aiming this client is waiting for, for neighbouring modules (`api.ui.targeting()`) — while it is open, the left
 * click belongs to the engine, whatever is under the mouse (corpse, chest, merchant). `{ token, activity, identifier }`
 * (uuids of the acting token and of the activity, dnd5e identifier of its item), or null.
 * §119: plus `kind` (`target`, `projectiles`, `group`, `dash`, `recall`, `area`), `item` (item name), `prompt` (the translated
 * instruction, or null), and for a multiple or group aiming `picked` / `total` (otherwise null).
 */
export function pendingTargeting() {
  const open = picking ?? targeting ?? dashing ?? recalling ?? placing;
  if ( !open ) return null;
  return { token: open.token?.uuid ?? null, activity: open.activity?.uuid ?? null,
    identifier: open.activity?.item ? identifierOf(open.activity.item).id : null,
    kind: targetingKind(), item: open.activity?.item?.name ?? null, prompt: promptText,
    picked: picking ? picking.picks.length : null, total: picking ? picking.count : null };
}

/**
 * §118: publishes an aiming change — hook `dnd5e-combat.targeting`, `(state)` (that of `pendingTargeting`, null on
 * close), on this client only. Deferred by a microtask: some paths set the class before the state.
 * §119: also on each creature chosen or removed in a multiple aiming (`picked` changes); and the banner follows.
 */
let announcedTargeting = null;
function announceTargeting() {
  queueMicrotask(() => {
    const state = pendingTargeting();
    if ( !state ) promptText = null;
    renderBanner(state);
    const key = state ? `${state.token}|${state.activity}|${state.kind}|${state.picked}|${state.prompt}` : null;
    if ( key === announcedTargeting ) return;
    announcedTargeting = key;
    // §118: on this client only, at each change of the aiming it is waiting for: `(state)`, that of `api.ui.targeting()`,
    // null on close.
    Hooks.callAll(`${MODULE_ID}.targeting`, state);
  });
}

/**
 * §119: the instruction of an aiming that opens — kept by the banner while the aiming lasts; the notification only without a
 * banner (setting off), so as not to show it twice.
 */
export function promptTargeting(text) {
  promptText = text;
  if ( !setting("targetingBanner") ) ui.notifications.info(text);
  announceTargeting();
}

/**
 * §119: aiming banner (issue #4: the notification fades, and nothing told you any more that the engine was waiting for clicks) —
 * at the top of the screen while an aiming is open: the instruction, and for a multiple aiming the counter. Per-client setting
 * (`targetingBanner`); a neighbour with its own display can hide it (`.dnd5e-combat-banner`) or move it
 * (CSS variable `--dnd5e-combat-banner-top`). Takes no click.
 */
let banner = null;
function renderBanner(state) {
  const text = state?.prompt ?? null;
  if ( !text || !setting("targetingBanner") ) {
    if ( banner ) banner.hidden = true;
    return;
  }
  if ( !banner ) {
    banner = document.createElement("div");
    banner.className = "dnd5e-combat-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `<span class="text"></span><span class="count"></span>`;
  }
  banner.querySelector(".text").textContent = text;
  const count = banner.querySelector(".count");
  count.textContent = Number.isFinite(state.total) ? `${state.picked}/${state.total}` : "";
  count.hidden = !count.textContent;
  banner.hidden = false;
  if ( !banner.isConnected ) document.body.append(banner);
}

export function markTargeting() {
  document.body.classList.add("dnd5e-combat-targeting");
  announceTargeting();
}

/**
 * Opens the aiming of an activity: the target of `token` is chosen with a click, then `activity.use(...usage)`. `prompt`: the
 * banner instruction; `notice`: a floating feedback above `noticeOn` (the acting token, usually); `reticle`: the text that
 * follows the mouse. `fresh` (default): the current aiming is closed first.
 */
export function openTargeting(token, activity, usage, { prompt, notice=null, noticeOn=token, reticle=null, fresh=true }) {
  if ( fresh ) stopTargeting();
  targeting = { token, activity, usage };
  markTargeting();
  promptTargeting(prompt);
  if ( notice ) floatNotice(noticeOn, notice);
  if ( reticle ) showReticle(reticle);
}

/** The window options of a use, without the dnd5e window (the choice is already made). */
const noDialog = dialogConfig => ({ ...(dialogConfig ?? {}), configure: false });

/** Whom the activity aims at with a click (core/targeting.mjs), or null if it is not aimed that way. */
function ruleOf(activity) {
  // §394: a summon is aimed only if the content asks for it (Finger of Death: the corpse). Its data often designate
  // the item itself (Carpet of Flying, Driftglobe) or a free cell (Efreeti Bottle): the engine waited for an impossible click.
  // (§385: `summon.untargeted`, Create Undead, is now a special case of it.)
  if ( (activity?.type === "summon") && !contentOf(activity.item).entry?.targetedSummon ) return null;
  // §16.41: the weapon of a creature, oneself included (Elemental Weapon: dnd5e aims at an "object").
  if ( enchantTargetOf(activity) === "weapon" ) return { self: true, side: null };
  // §53: the spell a potion makes you cast is for the drinker (adapter/usage.mjs) — nothing to aim.
  if ( potionCastsOnDrinker(activity?.item) ) return null;
  // §101: a "touch" potion is drunk without a target (the drinker), or goes to the creature already designated — no aiming.
  if ( isPotion(activity?.item) && (activity.range?.units === "touch") ) return null;
  // §123: the range corrected by the content (Lay on Hands: "personal" in the data, touch in truth).
  return activity ? targetRule({ type: activity.type, affects: activity.target?.affects?.type, rangeUnits: rangeUnitsOf(activity),
    template: activity.target?.template?.type }) : null;
}

function needsTarget(activity) {
  return !!ruleOf(activity);
}

const TARGET_REFUSALS = { self: "Retour.PasSoi", notAlly: "Retour.PasAllie", notEnemy: "Retour.PasEnnemi" };

/** Does the activity's target type refuse this creature (oneself, wrong side)? The refusal text, or null. */
export function targetTypeRefusal(me, hover, activity) {
  const why = targetRefusal(ruleOf(activity), { isSelf: hover === me, relation: relationForTargeting(me, hover) });
  return why ? loc(TARGET_REFUSALS[why]) : null;
}

/**
 * `dnd5e.preUseActivity`, BEFORE the legality check (order of the `register…()`): an activity
 * that aims at someone, cast without a target, goes into aiming mode; the use is suspended and
 * restarts, same configurations, on the click on the target.
 */
function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  // §16.27: a projectile spell is aimed projectile by projectile, after the level is chosen. Not for a caller that
  // confirms outright (connector, scenarios: targets given), nor for a chained projectile or a bounce.
  const ours = usageConfig[MODULE_ID] ?? {};
  if ( projectilesOf(activity?.item) && !ours.confirmed && !ours.picks && !ours.projectileOf && !ours.leap && canvas.ready ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( token?.object && token.isOwner ) {
      closeSheetFor(activity);
      stopTargeting();
      startPicking(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | multiple targeting`, err));
      return false;
    }
  }
  // §70: Call Lightning — "outdoors, in stormy weather?" before the casting (not on the recast: the cloud is there).
  const storm = stormOf(activity?.item);
  if ( storm && !ours.recast && !("stormy" in ours) && !ours.confirmed && canvas.ready && activity.actor?.isOwner && !cloudOf(activity.item) ) {
    closeSheetFor(activity);
    stopTargeting();
    askStorm(activity, storm.bonus ?? "").then(stormy => (stormy === null) ? null
      : exclusive(() => castStorm(activity, [usageConfig, dialogConfig, messageConfig], stormy)))
      .catch(err => console.error(`${MODULE_ID} | storm`, err));
    return false;
  }
  // §16.35: a light spell that summons an object (Light) — on the ground or on oneself, and the colour, before casting.
  if ( lightChoiceOf(activity) && !ours.lightChoice && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askLightChoice(activity).then(choice => !choice ? null
      : exclusive(() => (choice.where === "off") ? putOutLight(activity) : castLight(activity, usage, choice)))
      .catch(err => console.error(`${MODULE_ID} | light choice`, err));
    return false;
  }
  // §293: "each creature of your choice within a radius" (Turn Undead) — the list of creatures in range, ticked, and
  // the checkbox of the activity that replaces it (Sear Undead); then the activity goes off on the ticked ones,
  // with no area or click aiming.
  if ( pickTargetsOf(activity) && !ours.picked && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askPickTargets(activity).then(choice => !choice ? null : exclusive(() => castOnPicked(activity, usage, choice)))
      .catch(err => console.error(`${MODULE_ID} | creatures of your choice`, err));
    return false;
  }
  // §391 (issue #38): an enchantment or a transformation with several profiles cast without the dnd5e window (bar, "Cast anyway") —
  // the profile (the element of Elemental Weapon, the bonus of a +1/+2/+3 weapon…) is chosen in the engine's window, before its own
  // paths (Pact of the Blade, Elemental Weapon). Wild Shape already has its own (§16.39).
  // The engine paths that recast by themselves without the dnd5e window: the weapon of an already designated creature
  // (Elemental Weapon, Magic Weapon: `enchantWith`, `configure: false`) and Pact of the Blade (`pactWith`) — without this, the
  // element was never asked for when a target was already designated (enchantment sweep).
  const enchantKind = (activity?.type === "enchant") ? enchantTargetOf(activity) : null;
  const skipsDialog = (dialogConfig?.configure === false) || (enchantKind === "ownWeapon")
    || ((enchantKind === "weapon") && (!!ours.engaged || (game.user.targets.size > 0)));
  if ( ["enchant", "transform"].includes(activity?.type) && canvas.ready && activity.actor?.isOwner
    && asksProfile({ configure: skipsDialog ? false : dialogConfig?.configure, chosen: !!ours.summonForm, confirmed: !!ours.confirmed && !ours.forced, own: isWildShape(activity),
      profiles: ((activity.type === "enchant") ? activity.availableEnchantments : activity.availableProfiles)?.length ?? 0 }) ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askProfile(activity, usageConfig).then(choice => choice ? exclusive(() => castWithProfile(activity, usage, choice)) : null)
      .catch(err => console.error(`${MODULE_ID} | profile choice`, err));
    return false;
  }
  // §16.41: Elemental Weapon — the level and the element (dnd5e window), then the creature (aiming), then its weapon.
  // §16.45: Pact of the Blade — its weapons or a summoned weapon, and the damage type; no creature to aim at.
  if ( (enchantTargetOf(activity) === "ownWeapon") && !ours.enchantItem && !ours.confirmed && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askPact(activity).then(choice => choice ? exclusive(() => pactWith(activity, usage, choice)) : null)
      .catch(err => console.error(`${MODULE_ID} | pact weapon`, err));
    return false;
  }
  if ( (enchantTargetOf(activity) === "weapon") && !ours.enchantItem && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const target = [...game.user.targets][0]?.document ?? null;
    if ( ours.engaged || target ) {
      const usage = [usageConfig, dialogConfig, messageConfig];
      askEnchantWeapon(activity, target?.actor).then(uuid => uuid ? exclusive(() => enchantWith(activity, usage, uuid)) : null)
        .catch(err => console.error(`${MODULE_ID} | enchantment`, err));
      return false;
    }
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( !token?.object ) return true;
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      openTargeting(token, activity, [chosen.config, noDialog(dialogConfig), messageConfig],
        { prompt: loc("Enchant.ChoisirCreature", { name: activity.item.name }), fresh: false });
    }).catch(err => console.error(`${MODULE_ID} | enchantment`, err));
    return false;
  }
  // §16.39: Wild Shape, Circle Forms — the form is chosen among the known forms, before casting.
  if ( isWildShape(activity) && !ours.wildForm && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askWildForm(activity).then(uuid => uuid ? exclusive(() => takeForm(activity, usage, uuid)) : null)
      .catch(err => console.error(`${MODULE_ID} | Wild Shape`, err));
    return false;
  }
  // §383 (issue #38): a summon with several forms (Summon Celestial: Avenger / Defender), sizes or types, cast
  // without the dnd5e window (action bar, gamepad: `configure: false`) — the form is chosen in the engine's window, on the
  // caster's side, then the use restarts with it. Light has its own window (§16.35).
  // §385: "up to N" creatures (`summon.chooseCount`) — always this window, with the number and, from the sheet, the level.
  const chooseRule = (activity?.type === "summon") ? contentOf(activity.item).entry?.summon?.chooseCount : null;
  const chooseCount = !!chooseRule;
  if ( (activity?.type === "summon") && canvas.ready && activity.actor?.isOwner && !lightChoiceOf(activity)
    && asksSummonForm({ configure: dialogConfig?.configure, choices: summonChoicesOf(activity), chosen: !!ours.summonForm,
      // §410: a "forced" recast without a resource (legality window, §77) is confirmed but has not yet chosen its form.
      confirmed: !!ours.confirmed && !ours.forced, otherChoice: !!ours.lightChoice, always: chooseCount,
      willSummon: !!usageConfig.create?.summons || !!contentOf(activity.item).entry?.placesSummons || (game.user.targets.size > 0) }) ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    const options = { chooseCount, countFormula: (typeof chooseRule === "string") ? chooseRule : null, chooseLevel: chooseCount && (dialogConfig?.configure !== false) && activity.requiresSpellSlot,
      slot: usageConfig.spell?.slot ?? null };
    askSummonForm(activity, usageConfig.summons ?? {}, options).then(choice => choice ? exclusive(() => castWithForm(activity, usage, choice)) : null)
      .catch(err => console.error(`${MODULE_ID} | summon form`, err));
    return false;
  }
  // §57: a straight-line rush ("Wind Strike") — the arrival cell is aimed instead of placing the line template.
  if ( lineDashOf(activity) && !ours.dash && !ours.confirmed && canvas.ready ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( token?.object && token.isOwner ) {
      closeSheetFor(activity);
      stopTargeting();
      promptTargeting(loc("Ruee.Choisir", { item: activity.item.name }));
      dashing = { token, activity, usage: [usageConfig, dialogConfig, messageConfig] };
      markTargeting();
      return false;
    }
  }
  // §162: a wall ("wall" template) is placed by points — the level first, then two or more points; the activity goes off with them.
  const wall = (ours.aimed || ours.confirmed || !canvas.ready || (usageConfig.create?.measuredTemplate !== true)) ? null : wallAreaOf(activity);
  if ( wall && wall.token.object && wall.token.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    usageConfig.create.measuredTemplate = false;
    if ( dialogConfig ) {
      dialogConfig.options ??= {};
      dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
    }
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      return aimWall(activity, wall, points => exclusive(() => castAimed(activity,
        [chosen.config, noDialog(dialogConfig), messageConfig], { type: "wall", points })));
    }).catch(err => console.error(`${MODULE_ID} | wall placement`, err));
    return false;
  }
  // §59: a Cone, Line or Cube with personal range (breath, Burning Hands, Lightning Bolt, Thunderwave) — the level
  // first, then the area follows the mouse around the caster; the click places it and casts the activity.
  const aim = (ours.aimed || ours.confirmed || !canvas.ready || (usageConfig.create?.measuredTemplate !== true) || lineDashOf(activity))
    ? null : aimedAreaOf(activity);
  if ( aim && aim.token.object && aim.token.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    usageConfig.create.measuredTemplate = false;
    if ( dialogConfig ) {
      dialogConfig.options ??= {};
      dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
    }
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      return aimArea(activity, aim, shape => exclusive(() => castAimed(activity,
        [chosen.config, noDialog(dialogConfig), messageConfig], shape)));
    }).catch(err => console.error(`${MODULE_ID} | area targeting`, err));
    return false;
  }
  // §16.14: recasting a spell whose movable area is already there (Moonbeam) moves it: the cell is aimed, nothing is
  // cast. Not for a caller that confirms outright (connector, recast after legality): that one really casts.
  const zone = usageConfig[MODULE_ID]?.confirmed ? null : movableZoneOf(activity);
  if ( zone ) {
    stopTargeting();
    placeZone(activity, zone);
    return false;
  }
  if ( !usageConfig[MODULE_ID]?.engaged && !usageConfig[MODULE_ID]?.confirmed ) closeSheetFor(activity);
  // §125: an action the engine casts on the targets it has chosen (aiming, projectiles, group) — held until they are released.
  if ( ours.engaged || ours.picks || ours.projectileOf ) noteInFlight(activity);
  // §189: a fire action shot at an oil slick, a web — without a targeted creature, nothing to aim.
  if ( !setting("targetingMode") || usageConfig[MODULE_ID]?.engaged || usageConfig[MODULE_ID]?.confirmed || ours.igniteZone ) return true;
  // §125: the targets of a previous action not yet settled (its animation, its rolls) are not used for another — seen: a Healing
  // Word cast right after a Vicious Mockery healed the Zombie still targeted. Released, and the aiming opens.
  if ( leftoverTargets(activity) ) { clearTargets(); log(`${activity.item?.name}: previous action's targets released, targeting opened`); }
  if ( !canvas.ready || game.user.targets.size || !needsTarget(activity) ) return true;
  const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
  if ( !token?.object || !token.isOwner ) return true;
  stopTargeting();
  // §16.33: a spell with several targets (Bless, Prayer of Healing…) — the level first, then one click per creature.
  if ( maySeveral(activity) ) {
    startGroup(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | group targeting`, err));
    return false;
  }
  openTargeting(token, activity, [usageConfig, dialogConfig, messageConfig], { prompt: loc("Visee.Choisir", { name: activity.item.name }), fresh: false });
  return false;
}

/**
 * §15.1: choosing an attack or a spell closes the character sheet, to clear the view (aiming
 * included). Per-client setting. Other activities (potion healing, utility) leave it.
 */
function closeSheetFor(activity) {
  if ( !setting("closeSheetOnUse") || ((activity.type !== "attack") && !isSpellCast(activity.item)) ) return;
  const sheet = activity.actor?.sheet;
  if ( sheet?.rendered ) sheet.close();
}

/**
 * §16.14: the new position of a zone is chosen with the V14 core's interactive placement
 * (`RegionLayer#placeRegion`, client/canvas/layers/regions.mjs:688, `create: false`: nothing is created, the placed shape
 * is returned) — the one dnd5e uses to place the spell (canvas/template-placement.mjs:24). The preview is thus the zone
 * itself under the mouse, snapped to the grid as at placement; red beyond the allowed distance, where the click is
 * refused. Right click or Escape: the core cancels. The engine's mouse is hidden during placement.
 */
async function placeZone(activity, zone) {
  const source = zone.region.toObject();
  const shape = source.shapes?.[0];
  if ( !shape || !canvas.ready ) return;
  const mine = placing = { activity };
  announceTargeting();
  promptTargeting(loc("Zone.Choisir", { item: activity.item.name }));
  const far = s => tooFarForZone(zone, shapeCenter(s.toObject()));
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), name: source.name, color: source.color, shapes: [shape], levels: source.levels,
      elevation: source.elevation, restriction: source.restriction, visibility: source.visibility,
      highlightMode: source.highlightMode, hidden: source.hidden, displayMeasurements: true
    }, {
      create: false, allowRotation: false,
      onChange: ({ preview, document: doc, shape: s }) => {
        doc.updateSource({ color: far(s) ? TOO_FAR_COLOR : source.color });
        preview.renderFlags.set({ refreshState: true });
      },
      // §411: too far, the placement is no longer refused — `moveZone` says so in its window, and one can force.
    });
    const point = placed?.shapes?.length ? shapeCenter(placed.shapes[0].toObject()) : null;
    if ( !point ) return ui.notifications.info(loc("Visee.Annulee"));
    let settled = true;
    await exclusive(async () => { settled = await moveZone(activity, point); });
    // Given up at the window: the placement reopens, like the old refusal.
    if ( settled === false ) { endPlacing(mine); return placeZone(activity, movableZoneOf(activity) ?? zone); }
  } catch(err) { console.error(`${MODULE_ID} | area move`, err); }
  finally { endPlacing(mine); announceTargeting(); }
}

/**
 * §59: the aiming of a Cone, Line or Cube around the caster, via the core's region placement (`RegionLayer#placeRegion`,
 * client/canvas/layers/regions.mjs:688): `onMove` replaces the default movement (regions.mjs:1037-1043) — the apex
 * stays on the caster's edge, only the direction follows the mouse; a Cube stays attached to the caster (`aimedShapeData`);
 * the wheel rotates nothing (`onRotate` returns false, regions.mjs:991). Left click: `then(shape)`; right click or Escape: nothing.
 * @param {Activity} activity
 * @param {{shape: "cone"|"line", token: TokenDocument}} area
 * @param {(shape: object) => any} then  What follows the click, with the aimed shape.
 */
async function aimArea(activity, area, then) {
  if ( !canvas.ready ) return;
  stopTargeting();
  const mine = placing = { activity };
  announceTargeting();
  promptTargeting(loc("Zone.Viser", { item: activity.item.name, name: area.token.name }));
  let last = null;
  const center = area.token.object.center;
  const initial = aimedShapeData(activity, area, { x: center.x + 1, y: center.y });
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), ...aimedRegionData(activity, area, initial), displayMeasurements: true
    }, {
      create: false, allowRotation: true,
      onMove: ({ position, shape }) => {
        const data = aimedShapeData(activity, area, position, last);
        const c = area.token.object.center;
        if ( Math.hypot(position.x - c.x, position.y - c.y) > 1 ) last = { x: position.x - c.x, y: position.y - c.y };
        shape.updateSource({ x: data.x, y: data.y, rotation: data.rotation });
        return false;
      },
      onRotate: () => false
    });
    const shape = placed?.shapes?.length ? placed.shapes[0].toObject() : null;
    if ( !shape ) return ui.notifications.info(loc("Visee.Annulee"));
    endPlacing(mine);
    announceTargeting();
    await then(shape);
  } catch(err) { console.error(`${MODULE_ID} | area targeting`, err); }
  finally { endPlacing(mine); announceTargeting(); }
}

/** The length in feet (grid units) for the banner. */
const gridUnits = px => Math.round((px / canvas.dimensions.size) * canvas.dimensions.distance);

/**
 * §162: placing a wall by points. Left click: a point (at the nearest cell corner, the remaining length capped); the next
 * segment follows the mouse; right click or Enter: done (two points at least); Escape: nothing. The wall ends by itself when its
 * length is reached. `then(points)` receives the polyline, in pixels.
 * @param {Activity} activity
 * @param {{token: TokenDocument, length: number, width: number}} area  `wallAreaOf`.
 * @param {(points: Array<{x: number, y: number}>) => any} then
 */
async function aimWall(activity, area, then) {
  if ( !canvas.ready ) return;
  stopTargeting();
  const points = [];
  let mine = null;
  const g = new PIXI.Graphics();
  canvas.controls.addChild(g);
  const color = Number(foundry.utils.Color.from(game.user.color)) || 0xff6400;
  // §172: a thick wall is placed from cell center to cell center; its line of centers is one cell shorter than the wall.
  const max = (area.cells ? area.lineLength : area.length) || Infinity;
  // §169: no diagonal — the point follows the axis where it strays furthest from the previous one.
  const snap = p => {
    const v = canvas.grid.getSnappedPoint(p, { mode: area.cells ? CONST.GRID_SNAPPING_MODES.CENTER : CONST.GRID_SNAPPING_MODES.VERTEX });
    return (area.orthogonal && points.length) ? orthogonalize([points.at(-1), v])[1] : v;
  };
  const say = cursor => {
    const used = polylineLength(clampPolyline(cursor ? [...points, cursor] : points, max));
    const left = Number.isFinite(max) ? loc("Mur.Reste", { n: gridUnits(Math.max(0, max - used)), units: canvas.scene.grid.units }) : "";
    promptText = `${loc(points.length < 2 ? "Mur.Poser" : "Mur.Continuer", { item: activity.item.name })}${left ? ` ${left}` : ""}`;
    announceTargeting();
  };
  const draw = cursor => {
    const line = clampPolyline(cursor ? [...points, cursor] : points, max);
    g.clear();
    if ( !line.length ) return;
    g.lineStyle(Math.max(area.width, 6), color, 0.6).moveTo(line[0].x, line[0].y);
    for ( const p of line.slice(1) ) g.lineTo(p.x, p.y);
    g.lineStyle(0).beginFill(color, 0.9);
    for ( const p of points ) g.drawCircle(p.x, p.y, 6);
    g.endFill();
  };
  const result = await new Promise(resolve => {
    let done = false;
    const finish = value => {
      if ( done ) return;
      done = true;
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      g.destroy();
      resolve(value);
    };
    const onMove = event => { const p = snap(event.getLocalPosition(canvas.stage)); draw(p); say(p); };
    const onDown = event => {
      if ( event.button === 2 ) return finish(points.length >= 2 ? clampPolyline(points, max) : null);
      if ( event.button !== 0 ) return;
      event.stopPropagation();
      const p = snap(event.getLocalPosition(canvas.stage));
      points.push(p);
      const line = clampPolyline(points, max);
      if ( (line.length < points.length) || (polylineLength(line) >= max - 0.5) ) return finish(line.length >= 2 ? line : null);
      draw(p); say(p);
    };
    const onKey = event => {
      if ( event.key === "Escape" ) { event.preventDefault(); finish(null); }
      else if ( event.key === "Enter" ) { event.preventDefault(); finish(points.length >= 2 ? clampPolyline(points, max) : null); }
    };
    mine = placing = { activity, cancel: () => finish(null) };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    promptTargeting(loc("Mur.Poser", { item: activity.item.name }));
    say(null);
  });
  if ( endPlacing(mine) ) promptText = null;
  announceTargeting();
  if ( !result ) return ui.notifications.info(loc("Visee.Annulee"));
  await then(result);
}

/**
 * §70: after a use of Call Lightning — at casting, the cloud dnd5e has just placed is dressed up as a storm;
 * then (casting as recast) the bolt is aimed under the cloud: a 1.50 m circle follows the mouse without leaving the cloud,
 * the click places it (the resolution reads it), right click or Escape: no bolt (the card stays without resolution).
 */
export async function stormAfterUse(activity, usageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  let cloud = ours.recast ? cloudOf(activity.item) : null;
  if ( !cloud ) {
    cloud = freshCloudOf(activity.item);
    if ( !cloud ) return;
    await dressStorm(activity, cloud, { stormy: ours.stormy === true });
  }
  // §469: the casting placed only the cloud (Manual 3.0.0) — the bolt comes from its activity, used next, which returns here.
  const bolt = strikeActivityOf(activity);
  if ( bolt && (bolt !== activity) ) return void await launchStrike(activity, bolt, usageConfig);
  await aimBolt(activity, cloud);
}

async function aimBolt(activity, cloud) {
  if ( !canvas.ready ) return;
  const circle = cloudCircle(cloud);
  if ( !circle ) return;
  stopTargeting();
  const mine = placing = { activity };
  announceTargeting();
  setBoltAim({ activity, cloud });
  promptTargeting(loc("Orage.Viser", { item: activity.item.name }));
  const radius = boltRadiusPx(activity.item, cloud.parent);
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), name: activity.item.name, color: "#e8f4ff",
      shapes: [{ type: "circle", x: circle.center.x, y: circle.center.y, radius }], displayMeasurements: false
    }, {
      create: false, allowRotation: false,
      onMove: ({ position, shape }) => {
        const at = clampToCircle(position, circle.center, circle.radius);
        shape.updateSource({ x: at.x, y: at.y });
        return false;
      },
      onRotate: () => false
    });
    const shape = placed?.shapes?.length ? placed.shapes[0].toObject() : null;
    if ( !shape ) return;
    endPlacing(mine);
    announceTargeting();
    setBoltAim(null);
    await exclusive(() => strike(activity, cloud, { x: shape.x, y: shape.y }));
  } catch(err) { console.error(`${MODULE_ID} | lightning bolt targeting`, err); }
  finally { endPlacing(mine); announceTargeting(); setBoltAim(null); }
}

/** §59: the "Place the zone" button of the card of a Cone or Line with personal range — the same aiming. */
function onPreTemplate(activity) {
  if ( lineDashOf(activity) ) return;
  // §162 : un mur, par points.
  const wall = wallAreaOf(activity);
  if ( wall?.token.object && wall.token.isOwner ) {
    aimWall(activity, wall, points => placeWall(activity, points)).catch(err => console.error(`${MODULE_ID} | wall placement`, err));
    return false;
  }
  const aim = aimedAreaOf(activity);
  if ( !aim?.token.object || !aim.token.isOwner ) return;
  aimArea(activity, aim, shape => placeAimed(activity, shape)).catch(err => console.error(`${MODULE_ID} | area targeting`, err));
  return false;
}

/**
 * §190: a Sphere, cylinder or Cube cast "at a point within range" (Acid Splash, Fireball) — dnd5e's placement
 * (`TemplatePlacement.fromActivity`) has no range. Just before creation (`dnd5e.createMeasuredTemplate`,
 * canvas/template-placement.mjs:175, cancellable), an out-of-range zone is not created: the message says so and the
 * placement reopens. The placement stays dnd5e's, awaited by the use: what reads the zone at `postUseActivity` finds it (the Call
 * Lightning cloud, which 0.242.1 had broken by placing the zone afterwards). A storm cloud is not checked (its bolt aiming
 * follows the use); nor are the zones the engine creates itself (`enginePlaced`).
 */
function onCreateTemplate(activity, regionData) {
  if ( stormOf(activity?.item) ) return;
  if ( (regionData ?? []).some(d => d?.flags?.[MODULE_ID]?.enginePlaced || d?.flags?.[MODULE_ID]?.forcedPlacement) ) return;
  const area = rangedAreaOf(activity);
  if ( !area ) return;
  const shapes = (regionData ?? []).flatMap(d => d.shapes ?? []);
  // §200: "Clear path to the target" — no point of origin behind a wall (Fireball cast behind a wall, table feedback of
  // 2026-10-18). §286: each template of a multiple zone; Fire Storm — "each cube contiguous to at least one other".
  const problem = rangedPlacementProblem(area, shapes);
  if ( !problem ) return;
  const key = { far: "Zone.HorsPortee", hidden: "Zone.SansChemin", apart: "Zone.NonContigue" }[problem];
  // §411 (issue #44, batch 4): no more flat refusal — the window says so; forced, the zone is created where it was placed (as
  // dnd5e would have done, canvas/template-placement.mjs:175-187), the GM notified; given up, the placement reopens as before.
  // The hook is synchronous: we cancel, we ask, then we create.
  const data = foundry.utils.deepClone(regionData).map(d => foundry.utils.mergeObject(d, { [`flags.${MODULE_ID}.forcedPlacement`]: true }, { inplace: false }));
  askAnyway(`${activity.item.name} — ${activity.actor?.name ?? ""}`, [loc(key, { item: activity.item.name, max: area.max, units: area.units })],
    { actor: activity.actor, item: activity.item, token: activity.getUsageToken?.() ?? null }).then(async go => {
    if ( !go ) return dnd5e.canvas.TemplatePlacement.fromActivity(activity);
    const created = await canvas.scene.createEmbeddedDocuments("Region", data);
    Hooks.callAll("dnd5e.postCreateMeasuredTemplate", activity, created);
  }).catch(err => console.error(`${MODULE_ID} | ranged area placement`, err));
  return false;
}

/**
 * The dnd5e use window (spell slot level…), without casting: returns the chosen configuration and the level, or
 * null if the window was closed.
 */
async function configureFirst(activity, usageConfig, dialogConfig) {
  let config = usageConfig;
  if ( (dialogConfig?.configure !== false) && activity._requiresConfigurationDialog?.(usageConfig) && dialogConfig?.applicationClass ) {
    try { config = (await dialogConfig.applicationClass.create(activity, usageConfig, dialogConfig.options ?? {})) ?? usageConfig; }
    catch(err) {
      // Window closed: dnd5e rejects without error (activity-usage-dialog.mjs:556) — nothing is cast. A real error is logged.
      if ( err ) console.warn(`${MODULE_ID} | usage dialog of ${activity.item?.name}`, err);
      return null;
    }
  }
  const slot = config.spell?.slot;
  const level = slot ? (activity.actor?.system.spells?.[slot]?.level ?? activity.item.system.level ?? 0) : (activity.item.system.level ?? 0);
  return { config, level };
}

/** §16.33: can the activity aim at several creatures (number of targets > 1, or depending on the level)? Not an attack. */
function maySeveral(activity) {
  if ( activity.type === "attack" ) return false;
  const formula = activity.target?.override ? activity._source?.target?.affects?.count : activity.item?._source?.system?.target?.affects?.count;
  return (targetCount(activity) > 1) || /@/.test(String(formula ?? ""));
}

/**
 * §16.33: group aiming — the level first (it sets the number of targets: upcast Invisibility), then one click per
 * creature, a second click removes it; on the last one, or on Enter, the spell goes off on all. Only one possible target at this
 * level: the ordinary aiming.
 */
async function startGroup(token, activity, usageConfig, dialogConfig, messageConfig) {
  const chosen = await configureFirst(activity, usageConfig, dialogConfig);
  if ( !chosen ) return;
  const usage = [chosen.config, noDialog(dialogConfig), messageConfig];
  // §296: Twinned Spell — "increases the spell's effective level by 1": one more target than the slot spent.
  const twinned = pendingMetamagic(activity.actor).includes("twinned");
  const count = targetCount(activity, { level: twinned ? ((chosen.level ?? Number(activity.item?.system?.level) ?? 0) + 1) : chosen.level });
  clearTargets();
  markTargeting();
  if ( count <= 1 ) {
    targeting = { token, activity, usage };
    return promptTargeting(loc("Visee.Choisir", { name: activity.item.name }));
  }
  picking = { token, activity, count, picks: [], group: true, usage };
  showReticle(counterText());
  promptTargeting(loc("Cibles.Choisir", { item: activity.item.name, count }));
}

/** §16.33: the group aiming is closed (complete, or Enter) — the spell goes off on the chosen creatures. */
export function finishGroup() {
  if ( !(picking?.group || picking?.unique) || !picking.picks.length ) return;
  if ( !picking.group ) return launchPicks();   // §403: projectiles "one per creature", closed before the count
  const { activity, usage, picks } = picking;
  stopTargeting();
  exclusive(() => castOnTargets(activity, usage, picks));
}

/** The slot level first (the dnd5e window, without casting), then the multiple aiming. */
async function startPicking(token, activity, usageConfig, dialogConfig, messageConfig) {
  const chosen = await configureFirst(activity, usageConfig, dialogConfig);
  if ( !chosen ) return;
  const { config, level } = chosen;
  const count = projectileCount(activity, { level });
  clearTargets();
  // §403: Steel Wind Strike — "up to five creatures", one attack against each (`onePerTarget`).
  const unique = !!projectilesOf(activity.item)?.onePerTarget;
  picking = { token, activity, count, picks: [], unique, usage: [config, noDialog(dialogConfig), messageConfig] };
  markTargeting();
  showReticle(counterText());
  promptTargeting(loc("Projectiles.Choisir", { item: activity.item.name, count }));
}

function counterText() {
  if ( picking.group ) return loc("Cibles.Compteur", { item: picking.activity.item.name, done: picking.picks.length, count: picking.count });
  return loc("Projectiles.Compteur", { item: picking.activity.item.name, done: picking.picks.length, count: picking.count });
}

/**
 * Prompt reticle (user's request, 2026-09-25: "enlarge the target cursor and make it pulse"): when the engine
 * itself opens an aiming (bounce, "Size", start-of-turn spell, multiple aiming), a large pulsing ring follows the mouse,
 * the reason below; red on a refused target. A cursor does not animate: it is an element, the core's cursor is
 * hidden on the canvas for the duration of the prompt (styles, `dnd5e-combat-prompt`).
 */
export let reticle = null;

function showReticle(label) {
  if ( !reticle ) {
    reticle = document.createElement("div");
    reticle.className = "dnd5e-combat-reticle";
    reticle.innerHTML = `<div class="ring"></div><div class="cross"></div><div class="label"></div>`;
  }
  reticle.querySelector(".label").textContent = label ?? "";
  reticle.classList.remove("refused");
  reticle.hidden = false;
  if ( !reticle.isConnected ) document.body.append(reticle);
  document.body.classList.add("dnd5e-combat-prompt");
  if ( lastPointer ) placeReticle(lastPointer);
}

function setReticleLabel(label) {
  if ( reticle && !reticle.hidden ) reticle.querySelector(".label").textContent = label ?? "";
}

export function setReticleRefused(refused) {
  if ( reticle && !reticle.hidden ) reticle.classList.toggle("refused", !!refused);
}

function placeReticle(event) {
  if ( !reticle || reticle.hidden ) return;
  reticle.style.left = `${event.clientX}px`;
  reticle.style.top = `${event.clientY}px`;
}

function hideReticle() {
  if ( reticle ) reticle.hidden = true;
  document.body.classList.remove("dnd5e-combat-prompt");
}

function stopPicking() {
  picking = null;
}

/**
 * An abandoned multiple aiming (right click, Escape) releases the creatures already chosen: otherwise the next attack went
 * straight at them, without aiming (seen in play on 2026-10-10, §119 — Escape left them targeted, right click did not).
 */
/** A click on a creature during multiple aiming: one more projectile for it; on the last one, the spell goes off. */
export function pickTarget(hover) {
  if ( !picking || !hover?.object ) return;
  // §16.33: in group aiming, a creature counts only once — clicking it again removes it.
  if ( (picking.group || picking.unique) && picking.picks.includes(hover.uuid) ) {
    picking.picks.splice(picking.picks.indexOf(hover.uuid), 1);
    hover.object.setTarget(false, { releaseOthers: false, groupSelection: true });
    announceTargeting();
    return setReticleLabel(counterText());
  }
  // §286: Chain Lightning — after the first, each target within 9 m of it.
  const chained = (picking.group && picking.picks.length && chainOf(picking.activity.item)) ? { [MODULE_ID]: { chainFrom: picking.picks[0] } } : null;
  // §411 (issue #44, batch 4): a refused creature (out of range, wrong type…) counts anyway — its refusal is stated at the
  // start, in the legality window (Give up, or do it anyway: the GM notified). What legality does not flag goes with the use
  // (`issues`).
  const refusal = refusalFor(picking.token, hover, picking.activity, chained);
  if ( refusal ) {
    const issues = refusalIssues(picking.token, hover, picking.activity, chained, { blind: true });
    if ( issues.length ) {
      const [config, ...rest] = picking.usage;
      const own = config?.[MODULE_ID] ?? {};
      picking.usage = [{ ...config, [MODULE_ID]: { ...own, issues: mergeIssues(own.issues ?? [], issues) } }, ...rest];
    }
  }
  picking.picks.push(hover.uuid);
  hover.object.setTarget(true, { releaseOthers: false, groupSelection: true });
  setReticleLabel(counterText());
  floatNotice(hover, refusal ? `${picking.picks.length}/${picking.count} — ${refusal}` : `${picking.picks.length}/${picking.count}`, refusal ? "refused" : undefined);
  announceTargeting();
  if ( picking.picks.length < picking.count ) return;
  if ( picking.group ) return finishGroup();
  launchPicks();
}

/** The designated projectiles go off: the first like a clicked attack, the others chained by the engine. */
function launchPicks() {
  const { token, activity, usage: [config, dialog, message], picks } = picking;
  stopTargeting();
  // Rays: the first goes off like a clicked attack (chained roll, quick attack), the others will be chained by the engine.
  if ( projectilesOf(activity.item)?.attack ) {
    const first = fromUuidSync(picks[0], { strict: false });
    const usage = [{ ...config, [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), picks } }, dialog, message];
    if ( first ) return exclusive(() => engageWith(token, first, activity, { usage }));
  }
  exclusive(() => castWithPicks(activity, [config, dialog, message], picks));
}

export function stopTargeting() {
  stopPicking();
  dashing = null;
  recalling = null;
  hideReticle();
  targeting = null;
  if ( placing ) { canvas.regions?._cancelPlacement?.(); placing.cancel?.(); }
  placing = null;
  promptText = null;
  hideHitChance();
  setCursor(null);
  document.body.classList.remove("dnd5e-combat-targeting");
  announceTargeting();
}

/**
 * §16.21: at the start of a caster's turn, an activity to offer (`atTurnStart`, Aura of Vitality) as long as the
 * spell's Concentration holds — the aiming opens on the client of whoever plays that combatant; right click to skip.
 */
let offeredTurn = null;
function offerTurnStart(combat, prior, current) {
  // The core may call `combatTurnChange` twice for the same passage (round change): one offer per turn.
  const key = `${combat.id}.${current?.round}.${current?.turn}`;
  if ( key === offeredTurn ) return;
  offeredTurn = key;
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  const token = combatant?.token;
  if ( !actor?.isOwner || !token?.object ) return;
  if ( game.user.isGM && combatant.players?.some(u => u.active && !u.isGM) ) return;   // the player is there: it is up to them
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.atTurnStart;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !concentrationOn(item) ) continue;
    // §16.43: the next action of a link makes sense only while a creature is linked; we show it.
    const bound = (tetherOfActivity(activity)?.role === "follow") ? tetheredToken(item) : undefined;
    if ( bound === null ) continue;
    if ( bound ) floatNotice(bound, item.name, "prompt");
    openTargeting(token, activity, [{}, { configure: false }, {}], { prompt: loc("Visee.DebutTour", { item: item.name }), reticle: item.name });
    return;
  }
}

/** #33: replays the hover (throttled) when the Cover preview is in service. */
const coverReplay = foundry.utils.debounce(() => {
  if ( game.settings.get(MODULE_ID, "coverPreview") || game.settings.get(MODULE_ID, "attackLine") ) replayHover();
}, 120);

/** To register BEFORE `registerTurn()`: the aiming suspends a use before its legality is judged. */
export function registerPointer() {
  registerHitChance();
  registerAttackLine();
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  client("clickToMove", { type: String, default: "off",
    choices: { always: "DND5ECOMBAT.Reglage.clickToMove.always", combat: "DND5ECOMBAT.Reglage.clickToMove.combat", off: "DND5ECOMBAT.Reglage.clickToMove.off" } });
  // 2026-10-22 (table feedback): "never" by default, like click-to-move — right click always offers the attack.
  client("clickToAttack", { type: String, default: "off",
    choices: { always: "DND5ECOMBAT.Reglage.clickToAttack.always", combat: "DND5ECOMBAT.Reglage.clickToAttack.combat", off: "DND5ECOMBAT.Reglage.clickToAttack.off" } });
  client("targetingMode", { type: Boolean, default: true });
  client("fastAttack", { type: Boolean, default: true });
  client("quickRolls", { type: Boolean, default: true });
  client("pathPreview", { type: Boolean, default: true });
  client("releaseTargets", { type: Boolean, default: true });
  client("situationalCursor", { type: Boolean, default: true });
  client("closeSheetOnUse", { type: Boolean, default: true });
  client("teleportPlanning", { type: Boolean, default: true });
  client("targetingBanner", { type: Boolean, default: true, onChange: () => announceTargeting() });
  // §208: "Jump high here" in the context menu — beta, decided by the GM for the table, disabled by default.
  game.settings.register(MODULE_ID, HIGH_JUMP_MENU_SETTING, { scope: "world", config: true, type: Boolean, default: false,
    name: `DND5ECOMBAT.Reglage.${HIGH_JUMP_MENU_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${HIGH_JUMP_MENU_SETTING}.Aide` });
  // §210: the non-lethal blows switch in its token's context menu — hidden by default.
  game.settings.register(MODULE_ID, NONLETHAL_MENU_SETTING, { scope: "world", config: true, type: Boolean, default: false,
    name: `DND5ECOMBAT.Reglage.${NONLETHAL_MENU_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${NONLETHAL_MENU_SETTING}.Aide` });

  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "targeting: target expected" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "damage and healing without dialog" });
  route("dnd5e.preRollAttackV2", onPreRollDamage, { cancellable: true, label: "attack roll without dialog" });
  route("dnd5e.postUseActivity", onPostUseActivity, { label: "teleportation: targeting not opened" });
  route("dnd5e.preCreateMeasuredTemplate", onPreTemplate, { cancellable: true, label: "cone or line: targeting around the caster (map)" });
  route("dnd5e.createMeasuredTemplate", onCreateTemplate, { cancellable: true, label: "ranged area: within range, clear path" });
  route("updateChatMessage", onResolutionSettled, { label: "targets released" });
  route("createChatMessage", onResolutionSettled, { label: "targets released" });
  route("combatTurnChange", onTurnChange, { label: "targets released at end of turn" });
  route("combatTurnChange", offerTurnStart, { label: "start-of-turn activity offered" });
  route("createActiveEffect", offerEnchantedAttack, { label: "True Strike: attack not offered" });
  route("createChatMessage", onFlurryUsed, { label: "Flurry of Blows: targeting not opened" });
  route("canvasTearDown", (board, options) => {
    stopTargeting(); closeMenu(); forgetHover();
    // B12: only if we leave the scene — a level change also redraws the canvas (scene.mjs:273), in the middle of
    // walking a staircase (`walkMoves`), and that walk must continue.
    sceneLeft = (options?.nextScene ?? null) !== board.scene;
    if ( sceneLeft ) releaseMouse();
  }, { label: "mouse: reset" });
  route("canvasReady", () => { if ( sceneLeft ) stopDeadMovements(); sceneLeft = false; }, { label: "dead movements stopped" });
  route("controlToken", () => clearPreview(), { label: "path preview cleared" });
  // #33: the Cover preview follows a token that moves or changes Cover state under a motionless mouse.
  route("updateToken", (doc, change) => {
    if ( ("x" in change) || ("y" in change) || ("elevation" in change) || ("level" in change) ) coverReplay();
  }, { label: "cover preview: not refreshed after a move" });
  route("createActiveEffect", () => coverReplay(), { label: "cover preview: not refreshed after a cover status" });
  route("deleteActiveEffect", () => coverReplay(), { label: "cover preview: not refreshed after a cover status" });
  route("ready", () => {
    // §220: during Theater of the Mind, the mouse and keyboard go back to the core.
    const live = fn => event => (theaterActive() ? undefined : fn(event));
    document.addEventListener("pointerdown", live(onPointerDown), true);
    document.addEventListener("pointerup", live(onPointerUp), true);
    document.addEventListener("pointermove", live(onPointerMove), true);
    document.addEventListener("pointermove", live(placeHitChance), { capture: true, passive: true });
    document.addEventListener("pointermove", live(placeReticle), { capture: true, passive: true });
    document.addEventListener("pointermove", live(trackPointer), { capture: true, passive: true });
    document.addEventListener("keyup", live(onModifierKey), true);
    document.addEventListener("keydown", live(onKeyDown), true);
    document.addEventListener("keydown", live(onMenuShift), true);
    document.addEventListener("keyup", live(onMenuShift), true);
  }, { label: "mouse: listeners not attached" });
  // §220: when switching to Theater of the Mind, the path preview is erased.
  route(`${MODULE_ID}.theater`, active => { if ( active ) clearPreview(); }, { always: true, label: "theatre of the mind: path preview cleared" });
}
