/**
 * Which activity to use when dnd5e asks "which one?" (SPEC §42.1). An item with several activities opens dnd5e's activity
 * choice on every use; often this choice is no choice at all — a single activity is cast, the others are follow-ups that the
 * engine plays itself (the cold damage of Armor of Agathys, the save of Sanctuary), or the answer is a fact (Toll the Dead:
 * is the target wounded?). Here, the decision, without Foundry; null = leave the question.
 *
 * We answer in the player's place only for an item the engine knows (`known`): for a spell it does not play, the
 * window stays the way to reach its follow-ups by hand.
 */

/**
 * @param {object} query
 * @param {{id: string, timed: boolean, slot: boolean}[]} query.activities  The activities the window offers. `timed`: it
 *   has a casting time (action, Bonus Action, reaction, minute…) — a follow-up triggered by the engine has none;
 *   `slot`: it spends the spell slot; `free`: it casts the spell without a slot on uses that remain
 *   (the "Free Casting" of Magic Initiate, of a feat or of a species).
 * @param {number} [query.level]      Level of the spell (0: cantrip, or not a spell).
 * @param {boolean} [query.known]     The engine has a rule for this item.
 * @param {boolean} [query.running]   The spell is already ongoing for this caster (Concentration, effect applied).
 * @param {{healthy: string, wounded: string}|null} [query.byWounds]  Toll the Dead: the activity according to the target's HP.
 * @param {boolean} [query.wounded]   The designated targets are all wounded.
 * @param {boolean} [query.slotLeft]  The caster still has a slot of the spell's level or higher (§230: no longer decides
 *   free casting, kept for the callers).
 * @returns {string|null}  The identifier of the activity to use, or null: the question stays asked.
 */
export function activityToUse({ activities=[], level=0, known=false, running=false, byWounds=null, wounded=false, entry=null,
  slotLeft=true }={}) {
  const has = id => activities.some(a => a.id === id);
  // §45: the item itself designates the activity that is cast (Swallow / Engulf: the one that swallows; the damage each turn and
  // the exit of the corpse are played by the engine).
  if ( entry && has(entry) ) return entry;
  // §46: an attack, the only activity of the item that costs an action (action, Bonus Action, reaction…), whose others are only
  // follow-ups — the save that the hit imposes ("Ghoul's Claw": the engine chains it, §18.4), an escape
  // check, separate damage. Holds for any item, known to the engine or not: the follow-ups stay in the list of the
  // sheet's activities.
  const costly = activities.filter(a => a.cost);
  if ( (costly.length === 1) && (costly[0].type === "attack") ) return costly[0].id;
  if ( byWounds ) {
    const wanted = wounded ? byWounds.wounded : byWounds.healthy;
    return has(wanted) ? wanted : (has(byWounds.healthy) ? byWounds.healthy : null);
  }
  if ( !known ) return null;
  const timed = activities.filter(a => a.timed);
  // §127: a free casting that remains (Magic Initiate…) — the Sleep of a level 1 Monk went to the slot they
  // do not have. §230 (table feedback, "Faithful Steed": "always consumes a spell even the first time"): the free casting
  // first, remaining slots or not; several free castings, the player chooses. The slot stays reachable through
  // the sheet's activity list (and dnd5e's Shift + click, which takes the first activity).
  const free = activities.filter(a => a.free);   // dnd5e's "forward": with no casting time of its own
  if ( free.length && !running && (level > 0) ) return (free.length === 1) ? free[0].id : null;
  // A single activity is cast: the others are follow-ups.
  if ( timed.length === 1 ) return timed[0].id;
  // A slotted spell not yet cast: the casting is the only one to spend the slot, the others (moving the
  // mark, heating the metal, the Bonus Action damage) only make sense once the spell is ongoing — there, we ask.
  if ( running || !(level > 0) ) return null;
  const casts = timed.filter(a => a.slot);
  return (casts.length === 1) ? casts[0].id : null;
}
