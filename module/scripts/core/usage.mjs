/**
 * §68: use without a window — which spell slot to take when the one dnd5e proposes is empty.
 * Pure functions, no dependency on Foundry.
 */

/**
 * The slot to spend: the one dnd5e proposes if any is left, otherwise the lowest that still has one, of a level at least equal
 * to the spell's (pact slots included, at their level; at equal level, the ordinary slot first). null: none left.
 * @param {Record<string, {value: number, level: number}>} slots  The actor's slots (`system.spells`, keys `spell1`… `pact`).
 * @param {string} proposed  The key proposed by dnd5e (`usageConfig.spell.slot`).
 * @param {number} spellLevel  The spell's level.
 * @returns {string|null}
 */
export function pickSpellSlot(slots, proposed, spellLevel) {
  const has = key => (Number(slots?.[key]?.value) || 0) > 0;
  // §384: the proposed slot must also be high enough (a level 3 pact slot does not cast a level 6 spell —
  // dnd5e would "cast" it at level 3). A slot with no known level is taken as is.
  const highEnough = key => !Number(slots?.[key]?.level) || (Number(slots[key].level) >= spellLevel);
  if ( has(proposed) && highEnough(proposed) ) return proposed;
  const candidates = Object.entries(slots ?? {})
    .filter(([key, slot]) => /^(spell\d+|pact)$/.test(key) && has(key) && ((Number(slot.level) || 0) >= spellLevel))
    .sort(([ka, a], [kb, b]) => ((Number(a.level) || 0) - (Number(b.level) || 0)) || (Number(ka === "pact") - Number(kb === "pact")));
  return candidates[0]?.[0] ?? null;
}

/**
 * §384 (issue #38, continued): the slot of a spell the GM casts without a slot ("Cast anyway", §77). dnd5e sets the casting level
 * from the proposed slot (`_prepareUsageScaling`, documents/activity/mixin.mjs: `scaling` = slot level
 * − spell level) — a Warlock who only has level 3 pact slots "cast" Create Undead (level 6)
 * at level 3: 3 − 3 = 0 ghoul, "There must be at least one Token to be placed"; Summon Celestial at level 3, wrong spirit.
 * Returns the slot to set: the proposed one if it is at least of the spell's level, otherwise the one of the spell's level
 * (`spell<n>`, which always exists in `system.spells`, even at 0). Null for a cantrip or with no proposed slot.
 * @param {Record<string, {level: number}>} slots
 * @param {string|null} proposed
 * @param {number} spellLevel
 * @returns {string|null}
 */
export function forcedSpellSlot(slots, proposed, spellLevel) {
  if ( !(spellLevel > 0) || !proposed ) return null;
  const level = Number(slots?.[proposed]?.level) || 0;
  return (level >= spellLevel) ? proposed : `spell${spellLevel}`;
}

/**
 * §77: the consumptions of an activity that spend its OWN uses (`activityUses` without a target) when it has none,
 * when the item does carry some (Monster Manual 2024: the Dretch's "Fetid Cloud (1/Day)" — the charge is on the item): to be
 * read as the item's uses. The indexes of these consumptions.
 * @param {Array<{type: string, target?: string}>} targets  The activity's consumptions.
 * @param {boolean} activityHasUses  Does the activity have a maximum number of uses?
 * @param {boolean} itemHasUses  Does the item have a maximum number of uses?
 * @returns {number[]}
 */
export function misplacedSelfUses(targets, activityHasUses, itemHasUses) {
  if ( activityHasUses || !itemHasUses ) return [];
  return (targets ?? []).flatMap((t, i) => ((t?.type === "activityUses") && !t.target) ? [i] : []);
}

/**
 * §106: can the spell be cast higher than its level — is there a slot (pact included) of a higher level left?
 * That is then a real choice, which use without a window leaves to dnd5e's.
 * @param {Record<string, {value: number, level: number}>} slots  The actor's slots (`system.spells`).
 * @param {number} spellLevel  The spell's level.
 * @returns {boolean}
 */
export function canCastHigher(slots, spellLevel) {
  return Object.entries(slots ?? {}).some(([key, slot]) => /^(spell\d+|pact)$/.test(key)
    && ((Number(slot?.value) || 0) > 0) && ((Number(slot?.level) || 0) > spellLevel));
}

/**
 * §404: the activity at the level the spell was cast at. dnd5e records the slot upcast on the use message
 * (`system.scaling`, documents/activity/mixin.mjs: `data.system.scaling`) and replays it before each button of the card by
 * cloning the item (`Activity#onChatAction`: `flags.dnd5e.scaling`), or via `Item5e#scaledClone`
 * (`ChatMessage5e#getAssociatedActivity({ scaled })`).
 * An activity re-read by its uuid is the sheet's, at base level: its "Using a Higher-Level Spell Slot" dice are missing.
 * Returns the scaled copy (same activity id), or the activity as is without upcast or without `scaledClone`.
 * @param {object|null} activity  An activity (`item.scaledClone(n).system.activities.get(id)`).
 * @param {number|string|null} scaling  The slot upcast (casting level − spell level).
 * @returns {object|null}
 */
export function atCastLevel(activity, scaling) {
  const increase = Math.max(0, Math.trunc(Number(scaling) || 0));
  if ( !activity || !increase || (typeof activity.item?.scaledClone !== "function") ) return activity;
  return activity.item.scaledClone(increase)?.system?.activities?.get?.(activity.id) ?? activity;
}

/**
 * §405: the level of an activity of a spell that does not spend a slot — the attack of Flame Blade (only "Evoke Blade"
 * spends one), the Bonus Action damage of Witch Bolt. dnd5e records the casting level on the concentration effect
 * (`beginConcentrating(activity, { "flags.dnd5e.scaling": … })`, documents/activity/mixin.mjs), but a following use
 * recalculates it from the proposed slot, that of the spell's level (`_prepareUsageConfig` then `_prepareUsageScaling`): the
 * upcast falls back to 0. Returns `{ scaling, slot }` to put in the use configuration, or null (level 0 spell, activity that
 * spends a slot, upcast already set by the caller, no upcast concentration).
 * @param {{spellLevel: number, consumesSlot: boolean, scaling?: number|boolean, concentrationScaling?: number}} data
 * @returns {{scaling: number, slot: string}|null}
 */
export function followUpScaling({ spellLevel, consumesSlot, scaling, concentrationScaling }) {
  const level = Math.trunc(Number(spellLevel) || 0);
  const increase = Math.trunc(Number(concentrationScaling) || 0);
  if ( (level <= 0) || consumesSlot || (Number(scaling) > 0) || (increase <= 0) ) return null;
  return { scaling: increase, slot: `spell${level + increase}` };
}

/**
 * §406: the use configuration that replays an activity of a spell at the level it was cast at, spending nothing more —
 * for the engine that replays an activity later (the explosion of a Delayed Blast Fireball when its area ends, `zoneEnd`; a
 * `casterPulse` pulse that uses an activity). dnd5e recalculates the upcast from the proposed slot (`_prepareUsageScaling`,
 * §405): both must be given. Returns `{}` for a level 0 spell or one without upcast.
 * @param {number} spellLevel  The spell's level (`item.system.level`).
 * @param {number|string|null} scaling  The upcast of the original use message (`system.scaling`).
 * @returns {{scaling?: number, spell?: {slot: string}}}
 */
export function castLevelUsage(spellLevel, scaling) {
  const level = Math.trunc(Number(spellLevel) || 0);
  const increase = Math.max(0, Math.trunc(Number(scaling) || 0));
  if ( (level <= 0) || !increase ) return {};
  return { scaling: increase, spell: { slot: `spell${level + increase}` } };
}

/**
 * §406: the level a spell is cast at, read from the item (a scaled copy: `item.scaledClone(n)`,
 * `getAssociatedActivity({ scaled: true })`) — `system.level` plus `flags.dnd5e.scaling`. `system.level` alone stays the spell's
 * level (dnd5e.mjs:35309; the formulas' `@item.level` adds the upcast, dnd5e.mjs:34568). 0 without an item.
 * @param {object|null} item
 * @returns {number}
 */
export function spellCastLevel(item) {
  return (Number(item?.system?.level) || 0) + Math.max(0, Number(item?.flags?.dnd5e?.scaling) || 0);
}
