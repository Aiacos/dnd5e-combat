/**
 * The hit chance read from Foundry for the core (core/hitchance.mjs, SPEC §15.3): what the dnd5e
 * attack roll would do, without rolling it.
 *
 *  - bonus: `AttackActivityData#getAttackData` (data/activity/attack-data.mjs:274), the very one
 *    the roll uses (documents/activity/attack.mjs:258), with the attack mode, the
 *    ability and the ammunition that the roll would pick (last choices remembered on the item,
 *    attack.mjs:92-117). The bonus dice (Bless) are read term by term;
 *  - Advantage, Disadvantage: those of the system (`D20RollModificationField.combineFields`, the
 *    same fields as attack.mjs:121-124 — Poisoned, Active Effects, applied rules) plus
 *    those of the engine (adapter/conditions.mjs, the same as at the roll); both at once = normal roll;
 *  - critical threshold: `criticalThreshold` of the activity (attack-data.mjs:130);
 *  - AC: the one that dnd5e writes on the roll (`attributes.ac.value`), plus the engine's Cover
 *    (adapter/cover.mjs), as at the verdict (runtime/engine.mjs); a Cover condition set by hand is
 *    already in the AC.
 *
 * Not included: Lucky (Halfling), Elven Accuracy, Reactions of the
 * target (Shield).
 */

import { hitChance, saveFailChance } from "../core/hitchance.mjs";
import { attackModifiers, netMode, isAutoCritical, autoFailSave } from "../core/conditions.mjs";
import { saveAdvantageAgainst, fightingAdvantageFor, sizeAdvantageFor, bestSaveAbility } from "./saves.mjs";
import { critMargin } from "./criticals.mjs";
import { conditionImmunitiesOf } from "./facts.mjs";
import { attackContext, coverAgainst } from "./conditions.mjs";
import { rangedAcBonus } from "./defenses.mjs";
import { coverFor } from "./cover.mjs";
import { readUnitFactors } from "./units.mjs";
import { effectOfProfile } from "./usage.mjs";
import { ammoState } from "./ammo.mjs";

/**
 * A formula's bonus, split into a flat part and dice. null if the formula has anything other than a
 * sum of numbers and simple dice (multiplication, modified dice…).
 * @returns {{flat: number, dice: Array<{number: number, faces: number, sign: 1|-1}>}|null}
 */
export function splitBonus(formula, data) {
  const { Die, NumericTerm, OperatorTerm } = foundry.dice.terms;
  let roll;
  try { roll = new Roll(formula || "0", data); }
  catch { return null; }
  let flat = 0;
  const dice = [];
  let sign = 1;
  for ( const term of roll.terms ) {
    if ( term instanceof OperatorTerm ) {
      if ( term.operator === "-" ) sign = -sign;
      else if ( term.operator !== "+" ) return null;
      continue;
    }
    if ( term instanceof Die ) {
      if ( term.modifiers?.length || !Number.isInteger(term.number) || !Number.isInteger(term.faces) ) return null;
      dice.push({ number: term.number, faces: term.faces, sign });
    }
    else if ( term instanceof NumericTerm ) flat += sign * term.number;
    else if ( term.isDeterministic ) {
      try { flat += sign * new Roll(term.formula).evaluateSync().total; }
      catch { return null; }
    }
    else return null;
    sign = 1;
  }
  return { flat, dice };
}

/** The attack mode, the ability and the ammunition that the roll would pick. */
function rollChoices(activity, attackMode=null) {
  const item = activity.item;
  const last = item.getFlag?.("dnd5e", `last.${activity.id}`) ?? {};
  const modes = item.system.attackModes ?? [];
  const mode = attackMode ?? (modes.find(m => m.value === last.attackMode) ? last.attackMode : modes[0]?.value);
  const ammunition = ammoState(item, activity)?.current;   // §274 : celle que le jet tirera
  return { attackMode: mode ?? null, ability: last.ability, ammunition: ammunition || undefined };
}

/**
 * Chance that an attack hits a target.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity           An attack activity.
 * @param {object} [options]
 * @param {string|null} [options.attackMode]
 * @param {object} [options.posA]       The attacker's position at the end of their approach.
 * @param {{advantage?: boolean, disadvantage?: boolean}} [options.keys]  dnd5e's Advantage and
 *   Disadvantage keys (Alt / Ctrl by default), which the system adds to the roll (dice/d20-roll.mjs:83-84).
 * @returns {{hit: number, critical: number, ac: number|null, baseAc: number|null, cover: object|null,
 *            mode: 1|0|-1, advantage: object[], disadvantage: object[], system: {advantage: boolean, disadvantage: boolean}}|null}
 *   null: not an attack, or nothing certain enough to display.
 */
export function hitChanceOf(attacker, target, activity, { attackMode=null, posA, keys={} }={}) {
  if ( (activity?.type !== "attack") || !attacker?.actor || !target?.actor ) return null;
  const baseAc = target.actor.system.attributes?.ac?.value;
  if ( !Number.isFinite(baseAc) ) return null;

  const choices = rollChoices(activity, attackMode);
  const { data, parts } = activity.getAttackData(choices);
  const bonus = splitBonus(parts.join(" + "), data);
  if ( !bonus ) return null;

  const actor = activity.actor;
  const rollData = activity.getRollData({ roll: { ability: choices.ability, attackMode: choices.attackMode } });
  const Field = dnd5e.dataModels.shared.D20RollModificationField;
  const system = Field.combineFields(actor.system, [
    `abilities.${rollData.roll.ability}.attack.roll`, "rolls.attack", `rolls.attack.${activity.getActionType(choices.attackMode)}`
  ], { rules: { category: "attack", actor, item: activity.item, rollData } });

  const factors = readUnitFactors();
  const context = attackContext(attacker, target, activity, choices.attackMode, factors, { posA });
  const ours = attackModifiers(context);
  const advantage = !!system.advantage || !!keys.advantage || (ours.advantage.length > 0);
  const disadvantage = !!system.disadvantage || !!keys.disadvantage || (ours.disadvantage.length > 0);
  const mode = netMode({ advantage: advantage ? [1] : [], disadvantage: disadvantage ? [1] : [] });

  const cover = coverAgainst(attacker, target, activity, choices.attackMode, { posA, quiet: true,
    seenOnly: !game.user?.isGM });   // §131; #33: a player only counts the creatures they see
  // O8d (§347): AC bonus against ranged attacks ("Anti-missile Shield").
  const shield = context.ranged ? rangedAcBonus(target.actor) : 0;
  const ac = cover ? ((cover.bonus === null) ? null : baseAc + cover.bonus + shield) : baseAc + shield;
  const chance = hitChance({
    ac, bonus: bonus.flat, dice: bonus.dice, mode,
    critical: activity.criticalThreshold ?? 20,
    autoCritical: isAutoCritical(context.target, context.adjacent),
    margin: critMargin()   // §207
  });
  return { ...chance, ac, baseAc, cover, mode, advantage: ours.advantage, disadvantage: ours.disadvantage,
    system: { advantage: !!system.advantage, disadvantage: !!system.disadvantage },
    keys: { advantage: !!keys.advantage, disadvantage: !!keys.disadvantage } };
}

/**
 * Chance that a target fails an activity's saving throw (§15.3): what its saving throw would do, without rolling it —
 * built as dnd5e builds it (`Actor5e#rollSavingThrow` → `#rollD20Test`, dnd5e 6.0.3): fields
 * `abilities.<car>.save.roll` and `rolls.ability.save` combined (rule bonus, Advantage, Disadvantage), parts
 * (modifier, proficiency, bonus, Cover on Dexterity) by `D20Roll.constructParts`, condition reduction (Exhaustion) by
 * `addConditionRollReduction`; plus what the engine puts in it (adapter/saves.mjs, `saveRollArguments`): the activity's own
 * bonus, the Advantage from `saveAdvantageAgainst` (Magic Resistance, Fey Ancestry…) and from `fightingAdvantageFor`
 * (Charm Person). Automatic failure: `autoFailSave`; moot: Immunity to all the conditions applied, no damage.
 * Several abilities to choose from (Grapple): the best one for the target, as it would choose it.
 * @returns {{fail: number, dc: number, ability: string, bonus: number, dice: object[], mode: 1|0|-1, autoFail: string|null,
 *   immune: boolean, legendary: number, advantage: string[], disadvantage: string[]}|null}
 */
export function saveChanceOf(caster, target, activity) {
  const actor = target?.actor;
  if ( (activity?.type !== "save") || !actor?.system?.abilities ) return null;
  const dc = activity.save?.dc?.value;
  const abilities = Array.from(activity.save?.ability ?? []).filter(a => actor.system.abilities[a]);
  if ( !Number.isFinite(dc) || !abilities.length ) return null;
  const ability = (abilities.length > 1) ? bestSaveAbility(actor, abilities) : abilities[0];
  const data = actor.system.abilities[ability];

  const rollData = actor.getRollData({ roll: true });
  Object.assign(rollData.roll ??= {}, { ability, proficient: data?.save?.prof?.multiplier >= 1, type: "ability" });
  const Field = dnd5e.dataModels.shared.D20RollModificationField;
  const { bonus: ruleBonus, ...options } = Field.combineFields(actor.system, [`abilities.${ability}.save.roll`, "rolls.ability.save"],
    { rules: { category: "save", actor, rollData } });
  const built = CONFIG.Dice.D20Roll.constructParts({
    mod: data?.mod,
    prof: data?.save?.prof?.hasProficiency ? data.save.prof.term : null,
    ruleBonus,
    cover: (ability === "dex") ? actor.system.attributes?.ac?.cover : null
  }, rollData);
  actor.addConditionRollReduction?.(built.parts, built.data);
  const own = splitBonus(built.parts.join(" + "), built.data);
  const extra = activity.save?.bonus ? splitBonus(String(activity.save.bonus), activity.getRollData()) : { flat: 0, dice: [] };
  if ( !own || !extra ) return null;

  const advantage = [];
  const disadvantage = [];
  if ( options.advantage ) advantage.push("sheet");
  if ( options.disadvantage ) disadvantage.push("sheet");
  if ( saveAdvantageAgainst(actor, activity) ) advantage.push("saveAdvantage");
  if ( fightingAdvantageFor(activity, target) ) advantage.push("fighting");
  if ( sizeAdvantageFor(actor, activity) ) advantage.push("size");
  const mode = netMode({ advantage, disadvantage });

  const statuses = Array.from(actor.statuses ?? []);
  const autoFail = autoFailSave(statuses, ability);
  const posed = (activity.effects ?? []).flatMap(ref => Array.from(effectOfProfile(ref, activity.item)?.statuses ?? []));
  const immunities = conditionImmunitiesOf(actor);
  const immune = !(activity.damage?.parts?.length) && (posed.length > 0) && posed.every(s => immunities.includes(s));
  const bonus = own.flat + extra.flat;
  const dice = [...own.dice, ...extra.dice];
  return {
    fail: saveFailChance({ dc, bonus, dice, mode, autoFail: !!autoFail, immune }),
    dc, ability, bonus, dice, mode, autoFail, immune,
    legendary: actor.system.resources?.legres?.value ?? 0,
    advantage, disadvantage
  };
}
