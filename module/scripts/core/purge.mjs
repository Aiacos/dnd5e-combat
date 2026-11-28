/**
 * Log purge (SPEC §58): which messages to delete, without Foundry.
 */

/**
 * Beyond `max` messages, the oldest to delete to get back to `keep` — except an action still open and its rolls.
 * A deleted use card takes its rolls with it (`origin`), even newer than the cut: nothing is left orphaned.
 * @param {{id: string, origin: string|null, open: boolean}[]} messages  From oldest to newest.
 * @param {{max: number, keep: number}} limits                           `max` ≤ 0: never.
 * @returns {string[]}  The ids to delete.
 */
export function planPurge(messages, { max, keep }) {
  if ( !(max > 0) || (messages.length <= max) ) return [];
  const cut = messages.length - Math.max(0, Math.min(keep, max));
  const open = new Set(messages.filter(m => m.open).map(m => m.id));
  const doomed = new Set();
  for ( const m of messages.slice(0, cut) ) {
    if ( open.has(m.id) || (m.origin && open.has(m.origin)) ) continue;
    doomed.add(m.id);
  }
  for ( const m of messages.slice(cut) ) if ( m.origin && doomed.has(m.origin) ) doomed.add(m.id);
  return messages.filter(m => doomed.has(m.id)).map(m => m.id);
}
