/**
 * §113: what the creatures of the scene can contribute to an actor's skill or tool check — Guidance (the spell
 * `guidance`, actually cast by its caster), Bardic Inspiration (given by an allied bard) and Help (Advantage). The rule is in
 * core/skill-aid.mjs; here, the reading of the sheets and the tokens.
 */

import { AID_REACH, GUIDANCE_REACH, skillAids } from "../core/skill-aid.mjs";
import { INCAPACITATING, verbalSpellBlocked } from "../core/conditions.mjs";
import { isWithinRange } from "../core/units.mjs";
import { identifierOf } from "./content.mjs";
import { originItemOf, tokenOf } from "./facts.mjs";
import { combatantFor, distanceBetween, rangeOf } from "./turn.mjs";
import { inspirationOf, inspirationSourceOf } from "./inspiration.mjs";
import { isObjectToken } from "./bodies.mjs";
import { readUnitFactors } from "./units.mjs";
import { areAllies } from "./factions.mjs";

export const GUIDANCE = "guidance";

/** Range of Bardic Inspiration when the data says nothing measurable about it: 18 m (2024 rules). */
const INSPIRATION_REACH = Object.freeze({ value: 60, units: "ft" });

/** The range of the bard's Inspiration activity, convertible; 18 m by default. */
function inspirationReach(activity, factors) {
  const r = activity ? rangeOf(activity) : null;
  return ((Number(r?.value) > 0) && Number.isFinite(factors[r.units])) ? { value: Number(r.value), units: r.units } : INSPIRATION_REACH;
}

/** The Guidance spell on the sheet, or null. A scroll does not count: it is used up, so it is not offered by default. */
export function guidanceSpellOf(actor) {
  return actor?.items?.find(i => (i.type === "spell") && (identifierOf(i).id === GUIDANCE) && (identifierOf(i).from !== "scroll")) ?? null;
}

/** The activity of the spell that places a skill's effect (dnd5e's utility carries its 18 effects), and the id of that effect. */
export function guidanceEffectFor(spell, skill) {
  for ( const activity of spell?.system?.activities ?? [] ) {
    for ( const { _id } of activity.effects ?? [] ) {
      const effect = spell.effects.get(_id);
      const changes = effect?.system?.changes ?? effect?.changes ?? [];
      if ( changes.some(c => String(c.key ?? "").startsWith(`system.skills.${skill}.`)) ) return { activity, effectId: _id };
    }
  }
  return null;
}

/** Does the actor already have a Guidance on this skill? */
export function isGuided(actor, skill) {
  return Array.from(actor?.appliedEffects ?? []).some(effect => {
    if ( effect.disabled || effect.isSuppressed ) return false;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== GUIDANCE) ) return false;
    return (effect.system?.changes ?? effect.changes ?? []).some(c => String(c.key ?? "").startsWith(`system.skills.${skill}.`));
  });
}

const statusesOf = actor => Array.from(actor?.statuses ?? []);
const proficientIn = (actor, { skill, tool }) => skill ? (Number(actor?.system?.skills?.[skill]?.value) >= 1)
  : (Number(actor?.system?.tools?.[tool]?.value) >= 1);

/**
 * The possible aids to `actor`'s check, with what is needed to offer them.
 * @param {Actor} actor
 * @param {{skill?: string|null, tool?: string|null}} test
 * @returns {Array<{kind: "guidance"|"inspiration"|"help", helper: Actor, token: TokenDocument, self: boolean,
 *   tester: TokenDocument, formula?: string}>}  `formula`: a Bardic Inspiration die.
 */
export function aidsFor(actor, { skill=null, tool=null }={}) {
  const token = tokenOf(actor);
  const scene = token?.parent;
  if ( !token || !scene || (!skill && !tool) ) return [];
  const factors = readUnitFactors();
  const reachOf = (other, reach) => {
    if ( other === token ) return true;
    try { return isWithinRange(distanceBetween(token, other), reach, factors); }
    catch { return false; }
  };
  const tokens = scene.tokens.filter(t => t.actor && !isObjectToken(t) && ((t === token) || areAllies(t, token)));
  const byId = new Map(tokens.map(t => [t.id, t]));
  const sources = new Map(tokens.map(t => [t.id, inspirationSourceOf(t.actor)]));
  const candidates = tokens.map(t => {
    const statuses = statusesOf(t.actor);
    const source = sources.get(t.id);
    return {
      id: t.id, self: t === token, inReach: reachOf(t, AID_REACH), inGuidanceReach: reachOf(t, GUIDANCE_REACH),
      able: !INCAPACITATING.some(s => statuses.includes(s)),
      knowsGuidance: !!guidanceSpellOf(t.actor),
      canCast: !verbalSpellBlocked(statuses, { spell: true, verbal: true }),
      proficient: proficientIn(t.actor, { skill, tool }),
      inspires: !!source, inInspirationReach: !!source && reachOf(t, inspirationReach(source.activity, factors))
    };
  });
  const aids = skillAids({ skill, tool, inCombat: !!combatantFor(actor), guided: !!skill && isGuided(actor, skill),
    inspired: !!inspirationOf(actor), candidates });
  return aids.map(a => {
    const t = byId.get(a.helper);
    const formula = (a.kind === "inspiration") ? sources.get(t.id)?.formula : undefined;
    return { kind: a.kind, helper: t.actor, token: t, self: t === token, tester: token, ...(formula ? { formula } : {}) };
  });
}
