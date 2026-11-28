/**
 * The Monk (SPEC §24): what follows a hit. On the active GM, once the attack is resolved and its damage applied
 * (`dnd5e-combat.resolution`):
 *  - Stunning Strike: once per turn, after a hit with a monk weapon or an unarmed strike, if a Focus Point is left,
 *    the question to the monk (`askChoice`: the player, otherwise the GM); yes: the point spent, the item's Constitution saving
 *    throw rolled on the target (Stunned on a failure; slowed and the next attack against it with Advantage
 *    on a success — content `savedEffects`, `effectEnds`);
 *  - Open Hand Technique: after a hit of a Flurry of Blows strike (card marked `flurry`), the question:
 *    Addle, Push or Topple — the item's activity rolled on the target.
 * Martial Arts and Flurry of Blows (cost of the strikes): runtime/turn.mjs; aiming the Flurry strikes: ui/pointer.mjs.
 * §145: Martial Arts, Dexterity for the attack and damage rolls of monk weapons (`dnd5e.preRollAttackV2` /
 * `preRollDamageV2`, on the casting client).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { currentTurnKey, speakerTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc } from "./shared.mjs";
import { spendItemUses } from "../adapter/uses.mjs";

/** The rule of an actor's item (and the item), or null. */
function ruleOf(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.[key];
    if ( rule ) return { item, rule };
  }
  return null;
}

/** An unarmed strike, or a monk weapon (simple melee weapon, Light martial melee weapon). */
function monkWeapon(activity) {
  const item = activity?.item;
  if ( (activity?.type !== "attack") || !item ) return false;
  if ( (identifierOf(item).id === "unarmed-strike") || (activity.attack?.type?.classification === "unarmed") ) return true;
  const type = item.system?.type?.value;
  return (item.type === "weapon") && ((type === "simpleM") || ((type === "martialM") && item.system.properties?.has?.("lgt")));
}

/**
 * §145: Martial Arts — "you can use your Dexterity modifier instead of your Strength modifier for the attack and damage rolls of
 * your unarmed strikes and monk weapons", with no armor or shield. dnd5e already does it for the unarmed strike (natural weapon:
 * Strength or Dexterity) and Finesse weapons; not for a simple melee weapon (spear, quarterstaff).
 * Attack: `config.ability` = "dex" (dnd5e builds the roll from it); damage: `@mod` (already in the roll's data) replaced by
 * Dexterity when it equals Strength and Dexterity is better.
 */
function dexterityFor(config) {
  const activity = config?.subject;
  const actor = activity?.actor;
  if ( !actor || !ruleOf(actor, "martialArts") || !monkWeapon(activity) ) return null;
  const worn = actor.items.some(i => (i.type === "equipment") && i.system.equipped
    && ["light", "medium", "heavy", "shield"].includes(i.system.type?.value));
  if ( worn ) return null;
  const str = actor.system.abilities?.str?.mod ?? 0;
  const dex = actor.system.abilities?.dex?.mod ?? 0;
  return (dex > str) ? { actor, activity, str, dex } : null;
}

/** Attack roll: dnd5e builds its parts later, from `config.ability` (activity/attack.mjs, `_buildAttackConfig`:
 * `formData.ability ?? process.ability`) — the ability chosen in its window, if there is one, keeps priority. */
function dexterousAttack(config) {
  const found = dexterityFor(config);
  if ( !found || (config.ability && (config.ability !== "str")) ) return true;
  config.ability = "dex";
  log(`${found.actor.name}: Martial Arts, Dexterity instead of Strength for the attack with ${found.activity.item.name}`);
  return true;
}

/** Damage roll: its parts already carry `@mod` (the weapon's formula) — Strength replaced by Dexterity. */
function dexterousDamage(config) {
  const found = dexterityFor(config);
  if ( !found ) return true;
  let changed = false;
  for ( const roll of config.rolls ?? [] ) {
    if ( roll?.data && (roll.data.mod === found.str) ) { roll.data.mod = found.dex; changed = true; }
  }
  if ( changed ) log(`${found.actor.name}: Martial Arts, Dexterity instead of Strength for the damage of ${found.activity.item.name}`);
  return true;
}

/** Les utilisations restantes de l'item de cet identifiant, et l'item. */
function focusOf(actor, identifier) {
  const item = actor?.items?.find(i => identifierOf(i).id === identifier);
  const left = Number(item?.system?.uses?.value);
  return { item, left: Number.isFinite(left) ? left : 0 };
}

async function stunningStrike(source, target, activity) {
  const found = ruleOf(source.actor, "stunningStrike");
  if ( !found || !monkWeapon(activity) ) return;
  const key = currentTurnKey();
  if ( key && (source.actor.getFlag(MODULE_ID, "stunTurn") === key) ) return;   // "once per turn"
  const focus = focusOf(source.actor, found.rule.focus);
  if ( !focus.item || (focus.left < 1) ) return;
  const save = found.item.system.activities?.get(found.rule.activity);
  if ( !save ) return;
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: found.item.name,
    prompt: loc("Moine.Etourdissante.Question", { name: target.name, n: focus.left }),
    options: [{ id: "no", label: loc("Moine.Non") }, { id: "yes", label: loc("Moine.Etourdissante.Oui") }]
  });
  if ( answer?.id !== "yes" ) return log(`${found.item.name}: ${source.name} does not attempt to stun ${target.name}`);
  if ( key ) await source.actor.setFlag(MODULE_ID, "stunTurn", key);
  await spendItemUses(focus.item);
  log(`${found.item.name}: ${source.name} spends a point, ${target.name} makes a Constitution saving throw`);
  await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Moine.Carte" });
}

async function openHand(source, target) {
  const found = ruleOf(source.actor, "openHand");
  if ( !found ) return;
  const choices = Object.entries(found.rule).map(([key, id]) => ({ key, activity: found.item.system.activities?.get(id) })).filter(c => c.activity);
  if ( !choices.length ) return;
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: found.item.name,
    prompt: loc("Moine.MainOuverte.Question", { name: target.name }),
    options: [...choices.map(c => ({ id: c.key, label: loc(`Moine.MainOuverte.${c.key}`) })), { id: "none", label: loc("Moine.Non") }]
  });
  const chosen = choices.find(c => c.key === answer?.id);
  if ( !chosen ) return log(`${found.item.name}: nothing against ${target.name}`);
  log(`${found.item.name}: ${chosen.key} against ${target.name}`);
  await strikeAgainst(chosen.activity, source, target, { flavor: "DND5ECOMBAT.Moine.Carte" });
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const usage = game.messages.get(resolution.origin ?? "");
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  const source = speakerTokenOf(attackMessage) ?? speakerTokenOf(usage);
  const activity = fromUuidSync(resolution.activity, { strict: false });
  if ( !source?.actor || !activity ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( t.hit !== true ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor || ((target.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    if ( usage?.getFlag(MODULE_ID, "flurry") ) await openHand(source, target);
    await stunningStrike(source, target, activity);
  }
}

export function registerMonk() {
  route("dnd5e.preRollAttackV2", dexterousAttack, { cancellable: true, label: "Martial Arts: Dexterity with a Monk weapon (attack)" });
  route("dnd5e.preRollDamageV2", dexterousDamage, { cancellable: true, label: "Martial Arts: Dexterity with a Monk weapon (damage)" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`monk:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "Monk: Stunning Strike or Open Hand Technique not offered" });
}
