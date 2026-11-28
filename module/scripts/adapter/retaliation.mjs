/**
 * Retaliation (SPEC §16.9, brick B9): a creature hit by an attack deals damage to the attacker in return — Fire
 * Shield, Armor of Agathys, Acidic Form. Read and played in Foundry; the rule (when) is a registry declaration
 * (moment `isHit`, `damage` step with `to: "source"`), judged BEFORE the attack's damage is applied ("while
 * you have these Temporary Hit Points" is judged at the moment of the hit), played AFTER.
 *
 * Verified in dnd5e 6.0.3:
 *  - a damage activity gives its roll configuration, scaled by `item.scaledClone(scaling)` as the use message
 *    does (documents/chat-message.mjs, `getAssociatedItem`), through `getDamageConfig()`
 *    (data/activity/base-activity.mjs): `rolls[] = { parts, data, options }`;
 *  - an effect applied by the tray keeps the casting level: `flags.dnd5e.scaling` (effect-application.mjs,
 *    `_prepareEffectData`) — the engine's trace (adapter/traces.mjs) writes it the same way;
 *  - `DamageRoll.toMessage(rolls, messageData)` (dice/basic-roll.mjs): a roll card without an associated activity, which the
 *    engine does not take for a resolution's damage (adapter/messages.mjs, `readDamageMessage`).
 */

import { MODULE_ID } from "../constants.mjs";
import { select, stepsOf } from "../core/triggers.mjs";
import { declarationsOf, declarationsOfEffects, factsFor } from "./triggers.mjs";
import { applyDamageToToken } from "./messages.mjs";
import { describeTarget, cardScaling } from "./areas.mjs";

/**
 * §86: retaliation through a save (`save` step, `to: "source"`) — the attacker makes the save of one of the item's activities
 * (Sacred Aura: Constitution, Blinded on a failure). Same form as `pulseAgainst` (adapter/areas.mjs): a brand-new use message
 * of the activity (at the casting level of the carried effect), the attacker as the only target, marked `areaTick` — nothing is
 * spent, the usual save resolution applies (caster's DC, effects on a failure). Active GM only.
 * @returns {Promise<ChatMessage|null>}
 */
export async function saveRetaliation({ declaration, step }, { bearerToken, attackerToken }) {
  if ( !attackerToken?.actor ) return null;
  const item = fromUuidSync(declaration.item ?? "", { strict: false });
  const effect = declaration.effect ? fromUuidSync(declaration.effect, { strict: false }) : null;
  const scaling = effect?.getFlag?.("dnd5e", "scaling") ?? 0;
  const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
  const activity = scaled?.system?.activities?.get(step.activity);
  if ( !activity ) return null;
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor ?? undefined }),
    flavor: game.i18n.format("DND5ECOMBAT.RiposteSauvegarde", { item: declaration.name ?? item.name, attacker: attackerToken.name, bearer: bearerToken?.name ?? "" }),
    // §406: the carried effect's scaling on the card (`system.scaling`) — the resolution reads the activity again through
    // `getAssociatedActivity({ scaled: true })`, which takes it from there; `getCardData` does not give it.
    system: { ...card, ...cardScaling(activity, effect), targets: [describeTarget(attackerToken)] },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "retaliation", source: bearerToken?.uuid ?? null, token: attackerToken.uuid } } }
  });
}

/**
 * The retaliations triggered by an attack that hits, judged before its damage.
 * @param {object} context
 * @param {TokenDocument} context.bearerToken    The creature that was hit.
 * @param {TokenDocument} context.attackerToken  The attacker.
 * @param {Activity} context.activity            The attack activity.
 * @param {string|null} context.attackMode       The roll's attack mode ("thrown": not melee).
 * @returns {Array<{declaration: object, step: object}>}
 */
export function retaliationsFor({ bearerToken, attackerToken, activity, attackMode=null }) {
  const bearer = bearerToken?.actor;
  const attacker = attackerToken?.actor;
  if ( !bearer || !attacker || (bearer === attacker) ) return [];
  const declarations = [...declarationsOf(bearer), ...declarationsOfEffects(bearer)];
  const facts = factsFor({ source: attacker, target: bearer, activity, sourceToken: attackerToken, targetToken: bearerToken, attackMode });
  return select(declarations, "isHit", facts).flatMap(d => [...stepsOf(d, "damage"), ...stepsOf(d, "save")]
    .filter(s => s.to === "source").map(step => ({ declaration: d, step })));
}

/** A retaliation's damage rolls: the item's damage activity (at the casting level), or the declared formula. */
async function rollsFor({ declaration, step }, bearer) {
  const item = fromUuidSync(declaration.item ?? "", { strict: false });
  const effect = declaration.effect ? fromUuidSync(declaration.effect, { strict: false }) : null;
  if ( step.activity ) {
    const scaling = effect?.getFlag?.("dnd5e", "scaling") ?? 0;
    const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
    const activity = scaled?.system?.activities?.get(step.activity);
    if ( !activity?.getDamageConfig ) return [];
    const config = activity.getDamageConfig({});
    return (config.rolls ?? []).filter(r => r.parts?.length)
      .map(r => new CONFIG.Dice.DamageRoll(r.parts.join(" + "), r.data ?? activity.getRollData(), r.options ?? {}));
  }
  const data = item?.getRollData?.() ?? bearer.getRollData();
  return [new CONFIG.Dice.DamageRoll(step.formula, data, { type: step.damageType, types: [step.damageType], properties: ["mgc"] })];
}

/**
 * Plays a retaliation: damage roll (card visible to all, in the name of the creature that was hit), then damage applied to
 * the attacker through the system's method (Resistances and Immunities included). Active GM only.
 * @returns {Promise<object|null>}  Log entry (HP before / after) for the undo, or null.
 */
export async function retaliate(retaliation, { bearerToken, attackerToken }) {
  const bearer = bearerToken?.actor;
  const attacker = attackerToken?.actor;
  if ( !bearer || !attacker ) return null;
  const rolls = await rollsFor(retaliation, bearer);
  if ( !rolls.length ) return null;
  for ( const roll of rolls ) await roll.evaluate();
  const { declaration } = retaliation;
  const message = await CONFIG.Dice.DamageRoll.toMessage(rolls, {
    speaker: ChatMessage.implementation.getSpeaker({ actor: bearer, token: bearerToken }),
    flavor: game.i18n.format("DND5ECOMBAT.Riposte", { item: declaration.name, attacker: attackerToken.name }),
    flags: { [MODULE_ID]: { retaliation: { item: declaration.identifier, bearer: bearerToken.uuid, attacker: attackerToken.uuid } } }
  });
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type ?? retaliation.step.damageType,
    value: Math.max(0, roll.total)
  }));
  const entry = await applyDamageToToken(attackerToken.uuid, damages, message);
  return entry ? { ...entry, name: declaration.name } : null;
}

/**
 * Damage rolled by the engine and applied to a creature (SPEC §19): the outcome damage of a resolution (moments hit,
 * failedSave: "A target takes an extra 5 (2d4) necrotic damage if it fails") and that of the bearer of an effect on
 * their turn (Melf's Acid Arrow). Same path as a retaliation: roll card visible to all, then `applyDamageToToken`
 * (Resistances and Immunities included). `step`: `{ formula, damageType }` or `{ activity }` (damage activity of
 * `item`, at level `scaling`). `multiplier`: 0.5 for a successful save. Active GM only.
 * @returns {Promise<object|null>}  Log entry (HP before / after), or null.
 */
export async function inflict({ step, item=null, scaling=0, speaker, targetUuid, flavor, flags={}, multiplier=1, properties=["mgc"] }) {
  if ( !(multiplier > 0) ) return null;
  let rolls;
  if ( step.activity ) {
    const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
    // §153: an older copy of the item, without the declared activity (the pre-generated characters' "Furnace Smite" in the
    // Handbook), takes the activity that carries the damage dice — like the smite itself (adapter/smite.mjs, §128).
    const dice = a => (a.damage?.parts ?? []).some(p => (p.number && p.denomination) || p.custom?.formula);
    const activity = scaled?.system?.activities?.get(step.activity)
      ?? scaled?.system?.activities?.find?.(a => a.getDamageConfig && dice(a)) ?? null;
    if ( activity && (activity.id !== step.activity) ) console.log(`${MODULE_ID} | ${item?.name}: activity ${step.activity} missing, damage from "${activity.name}"`);
    if ( !activity?.getDamageConfig ) return null;
    const config = activity.getDamageConfig({});
    rolls = (config.rolls ?? []).filter(r => r.parts?.length)
      .map(r => new CONFIG.Dice.DamageRoll(r.parts.join(" + "), r.data ?? activity.getRollData(), r.options ?? {}));
  }
  else {
    const data = item?.getRollData?.() ?? {};
    // `properties`: magical by default (spells, features); §21: Graze keeps the weapon's (an ordinary weapon is not).
    rolls = [new CONFIG.Dice.DamageRoll(step.formula, data, { type: step.damageType, types: [step.damageType], properties })];
  }
  if ( !rolls.length ) return null;
  for ( const roll of rolls ) await roll.evaluate();
  const message = await CONFIG.Dice.DamageRoll.toMessage(rolls, { speaker, flavor, flags: { [MODULE_ID]: flags } });
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type ?? step.damageType,
    value: Math.max(0, roll.total)
  }));
  return applyDamageToToken(targetUuid, damages, message, { multiplier });
}
