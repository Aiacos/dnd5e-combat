/**
 * §252 — action feedback for the whole table (DAS rules of 2026-10-27): floating text seen by everyone and a sound heard by
 * everyone. Here, without Foundry: the default sound of each action and of its outcome, and what travels from one client to
 * another. The sounds are those that the Foundry core ships (public/sounds/…), present on every installation; a neighbouring
 * module replaces them via the public hook `dnd5e-combat.feedback` (runtime/shared.mjs, `notice`).
 */

/** The Foundry core sounds used by the engine. */
export const CORE_SOUNDS = Object.freeze({
  unlock: "sounds/doors/metal/unlock.ogg",
  locked: "sounds/doors/metal/lock.ogg",
  tools: "sounds/doors/metal/test.ogg",
  burst: "sounds/doors/wood/open-heavy.ogg",
  thud: "sounds/doors/wood/close-heavy.ogg",
  shut: "sounds/doors/shutter/close.ogg",
  rattle: "sounds/doors/jail/test.ogg",
  chime: "sounds/doors/magic/unlock.ogg",
  dull: "sounds/doors/wood/lock.ogg",
  fade: "sounds/doors/magic/lock.ogg",
  // §282: Heroic Inspiration used — an epic drum beat.
  heroicHit: "sounds/combat/epic-turn-1hit.ogg",
  // §290: the GM forces a player's response.
  nextHorn: "sounds/combat/epic-next-horn.ogg",
  // Issue #32: a success at an accepted cost — two drum beats.
  atCost: "sounds/combat/epic-turn-2hit.ogg"
});

/** The default sound of an action (`action`) by its outcome (`success`, `failure`), or null. */
const DEFAULTS = Object.freeze({
  pick: { success: CORE_SOUNDS.unlock, failure: CORE_SOUNDS.locked },
  force: { success: CORE_SOUNDS.burst, failure: CORE_SOUNDS.thud },
  key: { success: CORE_SOUNDS.unlock, failure: CORE_SOUNDS.locked },
  hide: { success: CORE_SOUNDS.shut, failure: CORE_SOUNDS.dull },
  search: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  escape: { success: CORE_SOUNDS.rattle, failure: CORE_SOUNDS.dull },
  firstAid: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  land: { success: null, failure: CORE_SOUNDS.thud },
  // §282: Heroic Inspiration spent (a die rerolled), then received.
  heroic: { success: CORE_SOUNDS.heroicHit, failure: null },
  // §258: a spell or an effect that ends (generic endings, runtime/endings.mjs).
  spellEnds: { success: CORE_SOUNDS.fade, failure: null },
  // §283: a spell that fails under Slow.
  spellFails: { success: null, failure: CORE_SOUNDS.fade },
  // §285: an imposed behaviour (panic, Confusion, Crown of Madness); upkeep of a spell by the Magic action.
  control: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  upkeep: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.fade },
  // §290: a player's response forced by the GM (combat windows with no delay).
  forced: { success: CORE_SOUNDS.nextHorn, failure: null },
  // §408: a rule overridden by a player (the table hears it).
  overridden: { success: CORE_SOUNDS.nextHorn, failure: null },
  // Issue #32: the success at an accepted cost (declined: nothing).
  atCost: { success: CORE_SOUNDS.atCost, failure: null },
  // §461: a self-teleport done (Misty Step, a demon's Teleportation).
  teleport: { success: CORE_SOUNDS.chime, failure: null },
  // B09 (§488): an attempt to change shape that a worn item forbids (the collar tightens).
  formLock: { success: null, failure: CORE_SOUNDS.rattle },
  // §489: a Parry that forces the attack to be rerolled — the metal that blocks (the hit misses), the dull thud (it lands anyway).
  reroll: { success: CORE_SOUNDS.tools, failure: CORE_SOUNDS.dull },
  // §490 (B08): mounting, dismounting, being thrown off one's mount, the command to a companion.
  mount: { success: CORE_SOUNDS.dull, failure: null },
  dismount: { success: CORE_SOUNDS.dull, failure: null },
  thrown: { success: null, failure: CORE_SOUNDS.thud },
  command: { success: CORE_SOUNDS.chime, failure: null },
  // §493 (B13): a reaction against an area ("Insect Shield") — the creature spared (chime), or the damage that goes through.
  areaShield: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  // §494 (B14): several Concentrations lost at once (failed roll, Incapacitated).
  concentrationLost: { success: null, failure: CORE_SOUNDS.fade },
  // §495 (B15): a condition ladder — the creature recovers a step (chime), or sinks a step (dull thud).
  stage: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  // §496 (B16): a spell kept against a dispelling, by the Reaction and a slot.
  dispelKept: { success: CORE_SOUNDS.chime, failure: null },
  // §502 (B22): a creature released because the item grabs only one at a time (the rattle of the escape).
  grappleReleased: { success: CORE_SOUNDS.rattle, failure: null },
  // §501 (B21): a single reaction lost instead of all of them ("it loses only one reaction").
  reactionLost: { success: null, failure: CORE_SOUNDS.dull },
  // §500 (B20): a creature killed by a drain (maximum HP or ability score brought to 0) — the dull blow.
  drainDeath: { success: CORE_SOUNDS.thud, failure: null },
  // §499 (B19): damage sent back to the attacker (the dull blow).
  damageReturned: { success: CORE_SOUNDS.thud, failure: null },
  // §498 (B18): a change of shape at will (chime), and the return to the original shape (the sound that fades).
  formChange: { success: CORE_SOUNDS.chime, failure: null },
  formRevert: { success: CORE_SOUNDS.fade, failure: null },
  // Issue #31: a healing potion drunk as an action — maximum healing.
  potionMax: { success: CORE_SOUNDS.chime, failure: null },
  // §537 : a standing weapon mastery chosen (Tactical Master).
  standingMastery: { success: CORE_SOUNDS.tools, failure: null }
});

/** The default sound for this action and this outcome (null: none). */
export function actionSound(action, outcome) {
  return DEFAULTS[action]?.[outcome] ?? null;
}

/**
 * A notice text: an already translated string, or `{ key, data }`, translated at each client (its language may differ from
 * that of whoever acts). `localize(key, data)` is the client's translation.
 */
export function noticeText(text, localize) {
  if ( !text ) return "";
  if ( typeof text === "string" ) return text;
  return text.key ? localize(text.key, text.data) : "";
}
