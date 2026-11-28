/**
 * §113: the aids offered to a skill or tool check, BG3 style — 2024 rules.
 *  - Guidance (`guidance`, cantrip, touch, Concentration): "you touch a willing creature and choose a
 *    skill; until the spell ends, it adds 1d4 to any ability check using that skill". The checker
 *    themselves if they know the spell, or an ally in touch — at 7.50 m out of combat (`GUIDANCE_REACH`). Not for a tool check
 *    ("a skill").
 *  - Help, check part: "choose one of your skill or tool proficiencies and an ally close enough to
 *    help you; they have Advantage on their next check with that skill or tool". An ally, never oneself.
 *  - Bardic Inspiration (`bardic-inspiration`, Bonus Action, 60 ft in the data): "another creature" — a Bard ally who still
 *    has a use, within the activity's range; not if the checker already carries an inspiration. The die is rolled AFTER the check,
 *    if it is missed ("when the creature fails a D20 Test"): runtime/roll-bonus.mjs offers it.
 *
 * In combat as out of combat; only Guidance's range changes (user's request, 2026-10-08). No dependency on Foundry.
 */

/** "Close enough to help" (Help): 1.50 m, the neighbouring cell (rule constant, converted by the caller). */
export const AID_REACH = Object.freeze({ value: 5, units: "ft" });

/**
 * Guidance offered from the check window, OUT OF COMBAT: the touch multiplied by five, 7.50 m — flexibility requested by
 * the user (2026-10-08): the ally takes the few steps to touch the checker. In combat, the touch (`AID_REACH`).
 */
export const GUIDANCE_REACH = Object.freeze({ value: AID_REACH.value * 5, units: AID_REACH.units });

/**
 * @param {object} args
 * @param {string|null} [args.skill]      The skill checked.
 * @param {string|null} [args.tool]       The tool checked.
 * @param {boolean} [args.inCombat]       The checker is in a combat that has started.
 * @param {boolean} [args.guided]         The checker already has a Guidance on this skill.
 * @param {boolean} [args.inspired]       The checker already carries a Bardic Inspiration.
 * @param {Array<{id: string, self?: boolean, inReach: boolean, inGuidanceReach?: boolean, able: boolean, knowsGuidance?: boolean,
 *   canCast?: boolean, proficient?: boolean, inspires?: boolean, inInspirationReach?: boolean}>} [args.candidates]
 *   The checker (`self`) and their allies: within reach of Help (`AID_REACH`) and Guidance (`GUIDANCE_REACH`), able
 *   to act (not Incapacitated), knows Guidance, can cast a spell with a verbal component, is proficient in the skill or tool,
 *   can give a Bardic Inspiration and the checker is within their reach.
 * @returns {Array<{kind: "guidance"|"inspiration"|"help", helper: string}>}  Guidance, Inspiration, Help; the checker first.
 */
export function skillAids({ skill=null, tool=null, inCombat=false, guided=false, inspired=false, candidates=[] }={}) {
  if ( !skill && !tool ) return [];
  const guidanceReach = c => (inCombat ? c.inReach : (c.inGuidanceReach ?? c.inReach));
  const ordered = [...candidates.filter(c => c.self), ...candidates.filter(c => !c.self)];
  const out = [];
  if ( skill && !guided ) {
    for ( const c of ordered ) {
      if ( c.knowsGuidance && (c.canCast !== false) && guidanceReach(c) && c.able ) out.push({ kind: "guidance", helper: c.id });
    }
  }
  if ( !inspired ) {
    for ( const c of ordered ) {
      if ( !c.self && c.inspires && c.inInspirationReach && c.able ) out.push({ kind: "inspiration", helper: c.id });
    }
  }
  for ( const c of ordered ) {
    if ( !c.self && c.proficient && c.inReach && c.able ) out.push({ kind: "help", helper: c.id });
  }
  return out;
}
