/**
 * §19.9: Path to the Grave (Grave Domain, `discharge` content). When the cleric or an ally they see hits the
 * cursed creature, the cleric can, without an action, lift the curse: the attack then also deals damage equal to their cleric
 * level, necrotic or radiant at their choice.
 *
 * On the active GM, at the engine's output hook `dnd5e-combat.resolution`, once the attack is settled and its damage applied:
 * for each hit target that carries the declared effect, the effect's caster is consulted (`askChoice`: the player, otherwise the
 * GM; with no answer, the curse stays). If they accept, the effect ends and the target takes the damage,
 * rolled by the engine on behalf of the caster (Resistances included) — a separate part rather than added to the attack's
 * roll: a fixed number, which a Critical Hit does not double. Limit: an attack resolved outside the engine is not seen.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, tokenOf } from "../adapter/facts.mjs";
import { canSee } from "../adapter/vision.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";

const seen = new Set();

/** The `discharge` effects a creature carries: the effect, the item it comes from and its rule. */
function chargesOn(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.discharge : null;
    if ( rule && item.actor && comesFromItemEffect(effect, rule.effect) ) out.push({ effect, item, rule });
  }
  return out;
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const hits = (resolution.targets ?? []).filter(t => t.hit === true);
  if ( !hits.length ) return;
  seen.add(resolution.id);
  const attacker = fromUuidSync(resolution.source ?? "", { strict: false });
  const attackerToken = tokenOf(attacker);
  for ( const t of hits ) {
    const victimToken = fromUuidSync(t.token, { strict: false });
    const victim = victimToken?.actor;
    if ( !victim || ((victim.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const { effect, item, rule } of chargesOn(victim) ) {
      const caster = item.actor;
      const casterToken = tokenOf(caster);
      if ( (caster.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
      // "you or an ally you can see": the attacker is the caster, or is not the caster's enemy and the caster sees them.
      if ( attacker?.uuid !== caster.uuid ) {
        if ( !attackerToken || !casterToken || areEnemies(casterToken, attackerToken) ) continue;
        if ( rule.sees && (canSee(casterToken, attackerToken) === false) ) continue;
      }
      const amount = Roll.replaceFormulaData(rule.formula, item.getRollData());
      const labels = rule.damageTypes.map(type => ({ id: type, label: loc("Malediction.Type", { n: amount, type: game.i18n.localize(CONFIG.DND5E.damageTypes[type]?.label ?? type) }) }));
      const answer = await askChoice(caster, {
        actor: caster.uuid,
        item: item.name,
        prompt: loc("Malediction.Question", { attacker: attacker?.name ?? "", name: victim.name }),
        options: [{ id: "keep", label: loc("Malediction.Garder") }, ...labels]
      });
      if ( !rule.damageTypes.includes(answer?.id) ) { log(`${item.name}: ${caster.name} keeps the curse on ${victim.name}`); continue; }
      if ( !(await fromUuid(effect.uuid)) ) continue;   // fell off in the meantime
      await effect.delete();
      const logged = await inflict({
        step: { formula: rule.formula, damageType: answer.id }, item, targetUuid: t.token,
        speaker: ChatMessage.implementation.getSpeaker({ actor: caster, token: casterToken ?? undefined }),
        flavor: loc("Malediction.Carte", { item: item.name, name: victim.name }),
        flags: { discharge: { item: item.uuid, target: t.token, resolution: resolution.id, type: answer.id } }
      });
      if ( victimToken ) notice(victimToken, loc("Malediction.Retour", { item: item.name }), "ended");
      log(`${item.name}: ${caster.name} ends the curse — ${victim.name} takes ${amount} ${answer.id}${logged ? ` (HP ${logged.before?.value} → ${logged.after?.value})` : ""}`);
    }
  }
}

export function registerDischarge() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`discharge:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "curse: early end not offered" });
}
