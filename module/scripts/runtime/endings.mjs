/**
 * Spell endings (SPEC §42.2): what follows the end of an effect.
 *
 *  - `effectThen` (active GM): when an item effect ceases on a creature — duration elapsed, concentration broken, dispelled,
 *    removed by hand —, another effect of the same item is placed on it. Haste: "when the spell ends, the target is Incapacitated
 *    and its Speed is 0 until the end of its next turn" (the "Lethargy" effect, which `effectEnds` drops at the end of the
 *    bearer's next turn, runtime/cantrips.mjs).
 *  - §258 `endsWhen` (active GM): the generic endings found by the CAT / CPR audit (core/endings.mjs) — armor donned, bearer and
 *    caster too far apart, 0 HP, and concentration that drops when the use affected no one (setting `endUnaffected`).
 * The other endings live with their building block: repeated save and damage on the bearer's turn (runtime/triggers.mjs), effect
 * broken by what its bearer does (`breaksOn`, runtime/breaks.mjs), end on a specific turn (`effectEnds`, runtime/cantrips.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { damagedByOriginSide } from "../core/triggers.mjs";
import { itemFacts } from "../adapter/antimagic.mjs";
import { areEnemies, sideOf } from "../adapter/factions.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import {
  ARMOR_WEIGHTS, armorEnds, healsMagically, isEndableEnchantment, isReplayUsage, nobodyAffected, tooFarApart, zeroHpEnds
} from "../core/endings.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { contentOf } from "../adapter/content.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { potionOfCast } from "../adapter/potions.mjs";
import { risingAtZero } from "../adapter/rise.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, locEsc, notice, say, sleep } from "./shared.mjs";

export const END_UNAFFECTED_SETTING = "endUnaffected";

async function onDeleteEffect(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const item = originItemOf(effect);
  // §289: the table that the end of the effect makes roll ("Living Shadow": "Will of the Shadow").
  const draws = item ? contentOf(item).entry?.drawsOnEnd : null;
  const drawn = draws ? Object.keys(draws).find(id => comesFromItemEffect(effect, id)) : null;
  if ( drawn && ((actor.system?.attributes?.hp?.value ?? 0) > 0) ) {
    enqueue(`drawsOnEnd:${actor.uuid}`, async () => {
      const table = await fromUuid(draws[drawn]).catch(() => null);
      if ( !table?.draw ) return;
      const token = actor.getActiveTokens?.(false, true)?.[0] ?? null;
      if ( token ) notice(token, { key: "Retour.TableTiree", data: { table: table.name } }, "refused", { all: true });
      await table.draw({ displayChat: true });
      log(`${item.name}: "${effect.name}" ends on ${actor.name}, table "${table.name}" drawn`);
    }).catch(err => console.error(`${MODULE_ID} | drawsOnEnd`, err));
  }
  // §367: the activity that the end of the effect makes used around its bearer ("Spirit of the Shadow").
  const ending = item ? contentOf(item).entry?.endActivity : null;
  const endKey = ending ? Object.keys(ending).find(id => comesFromItemEffect(effect, id)) : null;
  if ( endKey ) enqueue(`endActivity:${actor.uuid}`, () => useOnEnd(item, ending[endKey], actor, effect))
    .catch(err => console.error(`${MODULE_ID} | endActivity`, err));
  // §53: the spell that a potion made cast has no sequel (Potion of Speed: "without the wave of lethargy" of Haste).
  const rules = (item && !potionOfCast(item)) ? contentOf(item).entry?.effectThen : null;
  if ( !rules ) return;
  const key = Object.keys(rules).find(id => comesFromItemEffect(effect, id));
  if ( !key ) return;
  // A creature at 0 HP has nothing left to suffer; nor does an actor of a token deleted with its token.
  if ( (actor.system?.attributes?.hp?.value ?? 0) <= 0 ) return;
  if ( actor.isToken ? !actor.token?.parent?.tokens?.has(actor.token.id) : !game.actors.has(actor.id) ) return;
  return enqueue(`effectThen:${actor.uuid}`, async () => {
    const placed = await placeItemEffect(item, rules[key], actor, { scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0 });
    if ( placed ) log(`${item.name}: "${effect.name}" ends on ${actor.name}, "${placed.name}" applied`);
  });
}

/**
 * §367: `endActivity` — the effect has ended: the item's activity, used by its owner (the caster) on the creatures within `radius`
 * of the bearer (it excluded, alive, visible on the scene), without a template and spending nothing; no one around: nothing.
 */
async function useOnEnd(item, rule, actor, effect) {
  const activity = item.system.activities?.get(rule.activity);
  const bearer = actor.isToken ? actor.token : (actor.getActiveTokens?.(false, true)?.[0] ?? null);
  if ( !activity || !bearer?.parent || (bearer.parent !== canvas.scene) ) return;
  const reach = lengthIn(rule.radius, rule.units, bearer.parent.grid.units);
  const around = bearer.parent.tokens.filter(t => t.actor && (t !== bearer) && !t.hidden && t.object
    && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && (distanceBetween(bearer, t).value <= reach + 1e-6));
  log(`${item.name}: "${effect.name}" ends on ${actor.name}, "${activity.name}" on ${around.map(t => t.name).join(", ") || "nobody"}`);
  if ( !around.length ) return;
  canvas.tokens.setTargets(around.map(t => t.id));
  // No template: the message's targets (`givenTargets`, §104), like an area whose targets are supplied.
  await activity.use({ consume: false, [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false } }, { configure: false },
    { data: { flags: { [MODULE_ID]: { givenTargets: true } } } });
}

/* -------------------------------------------- */
/*  §258: generic endings (`endsWhen`)           */
/* -------------------------------------------- */

const rulesOf = item => (item ? contentOf(item).entry?.endsWhen ?? null : null);

/** The actors of a scene: those of the world (linked) and those of unlinked tokens. */
const actorsOf = scene => new Set([...game.actors, ...(scene?.tokens ?? []).filter(t => !t.actorLink && t.actor).map(t => t.actor)]);

/**
 * §527: only the actors with a token on the scene — for distance links (`apart`), judged only when bearer and caster are both there
 * (`apartTooFar`). Read on every step of a token: walking through every actor of the world cost for nothing (baileywiki's report,
 * 2026-11-24).
 */
const sceneActorsOf = scene => new Set((scene?.tokens ?? []).map(t => t.actor).filter(Boolean));

/**
 * The carried effects that an `endsWhen` rule of their source item can make cease (the caster's concentration excepted: it drops
 * through the spell, not as a carried effect).
 * @returns {{actor: Actor, effect: ActiveEffect, item: Item, rule: object}[]}
 */
function endingEffects(actors) {
  const out = [];
  for ( const actor of actors ) {
    for ( const effect of actor?.effects ?? [] ) {
      if ( effect.statuses?.has?.("concentrating") ) continue;
      const item = originItemOf(effect);
      const rule = rulesOf(item);
      if ( rule ) out.push({ actor, effect, item, rule });
    }
    // §447: an enchantment placed on one of its items ("Savage Wrath": "transformed" by an enchantment of the feature itself) —
    // the bearer is the owner of the enchanted item; removing it removes its companion effects (dnd5e). Only the enchantment
    // placed: the definition the item carries for its "enchant" activity is not a running effect.
    for ( const enchanted of actor?.items ?? [] ) {
      for ( const effect of enchanted.effects ?? [] ) {
        const { type, disabled, isAppliedEnchantment: applied } = effect;
        // §525: the item profile activated in its place ("Savage Wrath") carries its own profile mark (adapter/content.mjs).
        const ownProfile = effect.flags?.dnd5e?.enchantmentProfile === effect.id;
        if ( !isEndableEnchantment({ type, disabled, applied, ownProfile }) ) continue;
        const item = originItemOf(effect);
        const rule = rulesOf(item);
        if ( rule ) out.push({ actor, effect, item, rule });
      }
    }
  }
  return out;
}

/** The token of an actor on this scene, or null. */
function tokenIn(actor, scene) {
  if ( !actor || !scene ) return null;
  if ( actor.isToken ) return (actor.token?.parent === scene) ? actor.token : null;
  return scene.tokens.find(t => t.actorLink && (t.actorId === actor.id)) ?? null;
}

/**
 * §525: switches off an item profile activated in place of a self-enchantment (runtime/enchant.mjs) — what it added (its "riders",
 * `flags.dnd5e.dependents`) is removed as dnd5e would on deleting an enchantment, then the profile is disabled and loses its
 * mark: it becomes a definition again that the activity can relight.
 * @param {ActiveEffect} effect
 */
async function switchOffProfile(effect) {
  for ( const dependent of effect.getDependents?.() ?? [] ) {
    if ( dependent instanceof foundry.abstract.Document ) await dependent.delete().catch(() => null);
    else await dependent.item?.system?.activities?.get?.(dependent.id)?.delete?.().catch?.(() => null);
  }
  await effect.update({ disabled: true });
  await effect.unsetFlag("dnd5e", "enchantmentProfile");
  await effect.unsetFlag("dnd5e", "dependents");
}

/**
 * Ends the effect — or, `spell`, the whole spell: its concentration (dnd5e then removes the effects that depend on it), otherwise
 * its effects on every creature of the scene. A chat card tells the whole table.
 * @param {{actor, effect, item, rule}} entry
 * @param {"armor"|"apart"|"zeroHp"} reason
 * @param {Set<string>} done  The spells already ended during this pass.
 */
async function endEntry({ actor, effect, item, rule }, reason, scene, done) {
  if ( done.has(item.uuid) || done.has(effect.uuid) ) return;
  if ( rule.spell ) {
    done.add(item.uuid);
    const concentration = concentrationOn(item);
    if ( concentration ) await concentration.delete();
    else {
      for ( const other of endingEffects(actorsOf(scene)).filter(e => e.item === item) ) {
        if ( other.effect.parent?.effects?.has(other.effect.id) ) await other.effect.delete();
      }
    }
  }
  else {
    done.add(effect.uuid);
    if ( !effect.parent?.effects?.has(effect.id) ) return;
    // §525: an item profile activated in its place switches off — removing it would empty the item of this profile for good.
    if ( effect.flags?.dnd5e?.enchantmentProfile === effect.id ) await switchOffProfile(effect);
    else await effect.delete();
  }
  log(`${item.name}: ends${rule.spell ? "" : ` on ${actor.name}`} (${reason})`);
  // §252: floating text on every client, and a sound.
  const token = tokenIn(actor, scene);
  if ( token ) notice(token, item.name, "effectOff", { all: true, action: "spellEnds", outcome: "success" });
  await say({ actor: item.actor ?? actor }, locEsc(`FinGenerique.${reason}`, { item: item.name, name: actor.name }),
    { ended: { item: item.uuid, actor: actor.uuid, reason } });
}

/** The armor donned: Mage Armor (any armor), Rage (heavy armor). */
async function onUpdateItem(item, changes) {
  if ( (item.type !== "equipment") || (foundry.utils.getProperty(changes, "system.equipped") !== true) ) return;
  const weight = item.system?.type?.value;
  const actor = item.parent;
  if ( !ARMOR_WEIGHTS.includes(weight) || (actor?.documentName !== "Actor") ) return;
  const entries = endingEffects([actor]).filter(e => e.rule.armor && armorEnds(e.rule.armor, weight));
  if ( !entries.length ) return;
  const scene = tokenIn(actor, canvas?.scene) ? canvas.scene : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "armor", scene, done);
  });
}

/** §270: a caster's ally (not the caster) just hurt the bearer (Compelled Duel) — author noted by runtime/triggers.mjs (`damagedBy`). */
function hurtByCasterAlly(actor, caster, scene) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.uuid || ((Date.now() - (noted.at ?? 0)) > 10000) ) return false;
  const damager = fromUuidSync(noted.uuid, { strict: false });
  if ( !damager || !caster || (damager === caster) ) return false;
  const dt = tokenIn(damager, scene), ct = tokenIn(caster, scene);
  return damagedByOriginSide({ damager: damager.uuid, origin: caster.uuid, damagerDisposition: dt?.disposition ?? null,
    originDisposition: ct?.disposition ?? null, damagerSide: dt ? sideOf(dt) : null, originSide: ct ? sideOf(ct) : null });
}

/**
 * §299 (pass C4): an incapacitating condition (Incapacitated, and what grants it: Stunned, Paralyzed, Unconscious, dead…) has
 * just been placed — the effects whose `endsWhen.incapacitated` rule targets this bearer (`bearer`: Draconic Flight, "Form of
 * Dread") or this caster (`caster`: Turn Undead, "Calcination"; "if you have the Incapacitated condition or if you die") end.
 */
async function onIncapacitated(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || !Array.from(effect.statuses ?? []).some(s => INCAPACITATING.includes(s)) ) return;
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  const entries = endingEffects(actorsOf(scene)).filter(e => {
    const who = e.rule.incapacitated;
    if ( !who ) return false;
    const bearer = (e.actor === actor) && ["bearer", "either"].includes(who);
    const caster = (e.item.actor === actor) && ["caster", "either"].includes(who);
    return bearer || caster;
  });
  if ( !entries.length ) return;
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    // §447: dropped to 0 HP with the means to get back up (`atZero`: "Persistent Wrath", which precisely requires
    // "Savage Wrath") — the end waits for the decision; once back up, the incapacitating condition is gone and nothing ends
    // ("your HP change instead").
    if ( ((actor.system.attributes?.hp?.value ?? 1) <= 0) && risingAtZero(actor) ) {
      for ( let n = 0; (n < 240) && risingAtZero(actor); n++ ) await sleep(500);
      if ( !actor.effects.has(effect.id) ) { log(`${actor.name}: rose at 0 Hit Points, nothing ends`); return; }
    }
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "incapacitated", scene, done);
  });
}

/** 0 HP: the bearer and/or the caster whose effects run on others, as `zeroHp` says (Warding Bond: the caster only, issue #150); §270: hurt by an ally of the caster. */
async function onUpdateActor(actor, changes) {
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if ( hp === undefined ) return;
  if ( hp > 0 ) return onHurt(actor);
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  const entries = endingEffects(actorsOf(scene)).filter(e => zeroHpEnds(e.rule.zeroHp, { isBearer: e.actor === actor, isCaster: e.item.actor === actor }));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "zeroHp", scene, done);
  });
}

async function onHurt(actor) {
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  const entries = endingEffects([actor]).filter(e => e.rule.allyDamages && hurtByCasterAlly(actor, e.item.actor, scene));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "allyDamages", scene, done);
  });
}

/**
 * §270: the caster has just used an activity that targets a creature other than the bearer — an attack roll against it, or a
 * spell on an enemy (Compelled Duel: "if you make an attack roll against a creature other than the target, if you cast a spell
 * on an enemy other than the target"). The use message carries its targets.
 */
async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const caster = activity?.actor;
  const targets = (message.system?.targets ?? []).map(t => fromUuidSync(t.token ?? "", { strict: false })).filter(Boolean);
  if ( !caster || !targets.length ) return;
  const scene = targets[0].parent;
  const entries = endingEffects(actorsOf(scene)).filter(e => e.rule.casterTargetsOther && (e.item.actor === caster) && (e.item !== activity.item));
  if ( !entries.length ) return;
  const casterToken = tokenIn(caster, scene);
  return enqueue(`endsWhen:${caster.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) {
      const bearer = tokenIn(e.actor, scene);
      const others = targets.filter(t => t !== bearer);
      const breaks = (activity.type === "attack") ? others.length > 0
        : (isSpellCast(activity.item) && others.some(t => casterToken && areEnemies(casterToken, t)));
      if ( breaks ) await endEntry(e, "casterTargetsOther", scene, done);
    }
  });
}

/** Are the bearer and caster too far apart? Caster absent from the scene: we do not judge. */
function apartTooFar({ actor, item, rule }, scene) {
  const bearer = tokenIn(actor, scene);
  const caster = tokenIn(item.actor, scene);
  if ( !bearer || !caster || (bearer === caster) ) return false;
  const { value, units } = distanceBetween(bearer, caster);
  return tooFarApart(value, lengthIn(rule.apart.distance, rule.apart.units, units));
}

/** A token moved: the distance links that concern it, bearer or caster (`apart.at`: "move", by default). */
async function onMoveToken(tokenDoc) {
  const scene = tokenDoc.parent;
  const moved = tokenDoc.actor;
  if ( !moved ) return;
  const entries = endingEffects(sceneActorsOf(scene)).filter(e => e.rule.apart && ((e.rule.apart.at ?? "move") === "move")
    && ((e.actor === moved) || (e.item.actor === moved)));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:apart:${scene.id}`, async () => {
    const done = new Set();
    for ( const e of entries ) if ( apartTooFar(e, scene) ) await endEntry(e, "apart", scene, done);
  });
}

/** The end of the caster's turn: the links judged at that moment (`apart.at: "casterTurnEnd"`, Compelled Duel). */
async function onTurnChange(combat, prior) {
  const caster = combat.combatants.get(prior?.combatantId)?.actor;
  const scene = combat.scene ?? canvas?.scene;
  if ( !caster || !scene ) return;
  const entries = endingEffects(sceneActorsOf(scene)).filter(e => (e.rule.apart?.at === "casterTurnEnd") && (e.item.actor === caster));
  if ( !entries.length ) return;
  return enqueue(`endsWhen:apart:${scene.id}`, async () => {
    const done = new Set();
    for ( const e of entries ) if ( apartTooFar(e, scene) ) await endEntry(e, "apart", scene, done);
  });
}

/** The use is resolved and affected no one: the spell's concentration drops (setting `endUnaffected`). */
async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) ) return;
  if ( !game.settings.get(MODULE_ID, END_UNAFFECTED_SETTING) ) return;
  // §275: a replay (repeated save, area, reroll) does not say that the spell no longer affects anyone.
  if ( isReplayUsage(game.messages.get(resolution.carrier)?.flags?.[MODULE_ID]) ) return;
  const item = fromUuidSync(resolution.activity ?? "", { strict: false })?.item;
  const rule = rulesOf(item);
  if ( !rule?.unaffected || !nobodyAffected(resolution, rule.unaffected) ) return;
  const concentration = concentrationOn(item);
  if ( !concentration ) return;
  await concentration.delete();
  log(`${item.name}: nobody affected, concentration ends`);
  const caster = item.actor.isToken ? item.actor.token : item.actor.getActiveTokens?.(false, true)?.[0];
  if ( caster ) notice(caster, item.name, "effectOff", { all: true, action: "spellEnds", outcome: "success" });
  await say({ actor: item.actor }, locEsc("FinGenerique.unaffected", { item: item.name, name: item.actor.name }),
    { ended: { item: item.uuid, actor: item.actor.uuid, reason: "unaffected" } });
}

/**
 * §288: "you can end the spell early by using one of the special functions" (Dispel Evil and Good: Dismissal,
 * Break Enchantment) — once the use is made, the caster's concentration on the item drops (dnd5e removes what depends on it).
 */
async function onUsedEnding(activity) {
  const ids = contentOf(activity?.item).entry?.endsOnUse;
  if ( !ids?.includes(activity.id) || !activity.actor?.isOwner ) return;
  const concentration = concentrationOn(activity.item);
  if ( !concentration ) return;
  await activity.actor.endConcentration(concentration);
  const token = activity.actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( token ) notice(token, activity.item.name, "effectOff", { all: true, action: "spellEnds", outcome: "success" });
  log(`${activity.item.name}: ${activity.name || activity.id} used, the spell ends`);
}

/**
 * §495 (building block B15): magical healing received — the effects whose `endsWhen.healedByMagic` rule targets this bearer end.
 * `dnd5e.applyDamage` only runs on the applying client, which owns the actor (dnd5e requires it to write its HP):
 * the ending is played there. The source: the origin card the engine passes (`origin`, adapter/messages.mjs) or that of dnd5e's
 * "Apply" button (`originatingMessage`).
 */
async function onHealed(actor, amount, options) {
  if ( !(amount < 0) || !actor?.isOwner ) return;
  const entries = endingEffects([actor]).filter(e => e.rule.healedByMagic);
  if ( !entries.length ) return;
  const message = [options?.originatingMessage, options?.origin].find(m => m?.getAssociatedActivity) ?? null;
  const activity = message?.getAssociatedActivity?.() ?? null;
  const use = activity?.item ? { spellCast: isSpellCast(activity.item), item: itemFacts(activity.item), activityType: activity.type } : null;
  if ( !healsMagically(amount, use) ) {
    log(`${actor.name}: healed (${-amount}) without magic${activity ? ` (${activity.item.name})` : ""}, ${entries.map(e => e.effect.name).join(", ")} remains`);
    return;
  }
  const scene = actor.isToken ? actor.token?.parent : (actor.getActiveTokens?.(false, true)?.[0]?.parent ?? canvas?.scene);
  return enqueue(`endsWhen:${actor.uuid}`, async () => {
    const done = new Set();
    for ( const e of entries ) await endEntry(e, "healedByMagic", scene, done);
  });
}

export function registerEndings() {
  game.settings.register(MODULE_ID, END_UNAFFECTED_SETTING, {
    name: `DND5ECOMBAT.Reglage.${END_UNAFFECTED_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${END_UNAFFECTED_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "effect end: next effect not applied" });
  route("updateItem", onUpdateItem, { executor: true, label: "effect end on armor: not played" });
  route("updateActor", onUpdateActor, { executor: true, label: "effect end at 0 HP: not played" });
  route("dnd5e.applyDamage", onHealed, { label: "effect end on magical healing: not played" });
  route("createActiveEffect", onIncapacitated, { executor: true, label: "effect end when Incapacitated: not played" });
  route("createChatMessage", onUsage, { executor: true, label: "effect end when the caster targets another creature: not judged" });
  route("moveToken", onMoveToken, { executor: true, label: "effect end by distance: not judged" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "effect end by distance at turn end: not judged" });
  route("dnd5e.postUseActivity", activity => onUsedEnding(activity), { label: "spell ended by a special function: not ended" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`endsWhen:resolution:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "concentration end when nobody is affected: not played" });
}
