/**
 * The Rogue's Sneak Attack and Cunning Strikes (SPEC §20).
 *
 *  - On the author's client, at the damage roll of an attack (`dnd5e.preRollDamageV2`): if Sneak Attack applies
 *    (core/sneak.mjs: Finesse or ranged weapon, Advantage or an ally within 1.50 m of the target without Disadvantage, once
 *    per turn), its dice are added to the roll, of the weapon's type — minus those of the Cunning Strikes chosen just before
 *    (adapter/messages.mjs, `rollDamageForAttack`) —, with the extra parts (Assassinate in the first round). A Critical Hit
 *    doubles them like the others.
 *    The roll carries `flags["dnd5e-combat"].sneak`: the item, the dice rolled, the Strikes chosen, the target.
 *  - On the active GM, once the attack is resolved and its damage applied (`dnd5e-combat.resolution`): each Cunning Strike
 *    "takes place immediately after the attack's damage is dealt" — its saving throw plays on the target (Poison,
 *    Trip, Daze, Knock Out, Blind: adapter/areas.mjs, `strikeAgainst`), or Withdraw opens for the author a
 *    move of half their Speed without Opportunity Attacks.
 *  - §223 (#16): world setting "Sneak Attack: automatic / ask". In "ask" mode, the author decides on this hit
 *    in the Cunning Strikes window (adapter/sneak.mjs, `askHitOptions`); if declined, it stays available for another hit
 *    of the turn. The item's damage activity ("Self" in the Player's Handbook data: it hit the rogue) is no longer rolled:
 *    it says that Sneak Attack will come on the next eligible hit and, in "ask" mode, reserves it for that hit (without a
 *    question).
 * Limit: a damage roll made outside the engine (card button) has Sneak Attack, without a Cunning Strike question.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { settleStrikes, affordableStrikes } from "../core/sneak.mjs";
import { sneakAttackFor, attackMessageFor, markSneakSpent, sneakBonusesOf, strikeOptionsOf, strikeMaxOf, sneakItemOf, sneakSpent, sneakMode,
  armSneak, sneakArmed, SNEAK_MODE_SETTING, SNEAK_MODES } from "../adapter/sneak.mjs";
import { contentOf } from "../adapter/content.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { combatantFor, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";
import { restoreHiding } from "./hide.mjs";

/** Labels for the reasons why Sneak Attack does not apply (log only). */
const WHY = Object.freeze({
  spent: "already used this turn", notWeapon: "not a weapon attack", weaponKind: "weapon neither Finesse nor Ranged",
  disadvantage: "Disadvantage on the roll", noAdvantage: "neither Advantage nor an ally within 5 feet of the target"
});

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin") ?? null;
  // The damage roll may be that of a variant (M5): the attack is the one of the attack roll attached to the same message.
  const attackMessage = attackMessageFor(origin, activity);
  const attack = attackMessage ? (fromUuidSync(attackMessage.system?.activity?.uuid ?? "", { strict: false }) ?? activity) : null;
  const sneak = attack ? sneakAttackFor(attack, attackMessage) : null;
  if ( !sneak ) return true;
  if ( sneak.issue ) { log(`Sneak Attack: no (${WHY[sneak.issue] ?? sneak.issue})`); return true; }
  // §223: the author kept it for another hit ("ask" setting).
  if ( config[MODULE_ID]?.sneak === false ) { log("Sneak Attack: kept for another hit"); return true; }

  const options = affordableStrikes(strikeOptionsOf(actor, sneak.target), sneak.dice.number);
  const { strikes, dice } = settleStrikes(config[MODULE_ID]?.strikes ?? [], options, { dice: sneak.dice.number, max: strikeMaxOf(actor) });
  // Of the weapon's type: the one the first roll carries (the type chosen, for a weapon that offers several).
  const type = config.rolls[0]?.options?.type ?? Array.from(attack.item?.system?.damage?.base?.types ?? [])[0] ?? null;
  const data = activity.getRollData();
  const push = (formula, rollData=data) => config.rolls.push({ data: rollData, parts: [formula], options: { type, types: type ? [type] : [], properties: [] } });
  if ( dice > 0 ) push(`${dice}d${sneak.dice.faces}`);
  const bonuses = sneakBonusesOf(actor);
  for ( const b of bonuses ) push(b.formula, b.data);
  markSneakSpent(actor).catch(err => console.warn(`${MODULE_ID} | Sneak Attack: turn not marked`, err));
  if ( sneakArmed(actor) ) armSneak(actor, false).catch(() => {});
  foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.sneak`, {
    item: sneak.item.uuid, dice, faces: sneak.dice.faces, strikes, target: sneak.target.uuid, source: sneak.source.uuid,
    bonuses: bonuses.map(b => b.name)
  });
  log(`Sneak Attack: +${dice}d${sneak.dice.faces} ${type ?? ""}${strikes.length ? ` (Cunning Strikes: ${strikes.join(", ")})` : ""}${bonuses.length ? `; ${bonuses.map(b => `${b.name} +${b.formula}`).join(", ")}` : ""}`);
  return true;
}

/* -------------------------------------------- */
/*  After the damage: the Cunning Strikes       */
/* -------------------------------------------- */

const seen = new Set();

/** Withdraw: "immediately after the attack, you move up to half your Speed without provoking Opportunity Attacks". */
async function withdraw(sourceToken) {
  const combatant = sourceToken?.actor ? combatantFor(sourceToken.actor) : null;
  const own = combatant && (game.combat?.combatant?.id === combatant.id);
  if ( !own ) { log(`Withdraw: ${sourceToken?.name ?? "?"} is not on their turn, nothing to open (up to the GM)`); return; }
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return;
  const budget = readBudget(combatant);
  const extra = movement.speed / 2;
  await writeBudget(combatant, { ...budget, bonusMove: (Number(budget.bonusMove) || 0) + extra, disengaged: true });
  notice(sourceToken, loc("Sournoise.Repli", { n: extra, units: movement.units }), "gain");
  log(`Withdraw: ${sourceToken.name} can move ${extra} more ${movement.units}, without provoking Opportunity Attacks`);
}

/**
 * §236: Superior Sneak, Stealth Attack — "if you have the Invisible condition from the Hide action, this attack does not
 * end it if you finish the turn behind Three-Quarters or Total Cover". The attack roll has already removed the hidden
 * state (runtime/hide.mjs, which keeps what it removed): it is given back, and the end of the turn judges the Cover
 * (runtime/hide.mjs, `stealthAttackCheck`).
 */
async function stealthAttack(sourceToken) {
  const actor = sourceToken?.actor;
  if ( !actor ) return;
  const restored = await restoreHiding(actor);
  log(restored ? `Stealth Attack: ${actor.name} stays hidden until the end of the turn (cover is judged then)` : `Stealth Attack: ${actor.name} was not hidden`);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const damage = game.messages.get(resolution.damageRoll?.messageId ?? "");
  const sneak = damage?.getFlag(MODULE_ID, "sneak");
  if ( !sneak?.strikes?.length ) return;
  seen.add(resolution.id);
  const hit = (resolution.targets ?? []).find(t => (t.token === sneak.target) && (t.hit === true));
  const target = hit ? fromUuidSync(sneak.target, { strict: false }) : null;
  const source = fromUuidSync(sneak.source ?? "", { strict: false }) ?? tokenOf(fromUuidSync(resolution.source ?? "", { strict: false }));
  if ( !target?.actor || !source?.actor ) return;
  const options = strikeOptionsOf(source.actor, target);
  for ( const key of sneak.strikes ) {
    const option = options.find(o => o.key === key);
    if ( !option ) continue;
    if ( option.withdraw ) { await withdraw(source); continue; }
    if ( option.keepsHidden ) { await stealthAttack(source); continue; }
    // A target dropped to 0 HP by the damage no longer has a saving throw to make.
    if ( (target.actor.system.attributes?.hp?.value ?? 0) <= 0 ) { log(`${option.label}: ${target.name} is at 0 Hit Points, not applicable`); continue; }
    log(`${option.label}: ${target.name} makes their saving throw (${source.name}'s Cunning Strike)`);
    await strikeAgainst(option.activity, source, target);
  }
}

/* -------------------------------------------- */
/*  §223: the item's activity                   */
/* -------------------------------------------- */

/**
 * The Sneak Attack damage activity (`dnd5e.preUseActivity`, on the client of whoever uses it): never rolled — its
 * data make it target the rogue. It says instead when Sneak Attack will come, and in "ask" mode reserves it for the
 * next eligible hit of this turn.
 */
function onPreUseActivity(activity) {
  const actor = activity?.actor;
  if ( (activity?.type !== "damage") || !actor || !contentOf(activity.item).entry?.sneakAttack ) return true;
  // The hook's activity is that of a clone of the item (dnd5e, documents/activity/mixin.mjs:229): compared by id.
  if ( sneakItemOf(actor)?.id !== activity.item?.id ) return true;
  let text;
  if ( sneakSpent(actor) ) text = loc("Sournoise.ActiviteDejaUtilisee");
  else if ( sneakMode() !== "ask" ) text = loc("Sournoise.ActiviteAuto");
  else {
    const armed = !sneakArmed(actor);
    armSneak(actor, armed).catch(err => console.warn(`${MODULE_ID} | Sneak Attack: not reserved`, err));
    text = loc(armed ? "Sournoise.ActiviteReservee" : "Sournoise.ActiviteLiberee");
    log(`Sneak Attack: ${armed ? "reserved for the next eligible hit" : "reservation released"} (${actor.name})`);
  }
  ui.notifications.info(text);
  return false;
}

export function registerSneak() {
  game.settings.register(MODULE_ID, SNEAK_MODE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SNEAK_MODE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SNEAK_MODE_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(SNEAK_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${SNEAK_MODE_SETTING}.${m}`])), default: "auto"
  });
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "Sneak Attack: item activity not redirected" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Sneak Attack" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`sneak:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "Cunning Strikes not played" });
}
