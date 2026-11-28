/**
 * Log purge (SPEC §58): beyond `chatPurgeMax` messages (world setting, 0 = never), the active GM deletes the
 * oldest ones until only `chatPurgeKeep` remain. Permanent deletion — decided by the user on 2026-10-02.
 *
 * Never deleted: an action whose resolution is not closed (neither `done`, nor `missed`, nor `undone`), nor the rolls attached
 * to it (`system.origin`) — the engine still reads them. A deleted use card takes its native summaries with it
 * (documents/chat-message.mjs:625-635, `_preDeleteOperation`); its collapsed rolls (ui/compact.mjs) go with it here.
 */

import { MODULE_ID } from "../constants.mjs";
import { current, STEPS } from "../core/action.mjs";
import { planPurge } from "../core/purge.mjs";
import { route } from "./router.mjs";
import { log, isExecutor } from "./shared.mjs";

export const PURGE_MAX_SETTING = "chatPurgeMax";
export const PURGE_KEEP_SETTING = "chatPurgeKeep";

const CLOSED = new Set([STEPS.DONE, STEPS.MISSED, STEPS.UNDONE]);

let timer = null;
let running = false;

function setting(key) {
  try { return Math.max(0, Math.floor(Number(game.settings.get(MODULE_ID, key)) || 0)); } catch { return 0; }
}

/** The messages from oldest to newest, in the form core/purge.mjs reads. */
function entries() {
  return game.messages.contents.map(m => {
    const resolution = current(m.getFlag(MODULE_ID, "resolution"));
    return { id: m.id, origin: m._source.system?.origin ?? null, open: !!resolution && !CLOSED.has(resolution.step) };
  });
}

async function purge() {
  timer = null;
  if ( running || !isExecutor() ) return;
  const max = setting(PURGE_MAX_SETTING);
  const ids = planPurge(entries(), { max, keep: Math.min(setting(PURGE_KEEP_SETTING), max) });
  if ( !ids.length ) return;
  running = true;
  try {
    // In batches: a single operation of several hundred ids stays one request, but only one log render per batch.
    for ( let i = 0; i < ids.length; i += 100 ) {
      const batch = ids.slice(i, i + 100).filter(id => game.messages.has(id));
      if ( batch.length ) await ChatMessage.implementation.deleteDocuments(batch);
    }
    log(`chat log purged: ${ids.length} old message(s) deleted, ${game.messages.size} remaining`);
  } catch ( err ) {
    console.error(`${MODULE_ID} | chat log purge`, err);
  } finally { running = false; }
}

/** A purge at the end of a burst of messages, not during it. */
function schedule() {
  if ( setting(PURGE_MAX_SETTING) <= 0 ) return;
  if ( game.messages.size <= setting(PURGE_MAX_SETTING) ) return;
  if ( timer ) clearTimeout(timer);
  timer = setTimeout(purge, 3000);
}

export function registerPurge() {
  const world = (key, value) => game.settings.register(MODULE_ID, key, {
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`,
    scope: "world", config: true, type: Number, default: value, range: { min: 0, max: 2000, step: 50 }, onChange: schedule
  });
  world(PURGE_MAX_SETTING, 300);
  world(PURGE_KEEP_SETTING, 150);
  route("ready", schedule, { executor: true, label: "chat log purge on load" });
  route("createChatMessage", schedule, { executor: true, label: "chat log purge" });
}
