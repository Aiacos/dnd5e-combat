/**
 * The Paladin's smite spells (SPEC §25).
 *
 *  - On the author's client, at the damage roll of a melee hit (adapter/messages.mjs, `rollDamageForAttack`): the
 *    question (one button per possible spell and level), the slot or free use spent (adapter/smite.mjs); then
 *    here (`dnd5e.preRollDamageV2`), the spell's dice added to the roll, of its type — a Critical Hit doubles them like
 *    the others. The roll carries `flags["dnd5e-combat"].smite`.
 *  - On the active GM, once the attack is resolved (`dnd5e-combat.resolution`): the Bonus Action spent, and the spell's
 *    saving throw (Thunderous, Wrathful, Blinding, Staggering, Banishing) played on the target still standing
 *    (adapter/areas.mjs, `strikeAgainst`).
 *    §42.2: the spell's effect placed without a saving throw on the target hit (`smite.effect`: the burning of Searing
 *    Smite, the blinding of Blinding Smite), whose content declares what follows (damage at the start of the turn,
 *    repeated saving throw).
 * §402: a Concentration smite starts it at the hit, its effects depend on it. Limit: the glow of Shining Smite stays with the GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween } from "../adapter/turn.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, waitForDice } from "./shared.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { rangedWeaponHit, smiteOptions, spendSmite } from "../adapter/smite.mjs";
import { requestSave } from "./neighbours.mjs";

/**
 * §402: the Concentration of a smite that requires one (Trapping Strike, Wrathful Smite…) — those that exceed the actor's
 * limit end first (dnd5e: only one at a time), then dnd5e opens it on the saving throw activity (or the first one).
 */
async function beginSmiteConcentration(actor, item, smite) {
  const activity = item.system.activities?.get(smite.save) ?? item.system.activities?.contents?.[0] ?? null;
  if ( !activity || !actor.beginConcentrating ) return null;
  const limit = Number(actor.system.attributes?.concentration?.limit) || 1;
  const held = Array.from(actor.concentration?.effects ?? []);
  for ( const effect of held.slice(0, Math.max(0, held.length - limit + 1)) ) await actor.endConcentration(effect);
  const effect = await actor.beginConcentrating(activity).catch(() => null);
  if ( effect ) log(`${item.name}: ${actor.name} concentrates`);
  return effect ?? null;
}

function onPreRollDamage(config, dialog, message) {
  const smite = config[MODULE_ID]?.smite;
  const activity = config.subject;
  if ( !smite || !activity || !config.rolls?.length ) return true;
  const type = smite.type;
  if ( !smite.formula ) {   // §31: a boon without dice ("Renversement des coteaux") — only noted on the roll
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
    return true;
  }
  // §288: "instead of taking the damage and other effects of the attack" (Lightning Arrow) — the weapon's dice are dropped.
  if ( smite.replaces ) config.rolls.splice(0, config.rolls.length);
  config.rolls.push({ data: activity.getRollData(), parts: [smite.formula], options: { type, types: type ? [type] : [], properties: [] } });
  foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
  log(`${smite.name}${smite.level ? ` (level ${smite.level})` : ""}: +${smite.formula} ${type ?? ""}`);
  return true;
}

const seen = new Set();

/**
 * §273: what a smite triggers on its author (`afterSmite`) — an item on the sheet places one of its effects on them when one
 * of the named smites hits (Smite of Protection: "whenever you cast Divine Smite", the effect that lights its aura).
 */
async function afterSmite(actor, smiteItem) {
  const smiteId = identifierOf(smiteItem).id;
  for ( const own of actor.items ) {
    const rule = contentOf(own).entry?.afterSmite;
    if ( !rule || (rule.smites && !rule.smites.includes(smiteId)) ) continue;
    const placed = await placeItemEffect(own, rule.effect, actor);
    if ( placed ) log(`${own.name}: after ${smiteItem.name}, "${placed.name}" on ${actor.name}`);
  }
}

/**
 * §288: the dice of an activity of the item at the cast level, rolled in the chat (Dice So Nice awaited). `{ total, type }`,
 * or null.
 */
async function rollActivityDice(item, activityId, level, flavor, speaker) {
  const part = item.system.activities?.get(activityId)?.damage?.parts?.[0];
  if ( !part?.number || !part.denomination ) return null;
  const n = part.number + (Math.max(0, level - (Number(item.system.level) || 1)) * (Number(part.scaling?.number) || 0));
  const type = Array.from(part.types ?? [])[0] ?? null;
  const roll = await new CONFIG.Dice.DamageRoll(`${n}d${part.denomination}`, item.getRollData?.() ?? {}, { type, types: type ? [type] : [] }).evaluate();
  const message = await roll.toMessage({ speaker, flavor });
  await waitForDice(message);
  return { total: roll.total, type };
}

/**
 * §288: Lightning Arrow — "each creature within 3 m of the target then makes a Dexterity saving throw and takes 2d8
 * lightning damage on a failure, half as much on a success": one damage roll for all, each one's saving throw
 * (`requestSave`, the spell's DC), the damage applied (dnd5e resistances), a floating text and a card. Active GM.
 */
async function blastAround(item, level, target) {
  const rule = contentOf(item).entry?.smite;
  const blast = rule?.blast;
  if ( !blast || !target?.parent ) return 0;
  const radius = lengthIn(blast.radius, blast.units, target.parent.grid.units);
  const caught = target.parent.tokens.filter(o => (o !== target) && o.actor && !o.hidden && ((o.actor.system.attributes?.hp?.value ?? 0) > 0)
    && (o._source.level === target._source.level) && (distanceBetween(target, o).value <= radius + 1e-6));
  if ( !caught.length ) { log(`${item.name}: nobody within ${blast.radius} ${blast.units} of ${target.name}`); return 0; }
  const speaker = ChatMessage.implementation.getSpeaker({ actor: item.actor });
  const dice = await rollActivityDice(item, blast.activity, level, loc("FlecheFoudre.Eclat", { item: item.name, name: target.name }), speaker);
  if ( !dice ) return 0;
  const dc = Number(item.system.activities?.get(rule.damage)?.save?.dc?.value ?? item.actor?.system.attributes?.spell?.dc) || null;
  const lines = [];
  for ( const other of caught ) {
    const save = await requestSave(other.actor, { ability: blast.ability, dc, flavor: loc("FlecheFoudre.Sauvegarde", { item: item.name, name: other.name }) });
    const amount = save?.success ? Math.floor(dice.total / 2) : dice.total;
    await other.actor.applyDamage([{ value: amount, type: dice.type }]);
    notice(other, { key: "FlecheFoudre.Touche", data: { amount } }, "refused", { all: true });
    lines.push(locEsc(save?.success ? "FlecheFoudre.Reussie" : "FlecheFoudre.Ratee", { name: other.name, total: save?.total ?? "?", dc: dc ?? "?", amount }));
    log(`${item.name}: ${other.name} ${save?.success ? "saves" : "fails"} (${save?.total} vs DC ${dc}), ${amount} ${dice.type}`);
  }
  await say(speaker, [locEsc("FlecheFoudre.Carte", { item: item.name, name: target.name }), ...lines], { lightningBlast: { item: item.name, target: target.uuid, caught: caught.map(t => t.uuid) } });
  return caught.length;
}

/**
 * §288: Lightning Arrow on a MISSED shot — "when your attack hits or misses the target": the question to the author (on
 * their player), the slot and Bonus Action spent, half of the 4d8 on the target, then the burst. A shot that hits goes through
 * the smite question, at the damage roll (adapter/smite.mjs). Active GM.
 */
async function onMissed(resolution) {
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const actor = activity?.actor;
  const attack = game.messages.get(resolution.attack?.messageId ?? "");
  if ( !actor || !rangedWeaponHit(activity, attack?.system?.mode) || ((resolution.targets ?? []).length !== 1) ) return;
  const target = fromUuidSync(resolution.targets[0].token ?? "", { strict: false });
  if ( !target?.actor ) return;
  const options = smiteOptions(actor, { ranged: true }).filter(o => o.rule.onMiss === "half");
  if ( !options.length ) return;
  const answer = await askChoice(actor, { actor: actor.uuid, item: options[0].item.name, prompt: loc("FlecheFoudre.Question", { name: target.name }),
    options: [...options.map((o, i) => ({ id: `o${i}`, label: o.label })), { id: "none", label: loc("Chatiment.Aucun") }] });
  const option = options[Number(String(answer?.id ?? "").replace("o", ""))];
  if ( !answer?.id?.startsWith?.("o") || !option ) return;
  await spendSmite(actor, option);
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget ) await writeBudget(combatant, { ...budget, bonus: Math.max(0, (budget.bonus ?? 1) - 1) });
  const speaker = ChatMessage.implementation.getSpeaker({ actor });
  const dice = await rollActivityDice(option.item, option.rule.damage, option.level, loc("FlecheFoudre.Rate", { item: option.item.name, name: target.name }), speaker);
  if ( dice ) {
    const amount = Math.floor(dice.total / 2);
    await target.actor.applyDamage([{ value: amount, type: dice.type }]);
    notice(target, { key: "FlecheFoudre.Touche", data: { amount } }, "refused", { all: true });
    log(`${option.item.name}: missed, ${target.name} takes half (${amount} ${dice.type})`);
  }
  await blastAround(option.item, option.level, target);
}

async function onResolution(resolution) {
  if ( (resolution?.step === STEPS.MISSED) && resolution.plan?.attack && !seen.has(resolution.id) ) {
    seen.add(resolution.id);
    return onMissed(resolution);
  }
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const damage = game.messages.get(resolution.damageRoll?.messageId ?? "");
  const smite = damage?.getFlag(MODULE_ID, "smite");
  if ( !smite ) return;
  seen.add(resolution.id);
  const item = fromUuidSync(smite.item, { strict: false });
  const actor = item?.actor;
  if ( !actor ) return;
  if ( smite.kind === "rider" ) return applyRider(smite, item, resolution);
  // "Bonus Action, which you take immediately after hitting".
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget ) await writeBudget(combatant, { ...budget, bonus: Math.max(0, (budget.bonus ?? 1) - 1) });
  if ( (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true)) ) await afterSmite(actor, item);
  // §288: the burst of Lightning Arrow, the target hit (even if down).
  if ( smite.blast ) {
    const struck = fromUuidSync(smite.target, { strict: false });
    if ( struck ) await blastAround(item, smite.level ?? Number(item.system.level), struck);
  }
  if ( !smite.save && !smite.effect ) return;
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit ) return;
  // §176: a target dropped to 0 HP by the blow takes neither the effect nor the saving throw; the burst (Hail of Thorns) still
  // hits its neighbours — "the target and each creature within 1.50 m of it".
  const burst = contentOf(item).entry?.smite?.burst;
  const down = (target.actor.system.attributes?.hp?.value ?? 0) <= 0;
  if ( down ) log(`${smite.name}: ${target.name} is at 0 Hit Points, no effect and no saving throw`);
  if ( down && !burst ) return;
  // §402: a Concentration smite (Trapping Strike) starts it now — the slot is spent without dnd5e's `use()`,
  // which would have opened it; the effects placed depend on it and drop with it.
  const concentration = (!down && item.requiresConcentration) ? await beginSmiteConcentration(actor, item, smite) : null;
  // §42.2: the effect that the spell places on hitting, without a saving throw ("Seared", "Blinded"), at the cast level.
  if ( smite.effect && !down ) await placeItemEffect(item, smite.effect, target.actor, { scaling: smite.scaling ?? 0, dependentOn: concentration?.uuid ?? null });
  if ( !smite.save ) return;
  const save = item.system.activities?.get(smite.save);
  if ( !save ) return;
  const source = actor.getActiveTokens(false, true)[0] ?? null;
  if ( !source ) return;
  // §262: "if the attack reduces the target to 50 Hit Points or fewer" (Banishing Smite).
  const ceiling = contentOf(item).entry?.smite?.saveAtMostHp;
  const hp = target.actor.system.attributes?.hp?.value ?? 0;
  if ( !down && ceiling && (hp > ceiling) ) { log(`${smite.name}: ${target.name} still has ${hp} HP (> ${ceiling}), no saving throw`); return; }
  if ( !down ) {
    log(`${smite.name}: ${target.name} makes their saving throw`);
    await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte", scaling: smite.scaling ?? 0, concentration: concentration?.id ?? null });
  }
  // §164: "the target and each creature within 1.50 m of it" (Hail of Thorns).
  if ( !burst ) return;
  let radius = lengthIn(burst.radius, burst.units, target.parent.grid.units);
  for ( const other of target.parent.tokens ) {
    if ( (other === target) || !other.actor || other.hidden || ((other.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    if ( distanceBetween(target, other).value > radius + 1e-6 ) continue;
    log(`${smite.name}: ${other.name}, within ${burst.radius} ${burst.units} of ${target.name}, makes their saving throw`);
    await strikeAgainst(save, source, other, { flavor: "DND5ECOMBAT.Chatiment.Carte", scaling: smite.scaling ?? 0, concentration: concentration?.id ?? null });
  }
}

/**
 * §31: after the blow, what the boon places on the target still standing: the item's effect ("Froid mordant": Speed −3 m
 * until the start of the goliath's next turn — `effectEnds` content), or a condition ("Renversement des coteaux": Prone).
 */
async function applyRider(smite, item, resolution) {
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit || ((target.actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  // §372: placed as the effect of a smite (`placeItemEffect`: origin and `_stats.duplicateSource`) — a rule that targets
  // THIS effect of the item (`maxNextHit` by id: "Mise en danger") recognises it.
  if ( smite.effect ) {
    const placed = await placeItemEffect(item, smite.effect, target.actor);
    if ( placed ) log(`${smite.name}: "${placed.name}" placed on ${target.name}`);
  }
  if ( smite.status ) {
    await target.actor.toggleStatusEffect(smite.status, { active: true });
    log(`${smite.name}: ${target.name} receives "${smite.status}"`);
  }
  // §129: the boon's push ("Bagarreur de tavernes": 1.50 m), from the author.
  if ( smite.push ) {
    const source = item.actor?.getActiveTokens(false, true)[0] ?? null;
    if ( source ) {
      const { cells, wanted } = await pushAway(source, target, smite.push, readUnitFactors());
      log(`${smite.name}: ${target.name} pushed ${cells} square(s) out of ${wanted}`);
    }
  }
  // §78: the boon's saving throw ("Piqué": Strength or Prone), played on the target still standing.
  const save = smite.save ? item.system.activities?.get(smite.save) : null;
  const source = save ? (item.actor?.getActiveTokens(false, true)[0] ?? null) : null;
  if ( save && source && ((target.actor.system.attributes?.hp?.value ?? 0) > 0) ) {
    log(`${smite.name}: ${target.name} makes their saving throw`);
    await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte", scaling: smite.scaling ?? 0 });
  }
}

export function registerSmite() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "smite" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`smite:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "smite: saving throw not played" });
}
