/**
 * §212: Burning ("Burning" hazard, 2024 rules) and spread of flames.
 *  - A burning creature (dnd5e's `burning` condition, or an effect that its item declares as such: adapter/burning.mjs)
 *    takes 1d4 fire damage at the start of each of its turns (active GM, in combat). With an action, it puts out the flames by
 *    throwing itself Prone and rolling on the ground ("Put out the flames" entry of its own token's menu). Dousing with water,
 *    immersion, smothering: left to the GM (uncheck the condition in the HUD).
 *  - Spread, per the rules: a burning creature that enters a flammable zone not yet on fire (Oil, Web), or that
 *    is in one when it catches fire, ignites it (runtime/flammable.mjs). Its burns are fire damage: in such a zone,
 *    they ignite it too (§188 a).
 *  - House spread (`fireSpread` world setting, disabled by default, Baldur's Gate 3 style): a creature burned by a zone
 *    on fire catches fire in turn, unless immune to fire.
 */

import { MODULE_ID } from "../constants.mjs";
import { BURNING, BURN_DAMAGE, burningEffectsOf, isBurning, isBurningEffect, fireImmune } from "../adapter/burning.mjs";
import { isInside } from "../adapter/areas.mjs";
import { setStatus } from "../adapter/conditions.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { unlitZones, igniteViaGM } from "./flammable.mjs";
import { payAction } from "./action-end.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, notice, say, waitForDice } from "./shared.mjs";

export const FIRE_SPREAD_SETTING = "fireSpread";

const spreads = () => {
  try { return game.settings.get(MODULE_ID, FIRE_SPREAD_SETTING) === true; } catch { return false; }
};

/* -------------------------------------------- */
/*  Burn                                        */
/* -------------------------------------------- */

/** Active GM, at the start of a burning combatant's turn: 1d4 fire, rolled in the chat, applied (dnd5e Resistances). */
function onTurnStart(combat, prior, now) {
  const actor = combat.combatants.get(now?.combatantId)?.actor;
  if ( !actor || !isBurning(actor) ) return;
  enqueue(`burning:${actor.uuid}`, async () => {
    if ( !isBurning(actor) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const token = tokenOf(actor);
    const roll = await new Roll(BURN_DAMAGE.formula).evaluate();
    const message = await roll.toMessage({
      speaker: ChatMessage.implementation.getSpeaker({ actor, token }),
      flavor: loc("EnFeu.Brule", { name: token?.name ?? actor.name, amount: roll.total })
    });
    await waitForDice(message);
    await actor.applyDamage([{ value: roll.total, type: BURN_DAMAGE.type }]);
    log(`${actor.name}: burning, ${roll.total} fire at the start of their turn`);
  }).catch(err => console.error(`${MODULE_ID} | burning`, err));
}

/** Put out one's flames: an action (in combat), the "Burning" effects removed, Prone. On the owner's client. */
export async function extinguish(token) {
  const actor = token?.actor;
  if ( !actor || !isBurning(actor) ) return false;
  if ( !(await payAction(token)) ) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", burningEffectsOf(actor).map(e => e.id));
  await setStatus(actor, "prone", true);
  notice(token, loc("EnFeu.Eteint"), "ended");
  await say({ actor, token }, loc("EnFeu.EteintCarte", { name: token.name }));
  log(`${token.name}: rolls on the ground, the flames are out (Prone)`);
  return true;
}

/** The entry of one's own token's menu. */
export function burningEntries(token) {
  if ( !token?.isOwner || !isBurning(token.actor) || !levelAtLeast("assisted") ) return [];
  return [{ icon: "fa-solid fa-fire-extinguisher", label: loc("EnFeu.Eteindre"), run: () => extinguish(token) }];
}

/* -------------------------------------------- */
/*  Propagation                                 */
/* -------------------------------------------- */

/** The flammable zones not yet on fire where this burning token stands ignite. */
async function igniteAround(token, cause) {
  if ( !token?.parent || !isBurning(token.actor) || !levelAtLeast("full") ) return;
  for ( const zone of unlitZones(token.parent) ) if ( isInside(token, zone) ) await igniteViaGM(zone, cause);
}

/** Active GM: a burning token moved — it ignites the flammable zone where it arrives. */
function onTokenMoved(token, changes) {
  if ( !("x" in changes) && !("y" in changes) && !("elevation" in changes) ) return;
  if ( !isBurning(token.actor) ) return;
  igniteAround(token, `${token.name} is on fire`).catch(err => console.error(`${MODULE_ID} | burning: spread`, err));
}

/** Active GM: a creature catches fire — the flammable zone where it stands ignites. */
function onEffectCreated(effect) {
  if ( !isBurningEffect(effect) || (effect.parent?.documentName !== "Actor") ) return;
  for ( const token of effect.parent.getActiveTokens?.(false, true) ?? [] ) {
    igniteAround(token, `${token.name} catches fire`).catch(err => console.error(`${MODULE_ID} | burning: spread`, err));
  }
}

/**
 * House spread (`fireSpread`): a creature burned by a zone on fire catches fire in turn (runtime/flammable.mjs, `burnTick`,
 * after the damage). Active GM.
 */
export async function catchFireFromZone(token, zoneName) {
  const actor = token?.actor;
  if ( !spreads() || !actor || isObjectToken(token) || isBurning(actor) || fireImmune(actor) ) return false;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return false;
  await setStatus(actor, BURNING, true);
  notice(token, loc("EnFeu.PrendFeu"), "gain");
  log(`${token.name}: catches fire from ${zoneName} (house rule: fire spread)`);
  return true;
}

export function registerBurning() {
  game.settings.register(MODULE_ID, FIRE_SPREAD_SETTING, {
    name: `DND5ECOMBAT.Reglage.${FIRE_SPREAD_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${FIRE_SPREAD_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false
  });
  route("combatTurnChange", onTurnStart, { executor: true, label: "burning: start-of-turn fire damage not dealt" });
  route("updateToken", onTokenMoved, { executor: true, label: "burning: flammable zone not ignited by a burning creature" });
  route("createActiveEffect", onEffectCreated, { executor: true, label: "burning: flammable zone not ignited on catching fire" });
}
