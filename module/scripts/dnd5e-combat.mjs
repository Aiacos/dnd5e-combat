import { registerLevel, gated, automationLevel, levelAtLeast } from "./runtime/levels.mjs";
import { registerFlow } from "./runtime/flow.mjs";
import { MODULE_ID, MIN_SYSTEM_VERSION } from "./constants.mjs";
import { readUnitFactors } from "./adapter/units.mjs";
import { registerEngine } from "./runtime/engine.mjs";
import { registerUsage } from "./runtime/usage.mjs";
import { registerStorm } from "./runtime/storm.mjs";
import { registerContest } from "./runtime/contest.mjs";
import { registerConcentration } from "./runtime/concentration.mjs";
import { registerSpellWeapons } from "./runtime/spell-weapons.mjs";
import { registerPilot } from "./runtime/pilot.mjs";
import { registerDeath } from "./runtime/death.mjs";
import { registerCoven } from "./runtime/coven.mjs";
import { registerReduction } from "./runtime/reduction.mjs";
import { registerZones } from "./runtime/zones.mjs";
import { registerAltitude } from "./runtime/altitude.mjs";
import { registerActions, approach, pathTo, fleeFrom, gapCells, verticalGapCells } from "./runtime/actions.mjs";
import { registerFollow } from "./runtime/follow.mjs";
import { registerMount } from "./runtime/mount.mjs";
import { registerDoors } from "./runtime/doors.mjs";
import { registerDoorLockUi } from "./ui/door-lock.mjs";
import { registerWallGrateUi } from "./ui/wall-grate.mjs";
import { registerSceneBrightUi } from "./ui/scene-bright.mjs";
import { registerCombatEvents, combatApi } from "./runtime/combat-events.mjs";
import { registerCombatOutcome } from "./runtime/combat-outcome.mjs";
import { registerSkipDefeated } from "./runtime/skip-defeated.mjs";
import { registerTurn } from "./runtime/turn.mjs";
import { registerFormLock } from "./runtime/form-lock.mjs";
import { registerMetamagic } from "./runtime/metamagic.mjs";
import { registerFreeCast } from "./runtime/free-cast.mjs";
import { registerReactions } from "./runtime/reactions.mjs";
import { registerGates } from "./runtime/gates.mjs";
import { registerPortent } from "./runtime/portent.mjs";
import { registerGrimoire } from "./runtime/grimoire.mjs";
import { registerLeaves } from "./runtime/leaves.mjs";
import { registerUsesSpent } from "./runtime/uses-spent.mjs";
import { registerFlee } from "./runtime/flee.mjs";
import { registerReactionLoss } from "./runtime/reaction-loss.mjs";
import { registerDispel } from "./runtime/dispel.mjs";
import { registerTriggers } from "./runtime/triggers.mjs";
import { registerContent, contentApi } from "./runtime/content.mjs";
import { registerIcons } from "./runtime/icons.mjs";
import { registerConditions } from "./runtime/conditions.mjs";
import { registerVision } from "./runtime/vision.mjs";
import { canSee as visionCanSee, pinpointsTarget, sensedThrough, isVisionAvailable } from "./adapter/vision.mjs";
import { registerSpace } from "./runtime/space.mjs";
import { registerSelfAreas } from "./runtime/self-area.mjs";
import { registerAreas } from "./runtime/areas.mjs";
import { registerLingering } from "./runtime/lingering.mjs";
import { registerPassengers } from "./runtime/passengers.mjs";
import { registerBanish } from "./runtime/banish.mjs";
import { registerBursts } from "./runtime/bursts.mjs";
import { registerCoatings } from "./runtime/coatings.mjs";
import { registerGrants } from "./runtime/grants.mjs";
import { registerFelled } from "./runtime/felled.mjs";
import { registerWeaponFeed } from "./runtime/weapon-feed.mjs";
import { registerWrath } from "./runtime/wrath.mjs";
import { registerBackfire } from "./runtime/backfire.mjs";
import { registerProtection } from "./runtime/protection.mjs";
import { registerProjectiles } from "./runtime/projectiles.mjs";
import { registerAuras } from "./runtime/auras.mjs";
import { registerEmanations } from "./runtime/emanations.mjs";
import { registerRegeneration } from "./runtime/regeneration.mjs";
import { registerFortitude } from "./runtime/fortitude.mjs";
import { registerDamageTraits } from "./runtime/damage-traits.mjs";
import { registerExtraTurns } from "./runtime/extra-turns.mjs";
import { registerDamageByCount } from "./runtime/damage-by-count.mjs";
import { registerDrain } from "./runtime/drain.mjs";
import { registerSpaceSharing, registerObjectPassage } from "./runtime/space-sharing.mjs";
import { registerEmpower } from "./runtime/empower.mjs";
import { registerLifesteal } from "./runtime/lifesteal.mjs";
import { registerDischarge } from "./runtime/discharge.mjs";
import { registerSneak } from "./runtime/sneak.mjs";
import { registerMastery } from "./runtime/mastery.mjs";
import { registerMasteryChoices } from "./runtime/mastery-choices.mjs";
import { registerFighter } from "./runtime/fighter.mjs";
import { registerFeats } from "./runtime/feats.mjs";
import { registerEffectWhile } from "./runtime/effect-while.mjs";
import { registerBarbarian } from "./runtime/barbarian.mjs";
import { registerCantrips } from "./runtime/cantrips.mjs";
import { registerEndings } from "./runtime/endings.mjs";
import { registerActionEnd } from "./runtime/action-end.mjs";
import { registerActivityChoice } from "./runtime/activity-choice.mjs";
import { registerMonk } from "./runtime/monk.mjs";
import { registerSmite } from "./runtime/smite.mjs";
import { registerFollowUps } from "./runtime/follow-ups.mjs";
import { registerManeuverDice } from "./runtime/maneuver-dice.mjs";
import { registerRollBonus } from "./runtime/roll-bonus.mjs";
import { registerHeroic, setHeroic } from "./runtime/heroic.mjs";
import { registerSuccessAtCost, atCostApi } from "./runtime/success-at-cost.mjs";
import { registerSuccessAtCostUI } from "./ui/success-at-cost.mjs";
import { hasHeroic, heroicMode } from "./adapter/heroic.mjs";
import { registerNaturalOne } from "./runtime/natural-one.mjs";
import { registerRise } from "./runtime/rise.mjs";
import { registerAfterSneak } from "./runtime/after-sneak.mjs";
import { registerSwallow } from "./runtime/swallow.mjs";
import { registerBasics } from "./runtime/basics.mjs";
import { registerFamiliars } from "./runtime/familiar.mjs";
import { registerAnimations } from "./runtime/animations.mjs";
import { basicActionData } from "./adapter/basics.mjs";
import { stopAllWalks } from "./adapter/movement.mjs";
import { budgetIssues, spendBudget, takeBasicAction, requestSave, dropHeldBy } from "./runtime/neighbours.mjs";
import { registerGrapple } from "./runtime/grapple.mjs";
import { registerProne } from "./runtime/prone.mjs";
import { registerClimb, climbApi } from "./runtime/climb.mjs";
import { registerSpeedGrants } from "./runtime/speed-grants.mjs";
import { registerBreaks } from "./runtime/breaks.mjs";
import { registerCure } from "./runtime/cure.mjs";
import { registerBlink } from "./runtime/blink.mjs";
import { registerWalls } from "./runtime/walls.mjs";
import { registerWallSide } from "./runtime/wall-side.mjs";
import { registerElevationSpells } from "./runtime/elevation-spells.mjs";
import { registerCureUi } from "./ui/cure.mjs";
import { registerWallSideUi } from "./ui/wall-side.mjs";
import { registerKindleUi } from "./ui/kindle.mjs";
import { registerStandingMasteryUi } from "./ui/standing-mastery.mjs";
import { registerSkillAid } from "./runtime/skill-aid.mjs";
import { registerSkillAidUi } from "./ui/skill-aid.mjs";
import { registerGroupRoll, rollsApi } from "./runtime/group-roll.mjs";
import { registerGroupRollUI, openGroupRoll } from "./ui/group-roll.mjs";
import { registerInlineChecks } from "./ui/inline-check.mjs";
import { registerGroupRollTracker, openTracker } from "./ui/group-roll-tracker.mjs";
import { registerPlayerWaits, forceWait } from "./runtime/player-waits.mjs";
import { registerGmQueue, queue, forceLine, rollBlocked, answerLine } from "./runtime/gm-queue.mjs";
import { registerAwaiting } from "./runtime/awaiting.mjs";
import { registerAwaitingUI } from "./ui/awaiting.mjs";
import { registerPlayerWaitsUI, openPlayerWaits } from "./ui/player-waits.mjs";
import { playerWaits } from "./adapter/player-wait.mjs";
import { registerHelp } from "./runtime/help.mjs";
import { registerHide } from "./runtime/hide.mjs";
import { registerSearch } from "./runtime/search.mjs";
import { registerPassivePerception } from "./runtime/passive.mjs";
import { registerIllumination } from "./runtime/illumination.mjs";
import { registerLights } from "./runtime/lights.mjs";
import { registerEffects } from "./runtime/effects.mjs";
import { registerAntimagic, antimagicApi } from "./runtime/antimagic.mjs";
import { registerWildShape } from "./runtime/wildshape.mjs";
import { registerEnchant } from "./runtime/enchant.mjs";
import { registerTether } from "./runtime/tether.mjs";
import { registerDefenses } from "./runtime/defenses.mjs";
import { registerSize } from "./runtime/size.mjs";
import { registerOrders } from "./runtime/orders.mjs";
import { registerCompulsion } from "./runtime/compulsion.mjs";
import { registerControl } from "./runtime/control.mjs";
import { registerCatalyst } from "./runtime/catalyst.mjs";
import { registerSummonHandover } from "./runtime/summon-handover.mjs";
import { registerSummonPermissions } from "./runtime/summon-permissions.mjs";
import { registerSummonPermissionsUi, checkSummonPermissions, SUMMON_WINDOW_ID } from "./ui/summon-permissions.mjs";
import { registerAutoTranslate } from "./runtime/auto-translate.mjs";
import { registerDataFixes } from "./runtime/data-fixes.mjs";
import { registerClock } from "./runtime/clock.mjs";
import { registerCriticals } from "./runtime/criticals.mjs";
import { registerFlanking } from "./runtime/flanking.mjs";
import { registerFalls } from "./runtime/falls.mjs";
import { registerKnockout } from "./runtime/knockout.mjs";
import { registerTheater, theaterApi } from "./runtime/theater.mjs";
import { registerVanilla, vanillaApi } from "./runtime/vanilla.mjs";
import { registerCorrection, correctionApi } from "./runtime/correction.mjs";
import { registerCorrectionUi, openCorrection } from "./ui/correction.mjs";
import { registerCombatLaunch, launchApi } from "./runtime/combat-launch.mjs";
import { registerCombatLaunchUI, openCombatLaunch } from "./ui/combat-launch.mjs";
import { registerClimbSystem } from "./runtime/climb-system.mjs";
import { registerReady } from "./runtime/ready.mjs";
import { registerBurning } from "./runtime/burning.mjs";
import { registerImprovised } from "./runtime/improvised.mjs";
import { registerArmorTraining } from "./runtime/armor-training.mjs";
import { isNonLethal, setNonLethal, isKnockedOut } from "./adapter/knockout.mjs";
import { describeRoutes, skippedRoutes } from "./runtime/router.mjs";
import { testApi } from "./runtime/testing.mjs";
import { registerPointer } from "./ui/pointer.mjs";
import { registerAmmo } from "./runtime/ammo.mjs";
import { ammoState, setAmmo } from "./adapter/ammo.mjs";
import { registerRecast } from "./runtime/recast.mjs";
import { registerChat } from "./ui/chat.mjs";
import { registerGmAlert, alertGM } from "./runtime/gm-alert.mjs";
import { registerForced, reportForced } from "./runtime/forced.mjs";
import { registerGmAlertUi } from "./ui/gm-alert.mjs";
import { registerCompact } from "./ui/compact.mjs";
import { registerPurge } from "./runtime/purge.mjs";
import { registerPerf, perfApi } from "./runtime/perf.mjs";
import { registerFeedback, playFloat, floatFonts } from "./ui/feedback.mjs";
import { openFloatTheme, importTheme, exportTheme, resetTheme, tryKind } from "./ui/float-theme.mjs";
import { registerTimers, startTimer } from "./ui/timers.mjs";
import { registerTracker } from "./ui/tracker.mjs";
import { registerLightIndicator, lightState } from "./ui/illumination.mjs";
import { registerPerception } from "./ui/perception.mjs";
import { registerEtherealUI } from "./ui/ethereal.mjs";
import { etherealApi, registerEtherealMovement } from "./runtime/ethereal.mjs";
import { registerVigor } from "./ui/vigor.mjs";
import { registerAutomation, reportsApi } from "./ui/automation.mjs";
import { registerMasteryUI, masteryApi } from "./ui/mastery.mjs";
import { uiApi } from "./ui/api.mjs";
import { scrollSpellOf } from "./adapter/scrolls.mjs";
import { registerStabilize } from "./runtime/stabilize.mjs";
import { registerPotions } from "./runtime/potions.mjs";
import { registerPotionChoice } from "./runtime/potion-choice.mjs";
import { registerOil } from "./runtime/oil.mjs";
import { registerScatter } from "./runtime/scatter.mjs";
import { registerFlammable } from "./runtime/flammable.mjs";
import { registerWelcome, openWelcome } from "./ui/welcome.mjs";
import { openReleaseNotes } from "./ui/release-notes.mjs";
import { registerFactions, factionsApi } from "./runtime/factions.mjs";
import { coneOf } from "./adapter/cone.mjs";
import { canHear as hearingCanHear } from "./adapter/hearing.mjs";
import { registerStealthMode, stealthApi } from "./runtime/stealth.mjs";
import { registerStealthUI } from "./ui/stealth.mjs";
import { registerFactionsUI, openFactions } from "./ui/factions.mjs";
import { registerSettingsWindow, openSettings, registerWindow } from "./ui/settings.mjs";
import { openDiagnostic } from "./ui/diagnostic.mjs";
import { registerImporter, unregisterImporter } from "./runtime/diagnostic/index.mjs";
import { registerDebug, debugApi } from "./runtime/debug.mjs";
import { registerDebugReport, openDebugReport } from "./ui/debug-report.mjs";
import { registerConnection, testConnection } from "./runtime/connection.mjs";
import { registerConnectionTest, openConnectionTest } from "./ui/connection-test.mjs";

/**
 * Global state of the module, exposed on game.modules.get(MODULE_ID).api for inspection.
 * `routes()`: who listens to which hook, in what order (runtime/router.mjs).
 * `content`: shipped content, world overlay (`set`), what an actor declares (`inspect`).
 * `reports`: the items reported in part by the GM, and the summary panel (ui/automation.mjs, SPEC §9.2).
 * `perf`: the engine's timing survey on this client (§98, runtime/perf.mjs) — `table()`, `report()`, `longTasks()`, `reset()`.
 * `mcp`: test functions called by the connector (`call-module-api`), arguments and results in JSON (runtime/testing.mjs).
 * `nonLethal`: `get(actor)`, `set(actor, on)` — the actor's non-lethal blows (§210, the DAS UI switch); `knockedOut(actor)`.
 * `ui`: what an external interface reads (§40.1, ui/api.mjs) — `budget(combatant)`, `movement(token)`, `issues(activity)`,
 *   `cost(activity)` (§137), `cell(activity)` (both in one calculation, §205),
 *   `ritual(activity)` (§139: "none" / "ritual" / "ask"),
 *   `multiattackLeft(actor)`, `light(token)`, `globalLight()`. The engine knows no interface.
 * `light(token)`: the light where a token stands (ui/illumination.mjs) — the same as `ui.light`, kept under this name.
 * `approach(token, { cells, level })`: make a token walk by the engine's path to the nearest of the given cells
 *   (§39.1) — for modules (Darsh Loot's search); the engine knows none of them.
 * `stopWalks()`: stop the engine walks started by this client (§102) — for a module that stops everything (Darsh Loot: a
 *   discovery); only the client that started a walk can stop it.
 * `budget.issues(actor, cost)` / `budget.spend(actor, cost)`: what prevents spending from the turn budget, and the spending
 *   (on the active GM) — for a module's action (§102). Out of combat: nothing costs anything.
 * `scrolls.spellOf(item)`: the spell of a scroll `{ identifier, level, school }` or null (§48) — for the macro that recovers the
 *   world's scrolls (tools/macros/reprendre-parchemins.js).
 * `level()`: the world's automation level, "essentials" | "assisted" | "full" (§117); `levelAtLeast(niveau)`;
 *   `skippedRoutes()`: the listeners not wired at this level.
 * §179: `approach(token, { target, reachCells, seeing })` — approach a target to within a reach or range (in cells), while
 *   seeing it if requested; `path(token, { cells | target, reachCells, seeing }, { maxCost, extra })` → `{ arrives, moves, door }`
 *   or null — a path without walking it (`extra`: the Speed in addition, for a Dash);
 *   `basics.take(actor, "dash" | "disengage" | "dodge")` — the basic action without an item (NPC), through the budget.
 * §180: `flee(token, from, { extra, dryRun })` → `{ moved, from, to, reason? }` — move away from a threat as far as the turn's
 *   movement allows (plus `extra`), or only test (`dryRun`); `save(actor, { ability, dc, advantage,
 *   disadvantage, flavor })` → `{ total, d20, dc, success }` — a save outside resolution, no window; `drop(token)` → `{ items,
 *   pile, kept }` — drop what is held (like the "Drop it" order).
 * `vision.canSee(observer, target)` (§178): does the observer see the target, according to the engine's vision rules
 *   (light, walls, Darkvision, fog and Darkness, Invisible — hence a successful Stealth —, Blinded)? `true` / `false`,
 *   or `null` when it cannot be judged (simulated vision off, canvas absent, token not drawn). Tokens or documents; read-only.
 * §196: `climb` — climbing for neighbors (runtime/climb.mjs `climbApi`: `state`, `holds`, `entries`, `up`, `run`, `ceiling`,
 *   `down`, `drop`, `toward`; §224: `enabled()`, `setEnabled(on)` — the GM's switch, hook `dnd5e-combat.climbSystem`);
 *   `gap(a, b)` → `{ cells, vertical }` — the gap between two tokens in cells, in three dimensions (the engine's distance,
 *   from feet to head: 0 overlapping, 1 in contact) and its vertical void alone (on the ceiling, in flight). Read-only.
 * §242: `rolls` — GM-requested rolls from several characters: `request({ actors, type, key, dc, hideDc, advantage, disadvantage,
 *   bonus, label, group })` → promise of the final tally; `open({ actors, values })` (the window, GM);
 *   `tracker()` (the tracker, GM); `force(messageId, actorUuid)` (GM: roll for a player who is slow); `view(messageId)`;
 *   `mode(actor, request)` (the Advantage / Disadvantage that the system will give); `breakdown(actor,
 *   request)` (the bonus tiles); `title(request)`. Hooks `dnd5e-combat.groupRoll` (the tally, at each result, on every client) and
 *   `dnd5e-combat.groupRollPrompt` (an interface takes over the player's window: runtime/group-roll.mjs).
 * `debug`: the debugger (§380, runtime/debug.mjs) — `errors()`, `trailList()`, `logs()`, `verbose(on)`,
 *   `register({ module, repo, collect })`, `trail(module, kind, text)`, `onError(fn)`, `clear()`, `open({ token })` (the window);
 *   §388: `testConnection(user)` (GM: round trips and probe of a player's client → findings),
 *   `openConnectionTest(userId)` (its window); hook `dnd5e-combat.debug` at `setup`, with this API.
 * `welcome.open()`: the welcome screen (§177); `diagnostic.open({ check })`: the world diagnostic (checks, repair after
 *   backup, restoration), on a single check if `check` is given ("GM Tools" macros);
 *   `diagnostic.registerImporter({ id, flag, name, hint?, icon? })`: another module declares its item importer, recognized by the
 *   flag its items carry — the diagnostic gains a check (id returned) that lists those whose rule cites an id the item does not
 *   have and replaces them with the official item; `diagnostic.unregisterImporter(id)`.
 */
const state = {
  active: false, reason: null, unitFactors: null, routes: describeRoutes, content: contentApi, reports: reportsApi, mastery: masteryApi,
  // §272: the timer is also started through the connector (`timer`: token of the displayed scene, seconds, label) —
  // it lives in ui/.
  mcp: Object.freeze({ ...testApi,
    /** Starts on every client a timer of `seconds` s above the token `tokenId` of the displayed scene → `{ id }`. */
    timer: ({ tokenId, seconds=5, label="" }={}) => ({ id: startTimer({ token: canvas.tokens.get(tokenId)?.document, seconds, label }).id }),
    /** §542: the load-time summon permissions check, as at `ready` → `{ gaps, opened, windowId }` (the window opened, or not). */
    summonAlert: async () => ({ ...(await checkSummonPermissions()), windowId: SUMMON_WINDOW_ID }) }), perf: perfApi,
  ui: uiApi, light: lightState, approach, nonLethal: { get: isNonLethal, set: setNonLethal, knockedOut: isKnockedOut }, scrolls: { spellOf: scrollSpellOf }, basics: { data: basicActionData, take: takeBasicAction }, path: pathTo,
  flee: fleeFrom, save: requestSave, drop: dropHeldBy,
  stopWalks: stopAllWalks, budget: { issues: budgetIssues, spend: spendBudget },
  level: automationLevel, levelAtLeast, skippedRoutes,
  welcome: { open: openWelcome }, releaseNotes: { open: openReleaseNotes }, diagnostic: Object.freeze({ open: openDiagnostic, registerImporter, unregisterImporter }), debug: Object.freeze({ ...debugApi, open: openDebugReport, testConnection, openConnectionTest }), settings: { open: openSettings, registerWindow },
  vision: { canSee: publicCanSee, locates: publicLocates, sensed: publicSensed, cone: publicCone, canHear: publicCanHear },
  factions: { ...factionsApi,
    /** Opens (or brings to the front) the factions window on this client. */
    open: () => openFactions() },
  sneak: stealthApi,
  climb: climbApi,
  ethereal: etherealApi,   // §225 : `is(token)`, `perceives(observer, target)`, `toggle(tokens?, active?)`
  correction: { ...correctionApi, open: openCorrection },   // §396 : `apply({ activity, level, targets, damage, attack, save, concentration, effects, consume, zone, public })`, `shape(activity)`, `open(item|activity)`
  combatLaunch: { ...launchApi, open: openCombatLaunch },   // §397 : `open()`, `candidates()`, `launch({ participants, npcAuto, grouped, playlist })`, `pending()`
  // §436: `use(itemOrActivity, usage, dialog, message)` — like dnd5e, but a spell refused by the antimagic field alone
  // offers "do it anyway" (alert to the GM); `blocks(activity)`: refused by the field alone?
  antimagic: antimagicApi,
  vanilla: vanillaApi,   // §395 : `use(itemOrActivity, { event })` — lancer par dnd5e seul ; `is(docOrConfig)` — vient-il d'un tel lancement ?
  theater: theaterApi,   // §220: Theater of the Mind — `active()`, `set(on)`; hook `dnd5e-combat.theater`
  gm: { alert: alertGM, forced: reportForced },   // §408 : `api.gm.forced({ actor, item, reasons, targets, token })` ; hook `dnd5e-combat.forced`
    // §364 : alerte MJ (`api.gm.alert({ text, item, actor })`) ; hook `dnd5e-combat.gmAlert`
  rolls: { ...rollsApi, open: openGroupRoll, tracker: openTracker },   // §242: GM-requested rolls — hooks `groupRoll`, `groupRollPrompt`
  combat: combatApi,   // §250: events in the initiative — `addEvent`, `removeEvent`, `events`, `isEvent`; hook `dnd5e-combat.eventTurn`
  gap: publicGap,
  // §400 : textes flottants — `play(token, kind, text, { roll, mode })`, `open()`, `import(json)`, `export()`, `reset()`, `try(kind)`, `fonts()`
  floats: { play: playFloat, open: openFloatTheme, import: importTheme, export: exportTheme, reset: resetTheme, try: tryKind, fonts: floatFonts },
  // §274: a weapon's ammunition — `options(item)`: `{ options: [{ id, name, img, quantity }], current, ask }` (null if the
  // weapon fires none); `set(item, ammoId)`: the ammunition kept for its next attacks.
  // Hook `dnd5e-combat.ammunition` `(item, ammoId)`.
  ammo: {
    /**
     * The ammunition the weapon can fire and the one its next roll would fire: `{ options, current, ask }`, or null if it fires
     * none.
     */
    options: (item, activity=null) => ammoState(item, activity),
    set: setAmmo },
  waits: { list: playerWaits,   // §290: windows without delay, GM waits
    /**
     * GM: forces the wait `id` (the player's client resolves its windows as at the end of the delay) → true if the wait existed;
     * false for a player.
     */
    force: id => forceWait(id),
    open: openPlayerWaits },
  // §421: the GM Queue — what they must decide, the players awaited, the blocked actions.
  queue: { list: queue, force: forceLine, roll: rollBlocked, answer: answerLine, open: openPlayerWaits },
  // §282: Heroic Inspiration — `has(actor)`, `set(actor, on)` (GM: grants or removes it, card and return to the table), `mode()`:
  // this client's setting ("on", "failure", "off").
  heroic: { has: hasHeroic,
    /** GM: grants (`on` true) or removes the Heroic Inspiration of a player character, with a chat card → true if it changed. */
    set: (actor, on) => (game.user.isGM ? setHeroic(actor, on) : false),
    mode: heroicMode },
  // Issue #32: success at a cost — `enabled()`, `candidates()` (the pauses open on the active GM), `offer(id, { cost? })`,
  // `dismiss(id)`, `offerOnMessage(messageId, { what, cost? })`. Hook `dnd5e-combat.successAtCost` after each answer.
  atCost: atCostApi
};

/** §196: the gap between two tokens in cells (3D, and its vertical void), for a neighbor judging a reach — null if unmeasurable. */
function publicGap(a, b) {
  const da = a?.document ?? a;
  const db = b?.document ?? b;
  if ( !da?.parent?.grid || (da.parent !== db?.parent) ) return null;
  try { return { cells: gapCells(da, db), vertical: verticalGapCells(da, db) }; } catch { return null; }
}

/** §178: the engine's vision for a neighbor (read-only) — null when simulated vision is off or cannot judge. */
function publicCanSee(observer, target) {
  if ( !isVisionAvailable() ) return null;
  return visionCanSee(observer?.document ?? observer, target?.document ?? target);
}

/**
 * Is the target's position known to the observer: they see it, or a sense that is not sight locates it
 * (Tremorsense)? Issue #107: such a sense also pinpoints a creature Hidden from the observer, which stays unseen
 * (`canSee` false) and Hidden. Read-only; null when simulated vision is off or cannot judge.
 */
function publicLocates(observer, target) {
  if ( !isVisionAvailable() ) return null;
  return pinpointsTarget(observer?.document ?? observer, target?.document ?? target);
}

/**
 * What a sense declared by content (`sense`) tells the observer about the target: `"sight"` (sight), `"locate"` (position known,
 * not seen), `"presence"` (presence known, not the position), `"aura"`
 * (an aura on the creature, which another sense must already make visible: `reveals: "aura"`), or null.
 * Read-only; null also when simulated vision is off.
 */
function publicSensed(observer, target) {
  if ( !isVisionAvailable() ) return null;
  return sensedThrough(observer?.document ?? observer, target?.document ?? target);
}

/** §186: the engine's hearing for a neighbor (read-only) — walls and floors that stop sound, Deafened, hidden target; no range. */
function publicCanHear(observer, target) {
  return hearingCanHear(observer?.document ?? observer, target?.document ?? target);
}

/** §182: a creature's vision cone (`{ angle, rotation }`, core convention), or null when it sees in 360°. */
function publicCone(token) {
  return coneOf(token?.document ?? token);
}

/** Why the engine must stay dormant in this world, or null if it can run. */
function standbyReason() {
  // SPEC §2: exclusive with respect to Midi-QOL. When it is present, nothing is wired.
  if ( game.modules.get("midi-qol")?.active ) return "midi-qol";
  if ( foundry.utils.isNewerVersion(MIN_SYSTEM_VERSION, game.system.version) ) return "system";
  return null;
}

// Hooks are wired from `init`: the chat log renders existing messages before
// `ready`, and a render hook set up later does not see them (verdicts missing after an F5).
Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = state;
  state.reason = standbyReason();
  // §177: the welcome screen and the diagnostic, even when dormant (the diagnostic precisely cleans up Midi-QOL traces).
  // Outside the levels.
  registerWelcome({ menu: !!state.reason });
  registerConnection();   // §388: a client answers the GM's connection test, even when dormant
  registerDebug();   // §380: the debugger, even when dormant and at every level (capture runs from the script load)
  if ( state.reason ) return;
  // The order of these calls is the call order of the listeners of a same hook (runtime/router.mjs).
  // The engine first; the mouse (ui/pointer) before legality (turn): an activity without a target
  // goes into aiming mode before its budget is judged; the rest of the interface last.
  // §117: the automation level first (its setting at the top of the window); each function registers according to it.
  registerLevel();
  gated(registerTheater);   // §220: Theater of the Mind — outside the automation levels: its button always exists
  gated(registerVanilla);   // §395: "without DAS" — marks what stems from a no-DAS action, before any other registration
  gated(registerCorrection);   // §396: GM correction — the restored area resolves nothing on placement
  gated(registerClimbSystem);   // §224: the climbing and falling switch — before altitude and climbing, which read it
  gated(registerFlow);   // §418: the settings of the "Flow" frame (reactions)
  gated(registerPerf);   // §98: the timing survey threshold, before the hooks run
  gated(registerContent);
  gated(registerFactions);   // §181: the factions table, before any rule that judges friend / foe
  gated(registerStealthMode);   // §183: PC stealth mode (leaves the mode on entering combat)
  gated(registerIcons);
  gated(registerEngine);
  gated(registerConcentration);
  gated(registerSpellWeapons);   // §554: spell weapons in the favorites, hook for neighbours (after concentration removes the traces)
  gated(registerPilot);   // after concentration: the created item is first attached to it
  gated(registerReduction);   // before 0 HP: what the pool absorbs does not reach the creature
  gated(registerDeath);
  gated(registerCoven);   // after 0 HP: the second phase replaces the fall that registerDeath no longer applies (§19.5)
  gated(registerAltitude);   // before the turn ceiling and Opportunity Attacks: they judge the path aligned on the ground
  gated(registerActions);
  gated(registerFollow);   // §41.3: after the actions — following walks by `approach`
  gated(registerMount);    // §490 (B08): mount (shared movement, fall, Initiative) and order to a companion
  gated(registerDoors);   // §244: door locks (setting, request to the active GM)
  gated(registerDoorLockUi);   // §244: "DAS · Lock" section of the wall configuration
  gated(registerWallGrateUi);   // §468: "DAS · Grate" section of the wall configuration
  gated(registerSceneBrightUi);   // Discord (Fanarie, 2026-11-18): "Bright Light" checkbox of global illumination, hidden by V14
  gated(registerCombatEvents);   // §250: events in the initiative (a trap on its initiative)
  gated(registerCombatOutcome);   // §555: combatEnded / creatureDefeated signals — Essentials, they only observe
  gated(registerSkipDefeated);   // 2026-11-28: the turn passes defeated NPCs (setting, on by default)
  gated(registerRecast);   // before the mouse: a recast goes back through aiming and legality
  gated(registerPointer);
  gated(registerProjectiles);   // after aiming (the targets are designated), before legality
  gated(registerUsage);   // §68: before metamagic and legality — the chosen slot is the one they will read
  gated(registerMetamagic);   // §32: before registerTurn — Quickened Spell changes the cost that legality reads
  gated(registerFreeCast);    // Divine Intervention: before registerTurn too — the retained spell goes off at no action cost
  gated(registerPotionChoice);   // issue #31: healing potion as an action (maximum healing) — the cost, before legality
  gated(registerFormLock);   // B09 (§488): just before legality — the attempt to change form punished once, then refused
  gated(registerTurn);
  gated(registerAmmo);   // §274: after legality — the attack mode and the confirmation are set when the ammunition is chosen
  gated(registerGates);   // after legality: a door opens only for a confirmed use
  gated(registerSummonHandover);   // §118: after legality — a refused use claims nothing from neighbors
  gated(registerAutoTranslate);
  gated(registerDataFixes);   // §335: faulty premium data fixed at creation (after the translation)
  gated(registerClock);   // §251: real-time clock out of combat (off by default)
  gated(registerFlanking);   // §369: Flanking (optional rule of the 2014 DMG), disabled by default
  gated(registerCriticals);   // §207: Critical Hit options (AC margin, critical table), disabled by default   // §204: translation reapplied at creation (items and creatures left in the original language)
  gated(registerReactions);
  gated(registerPortent);   // §36: Portent (Long Rest, diviner's request)
  gated(registerGrimoire);   // §139 : rituels sans emplacement, Restauration magique
  gated(registerLeaves);   // §456: an item removed from the sheet leaves its declared effects on it ("Mark of Sacrifice")
  gated(registerUsesSpent);   // §458: an item with spent uses (book read for 48 hours) applies its declared effects
  gated(registerFlee);   // §147: Dissonant Whispers, the flight by Reaction
  gated(registerReactionLoss);   // §501 (B21): "it only loses one reaction"
  gated(registerDispel);   // §37.2 : Dissipation de la magie
  gated(registerInlineChecks);   // §536: inline journal checks to the requested-roll flow — before every other pre-roll listener
  gated(registerTriggers);
  gated(registerVision);
  gated(registerSpace);
  gated(registerConditions);
  gated(registerAreas);
  gated(registerBanish);   // §265: the real Banishment (target Hidden, return at the end)
  gated(registerPassengers);   // §264: passengers of a teleportation (Dimension Door), placed by the active GM
  gated(registerLingering);   // §261: the terrain left by an instantaneous area (Ice Storm)
  gated(registerContest);   // §72 : test en opposition (Combat perspicace)
  gated(registerStorm);   // §70: Call Lightning, the storm die already there
  gated(registerSelfAreas);   // §47: a "self" area is placed on the caster automatically
  gated(registerBursts);
  gated(registerCoatings);   // §345: the coated blade (Dagger of Venom) loses its poison on the first hit that lands
  gated(registerGrants);   // C12-d: activities given to another creature (Dragon's Breath)
  gated(registerFelled);
  gated(registerWeaponFeed);
  gated(registerWrath);
  gated(registerBackfire);   // O9h (§363): Horn of Blasting
  gated(registerProtection);   // O9h (§363) : Parchemin de protection
  gated(registerZones);
  gated(registerAuras);
  gated(registerEmanations);
  gated(registerRegeneration);
  gated(registerFortitude);   // §61: Undead Fortitude (the save due goes off with the HP, adapter/death.mjs)
  gated(registerDamageTraits);   // trait that answers a type of damage taken ("Frost", "Fire Aversion")
  gated(registerExtraTurns);   // consecutive turns (Time Stop)
  gated(registerDamageByCount);   // damage by the number created (Ring of Shooting Stars)
  gated(registerDrain);
  gated(registerSpaceSharing);
  gated(registerObjectPassage);   // §255
  gated(registerEmpower);   // §19.9 : Morsure vampirique (Dhampir)
  gated(registerLifesteal);   // §120 : Caresse du vampire
  gated(registerDischarge);   // §19.9: Path to the Grave, early end of the curse
  gated(registerMastery);   // §21: weapon mastery properties (after registerTriggers: marks consumed on the same attack message)
  gated(registerMasteryChoices);   // §222 : bottes choisies — limite, changement au Repos long
  gated(registerSneak);   // §20: Sneak Attack (after registerAreas: the chosen damage type is already set), Cunning Strike
  gated(registerFighter);   // §21: "Hero of the Field of Honor", Great Weapon Fighting and Thrown Weapon Fighting styles
  gated(registerFeats);   // §129: "Martial Savagery", Healer
  gated(registerEffectWhile);   // §130: conditional feat effects (Defense, Dueling…)
  gated(registerMonk);   // §24: Stunning Strike, Open Hand Technique
  gated(registerSmite);   // §25: smite spells (after registerSneak: the smite dice follow those of Sneak Attack)
  gated(registerFollowUps);   // §373: activities offered after a hit (after registerSmite: the favor first, then the hold)
  gated(registerManeuverDice);   // §89, §90: maneuver dice (Lunging, Feinting, Evasive Footwork, Sweeping, Maneuvering, Commander's Strike)
  gated(registerSuccessAtCost);   // issue #32: success at a cost (settings, question to the player)
  gated(registerHeroic);   // §282: Heroic Inspiration — before the post-roll dice ("Ambush", Bardic Inspiration), which wait for it
  gated(registerRollBonus);      // §90: a die added to a check or Initiative ("Ambush", "Natural Authority", "Tactical Assessment")
  gated(registerNaturalOne);     // §93: a natural 1 on a D20 Test ("Dark Gifts of Ravenloft")
  gated(registerRise);           // §95: rising at 0 HP ("Necrotic Husk", "Strength of the Grave", "Lingering Wrath")
  gated(registerAfterSneak);     // §95: after a Sneak Attack ("Wailing from the Grave")
  gated(registerActivityChoice);   // §42.1: dnd5e's activity choice, answered when there is nothing to choose
  gated(registerCantrips);   // §23: cantrips (durations, blocked healing, Toll the Dead, True Strike)
  gated(registerEndings);   // §42.2: what follows the end of an effect (Haste lethargy)
  gated(registerActionEnd);   // §43.2: an action ends an effect (request to the active GM)
  gated(registerBarbarian);   // §22: Persistent Rage, Relentless Rage, Reckless Attack (after legality: the question comes once use is confirmed)
  gated(registerSwallow);
  gated(registerBasics);
  gated(registerAwaiting);   // §381: who the table is waiting for — settings, request between clients, disconnections
  gated(registerGmQueue);   // §421: the GM Queue — forcing any player window, rolling for an absent author
  gated(registerPlayerWaits);   // §290: combat windows without delay — the setting, and the "force" request on each player
  gated(registerAnimations);   // §112 : l'application attend la fin de l'animation (Sequencer / BLFX)
  gated(registerFamiliars);   // §107 : vision et poche dimensionnelle des familiers (leurs actions de base : registerBasics)
  gated(registerGrapple);
  gated(registerProne);
  gated(registerClimb);   // §192: climbing walls, fall of a climber who no longer holds
  gated(registerFalls);   // §208: automatic fall (dnd5e "Falling", flying at Speed 0), Step of the Wind
  gated(registerKnockout);   // §210: non-lethal blows (waking up, first aid), surprise on Initiative
  gated(registerReady);
  gated(registerBurning);
  gated(registerImprovised);
  gated(registerArmorTraining);   // §214: armor training   // §213: improvised weapons, asked of the GM   // §212: Burning — burns at the start of the turn, putting out one's flames, spreading   // §211: Ready — the readied action, its trigger, the Reaction
  gated(registerSpeedGrants);   // §195: speeds that content grants (Athlete: climb)
  gated(registerBreaks);
  gated(registerCure);
  gated(registerBlink);
  gated(registerWalls);
  gated(registerWallSide);   // §169: Wall of Fire — burning side, thin ring, burning face
  gated(registerElevationSpells);
  gated(registerStabilize);   // §50 : trousse de soins
  gated(registerPotions);   // §53: spell of a potion without Concentration
  gated(registerOil);   // §54 : l'huile s'enflamme
  gated(registerScatter);   // §187: caltrops and ball bearings scattered on the ground
  gated(registerFlammable);   // §188: oil on the ground, web — areas that ignite
  gated(registerHelp);
  gated(registerSkillAid);   // §113: "Assist" and "Help" requested for a skill check (request to the helper)
  gated(registerGroupRoll);   // §242: GM-requested rolls (request to the player, dnd5e request card)
  gated(registerCombatLaunch);   // §397: starting a combat (pause, participants, Initiative via roll request, music)
  gated(registerHide);
  gated(registerSearch);
  gated(registerPassivePerception);
  gated(registerIllumination);
  gated(registerLights);
  gated(registerEffects);
  gated(registerAntimagic);   // §436: dnd5e 6.1 antimagic (Handbook Field behavior, marked magical effects)
  gated(registerWildShape);
  gated(registerEnchant);
  gated(registerTether);
  gated(registerDefenses);
  gated(registerSize);
  gated(registerCompulsion);   // §403: Compulsion, the direction and the walk (after the budget, like orders)
  gated(registerOrders);   // after the budget (registerTurn): an order finishes the turn that the reset has just opened
  gated(registerControl);   // §285: control spells (panic, Confusion, Crown of Madness), same place as orders
  gated(registerCatalyst);   // §289 : Seconde peau, le changement involontaire
  gated(registerCompact);   // §58: before registerChat — the dice summary precedes the verdict
  gated(registerChat);
  gated(registerGmAlert);   // §364: GM alert — the whispered card
  gated(registerForced);   // §408: a rule overridden — the GM and the table notified
  gated(registerGmAlertUi);   // §364 : son bandeau chez le MJ
  gated(registerSummonPermissions);   // §542 (issue #43): a player who cannot summon is told why, and so is the GM
  gated(registerSummonPermissionsUi);   // §542: at load, the GM is told when players cannot summon
  gated(registerPurge);
  gated(registerFeedback);
  gated(registerAwaitingUI);   // §381: the hourglass above the token being waited on, the "The GM is deciding…" banner
  gated(registerTimers);   // §272: timers above tokens (search, disarming), seen by the whole table
  gated(registerTracker);
  gated(registerLightIndicator);
  gated(registerPerception);   // §62: fog hides on screen, hearing shows what is heard
  gated(registerEtherealUI);   // §225: the Ethereal token as a ghost, the gray scene seen from the Ethereal Plane
  gated(registerEtherealMovement);   // §225, batch 3: the "Ethereal" movement action (walls crossed)
  gated(registerVigor);
  gated(registerCureUi);
  gated(registerWallSideUi);   // §171: ring of fire — inward or outward
  gated(registerKindleUi);   // §52: tinderbox
  gated(registerStandingMasteryUi);   // §537 : standing weapon mastery (Tactical Master)
  gated(registerSkillAidUi);   // §113: "Aids" section of a check's roll window
  gated(registerGroupRollUI);   // §242: request window, toolbar die, token HUD, card
  gated(registerSuccessAtCostUI);   // issue #32: GM badge, card buttons and marks
  gated(registerPlayerWaitsUI);   // §290: GM tracking window (who they are waiting for, force)
  gated(registerCombatLaunchUI);   // §397: "Start a combat" window and its button
  gated(registerCorrectionUi);   // §395 / §396: "Launch without DAS" and "GM Correction" in a sheet item's menu
  gated(registerGroupRollTracker);   // §242: GM tracking window (rolls in progress, roll for a player who is slow)
  gated(registerAutomation);
  gated(registerMasteryUI);   // §222: mastery badge on the sheet, mastery window
  gated(registerFactionsUI);   // §181: window, toolbar tool, token HUD
  gated(registerStealthUI);   // §183: stealth mode shortcut, cones drawn on the player's side
  gated(registerDebugReport);   // §380: bug report window, badge, notice, menu entry
  gated(registerConnectionTest);   // §388: "Test the connection (DAS)" in the player list menu
  gated(registerSettingsWindow);   // the settings window: last, it sorts out at `setup` what the others declared
  state.active = true;
});

Hooks.once("ready", () => {
  if ( state.reason === "midi-qol" ) {
    if ( game.user.isGM ) ui.notifications.warn("DND5ECOMBAT.MidiActif", { localize: true, permanent: true });
    return;
  }
  if ( state.reason === "system" ) {
    if ( game.user.isGM ) ui.notifications.warn(
      game.i18n.format("DND5ECOMBAT.SystemeTropAncien", { version: game.system.version }), { permanent: true });
    return;
  }
  state.unitFactors = readUnitFactors();
  console.log(`${MODULE_ID} | active — dnd5e ${game.system.version}, Foundry ${game.version}`);
});
