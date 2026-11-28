/**
 * Superior Hunter's Prey (key `markSplash`): at the end of a Ranger's resolution that wounded a creature carrying their Hunter's
 * Mark, once per turn, they choose another creature they can see within range of the first: it takes the spell's extra damage.
 * "Nobody" first. Active GM (the resolution route), the question goes to the Ranger's player.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { splashTargets, splashAvailable, splashFormula } from "../core/mark-splash.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { canSee } from "../adapter/vision.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { log, tokenOfActor } from "./shared.mjs";

const seen = new Set();

/**
 * The current turn of the combat this creature is in (same form as `currentTurnKey`), or null out of combat. Read from the
 * combatant's combat rather than the displayed combat: seen in play, the latter was not yet known at the end of the resolution.
 */
function turnKeyOf(token) {
  const combat = game.combats.find(c => c.started && c.combatants.some(x => x.tokenId === token.id));
  return combat ? `${combat.id}.${combat.round}.${combat.turn}` : null;
}

/** Does the creature carry an effect of the `mark` item placed by this actor? */
function markedBy(actor, mark, source) {
  return Array.from(actor?.appliedEffects ?? actor?.effects ?? []).some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const item = originItemOf(e);
    return !!item && (identifierOf(item).id === mark) && (item.actor?.uuid === source.uuid);
  });
}

export async function onMarkSplashResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || seen.has(resolution.id) ) return;
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const source = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const item = source?.items?.find(i => contentOf(i).entry?.markSplash);
  if ( !item ) return;
  const rule = contentOf(item).entry.markSplash;
  const self = tokenOfActor(source);
  const scene = self?.parent;
  if ( !self || !scene ) return;
  const first = (resolution.targets ?? []).filter(t => Number(t.damage?.applied) > 0)
    .map(t => fromUuidSync(t.token, { strict: false })).find(t => t?.actor && markedBy(t.actor, rule.mark, source));
  if ( !first ) return;
  seen.add(resolution.id);
  const turn = turnKeyOf(self);
  if ( !splashAvailable(source.getFlag(MODULE_ID, "markSplash") ?? null, turn) ) return;
  const range = lengthIn(rule.range.value, rule.range.units, scene.grid.units, readUnitFactors());
  const alive = t => t.actor && !t.hidden && (t.id !== self.id) && ((t.actor.system?.attributes?.hp?.value ?? 0) > 0);
  const tokens = scene.tokens.filter(alive).map(t => ({ id: t.id, name: t.name, first: t.id === first.id,
    enemy: areEnemies(self, t), seen: canSee(self, t) !== false,   // des documents de token (adapter/vision.mjs)
    distance: (t.id === first.id) ? 0 : distanceBetween(first, t).value }));   // in the scene's unit
  const choices = splashTargets(tokens, range);
  if ( !choices.length ) return;
  const formula = splashFormula(rule, source.items.map(i => identifierOf(i).id));
  const answer = await askChoice(source, { actor: source.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.ProieSuperieure.Question", { item: item.name, first: first.name, formula }),
    // "Nobody" first: with no answer within the delay, askChoice takes the first option.
    options: [{ id: "none", label: game.i18n.localize("DND5ECOMBAT.ProieSuperieure.Personne") },
      ...choices.map(t => ({ id: t.id, label: t.name }))] });
  const chosen = scene.tokens.get(answer?.id ?? "");
  if ( !chosen ) return;
  if ( turn ) await source.setFlag(MODULE_ID, "markSplash", turn);
  await inflict({ step: { formula, damageType: rule.damageType }, item,
    speaker: ChatMessage.implementation.getSpeaker({ actor: source }), targetUuid: chosen.uuid,
    flavor: game.i18n.format("DND5ECOMBAT.ProieSuperieure.Carte", { item: item.name, name: chosen.name }),
    flags: { [MODULE_ID]: { markSplash: { item: identifierOf(item).id, to: chosen.uuid } } } });
  log(`${item.name}: ${source.name} also deals ${formula} to ${chosen.name} (within range of ${first.name})`);
}
