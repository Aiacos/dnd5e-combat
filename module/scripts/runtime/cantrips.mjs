/**
 * Cantrips (SPEC §23): what dnd5e's data does not say.
 *
 *  - `effectEnds` (active GM): an item effect ends at the start of the caster's next turn (Ray of Frost), at the end of their
 *    next turn (Chill Touch, Mind Sliver, Vicious Mockery), at the start of the bearer's next turn (Shocking Grasp)
 *    or at the end of their next turn (Haste's lethargy, §42.2).
 *    At its placement, the engine notes the turn and gives it a duration of one minute, so that dnd5e's expiry ("1 round", at
 *    the start of any turn) does not pass first.
 *  - `blocksHealing` (applying client): the bearer of an item effect does not regain HP (Chill Touch).
 *  - `byWounds` (author's client): Toll the Dead rolls the dice of the right activity — d12 against a wounded target, d8
 *    otherwise; and the "unharmed target / wounded target" choice that dnd5e opens for an item with two activities is no
 *    longer asked (§41.1; runtime/activity-choice.mjs, which reads `byWounds`).
 *  - `oneAttack` (active GM): the True Strike enchantment ends after the weapon attack. The attack itself is offered by
 *    the interface as soon as the enchantment is placed (ui/pointer.mjs).
 * Mind Sliver (`breaksOn: ["save"]`): runtime/breaks.mjs; Shocking Grasp (`noOpportunityAttacks`): runtime/reactions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { effectEndsNow } from "../core/effect-ends.mjs";
import { traitBlocksHealing } from "../core/healing-block.mjs";
import { extendedSeconds } from "../core/extended.mjs";
import { usageMetamagic, pendingMetamagic } from "../adapter/metamagic.mjs";
import { contentOf, entryOfIdentifier } from "../adapter/content.mjs";
import { potionOfCast } from "../adapter/potions.mjs";
import { durationSeconds } from "../core/rolled-duration.mjs";
import { durationAtLevel } from "../core/durations.mjs";
import { reducesSpeed, withoutSpeedReductions } from "../core/speed-floor.mjs";
import { originItemOf, isWounded } from "../adapter/facts.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { currentTurnKey, combatSceneActors, turnKeyAt } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

/** The `effectEnds` rule that applies to this effect (placed by an item), or null. */
function endRuleOf(effect) {
  const item = originItemOf(effect);
  const rules = item ? contentOf(item).entry?.effectEnds : null;
  if ( !rules ) return null;
  // §157: `status:<id>` — a condition placed by the item with no effect of its own (`status` step: Stunned from Stunning Smite).
  const key = Object.keys(rules).find(id => id.startsWith("status:") ? effect.statuses?.has?.(id.slice(7)) : comesFromItemEffect(effect, id));
  return key ? { when: rules[key], caster: item.actor ?? null } : null;
}

/**
 * §42.2: does the content itself make this effect fall on its bearer's turn (`remove` at startOfTurn / endOfTurn: the delayed
 * damage of Melf's Acid Arrow, of Vitriolic Sphere)? Their duration of "1 turn" would expire at the very turn change where
 * the damage must fall — and an effect expired in combat is not deleted by dnd5e but suspended (`isSuppressed`,
 * client/documents/active-effect.mjs:192; documents/active-effect.mjs:804), thus ignored: seen in play on 2026-10-01.
 */
function removedAtTurn(effect) {
  const item = originItemOf(effect);
  if ( !item ) return false;
  return (contentOf(item).entry?.triggers ?? []).some(d => (d.via === "effect")
    && [].concat(d.on ?? []).some(m => ["startOfTurn", "endOfTurn"].includes(m))
    && (!d.fromEffect || comesFromItemEffect(effect, d.fromEffect))
    && (d.do ?? []).some(s => s.type === "remove"));
}

/** O9h (§363): durations drawn per use (`{ formula, units }`), so that all targets of the same use have the same one. */
const drawn = new Map();

/** The duration of this effect per the `effectDurations` rule — drawn once per use (origin message) and per item. */
function drawnDuration(effect, item, rule) {
  if ( Number.isFinite(rule.seconds) ) return rule.seconds;
  const now = Date.now();
  for ( const [k, v] of drawn ) if ( now - v.at > 30000 ) drawn.delete(k);
  const key = `${item.uuid}|${effect.system?.origin?.message ?? effect.origin ?? ""}`;
  if ( !drawn.has(key) ) {
    const seconds = durationSeconds(rule);
    drawn.set(key, { seconds, at: now });
    if ( seconds ) log(`${item.name}: duration ${rule.formula} ${rule.units} → ${seconds} s`);
  }
  return drawn.get(key).seconds;
}

/** Was this spell cast with Extended Spell? The effect's origin card carries it; otherwise what its caster retains. */
function extendedCast(effect, item) {
  const usage = game.messages?.get(effect.system?.origin?.message ?? "");
  if ( usage ) return usageMetamagic(usage).includes("extended");
  return pendingMetamagic(item.actor).includes("extended");
}

/** O9h (§363): an effect of the spell that an object cast (copy `cachedFor`) lasts what the object declares (`castDuration`). */
export function castDurationOf(spell) {
  const potion = spell ? potionOfCast(spell) : null;
  return potion?.identifier ? (entryOfIdentifier(potion.identifier)?.castDuration?.seconds ?? null) : null;
}

/**
 * Before placement, on the client that creates the effect: the noted turn, a duration of one minute (the end time is the
 * engine's). In the creation data, with no write: an update right after crossed the rewrite of an unlinked token ("A parent
 * Document provided to the database operation must be a Document instance", seen on 2026-09-28).
 */
function onPreCreateEffect(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return true;
  // §295: `effectDurations` — the duration that the rule gives to this item effect (Frightful Presence: one minute, the data says
  // one round), in and out of combat. An `effectEnds` rule of the same effect, further down, keeps control of its end.
  const item = originItemOf(effect);
  const durations = item ? contentOf(item).entry?.effectDurations : null;
  const wanted = durations ? Object.entries(durations).find(([id]) => comesFromItemEffect(effect, id))?.[1] : null;
  const seconds = wanted ? drawnDuration(effect, item, wanted) : castDurationOf(item);
  if ( seconds ) effect.updateSource({ duration: { value: seconds, units: "seconds", expiry: null } });
  // Extended Spell (Metamagic): the effect of a spell cast with this option lasts double (24 hours at most); marked, for
  // the Advantage on Concentration saves (runtime/feats.mjs). The option is read on the spell's card, or — for the
  // Concentration effect, created during the use — on what the caster retained.
  if ( (item?.type === "spell") && extendedCast(effect, item) ) {
    const longer = extendedSeconds(effect._source?.duration ?? effect.duration);
    effect.updateSource({ ...(longer ? { duration: { value: longer, units: "seconds", expiry: null } } : {}),
      [`flags.${MODULE_ID}.extendedSpell`]: true });
    if ( longer ) log(`${item.name}: ${effect.name} lasts ${longer} s (Extended Spell)`);
  }
  // §403: `keepsSpeed` — Freedom of Movement: "its Speed can't be reduced by magic". A magical effect (spell, magic
  // item) placed on a protected bearer arrives without its Speed reductions (Ray of Frost, Slow, Irresistible Dance).
  const changes = effect.system?.changes ?? effect.changes ?? [];
  if ( changes.some(reducesSpeed) && magicalOrigin(item) && speedKept(effect.parent) ) {
    effect.updateSource({ "system.changes": withoutSpeedReductions(changes) });
    log(`${effect.parent.name}: ${effect.name} cannot reduce its Speed (magic)`);
  }
  // §403: `durationByLevel` — the duration by casting slot (Bestow Curse), on the placed effects and on Concentration.
  const byLevel = item ? contentOf(item).entry?.durationByLevel : null;
  if ( byLevel ) {
    const tier = durationAtLevel(byLevel, (Number(item.system?.level) || 0) + (Number(effect.flags?.dnd5e?.scaling) || 0));
    if ( tier ) {
      effect.updateSource({ duration: { value: tier.seconds, units: tier.seconds ? "seconds" : "", expiry: null } });
      log(`${item.name}: ${effect.name} lasts ${tier.seconds ? `${tier.seconds} s` : "until dispelled"} (cast level)`);
    }
  }
  if ( !game.combat?.started ) return true;
  if ( !endRuleOf(effect) && !removedAtTurn(effect) ) return true;
  effect.updateSource({ [`flags.${MODULE_ID}.placedOn`]: currentTurnKey(), duration: { value: 60, units: "seconds", expiry: null } });
  return true;
}

async function expire(combat, prior, current) {
  const priorActor = combat.combatants.get(prior?.combatantId)?.actor ?? null;
  const currentActor = combat.combatants.get(current?.combatantId)?.actor ?? null;
  const priorKey = turnKeyAt(combat, prior);
  for ( const actor of combatSceneActors(combat) ) {
    const gone = actor.effects.filter(effect => {
      const rule = endRuleOf(effect);
      if ( !rule ) return false;
      const caster = rule.caster?.uuid ?? null;
      const placedOn = effect.getFlag(MODULE_ID, "placedOn");
      // §42.2: "until the end of its next turn" (Haste lethargy) is not the end of the turn in which the effect was placed;
      // "until the end of the current turn" (`currentTurnEnd`) is (core/effect-ends.mjs).
      return effectEndsNow(rule.when, {
        casterStarts: !!currentActor && (currentActor.uuid === caster),
        bearerStarts: !!currentActor && (currentActor.uuid === actor.uuid),
        casterEnded: !!priorActor && (priorActor.uuid === caster),
        bearerEnded: !!priorActor && (priorActor.uuid === actor.uuid),
        placedInEnded: !!priorKey && (placedOn === priorKey) });
    });
    const ids = gone.map(e => e.id).filter(id => actor.effects.has(id));
    if ( !ids.length ) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${actor.name}: ${gone.map(e => e.name).join(", ")} ends (turn)`);
  }
}

/* -------------------------------------------- */

/** A spell, or an item with the Magical property. */
function magicalOrigin(item) {
  return !!item && ((item.type === "spell") || (item.system?.properties?.has?.("mgc") === true));
}

/** §403: does the actor carry an effect from an item with `keepsSpeed` (Freedom of Movement)? */
function speedKept(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e)).entry?.keepsSpeed === true));
}

/**
 * §403: `durationByLevel` — at the slot where the spell no longer requires Concentration (Bestow Curse at level 5+), dnd5e does
 * not start it: `usageConfig.concentration.begin` is read just after this hook (activity/mixin.mjs:338, then 278).
 */
function onPreActivityConsumption(activity, usageConfig) {
  const rule = activity?.item ? contentOf(activity.item).entry?.durationByLevel : null;
  if ( !rule || !usageConfig?.concentration?.begin ) return true;
  const level = (Number(activity.item.system?.level) || 0) + (Number(usageConfig.scaling) || 0);
  if ( durationAtLevel(rule, level)?.concentration === false ) {
    usageConfig.concentration.begin = false;
    log(`${activity.item.name}: cast at level ${level}, no Concentration`);
  }
  return true;
}

/** Chill Touch: no HP regained while the effect holds. */
function onPreApplyDamage(actor, amount, updates) {
  // §505 (B25): `blocksTempHp` — Temporary Hit Points do not rise (a spell, a potion, a "temphp" healing card).
  if ( actor && blocksTempHp(actor) ) {
    const temp = Number(actor.system.attributes?.hp?.temp) || 0;
    if ( Number(updates["system.attributes.hp.temp"]) > temp ) {
      updates["system.attributes.hp.temp"] = temp;
      log(`${actor.name}: cannot gain Temporary Hit Points`);
    }
  }
  if ( !(amount < 0) || !actor?.effects ) return true;
  // §334: `blocksHealing` — all the item's effects, or those in the list ("Enervating Ray": its Poisoned alone).
  // §505: a trait without an effect that declares it applies to the creature that bears it (Swarm: "can't regain Hit Points").
  const byTrait = (actor.items ?? [])
    .some(i => traitBlocksHealing({ rule: contentOf(i).entry?.blocksHealing, effects: i.effects?.size ?? 0 }));
  const blocked = byTrait || actor.effects.some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const rule = contentOf(originItemOf(e)).entry?.blocksHealing;
    return (rule === true) || (Array.isArray(rule) && rule.some(id => comesFromItemEffect(e, id)));
  });
  if ( !blocked ) return true;
  const hp = actor.system.attributes?.hp?.value;
  if ( Number.isFinite(hp) && (updates["system.attributes.hp.value"] > hp) ) {
    updates["system.attributes.hp.value"] = hp;
    log(`${actor.name}: cannot regain Hit Points`);
  }
  return true;
}

/**
 * §505 (B25): can the creature not receive Temporary Hit Points? A trait it bears (`blocksTempHp: true` on the item), or an
 * effect from an item that declares it (all its effects, or those in the list).
 */
function blocksTempHp(actor) {
  if ( (actor.items ?? []).some(i => contentOf(i).entry?.blocksTempHp === true) ) return true;
  return (actor.effects ?? []).some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const rule = contentOf(originItemOf(e)).entry?.blocksTempHp;
    return (rule === true) || (Array.isArray(rule) && rule.some(id => comesFromItemEffect(e, id)));
  });
}

/** Toll the Dead: the dice of the activity that suits the target (wounded: `wounded`, unharmed: `healthy`). Author's client. */
function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const rule = activity?.item ? contentOf(activity.item).entry?.byWounds : null;
  if ( !rule || ![rule.healthy, rule.wounded].includes(activity.id) || !config.rolls?.length ) return true;
  const described = foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [];
  const actors = described.length ? described.map(t => fromUuidSync(t.token ?? "", { strict: false })?.actor).filter(Boolean)
    : Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
  if ( !actors.length ) return true;
  const wanted = actors.every(isWounded) ? rule.wounded : rule.healthy;
  if ( wanted === activity.id ) return true;
  const faceOf = a => Number(a?.damage?.parts?.[0]?.denomination) || null;
  const from = faceOf(activity);
  const to = faceOf(activity.item.system.activities.get(wanted));
  if ( !from || !to ) return true;
  const base = config.rolls[0];
  base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? String(p).replace(new RegExp(`d${from}(?!\\d)`, "g"), `d${to}`) : p));
  log(`${activity.item.name}: target ${wanted === rule.wounded ? "wounded" : "unhurt"}, d${from} → d${to}`);
  return true;
}

/**
 * True Strike: the enchantment only falls after the attack (below). Out of combat, V14 marks its "1 turn" duration as "expired"
 * (`duration.expired`), and dnd5e then deletes the effect (documents/active-effect.mjs:804) — seen on 2026-09-28, before one could
 * attack. That update is refused.
 */
function onPreUpdateEffect(effect, changes) {
  if ( foundry.utils.getProperty(changes, "duration.expired") !== true ) return true;
  if ( (effect.parent?.documentName !== "Item") || (contentOf(originItemOf(effect)).entry?.oneAttack !== true) ) return true;
  return false;
}

/** True Strike: after the attack with the enchanted weapon, the enchantment falls. Active GM. */
async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) || !resolution.plan?.attack ) return;
  const weapon = fromUuidSync(resolution.activity, { strict: false })?.item;
  if ( !weapon?.effects ) return;
  const once = weapon.effects.filter(e => contentOf(originItemOf(e)).entry?.oneAttack === true);
  const ids = once.map(e => e.id).filter(id => weapon.effects.has(id));
  if ( !ids.length ) return;
  await weapon.deleteEmbeddedDocuments("ActiveEffect", ids);
  log(`${weapon.name}: ${once.map(e => e.name).join(", ")} drops after the attack`);
}

export function registerCantrips() {
  route("preCreateActiveEffect", onPreCreateEffect, { cancellable: true, label: "spell effect end not recorded" });
  route("dnd5e.preActivityConsumption", onPreActivityConsumption, { cancellable: true, label: "spell without Concentration at a higher level" });
  route("preUpdateActiveEffect", onPreUpdateEffect, { cancellable: true, label: "True Strike: enchantment expired too early" });
  route("combatTurnChange", (combat, prior, current) => enqueue("cantrips:ends", () => expire(combat, prior, current)),
    { executor: true, label: "spell effect end not played" });
  route("dnd5e.preApplyDamage", onPreApplyDamage, { label: "healing blocked" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Toll the Dead: target's dice" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`oneAttack:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "attack enchantment not removed" });
}
