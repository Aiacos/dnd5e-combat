/**
 * What a request received from another client is allowed to ask (§471). A V14 core request (`User#query`) arrives with
 * its sender; its data is what that client sent. Pure rules:
 * runtime/cure.mjs and adapter/reactions.mjs apply them. A refusal here is about security, not a game rule: it cannot be forced
 * (the GM keeps their means, a request they send themselves goes through as is).
 */

/**
 * Must this request be checked? No for a local call (no sender: this client is making it), nor for oneself or a GM.
 * @param {{isGM?: boolean, isSelf?: boolean}|null|undefined} user  the sender, as the core passes it to the handler
 */
export const needsCheck = user => !!user && !user.isSelf && !user.isGM;

/**
 * A request that only the GM sends in the game (saving throw, Concentration, death saving throw…): from a player, it is dropped.
 * @param {{isGM?: boolean, isSelf?: boolean}|null|undefined} user
 */
export const fromTrusted = user => !needsCheck(user);

/**
 * Can the sender act for this document (do they own it)? Always yes for a local call, oneself or a GM.
 * @param {{isGM?: boolean, isSelf?: boolean}|null|undefined} user
 * @param {{testUserPermission?: Function}|null|undefined} doc  an actor, a token, an item…
 */
export const actsFor = (user, doc) => !needsCheck(user) || !!doc?.testUserPermission?.(user, "OWNER");

/**
 * The `cure` request: does the content rule of the item used allow this act on the target?
 * @param {object|null} entry  the content of the item of the use card (`contentOf(item).entry`)
 * @param {string} status      the act requested (`hp`, `temphp`, `curses`, `exhaustion`, `exhaustion-1`, `standReaction`, or a
 *   condition)
 * @param {*} value
 */
export function cureAllowed(entry, status, value=null) {
  if ( !entry ) return false;
  const ends = [...(entry.cures ?? []), ...(entry.curesAll ?? [])];
  switch ( status ) {
    case "hp": return !!(entry.healPool || entry.revivesFull);
    case "temphp": return !!(entry.healPool?.temp || entry.tempHpPool);
    case "curses": return Array.isArray(value) && (value.length > 0) && value.every(id => (entry.endsCurses ?? []).includes(id));
    case "exhaustion": return (entry.curesAll ?? []).includes("exhaustion");
    case "exhaustion-1": return ends.includes("exhaustion");
    case "standReaction": return !!entry.standsWithReaction;
    default: return (typeof status === "string") && ends.includes(status);
  }
}

/**
 * HP requested by another client: healing never wounds and never exceeds the maximum.
 * @param {*} value
 * @param {{current: number, max: number}} hp
 * @returns {number}
 */
export function healedHp(value, { current, max }) {
  const wanted = Number(value);
  if ( !Number.isFinite(wanted) ) return current;
  return Math.max(current, Math.min(max, Math.floor(wanted)));
}

/**
 * Temporary Hit Points requested by another client: positive, and at most `ceiling` when it is known (the rule's pool, the roll).
 * @param {*} value
 * @param {number} [ceiling]
 * @returns {number}
 */
export function grantedTempHp(value, ceiling=Infinity) {
  const wanted = Math.floor(Number(value));
  if ( !Number.isFinite(wanted) || (wanted <= 0) ) return 0;
  return Math.min(wanted, ceiling);
}

/**
 * What a Reaction option coming from another client can change about the use: only the forms the engine sends
 * itself — the level of a countered spell (`scaling`, runtime/gates.mjs), the already-paid readied spell (`spell.slot`,
 * `consume.spellSlot: false`, `readiedRelease`, adapter/ready.mjs), projected Aegis (`consume: false`). The rest is dropped.
 * @param {object} usage
 */
function plainUsage(usage) {
  if ( !usage || (typeof usage !== "object") ) return null;
  const out = {};
  if ( Number.isInteger(usage.scaling) && (usage.scaling >= 0) && (usage.scaling <= 9) ) out.scaling = usage.scaling;
  if ( /^(?:spell|pact)\d*$/.test(String(usage.spell?.slot ?? "")) ) out.spell = { slot: usage.spell.slot };
  if ( usage.consume?.spellSlot === false ) out.consume = { spellSlot: false };
  return Object.keys(out).length ? out : null;
}

/**
 * The `reaction` request coming from an untrusted client (`needsCheck`): the window is always posed (`auto` is
 * the GM's scenario tool), and each option keeps, of what changes the use, only the legitimate forms (`plainUsage`). What
 * depends on the documents (does the reactor have the activity, what `drop` removes) is rechecked on the receiver
 * (adapter/reactions.mjs).
 * @param {object} payload
 * @returns {object}
 */
export function plainReaction(payload) {
  const options = (Array.isArray(payload?.options) ? payload.options : []).map(o => {
    const { usage, flags, consume, ...rest } = o ?? {};
    const kept = { ...rest, usage: plainUsage(usage) };
    if ( consume === false ) kept.consume = false;
    if ( flags?.readiedRelease === true ) kept.flags = { readiedRelease: true };
    return kept;
  });
  return { ...payload, options, auto: false };
}
