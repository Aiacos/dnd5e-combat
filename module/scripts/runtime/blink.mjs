/**
 * §161: Blink — "roll a d6 at the end of each of your turns for the duration; on a 4 to 6, you vanish from your plane
 * of existence and appear in the Ethereal Plane … at the start of your next turn, you return". Content `blink`: the spell's
 * effect that carries the duration. The data puts the Ethereal condition on it for the whole duration: it is removed at
 * placement (the effect only serves to count), and the condition is placed separately, marked, on a 4 to 6 at end of turn,
 * then removed at the start of the next turn. Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const ETHEREAL = "ethereal";

/** L'effet de Clignotement que porte l'acteur, ou null. */
function blinkOf(actor) {
  return Array.from(actor?.effects ?? []).find(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const id = contentOf(originItemOf(e)).entry?.blink;
    return !!id && comesFromItemEffect(e, id);
  }) ?? null;
}

/** At placement: the data's effect loses its permanent Ethereal condition. */
async function onCreateEffect(effect) {
  if ( (effect.parent?.documentName !== "Actor") || (blinkOf(effect.parent) !== effect) || !effect.statuses?.has(ETHEREAL) ) return;
  // The data gives it "1 round" (expiry at the start of the next turn): the spell's duration is one minute.
  await effect.update({ statuses: Array.from(effect.statuses).filter(s => s !== ETHEREAL), duration: { value: 60, units: "seconds", expiry: null } });
  log(`${effect.parent.name}: Blink, the d6 decides at the end of each turn`);
}

/**
 * In the rule's order: the end of the turn that ends (the d6), then the start of the one that begins (the return). The same actor
 * can be both — alone in combat, or the others skipped: it leaves on 4–6 and returns at once, instead of spending its whole
 * new turn in the Ethereal Plane (seen on 2026-10-16: the intermittent failure of `releve-sorts-6`, the skipped Zombie).
 */
async function onTurnChange(combat, prior, current) {
  await endOfTurn(combat.combatants.get(prior?.combatantId)?.actor);
  await startOfTurn(combat.combatants.get(current?.combatantId)?.actor);
}

/** End of turn: the d6. */
async function endOfTurn(actor) {
  const blink = blinkOf(actor);
  if ( !blink ) return;
  const roll = await new Roll("1d6").evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: blink.name });
  if ( roll.total < 4 ) { log(`${actor.name}: Blink, ${roll.total} — stays`); return; }
  const effect = await actor.toggleStatusEffect(ETHEREAL, { active: true });
  if ( effect?.update ) await effect.update({ [`flags.${MODULE_ID}.blink`]: true });
  log(`${actor.name}: Blink, ${roll.total} — to the Ethereal Plane until the start of their next turn`);
}

/** Start of turn: the return from the Ethereal Plane. */
async function startOfTurn(actor) {
  const marked = Array.from(actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "blink"));
  if ( !marked.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", marked.map(e => e.id));
  log(`${actor.name}: Blink, back from the Ethereal Plane`);
}

export function registerBlink() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "Blink: permanent Ethereal not removed" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "Blink: d6 not rolled" });
}
