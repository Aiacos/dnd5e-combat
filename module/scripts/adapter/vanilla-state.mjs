/**
 * §395: "Cast without DAS" — an action goes through dnd5e alone, as during Theater of the Mind (§220), but for it alone and
 * everything that follows from it until its end (user decision, 2026-11-07).
 *
 * The marker is `flags["dnd5e-combat"].vanilla`: set on the use configuration by the caller, copied onto the use card,
 * the Concentration effect, the areas and the summoned creatures (runtime/vanilla.mjs). What follows from it is recognized
 * by the links dnd5e already keeps: a roll through the originating card (`system.origin`, `options.originatingMessage`), an
 * effect applied by the card (`system.origin.message`) or attached to a marked Concentration (`flags.dnd5e.dependentOn`).
 *
 * `flags["dnd5e-combat"].correction` (§396, "GM Correction" card) is skipped by the router, it alone: what the correction
 * applies (effects, Concentration) becomes DAS's business again.
 *
 * Without imports, like theater-state.mjs: the router reads it at each hook. The globals (`game`, `fromUuidSync`) are read
 * only at call time, and only when a link is to be followed: the file can be tested outside Foundry.
 */

const ID = "dnd5e-combat";

/** Duration during which an activity cast without DAS marks what it creates on this client (placed area, summon…). */
export const PENDING_MS = 120000;

/** activity or item uuid → deadline (ms). Local to the casting client: it is the one that creates the Concentration, area, summon. */
const pending = new Map();

/** Records that an activity (and its item) has just been cast without DAS on this client. */
export function markPending(uuids, now=Date.now()) {
  for ( const uuid of uuids ) if ( uuid ) pending.set(uuid, now + PENDING_MS);
}

/** An ordinary use of this activity / item: what it creates becomes DAS's business again. */
export function clearPending(uuids) {
  for ( const uuid of uuids ) pending.delete(uuid);
}

/** Was this activity or item cast without DAS a short while ago, on this client? */
export function isPending(uuid, now=Date.now()) {
  if ( !uuid || !pending.size ) return false;
  const until = pending.get(uuid);
  if ( until === undefined ) return false;
  if ( until < now ) { pending.delete(uuid); return false; }
  return true;
}

/** Clears the state (tests). */
export function resetVanilla() {
  pending.clear();
}

const flagsOf = x => x?.flags?.[ID] ?? x?._source?.flags?.[ID] ?? null;

/** Do the document or the data carry the "without DAS" marker? */
export function hasVanillaFlag(x) {
  return !!flagsOf(x)?.vanilla;
}

const lookupMessage = ref => {
  if ( !ref ) return null;
  if ( typeof ref === "object" ) return ref;
  if ( typeof ref !== "string" ) return null;
  const messages = globalThis.game?.messages;
  return messages?.get?.(ref) ?? (ref.includes(".") ? globalThis.fromUuidSync?.(ref, { strict: false }) ?? null : null);
};

const lookupUuid = uuid => ((typeof uuid === "string") ? globalThis.fromUuidSync?.(uuid, { strict: false }) ?? null : null);

/** Is this message, or the card it derives from (a damage roll of the use card), marked? */
function messageVanilla(ref) {
  const message = lookupMessage(ref);
  if ( !message ) return false;
  if ( hasVanillaFlag(message) ) return true;
  const origin = message.system?.origin;
  return !!origin && (typeof origin !== "object" || origin.documentName === "ChatMessage") && hasVanillaFlag(lookupMessage(origin));
}

/**
 * Does this document, these data or this configuration come from an action cast without DAS? Follows dnd5e's links to the
 * originating card or the Concentration (one level, no chain).
 */
export function isVanilla(x) {
  if ( !x || (typeof x !== "object") ) return false;
  if ( x[ID]?.vanilla ) return true;                       // configuration d'utilisation
  if ( hasVanillaFlag(x) ) return true;                    // marked document, creation data
  if ( hasVanillaFlag(x.data) ) return true;               // configuration de message (`data.flags`)
  if ( pending.size && (isPending(x.uuid) || isPending(x.subject?.uuid)) ) return true;   // activity in progress, roll config
  const system = x.system ?? x.data?.system ?? null;
  const origin = system?.origin;
  if ( origin ) {
    // Roll attached to its card (attack.mjs:69, damage.mjs:52: `system.origin` = message id; ChatMessage5e resolves it).
    if ( (typeof origin === "string") || (origin.documentName === "ChatMessage") ) {
      if ( messageVanilla(origin) ) return true;
    }
    // Effect applied by the card (effect-application.mjs:253: `system.origin.message`).
    else if ( origin.message && messageVanilla(origin.message) ) return true;
  }
  // A Roll (basic-roll.mjs:177), the options of applyDamage (chat-message.mjs:502: the damage message, derived from the card).
  const originating = x.options?.originatingMessage ?? x.originatingMessage;
  if ( originating && messageVanilla(originating) ) return true;
  const dependentOn = x.flags?.dnd5e?.dependentOn;   // effect attached to a Concentration (effect-application.mjs:247)
  if ( dependentOn && hasVanillaFlag(lookupUuid(dependentOn)) ) return true;
  return false;
}

/** Must the router stay silent for these hook arguments? The first four, and the first element of a list (of rolls). */
export function concernsVanilla(args) {
  const n = Math.min(args?.length ?? 0, 4);
  for ( let i = 0; i < n; i++ ) {
    const a = args[i];
    if ( Array.isArray(a) ) { if ( a.length && isVanilla(a[0]) ) return true; continue; }
    if ( isVanilla(a) ) return true;
    if ( flagsOf(a)?.correction ) return true;              // §396: the correction card itself
  }
  return false;
}
