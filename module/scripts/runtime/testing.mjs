/**
 * Test functions exposed to the MCP connector (`call-module-api`, connector ≥ 0.28.0) under
 * `game.modules.get("dnd5e-combat").api.mcp`: what scenarios (tools/scenarios/) cannot do
 * with the generic tools — make a token walk along the ENGINE path (A*, stairs,
 * budget), like a click. Arguments and results in JSON (ids, cells, points), never a document.
 *
 * GM client only (the one running the connector), on the scene it displays: the A* reads the
 * canvas (walls, region polygons).
 */

import { playerWaits } from "../adapter/player-wait.mjs";
import { awaitingList } from "../adapter/awaiting.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { hamperedBy } from "./reactions.mjs";
import { scrollReadingFor, scrollReadOf } from "../adapter/scrolls.mjs";
import { forceWait } from "./player-waits.mjs";
import { queue, forceLine, rollBlocked, answerLine } from "./gm-queue.mjs";
import { pickCandidates, upgradeOf } from "../adapter/pick-targets.mjs";
import { castOnPicked } from "./pick-targets.mjs";
import { clockState } from "./clock.mjs";
import { MODULE_ID } from "../constants.mjs";
import { COMBAT_ENDED_HOOK, CREATURE_DEFEATED_HOOK } from "./combat-outcome.mjs";
import { perfApi } from "./perf.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { rollDamageFor } from "../adapter/messages.mjs";
import { reportsText } from "../core/automation.mjs";
import { identifierOf, contentOf } from "../adapter/content.mjs";
import { animationState } from "./animations.mjs";
import { carriedLightState } from "../adapter/lights.mjs";
import { toggleCarriedLight, toggleHood } from "./lights.mjs";
import { listBackups as diagBackups, repairTasks, restore as diagRestore, scanWorld } from "./diagnostic/index.mjs";
import { gmOnly, windows, viewedToken } from "./testing-shared.mjs";
import { blockerFor, tellGM } from "./summon-permissions.mjs";
import { debugThrow, debugReport, debugClear, debugVerbose, connectionTest } from "./testing-debug.mjs";
import { barrierBetween } from "../adapter/barriers.mjs";
import { climbEntries } from "./climb.mjs";
import { atCostCandidates, dismissAtCost, offerAtCost, offerOnMessage, offerOnRow, rowCandidate, nativeCandidate } from "./success-at-cost.mjs";
import { groupRollView } from "./group-roll.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { flight, hoist, grab, jump, climb, climbState, climbHolds, climbToward, climbCeiling, climbDown, reachCheck, dropDown, rawMove, dash, door, lock, familiar, familiarPocket, familiarRecall, follow, followState, mount, move, movement, plan, stairs, stairsAt, takeStairs, teleport, teleportPick, threats, missedOpportunities, transpose, unfollow, view } from "./testing-moves.mjs";
import { visionMatrix, screenHere, setOwners, sightIssues, screenAfterUpdate, control as controlToken } from "./testing-vision.mjs";
import { range, ready, burning, actionEnd, attackReasons, budget, cover, coverPreview, effectOrigins, enchant, endings, factions, heal, hurt, identify, itemData, issues, naturalOne, overrideContent, perceived, portent, rollCheck, rollSave, saveChance, potionOptionsOf, flammable, scatter, sees, skillAid, skillAids, stats, stealth, use, sheetUse, masteries, masteryWindow, etherealWalls, groupRoll, groupRollState, groupRollBreakdown, groupRollForce, groupRollMode, placeItemEffect, concentrate, upkeep, stand, fortified, catalyst, grappleState , rangeCheck, attacksThisTurn } from "./testing-rules.mjs";
import { placeRegionAt, rangedPlacement, chainCheck, tokenLight, damageTypes, owners, planning, storm, stormStrike, summonAt, wall, wallSide, castFromBar, summonCaptured } from "./testing-areas.mjs";

/** Closes a window (a closed dialog counts as "no": the move paused by the core ends). */
async function closeWindow({ id }) {
  gmOnly();
  const app = foundry.applications.instances.get(id);
  if ( !app ) return { closed: false };
  await app.close();
  return { closed: true };
}

/**
 * §391: clicks card no. `index` (greyed ones excluded) of an engine card window (`.dnd5e-combat-form`: the weapon of Elemental
 * Weapon, summoning form, Wild Shape…), like a player — the connector can fill a field and click a button, not a
 * card. Returns what was clicked.
 */
function clickCard({ id, index=0 }) {
  gmOnly();
  const app = foundry.applications.instances.get(id);
  const cards = [...(app?.element?.querySelectorAll(".dnd5e-combat-form:not(.refused)") ?? [])];
  const card = cards[index] ?? null;
  if ( !card ) return { clicked: false, cards: cards.length };
  card.click();
  return { clicked: true, cards: cards.length, uuid: card.dataset.uuid ?? card.dataset.profile ?? null };
}

/** The items partly reported by the GM (SPEC §9.2), for the summary reread by Claude. */
function reports() {
  return { entries: itemReports(), text: reportsText(itemReports()) };
}

/**
 * The click on "Damage" or "Healing" of a use card for which the engine awaits the author's roll (healing, damage
 * left to the system): what the connector does not do alone (it only rolls attacks). Same path as the engine
 * (adapter/messages.mjs, `rollDamageFor`): the roll is attached to the card, on the resolution's targets.
 */
async function rollCard({ messageId }) {
  gmOnly();
  const carrier = game.messages.get(messageId);
  if ( !carrier ) throw new Error(`message ${messageId} not found`);
  const resolution = carrier.getFlag(MODULE_ID, "resolution");
  if ( !resolution ) throw new Error(`message ${messageId}: no engine resolution`);
  const rolls = await rollDamageFor(carrier, resolution, false);
  return { rolled: !!rolls, step: resolution.step ?? null };
}

/**
 * §121: light or extinguish a carried source without going through its activity (the Torch has none), like the inventory menu;
 * returns the result and the source's state. `on` absent: the opposite.
 */
async function toggleLight({ actorId, itemId, on=null }) {
  gmOnly();
  const item = game.actors.get(actorId)?.items.get(itemId);
  if ( !item ) throw new Error("item not found");
  const result = await toggleCarriedLight(item, on);
  return { ...result, state: item.actor?.items.get(itemId) ? carriedLightState(item) : null };
}

/** §346: lowers (`down: true`) or raises the hood of a lit source. */
async function hood({ actorId, itemId, down=null }) {
  gmOnly();
  const item = game.actors.get(actorId)?.items.get(itemId);
  if ( !item ) throw new Error("item not found");
  return toggleHood(item, down);
}

/** §346: removes an effect from an actor's item (an applied enchantment). */
async function removeItemEffect({ actorId, itemId, effectId }) {
  gmOnly();
  const effect = game.actors.get(actorId)?.items.get(itemId)?.effects.get(effectId);
  if ( !effect ) return false;
  await effect.delete();
  return true;
}

/** §121: the state of a carried source (lit, time left, fuel), or null if it is no longer there. */
function lightState({ actorId, itemId }) {
  const item = game.actors.get(actorId)?.items.get(itemId);
  return item ? carriedLightState(item) : null;
}

/** §121: make world time pass (seconds, negative to go back); returns the world time. */
/** §305: a Long Rest for the token, without a window or card (the `dnd5e.restCompleted` hook fires as on a player's rest). */
async function longRest({ tokenId }) {
  gmOnly();
  const actor = canvas.scene?.tokens.get(tokenId)?.actor;
  if ( !actor ) throw new Error("token not found on the viewed scene");
  const result = await actor.longRest({ dialog: false, chat: false, newDay: false });
  return { done: !!result };
}

/** C12-j: a Short Rest for the token, without a window (Hit Dice are not spent). */
async function shortRest({ tokenId }) {
  gmOnly();
  const actor = canvas.scene?.tokens.get(tokenId)?.actor;
  if ( !actor ) throw new Error("token not found on the viewed scene");
  const result = await actor.shortRest({ dialog: false, chat: false });
  return { done: !!result };
}

/** GM: advances world time by `seconds` seconds (`game.time.advance`) → `{ worldTime }`. */
async function advanceTime({ seconds }) {
  gmOnly();
  await game.time.advance(Number(seconds) || 0);
  return { worldTime: game.time.worldTime };
}

/**
 * Gives an item back to an actor under its original identifier (`keepId`), for a scenario that made it lose it ("Coward of
 * Command" dropped in a heap by a neighboring module): the connector always creates a new identifier, and the caster's safety net
 * removes the items it did not know.
 */
async function restoreItem({ actorId, itemData }) {
  gmOnly();
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`actor ${actorId} not found`);
  if ( actor.items.has(itemData?._id) ) return { restored: false, id: itemData._id };
  const [item] = await actor.createEmbeddedDocuments("Item", [itemData], { keepId: true });
  return { restored: !!item, id: item?.id ?? null };
}

/** §98: the survey of the engine's timings on the GM's client (the `limit` costliest lines), and the long tasks. */
function perf({ limit=20, reset=false }={}) {
  const out = { hooks: perfApi.report().slice(0, limit), longTasks: perfApi.longTasks() };
  if ( reset ) perfApi.reset();
  return out;
}

/** Load time of the engine code on this client: changes on every reload. */
const BOOTED_AT = Date.now();

/**
 * The state of the executing client (the connector's GM): engine version and load time, and whether it is the active GM
 * — the one running the engine (`game.users.activeGM`). `tools/reload.mjs` uses it to know that the F5 happened.
 */
function status() {
  return { version: game.modules.get(MODULE_ID)?.version ?? null, bootedAt: BOOTED_AT, ready: game.ready === true, hidden: document.hidden === true, worldTime: game.time?.worldTime ?? null,
    user: game.user.name, activeGM: game.users.activeGM?.id === game.user.id,
    // §389: the GM client's language (activity names without a proper name and Babele depend on it)
    // and the number of connected players.
    lang: game.i18n?.lang ?? null, players: game.users.filter(u => u.active && !u.isGM).length };
}

/**
 * Launches a macro (by its uuid: world or "GM Tools" compendium, §56) without waiting for its end: its windows are read and
 * answered afterwards through the connector's `list-dialogs` / `answer-dialog`. GM only.
 */
/** O8g (§350): a spell scroll made as dnd5e does it from a compendium (`createScrollFromSpell`), given to the token's actor. */
async function makeScroll({ tokenId, spellUuid, quantity=1 }) {
  gmOnly();
  const actor = canvas.scene?.tokens.get(tokenId)?.actor;
  const spell = await fromUuid(spellUuid);
  if ( !actor || !spell ) throw new Error("token or spell not found");
  const scroll = await CONFIG.Item.documentClass.createScrollFromSpell(spell, {}, { dialog: false });
  const data = scroll?.toObject?.() ?? scroll;
  foundry.utils.setProperty(data, "system.quantity", quantity);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return { itemId: created?.id ?? null, name: created?.name ?? null, activities: Array.from(created?.system.activities ?? []).map(a => a.type) };
}

/** O8g (§350): what the engine judges of a scroll for its bearer (`scrollReadingFor`), activity by activity. */
function scrollReading({ tokenId, itemId }) {
  const actor = canvas.scene?.tokens.get(tokenId)?.actor;
  const item = actor?.items.get(itemId);
  if ( !item ) throw new Error("item not found");
  return Array.from(item.system.activities ?? []).map(a => ({ type: a.type, spell: a.spell?.uuid ?? null, reading: scrollReadingFor(a, actor),
    read: scrollReadOf(a), ready: globalThis.dnd5e?.registry?.spellLists?.ready ?? null, classes: Object.keys(actor.classes ?? {}) }));
}

/** O9g (§362): the item that gives Disadvantage to Opportunity Attacks against this token (Speedy, Boots of Speed), or null. */
/** O9h (§363): the barrier that stops this action from reaching its target (Antilife Shell, Scroll of Protection), or null. */
function barrier({ attackerId, targetId, itemId, activityType=null }) {
  const attacker = canvas.scene?.tokens.get(attackerId);
  const target = canvas.scene?.tokens.get(targetId);
  const activity = attacker?.actor?.items.get(itemId)?.system.activities.find(a => !activityType || (a.type === activityType)) ?? null;
  return barrierBetween(attacker, target, activity)?.item?.name ?? null;
}

/** §364: the GM alerts shown in this client's banner (texts). */
function gmAlerts() {
  return Array.from(document.querySelectorAll(".das-gm-alerts__line:not(.closing) .das-gm-alerts__text")).map(e => e.textContent);
}

/**
 * §542: what would happen if the user `userId` (a player) used this summon activity — the bench has no player client. Rights are read
 * for that user (`User#can` reads the role table for any user); with `tell: true` (default) the GM alert is posted as the player's
 * client would post it, whatever was told before. → `{ blocker, messageId }` (`blocker` null: nothing missing).
 */
async function summonBlocked({ userId, tokenId, itemId, activityId=null, tell=true }={}) {
  gmOnly();
  const user = game.users.get(userId);
  if ( !user ) throw new Error(`user ${userId} not found`);
  const item = canvas.scene?.tokens.get(tokenId)?.actor?.items.get(itemId);
  const activity = item?.system.activities.get(activityId) ?? item?.system.activities.find(a => a.type === "summon");
  if ( activity?.type !== "summon" ) throw new Error(`no summon activity on item ${itemId}`);
  const blocker = blockerFor(activity, user);
  const messageId = (blocker && tell) ? await tellGM(activity, user, blocker, { once: false }) : null;
  return { blocker, messageId };
}

/** §134: Speedy — the name of the item that gives Disadvantage to Opportunity Attacks against token `tokenId`'s actor, or null. */
function hampered({ tokenId }) {
  return hamperedBy(canvas.scene?.tokens.get(tokenId)?.actor ?? null);
}

/** GM: runs the macro `uuid` without waiting for it (an error goes to the console) → `{ started }` (its name). */
async function runMacro({ uuid }={}) {
  gmOnly();
  const macro = await fromUuid(uuid);
  if ( !(macro instanceof Macro) ) throw new Error(`not a macro: ${uuid}`);
  Promise.resolve(macro.execute()).catch(err => console.error(`${MODULE_ID} | macro "${macro.name}"`, err));
  return { started: macro.name };
}

/**
 * The GM client's F5, so that it rereads the engine code after a change: the response goes out before the reload.
 * GM only; `call-module-api` exists only in a world where the connector's "Test tools" setting is enabled.
 */
function reload() {
  gmOnly();
  setTimeout(() => window.location.reload(), 300);
  return { reloading: true, bootedAt: BOOTED_AT };
}

/**
 * The inventory of the world's capabilities (world actors, not unlinked tokens): one line per identifier and item type,
 * with who carries it, what the engine knows of it (`rules`: the content keys), its activities, its effects and the start of its
 * original English text. `types` filters the item types (by default everything except basic equipment and loot).
 */
function inventory({ types=null, textLength=700 }={}) {
  const skip = new Set(["loot", "container", "class", "subclass", "background", "race"]);
  const rows = new Map();
  for ( const actor of game.actors ) {
    if ( !["character", "npc"].includes(actor.type) ) continue;
    for ( const item of actor.items ) {
      if ( types ? !types.includes(item.type) : skip.has(item.type) ) continue;
      const { id, from } = identifierOf(item);
      const key = `${item.type}|${id ?? item.name}`;
      let row = rows.get(key);
      if ( !row ) {
        const text = String(item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        row = { identifier: id, from, type: item.type, names: [], actors: [], rules: Object.keys(contentOf(item).entry ?? {}),
          activities: Array.from(item.system.activities ?? []).map(a => a.type), effects: item.effects.size,
          level: item.system.level ?? null, source: item._stats?.compendiumSource ?? null, text: text.slice(0, textLength) };
        rows.set(key, row);
      }
      if ( !row.names.includes(item.name) ) row.names.push(item.name);
      row.actors.push(`${actor.name}${actor.hasPlayerOwner ? " (PC)" : ""}`);
    }
  }
  return Array.from(rows.values()).sort((a, b) => (b.actors.length - a.actors.length) || String(a.identifier).localeCompare(String(b.identifier)));
}

/**
 * §220, §224: the engine's buttons in the token toolbar (`present`, `active`) and, for a token, what climbing offers
 * in its menu (labels) — the climbing switch read by the `escalade-interrupteur` scenario.
 */
function controls({ tokenId=null }={}) {
  const tools = ui.controls?.controls?.tokens?.tools ?? {};
  const tool = name => ({ present: name in tools, active: tools[name]?.active === true });
  const token = tokenId ? viewedToken({ tokenId }) : null;
  return { theater: tool("das-theater"), climb: tool("das-climb"), climbSystem: climbSystemOn(),
    climbEntries: token ? climbEntries(token).map(e => e.label) : null };
}

/**
 * §240: the context menu entries of `targetId` for `tokenId` (taken over while reading), read through the public API
 * `api.ui.tokenMenu` — `runtime/` does not import `ui/`. `run`: launches the entry with this label without waiting for it
 * (a roll may open a window); the previous control comes back when it has finished.
 */
function menu({ tokenId, targetId, run=null }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const before = canvas.tokens.controlled.map(t => t.document.id);
  const giveBack = () => {
    canvas.tokens.releaseAll();
    for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  };
  token.object.control({ releaseOthers: true });
  let entries;
  try { entries = game.modules.get(MODULE_ID).api.ui.tokenMenu(target); }
  catch(err) { giveBack(); throw err; }
  const labels = entries.map(e => e.label);
  // §411: the greyed-out entries and their reason.
  const refused = Object.fromEntries(entries.filter(e => e.refused).map(e => [e.label, e.refused]));
  const entry = run ? entries.find(e => e.label === run) : null;
  if ( !entry ) {
    giveBack();
    if ( run ) throw new Error(`no menu entry « ${run} » (${labels.join(" | ")})`);
    return { labels, refused };
  }
  Promise.resolve(entry.run()).catch(err => console.error(`${MODULE_ID} | test menu`, err)).finally(giveBack);
  return { labels, refused, started: true };
}

/**
 * §243, §247: the menu entries of a door (`wallId`) or a cell (`x`, `y`) for `tokenId`, read through the public API
 * (`api.ui.doorMenu`, `api.ui.groundMenu`), with those of the neighbors. `probe`: a trial entry added for the time of the read by
 * the menu hook (`doorMenu` / `groundMenu`), to check that a neighbor is heard there; the received context is returned.
 */
function placeMenu({ tokenId, wallId=null, x=null, y=null, probe=null }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const before = canvas.tokens.controlled.map(t => t.document.id);
  const hook = wallId ? `${MODULE_ID}.doorMenu` : `${MODULE_ID}.groundMenu`;
  const seen = [];
  const listener = probe ? Hooks.on(hook, (entries, context) => {
    seen.push({ token: context.token?.id ?? null, wall: context.wall?.id ?? null, point: context.point ?? null });
    entries.push({ icon: "fa-solid fa-flask", label: probe, run: () => {} });
  }) : null;
  token.object.control({ releaseOthers: true });
  try {
    const api = game.modules.get(MODULE_ID).api.ui;
    const entries = wallId ? api.doorMenu(wallId) : api.groundMenu({ x, y });
    return { labels: entries.map(e => e.label), seen };
  } finally {
    if ( listener !== null ) Hooks.off(hook, listener);
    canvas.tokens.releaseAll();
    for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  }
}

/**
 * A setting of the engine (and of it alone): returns the previous value, so a scenario can restore it; `value` absent: read-only.
 * GM only (§38.4: the `presage` scenario disables Portent for the length of a game).
 */
async function setting({ key, value }) {
  gmOnly();
  if ( !game.settings.settings.has(`${MODULE_ID}.${key}`) ) throw new Error(`unknown setting: ${key}`);
  const before = game.settings.get(MODULE_ID, key);
  if ( value !== undefined ) await game.settings.set(MODULE_ID, key, value);
  return { key, before, now: game.settings.get(MODULE_ID, key) };
}

/** The engine's world settings that are not at their default value (read-only): what the table chose. */
function settingsChanged() {
  gmOnly();
  const out = {};
  for ( const [id, config] of game.settings.settings ) {
    if ( (config.namespace !== MODULE_ID) || (config.scope !== "world") || !config.config && (config.type === Object) ) continue;
    let value;
    try { value = game.settings.get(MODULE_ID, config.key); } catch { continue; }
    const def = (typeof config.default === "function") ? undefined : config.default;
    if ( (def !== undefined) && (JSON.stringify(value) !== JSON.stringify(def)) ) out[config.key] = { value, default: def };
  }
  return out;
}

/**
 * Displays a scene for the GM (`Scene#view`): activating an already active scene does not change what the GM is looking at
 * (seen on 2026-10-22: a sweep played against the Test Arena, displayed, while the Spell Arena was active).
 * Returns the displayed scene.
 */
async function viewScene({ sceneId }) {
  gmOnly();
  const scene = game.scenes.get(sceneId);
  if ( !scene ) throw new Error(`scene ${sceneId} not found`);
  if ( canvas.scene?.id !== sceneId ) await scene.view();
  return { viewed: canvas.scene?.id ?? null };
}

/**
 * A WORLD setting of another module, read and changed for the length of a scenario pass (survey of gaps, 2026-10-22): a clock
 * that advances world time outside combat ("Simple Timekeeping" from `dnd-6`: 600 s per interval, `paused` setting) makes any
 * one-minute duration expire within seconds — Concentration included, which dnd5e then removes outside combat
 * (`_onUpdate`, expired effect). Returns `{ absent: true }` if the setting does not exist (module absent or inactive).
 */
/** §251: the state of the engine's real-time clock (null: it is running) and the world time. */
const clock = () => ({ halt: clockState(), worldTime: game.time.worldTime });

/**
 * GM: reads a world setting of another namespace (`namespace.key`) and, with `value`, writes it → `{ key, before, now }`, or
 * `{ absent: true }`.
 */
async function foreignSetting({ namespace, key, value }) {
  gmOnly();
  const config = game.settings.settings.get(`${namespace}.${key}`);
  if ( !config ) return { absent: true };
  if ( config.scope !== "world" ) throw new Error(`${namespace}.${key}: not a world setting`);
  const before = game.settings.get(namespace, key);
  if ( value !== undefined ) await game.settings.set(namespace, key, value);
  return { key, before, now: game.settings.get(namespace, key) };
}

/**
 * The running Sequencer effects and sounds (third-party module: Boss Loot / BLFX animations), and the ending of those designated —
 * so that the scenario runner finishes what a scenario spawned (seen on 2026-09-29: the looping sound of Acid Splash
 * stayed after the `presage` scenario). `Sequencer.EffectManager.effects` / `.endEffects({ effects: [ids] })`,
 * `Sequencer.SoundManager.sounds` / `.endSounds({ sounds: [ids] })` (sequencer.js 4.2.3: 10723, 10842, 11538, 11626, 30899-30900);
 * the other clients are notified by Sequencer. Without Sequencer: nothing.
 */
async function sequencer({ end=null }={}) {
  const S = globalThis.Sequencer;
  if ( !S?.EffectManager || !S?.SoundManager ) return { available: false, effects: [], sounds: [] };
  if ( end?.effects?.length ) await S.EffectManager.endEffects({ effects: end.effects }).catch(() => null);
  if ( end?.sounds?.length ) await S.SoundManager.endSounds({ sounds: end.sounds });
  return {
    available: true,
    effects: (S.EffectManager.effects ?? []).map(e => ({ id: e.id, name: e.data?.name ?? null, file: String(e.data?.file ?? "") })),
    sounds: (S.SoundManager.sounds ?? []).map(s => ({ id: s.data?._id ?? s.id, name: s.data?.name ?? null }))
  };
}

/**
 * §58: the latest log cards as the GM sees them — type, collapsed or not (`display` computed), summary of the rolls
 * of the single card and verdict. Read-only.
 */
function chatCards({ count=6 }={}) {
  return game.messages.contents.slice(-count).map(m => {
    const li = document.querySelector(`#chat .chat-message[data-message-id="${m.id}"]`);
    return { id: m.id, type: m.type, origin: m._source.system?.origin ?? null, inLog: !!li,
      hidden: li ? (getComputedStyle(li).display === "none") : null,
      rolls: li ? [...li.querySelectorAll(".dnd5e-combat-rolls p")].map(p => p.textContent) : [],
      details: li?.querySelector(".dnd5e-combat-details")?.textContent ?? null,
      verdict: li ? [...li.querySelectorAll(".dnd5e-combat-result:not(.dnd5e-combat-rolls) p")].map(p => p.textContent) : [] };
  });
}

/* -------------------------------------------- */

const plainTask = t => ({ id: t.id, check: t.check, root: t.root ?? null, fixable: typeof t.apply === "function", preselect: !!t.preselect,
  where: String(t.where ?? "").replace(/<[^>]+>/g, ""), text: String(t.text ?? "").replace(/<[^>]+>/g, "") });

/** Analysis (nothing is written): the tasks, without their functions. */
async function diagnosticScan({ checks=null }={}) {
  const scan = await scanWorld(checks);
  return Object.fromEntries(Object.entries(scan).map(([id, tasks]) => [id, tasks.map(plainTask)]));
}

/**
 * Repairs the repairable tasks of these checks whose root is one of these uuids (all if `roots` is absent), with these
 * check options (`{ [checkId]: { [optionId]: valeur } }`).
 */
async function diagnosticRepair({ checks=null, roots=null, options={} }={}) {
  const scan = await scanWorld(checks);
  const tasks = Object.values(scan).flat().filter(t => t.apply && (!roots || roots.includes(t.root?.uuid)));
  const { backup, results } = await repairTasks(tasks, options);
  return { backup, results: results.map(r => ({ ...plainTask(r.task), ok: r.ok, line: String(r.line).replace(/<[^>]+>/g, "") })) };
}

/** The world diagnostic's backups, most recent first: `[{ id, uuid, name, date, roots, checks }]`. */
const diagnosticBackups = () => diagBackups();

/** After a scenario: removes these backup entries, and the compendium if it is empty and the scenario created it (`dropPack`). */
async function diagnosticForget({ uuids=[], dropPack=false, actors=[] }={}) {
  for ( const uuid of uuids ) await (await fromUuid(uuid).catch(() => null))?.delete();
  // The actors the scenario created (marked `flags.dnd5e-combat.scenario`), never any other.
  for ( const id of actors ) { const a = game.actors.get(id); if ( a?.getFlag(MODULE_ID, "scenario") ) await a.delete(); }
  const pack = game.packs.get("world.das-backups");
  const left = pack ? (await pack.getIndex()).size : 0;
  if ( pack && dropPack && !left ) await pack.deleteCompendium();
  return { left, dropped: !!(pack && dropPack && !left) };
}
/** GM: restores the diagnostic backup `uuid`, after saving the current state of the same documents → `{ lines, before }`. */
const diagnosticRestore = ({ uuid }) => diagRestore(uuid);


/** §293: the activity of an item of a token in the viewed scene. */
function activityOn({ tokenId, itemId, activityId }) {
  const item = canvas.scene?.tokens.get(tokenId)?.actor?.items.get(itemId);
  return item?.system?.activities?.get(activityId) ?? null;
}

/** §293: the "creatures of your choice within a radius" list the window would have (without what the user sees). */
function pickTargets(args) {
  const activity = activityOn(args);
  if ( !activity ) return { error: "activity not found" };
  const { radius, units, creatures, max, centers=[] } = pickCandidates(activity);
  return { radius, units, max: max ?? null, upgrade: upgradeOf(activity)?.item?.name ?? null, centers: centers.map(t => t.name),
    creatures: creatures.map(c => ({ id: c.token.id, name: c.token.name, enemy: c.enemy, checked: !!c.checked, distance: c.distance })) };
}

/** §293: what the window's "Use" does — checked `targetIds`, `upgrade`: the checkbox of the activity that replaces it. */
async function castPicked({ targetIds=[], upgrade=false, ...args }) {
  const activity = activityOn(args);
  if ( !activity ) return { error: "activity not found" };
  const tokens = targetIds.map(id => canvas.scene.tokens.get(id)).filter(Boolean);
  const results = await castOnPicked(activity, [{ [MODULE_ID]: { confirmed: true } }, { configure: false }, {}], { tokens, upgrade: upgrade ? upgradeOf(activity) : null });
  return { used: !!results, usageMessageId: results?.message?.id ?? null };
}

/** Ce que `api.mcp` expose. */
/** §421: the GM's Queue — `{ mine, players, blocked, count, window }` (`window`: is the panel open?). */
function gmQueueState() {
  return { ...queue(), window: !!foundry.applications.instances.get("das-player-waits") };
}
/** §421: the GM forces the row `id` of "I'm waiting for a player". */
const gmQueueForce = ({ id }) => forceLine(id);
/** §421: the GM rolls, in place of an absent author, the roll of the row `id` of "Blocked". */
const gmQueueRoll = ({ id }) => rollBlocked(id);
/** §422: the GM answers from their queue — the `action` button of the window of the row `id` of "Up to me to decide". */
const gmQueueAnswer = ({ id, action }) => answerLine(id, action);

/** §290: the GM's waits (combat windows without a delay) — `{ waits: [...], window: bool }`. */
function waits() {
  return { waits: playerWaits(), window: !!foundry.applications.instances.get("das-player-waits") };
}

/**
 * §381 (issue #35): who the table is waiting for, for scenarios — `list` (this client's known waits), `open` (opens here a
 * button window marked for token `tokenId`, of kind `kind`, delay `seconds` or the setting's; returns right away, the window stays
 * open until `answer-dialog` or the delay), `result` (what the last opened window returned, `undefined` while it is open).
 */
let awaitingProbe = { done: true, value: undefined };
/**
 * §381: `action` "list" (this client's known waits), "open" (a probe window marked for `tokenId`) or "result" (its
 * answer).
 */
function awaiting({ action="list", tokenId=null, kind="reaction", seconds=null }={}) {
  if ( action === "list" ) return awaitingList();
  if ( action === "result" ) return { done: awaitingProbe.done, value: awaitingProbe.value ?? null };
  if ( action === "open" ) {
    const actor = canvas.tokens.get(tokenId)?.actor ?? null;
    if ( !actor ) throw new Error(`no token ${tokenId}`);
    const probe = awaitingProbe = { done: false, value: undefined };
    timedWait({ window: { title: "DAS awaiting probe" }, content: "<p>probe</p>",
      buttons: [{ action: "yes", label: "Yes", default: true }, { action: "no", label: "No" }] },
    { fallback: "timeout", awaiting: { actor, kind }, ...(Number(seconds) > 0 ? { seconds: Number(seconds) } : {}) })
      .then(value => { probe.value = value; }, () => { probe.value = "error"; }).finally(() => { probe.done = true; });
    return { opened: true };
  }
  throw new Error(`unknown action: ${action}`);
}

/** §290: force a wait (`{ id }`, or the oldest). */
async function forcePlayerWait({ id=null }={}) {
  const target = id ?? playerWaits()[0]?.id;
  return { forced: target ? await forceWait(target) : false };
}

/**
 * Issue #32: successes at a cost, for scenarios — `list` (the pauses open on the active GM), `offer` (a pause taken; `cost`
 * given: without the GM's window), `dismiss`, `row` (a row of a requested roll, `card` + `tokenId`),
 * `message` (a native roll with a DC).
 */
async function atCost({ action="list", id=null, cost, card=null, tokenId=null, message=null }={}) {
  if ( action === "list" ) return atCostCandidates();
  if ( action === "offer" ) return { accepted: await offerAtCost(id, { cost }) };
  if ( action === "dismiss" ) { dismissAtCost(id); return { ok: true }; }
  if ( action === "row" ) {
    const view = groupRollView(card);
    const actor = canvas.tokens.get(tokenId)?.actor;
    const entry = view?.entries.find(e => e.uuid === actor?.uuid);
    const row = rowCandidate(entry ? { ...entry, actor } : null, view?.request);
    if ( !row ) return { candidate: false, total: entry?.total ?? null, dc: view?.request?.dc ?? null };
    return { candidate: true, accepted: await offerOnRow(card, { ...row, what: "test" }, { cost }) };
  }
  if ( action === "message" ) {
    const m = game.messages.get(message);
    if ( !nativeCandidate(m) ) return { candidate: false };
    return { candidate: true, accepted: await offerOnMessage(message, { what: "test", cost }) };
  }
  throw new Error(`unknown action: ${action}`);
}

/**
 * Discord (Fanarie, 2026-11-18): the "Bright Light" checkbox put back in the displayed scene's configuration
 * (ui/scene-bright.mjs). Opens the window, reads the checkbox; `check`: ticks or unticks it and saves the form.
 * Returns the checkbox and the saved value.
 */
async function sceneBright({ check=null }={}) {
  gmOnly();
  const scene = canvas.scene;
  const app = scene.sheet;
  await app.render({ force: true });
  await new Promise(resolve => setTimeout(resolve, 300));
  const input = app.element?.querySelector('[name="environment.globalLight.bright"]');
  const shown = { present: !!input, checked: input?.checked ?? null };
  if ( input && (check !== null) ) {
    input.checked = !!check;
    await app.submit();
  }
  await app.close();
  return { ...shown, saved: scene._source.environment.globalLight.bright };
}

const outcomeWatch = { ids: null, heard: [] };
/**
 * §555: records the `combatEnded` / `creatureDefeated` hooks on this client. `action`: "watch" (starts, clears), "read" (what was
 * heard), "stop" (stops, returns what was heard), "tracker" (ticks "defeated" for `tokenId` in `combatId`), "unstarted" (a combat
 * with `tokenId`, deleted before it began).
 */
async function combatOutcome({ action="read", combatId=null, tokenId=null }={}) {
  if ( action === "tracker" ) {
    gmOnly();
    const combatant = game.combats.get(combatId)?.combatants.find(c => c.tokenId === tokenId);
    if ( !combatant ) throw new Error(`no combatant for token ${tokenId} in combat ${combatId}`);
    await combatant.update({ defeated: true });
    return { defeated: combatant.defeated };
  }
  if ( action === "unstarted" ) {
    gmOnly();
    const [combat] = await Combat.implementation.createDocuments([{ scene: canvas.scene.id }]);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId: canvas.scene.id }]);
    await combat.delete();
    return { id: combat.id };
  }
  if ( action === "watch" ) {
    if ( !outcomeWatch.ids ) outcomeWatch.ids = [
      [COMBAT_ENDED_HOOK, Hooks.on(COMBAT_ENDED_HOOK, ({ combat, round, combatants, defeated }) => outcomeWatch.heard.push({ hook: "combatEnded",
        combat: combat?.id ?? null, round, combatants: combatants.map(c => ({ token: c.token?.id ?? null, defeated: c.defeated })),
        defeated: defeated.map(t => t.id) }))],
      [CREATURE_DEFEATED_HOOK, Hooks.on(CREATURE_DEFEATED_HOOK, ({ token, combat, cause }) => outcomeWatch.heard.push({ hook: "creatureDefeated",
        token: token?.id ?? null, combat: combat?.id ?? null, cause }))]
    ];
    outcomeWatch.heard = [];
    return { watching: true };
  }
  const heard = [...outcomeWatch.heard];
  if ( action === "stop" ) {
    for ( const [name, id] of outcomeWatch.ids ?? [] ) Hooks.off(name, id);
    outcomeWatch.ids = null;
    outcomeWatch.heard = [];
  }
  return { heard };
}

export const testApi = Object.freeze({ combatOutcome, summonBlocked, gmQueue: gmQueueState, gmQueueForce, gmQueueRoll, gmQueueAnswer, atCost, barrier, gmAlerts, controls, menu, wall, wallSide, cover, coverPreview, issues, planning, stormStrike, storm, placeRegionAt, effectOrigins, enchant, overrideContent, heal, hurt, rollSave, rollCheck, range, rangeCheck, naturalOne, perf, threats, missedOpportunities, attackReasons, perceived, inventory, budget, potionOptions: potionOptionsOf, identify, itemData, stairs, plan, movement, move, windows, closeWindow, view, reports, rollCard, status, reload, clickCard, summonAt, castFromBar, summonCaptured, owners, makeScroll, scrollReading, hampered, stats, teleport, teleportPick, restoreItem, runMacro, saveChance, portent, transpose, dash, chatCards, setting, foreignSetting, viewScene, sequencer, stairsAt, takeStairs, follow, unfollow, followState, mount, endings, actionEnd, use, sheetUse, familiar, familiarPocket, familiarRecall, skillAids, skillAid, animations: animationState, toggleLight, hood, removeItemEffect, lightState, advanceTime, longRest, shortRest, clock, door, lock, diagnosticScan, diagnosticRepair, diagnosticBackups, diagnosticRestore, diagnosticForget, factions, sees, stealth, scatter, flammable, climb, climbState, climbHolds, climbToward, climbCeiling, climbDown, reachCheck, dropDown, rawMove, jump, hoist, grab, ready, burning, masteries, masteryWindow, etherealWalls, flight, groupRoll, groupRollState, groupRollBreakdown, groupRollForce, groupRollMode, placeMenu, settingsChanged, placeItemEffect, concentrate, upkeep, stand, rangedPlacement, chainCheck, tokenLight, damageTypes, fortified, catalyst, grappleState, attacksThisTurn, waits, awaiting, forcePlayerWait, pickTargets, castPicked , debugThrow, debugReport, debugClear, debugVerbose, connectionTest, visionMatrix, screenHere, setOwners, sightIssues, screenAfterUpdate, controlToken, sceneBright });
