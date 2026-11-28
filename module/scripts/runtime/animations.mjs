/**
 * §112: applying a resolution (damage, healing, effects) waits for the end of the animation that shows it — session
 * feedback (2026-10-08): HP dropped at the projectile's launch in BLFX, not at its arrival.
 *
 * BLFX (Boss Loot) does not announce the end of its animations, but plays them through Sequencer, which does so on each client:
 * `createSequencerEffect` on playback and `endedSequencerEffect` at the end (sequencer.js 4.2.3: 15468, 15485; the effect
 * carries `sourceDocument` / `targetDocument`, 14889-14958, and `data.persist`). BLFX launches the animation after the 3D dice,
 * like the engine (helperFunctions.js:1711-1733, `waitForDiceSoNiceRoll`): both started together.
 *
 * Before applying (`apply` command, runtime/engine.mjs), on the active GM: if Sequencer is there, we watch for a short moment
 * for an animation that starts from the author or arrives on a target (core/animations.mjs), then wait for its end — bounded by
 * the `animationWait` setting (seconds). Nothing to wait for: we apply at once. Window without rendering (hidden tab, minimized):
 * no animation plays there, we do not wait.
 */

import { MODULE_ID } from "../constants.mjs";
import { relevantAnimations } from "../core/animations.mjs";
import { route } from "./router.mjs";
import { log, sleep } from "./shared.mjs";

export const SYNC_SETTING = "syncAnimations";
export const WAIT_SETTING = "animationWait";

/** The time given to BLFX to launch its animation, after the dice (it waits for the same dice as the engine). */
const LOOK_MS = 600;

/** id → { id, source, target, persist, started, ended, done: Promise } */
const live = new Map();

/** Survey of the latest animation starts and waits (for `api.mcp.animations`, scenarios). */
const journal = [];
function note(entry) {
  journal.push({ ...entry, at: Date.now() });
  if ( journal.length > 40 ) journal.shift();
}

/** The tracked animations and the recent survey (test). */
export function animationState() {
  return { live: [...live.values()].map(({ done, resolve, ...e }) => e), journal: [...journal] };
}

const docUuid = doc => (doc?.uuid ?? null);

function onCreate(effect) {
  if ( !effect?.id ) return;
  let resolve;
  const done = new Promise(r => { resolve = r; });
  let source = null, target = null;
  try { source = docUuid(effect.sourceDocument); } catch {}
  try { target = docUuid(effect.targetDocument); } catch {}
  live.set(effect.id, { id: effect.id, source, target, persist: !!effect.data?.persist, started: Date.now(), ended: false, done, resolve });
  note({ kind: "start", id: effect.id, source, target, persist: !!effect.data?.persist });
}

function onEnded(effect) {
  const entry = live.get(effect?.id);
  if ( !entry ) return;
  entry.ended = true;
  entry.resolve();
  live.delete(effect.id);
}

const sequencerActive = () => !!game.modules.get("sequencer")?.active;

/**
 * Wait for the end of the animations of these tokens (author, targets) before applying.
 * Returns the time waited (ms), 0 without a wait.
 * @param {Array<string|null|undefined>} uuids
 * @returns {Promise<number>}
 */
export async function waitForAnimations(uuids) {
  if ( !game.settings.get(MODULE_ID, SYNC_SETTING) || !sequencerActive() || (document.hidden === true) ) { note({ kind: "skip", hidden: document.hidden === true }); return 0; }
  const maxMs = Math.max(0, Number(game.settings.get(MODULE_ID, WAIT_SETTING)) || 0) * 1000;
  if ( !maxMs ) return 0;
  const t0 = Date.now();
  let ids = relevantAnimations([...live.values()], uuids, Date.now());
  // BLFX may not have launched its own yet: we watch for it for a short moment.
  while ( !ids.length && ((Date.now() - t0) < LOOK_MS) ) {
    await sleep(50);
    ids = relevantAnimations([...live.values()], uuids, Date.now());
  }
  if ( !ids.length ) { note({ kind: "none", uuids: uuids.filter(Boolean) }); return 0; }
  const pending = ids.map(id => live.get(id)?.done).filter(Boolean);
  const left = Math.max(0, maxMs - (Date.now() - t0));
  const outcome = await Promise.race([Promise.all(pending).then(() => "done"), sleep(left).then(() => "late")]);
  const waited = Date.now() - t0;
  note({ kind: "waited", ids, ms: waited, late: outcome === "late" });
  log(`animations: ${ids.length} awaited, ${waited} ms${outcome === "late" ? " (maximum wait reached)" : ""}`);
  return waited;
}

export function registerAnimations() {
  game.settings.register(MODULE_ID, SYNC_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SYNC_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SYNC_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, WAIT_SETTING, {
    name: `DND5ECOMBAT.Reglage.${WAIT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${WAIT_SETTING}.Aide`,
    scope: "world", config: true, type: Number, default: 3, range: { min: 1, max: 10, step: 0.5 }
  });
  route("createSequencerEffect", onCreate, { label: "animations: start (Sequencer)" });
  route("endedSequencerEffect", onEnded, { label: "animations: end (Sequencer)" });
}
