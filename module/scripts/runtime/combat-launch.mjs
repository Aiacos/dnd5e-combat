/**
 * §397: "Launch a combat" (GM, user request, 2026-11-07). The sorting rule is in core/combat-launch.mjs, the window in
 * ui/combat-launch.mjs.
 *
 *  1. `beginLaunch`: the game pauses for the whole table, with "A combat begins, get ready" under the pause icon
 *     (the core's banner, client/applications/ui/game-pause.mjs, rewritten after its render: `showLaunchCaption`); the window
 *     opens on the GM's side.
 *  2. `launchCandidates`: the scene's tokens, sorted (connected players, seen by the players, rest of the map).
 *  3. `launchCombat`: the scene's combat (created if needed), its combatants — an NPC the players do not see enters hidden in
 *     the tracker (`hidden`) and appears as soon as a player token sees it; dnd5e's Surprised condition on the surprised
 *     (Disadvantage on Initiative, removed once the roll is made: runtime/knockout.mjs); the music; the pause lifted;
 *     Initiative — the players through the GM's roll request (type "initiative", runtime/group-roll.mjs: a neighbouring
 *     interface's roll window, timeout, follow-up), the NPCs by dnd5e if requested; a summon "right after its master" gets
 *     its Initiative as soon as the master has theirs (`initiativeAfter`);
 *     the first round starts on its own when everyone has rolled.
 *  4. When that combat ends, the previous music resumes.
 * The state (pending, combat launched, previous music) is a hidden world setting: every client reads it.
 */

import { MODULE_ID } from "../constants.mjs";
import { classify, initiativeGroups, allRolled } from "../core/combat-launch.mjs";
import { initiativeAfter } from "../core/turn.mjs";
import { canLocate } from "../adapter/vision.mjs";
import { summonItemOf } from "../adapter/summons.mjs";
import { contentOf } from "../adapter/content.mjs";
import { requestGroupRoll } from "./group-roll.mjs";
import { route } from "./router.mjs";
import { log, loc, isExecutor } from "./shared.mjs";
import { tokenArt } from "../adapter/token-art.mjs";

export const LAUNCH_STATE = "combatLaunch";
export const LAUNCH_BUTTON = "combatLaunchButton";
export const LAUNCH_PLAYLIST = "combatLaunchPlaylist";
const HIDDEN_FLAG = "revealWhenSeen";

const state = () => { try { return game.settings.get(MODULE_ID, LAUNCH_STATE) ?? {}; } catch { return {}; } };
const setState = changes => game.settings.set(MODULE_ID, LAUNCH_STATE, { ...state(), ...changes });

/** A summon's Initiative rule (content/summons.mjs `summon.initiative`), null for an ordinary creature. */
function summonRule(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  if ( !item ) return null;
  return contentOf(item).entry?.summon?.initiative ?? "own";
}

/** A summon's master: its token on the scene, or null. */
function masterToken(tokenDoc) {
  const actor = summonItemOf(tokenDoc)?.actor;
  return actor?.getActiveTokens?.(false, true)?.find(t => t.parent === tokenDoc.parent) ?? null;
}

const isCreature = actor => ["character", "npc"].includes(actor?.type);
const alive = actor => {
  if ( actor?.statuses?.has?.("dead") ) return false;
  const hp = actor?.system?.attributes?.hp;
  return !(Number(hp?.max) > 0) || (Number(hp?.value) > 0);
};
const ownersOnline = actor => game.users.some(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
const sameLevel = token => !canvas.level || !token.level || (token.level === canvas.level.id);

/**
 * The tokens that "see for the players": all the players' creatures on the scene, connected or not (a character whose
 * player is absent still sees what surrounds it).
 */
function playerTokens(scene) {
  return scene.tokens.filter(t => t.actor?.hasPlayerOwner && isCreature(t.actor) && alive(t.actor));
}

/** The scene's tokens, sorted for the window (core/combat-launch.mjs `classify`). */
export function launchCandidates(scene=canvas.scene) {
  if ( !scene ) return { players: [], seen: [], rest: [] };
  const observers = playerTokens(scene);
  const entries = scene.tokens.filter(t => t.actor).map(token => {
    const actor = token.actor;
    const player = !!actor.hasPlayerOwner;
    const online = player && ownersOnline(actor);
    const seen = !player && observers.some(o => {
      const verdict = canLocate(o, token);
      return (verdict === null) ? !token.hidden : verdict;
    });
    const summon = summonRule(token);
    return {
      id: token.id, uuid: token.uuid, name: token.name, img: tokenArt(token),
      actorKey: (token.actorLink ? actor.id : token.actorId) ?? actor.id,
      player, online, creature: isCreature(actor), alive: alive(actor), sameLevel: sameLevel(token),
      notCombatant: token.getFlag?.(MODULE_ID, "notCombatant") === true || actor.getFlag?.(MODULE_ID, "notCombatant") === true,
      summon, master: summon === "after" ? masterToken(token)?.id ?? null : null, seen, hiddenToken: token.hidden
    };
  });
  return classify(entries);
}

/** GM: the pause for the whole table, with its message. */
export async function beginLaunch() {
  if ( !game.user.isGM ) return false;
  if ( !canvas.scene ) { ui.notifications.warn(loc("Lancement.SansScene")); return false; }
  const running = game.combats.find(c => c.started && (c.scene?.id === canvas.scene.id));
  if ( running ) { ui.notifications.warn(loc("Lancement.DejaEnCours")); return false; }
  // `by`: the GM who opened the window — if they reload their page, their client lifts the wait (`ready`).
  await setState({ pending: true, wasPaused: game.paused, by: game.user.id });
  game.togglePause(true, { broadcast: true });
  log("combat launch: game paused, choosing the participants");
  return true;
}

/** GM: the window closed without launching — the previous pause comes back. */
export async function cancelLaunch() {
  if ( !game.user.isGM || !state().pending ) return;
  const was = state().wasPaused;
  await setState({ pending: false });
  if ( !was ) game.togglePause(false, { broadcast: true });
  log("combat launch: cancelled");
}

/** The music currently playing (playlists and tracks), to resume it at the end of the combat. */
function playingNow() {
  return game.playlists.filter(p => p.playing).map(p => ({ playlist: p.id, sounds: p.sounds.filter(s => s.playing).map(s => s.id) }));
}

async function startMusic(playlistId) {
  const playlist = game.playlists.get(playlistId ?? "");
  if ( !playlist ) return null;
  const previous = playingNow().filter(p => p.playlist !== playlist.id);
  for ( const p of previous ) await game.playlists.get(p.playlist)?.stopAll();
  await playlist.playAll();
  return { previous, current: playlist.id };
}

async function restoreMusic(music) {
  if ( !music ) return;
  await game.playlists.get(music.current ?? "")?.stopAll();
  for ( const p of music.previous ?? [] ) {
    const playlist = game.playlists.get(p.playlist);
    if ( !playlist ) continue;
    const sounds = p.sounds.map(id => playlist.sounds.get(id)).filter(Boolean);
    if ( sounds.length ) for ( const s of sounds ) await playlist.playSound(s);
    else await playlist.playAll();
  }
}

/**
 * GM: launches the combat.
 * @param {object} input
 * @param {Array<{uuid: string, surprised?: boolean}>} input.participants
 * @param {boolean} [input.npcAuto=true]       NPCs roll their Initiative on their own.
 * @param {boolean} [input.grouped=false]     One Initiative per creature type.
 * @param {string|null} [input.playlist]      The combat playlist.
 * @returns {Promise<Combat|null>}
 */
export async function launchCombat({ participants=[], npcAuto=true, grouped=false, playlist=null }={}) {
  if ( !game.user.isGM ) return null;
  const scene = canvas.scene;
  const tokens = participants.map(p => ({ token: fromUuidSync(p.uuid, { strict: false }), surprised: !!p.surprised })).filter(p => p.token?.actor);
  if ( !scene || !tokens.length ) { ui.notifications.warn(loc("Lancement.Personne")); return null; }
  const observers = playerTokens(scene);
  const unseen = token => !token.actor.hasPlayerOwner && !observers.some(o => canLocate(o, token) === true);

  let combat = game.combats.find(c => !c.started && (c.scene?.id === scene.id)) ?? null;
  combat ??= await Combat.implementation.create({ scene: scene.id, active: true });
  if ( !combat.active ) await combat.activate();
  const already = new Set(combat.combatants.map(c => c.tokenId));
  const data = tokens.filter(p => !already.has(p.token.id)).map(({ token }) => {
    const hidden = token.hidden || unseen(token);
    return { tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden,
      ...(hidden && !token.hidden ? { flags: { [MODULE_ID]: { [HIDDEN_FLAG]: true } } } : {}) };
  });
  if ( data.length ) await combat.createEmbeddedDocuments("Combatant", data);

  for ( const { token, surprised } of tokens ) {
    if ( surprised && !token.actor.statuses?.has("surprised") ) await token.actor.toggleStatusEffect("surprised", { active: true });
  }

  const music = playlist ? await startMusic(playlist) : null;
  await setState({ pending: false, combat: combat.id, music, grouped });
  game.togglePause(false, { broadcast: true });
  log(`combat launch: ${tokens.length} participant(s)${music ? ", combat music on" : ""}`);

  // Initiative: the players through the roll request, the NPCs by dnd5e, the "after" summons when their master has theirs.
  const ids = new Set(tokens.map(p => p.token.id));
  const members = combat.combatants.filter(c => ids.has(c.tokenId));
  const rule = c => summonRule(c.token);
  const players = members.filter(c => c.actor?.hasPlayerOwner && ownersOnline(c.actor) && (rule(c) !== "after"));
  const npcs = members.filter(c => !players.includes(c) && (rule(c) !== "after"));
  if ( npcAuto && npcs.length ) {
    const actorKey = c => (c.token?.actorLink ? c.actor?.id : c.token?.actorId) ?? c.id;
    for ( const group of initiativeGroups(npcs.map(c => ({ id: c.id, actorKey: actorKey(c) })), grouped) ) {
      await combat.rollInitiative([group.roll]);
      const value = combat.combatants.get(group.roll)?.initiative;
      if ( group.copies.length && Number.isFinite(value) ) {
        await combat.updateEmbeddedDocuments("Combatant", group.copies.map(id => ({ _id: id, initiative: value })));
      }
    }
  }
  if ( players.length ) {
    const actors = [...new Set(players.map(c => c.actor.uuid))];
    requestGroupRoll({ actors, type: "initiative", combat: combat.id, label: loc("Lancement.Libelle") })
      .catch(err => console.error(`${MODULE_ID} | combat launch: initiative request failed`, err));
  }
  await followSummons(combat);
  await startWhenReady(combat);
  return combat;
}

/** The summons "right after their master": their Initiative follows the master's as soon as it has one. */
async function followSummons(combat) {
  const updates = [];
  for ( const c of combat.combatants ) {
    if ( Number.isFinite(c.initiative) || (summonRule(c.token) !== "after") ) continue;
    const master = masterToken(c.token);
    const mine = master ? combat.combatants.find(x => x.tokenId === master.id) : null;
    if ( !Number.isFinite(mine?.initiative) ) continue;
    const others = combat.combatants.filter(x => (x !== mine) && (x !== c)).map(x => x.initiative);
    updates.push({ _id: c.id, initiative: initiativeAfter(mine.initiative, others) });
  }
  if ( updates.length ) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** The combats whose first round is requested from the server, not yet confirmed. */
const starting = new Set();

/**
 * The first round, as soon as everyone has rolled. `combat.started` only changes on the server's response, and a response that
 * carries several Initiatives (grouped NPCs, summons that follow their master) comes through here once per combatant: the start
 * in progress is noted, so as not to start the combat several times.
 */
async function startWhenReady(combat) {
  if ( !combat || combat.started || starting.has(combat.id) || (state().combat !== combat.id) ) return;
  if ( !allRolled(combat.combatants.map(c => c.initiative)) ) return;
  starting.add(combat.id);
  try { await combat.startCombat(); }
  finally { starting.delete(combat.id); }
  log("combat launch: everyone rolled, round 1 starts");
}

/** An NPC hidden in the tracker for lack of being seen: it appears as soon as a player token sees it. */
async function revealSeen(combat) {
  if ( !combat?.scene || (state().combat !== combat.id) ) return;
  const observers = playerTokens(combat.scene);
  const updates = combat.combatants.filter(c => c.hidden && c.getFlag(MODULE_ID, HIDDEN_FLAG) && c.token && !c.token.hidden
    && observers.some(o => canLocate(o, c.token) === true)).map(c => ({ _id: c.id, hidden: false, [`flags.${MODULE_ID}.${HIDDEN_FLAG}`]: null }));
  if ( updates.length ) {
    await combat.updateEmbeddedDocuments("Combatant", updates);
    log(`combat launch: ${updates.length} creature(s) now seen, shown in the initiative`);
  }
}

/**
 * The pause banner: the launch message during the choice of participants. Written after the banner's render, without
 * subscribing to `renderGamePause`: dnd5e only dresses up the banner (its emblem, its font) if it is the only subscriber to that
 * hook (`if ( Hooks.events.renderGamePause.length > 1 ) return;`) — one more subscriber, and the whole table permanently saw the
 * core's bare banner.
 */
function showLaunchCaption() {
  if ( !state().pending || !game.paused ) return;
  const caption = ui.pause?.element?.querySelector?.("figcaption");
  if ( caption ) caption.innerText = loc("Lancement.Pause");
}

/** Redraws the pause banner (the system's text comes back), then puts the launch message back on it if applicable. */
async function refreshPause() {
  try { await ui.pause?.render?.(); } catch { /* no banner on this client */ }
  showLaunchCaption();
}

export function registerCombatLaunch() {
  game.settings.register(MODULE_ID, LAUNCH_STATE, { scope: "world", config: false, type: Object, default: {},
    onChange: () => refreshPause() });
  game.settings.register(MODULE_ID, LAUNCH_BUTTON, {
    name: `DND5ECOMBAT.Reglage.${LAUNCH_BUTTON}.Nom`, hint: `DND5ECOMBAT.Reglage.${LAUNCH_BUTTON}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: () => ui.controls?.render?.({ reset: true })
  });
  game.settings.register(MODULE_ID, LAUNCH_PLAYLIST, { scope: "client", config: false, type: String, default: "" });
  // The pause set or lifted, and the client that (re)loads during the choice: the banner has just been redrawn by the core.
  for ( const hook of ["pauseGame", "ready"] ) {
    route(hook, () => { refreshPause(); }, { always: true, label: "combat launch: pause message not shown" });
  }
  // The wait only lifts when the window closes: a GM who reloads with the window open no longer has one, the pause and its message
  // would stay until the next launch. A state from before `by`: the active GM takes care of it.
  route("ready", () => {
    const { pending, by } = state();
    if ( pending && (by ? by === game.user.id : isExecutor()) ) return cancelLaunch();
  }, { label: "combat launch: pending launch not cleared" });
  route("updateCombatant", (combatant, changes) => {
    if ( !("initiative" in changes) ) return;
    const combat = combatant.combat;
    if ( state().combat !== combat?.id ) return;
    return followSummons(combat).then(() => startWhenReady(combat));
  }, { executor: true, label: "combat launch: initiative not followed" });
  route("updateToken", (token, changes) => {
    if ( !("x" in changes) && !("y" in changes) && !("hidden" in changes) && !("elevation" in changes) ) return;
    const combat = game.combats.get(state().combat ?? "");
    if ( combat?.scene?.id === token.parent?.id ) return revealSeen(combat);
  }, { executor: true, label: "combat launch: seen creature not shown" });
  route("deleteCombat", combat => {
    const s = state();
    if ( s.combat !== combat.id ) return;
    return restoreMusic(s.music).finally(() => setState({ combat: null, music: null }));
  }, { executor: true, label: "combat launch: music not restored" });
}

export const launchApi = Object.freeze({ candidates: launchCandidates, begin: beginLaunch, cancel: cancelLaunch, launch: launchCombat,
  /** Is a combat launch in progress (pause placed by `begin`, participants not yet chosen)? World setting, any client. */
  pending: () => !!state().pending });
