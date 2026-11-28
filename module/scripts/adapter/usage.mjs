/**
 * What a dnd5e 6.0 use message asks of the engine: the PLAN of the action machine
 * (core/action.mjs) and its targets. An activity without a plan keeps its native behavior.
 *
 * Verified in dnd5e 6.0.3:
 *  - the use message (`type: "usage"`) carries `system.targets` and finds its activity through
 *    `getAssociatedActivity()` (documents/chat-message.mjs:690)
 *  - using an attack activity chains its attack roll (activity/attack.mjs:68-70); the
 *    `damage` and `heal` activities THEMSELVES roll their roll on use
 *    (damage.mjs:51, heal.mjs:60) — the author need not roll it again; a `save` activity rolls nothing
 *  - a heal creates a `type: "healing"` message (heal.mjs:69-73), of the same shape as a damage message
 *  - for a template spell, the message is created BEFORE the area is placed
 *    (activity/mixin.mjs:293-296): its targets are worthless, we wait for the region
 *
 * Inventory of the system's 2024 packs (2026-09-21), which decided the shapes covered:
 * attack with on-hit effect 44 · `damage` activities 45 · `heal` 49 · utility with effect 118 ·
 * save 380 · attack + save on the same item: only 2 — chaining is DECLARED there
 * (`onHit.save` = id of the save activity, in the content or `flags["dnd5e-combat"].onHit`
 * of the item). Monster Manual attacks are recognized by their shape and their lead-in
 * (SPEC §18.4, M2, `core/riders.mjs`); their size gate too (M3).
 */

import { MODULE_ID } from "../constants.mjs";
import { usageMetamagic } from "./metamagic.mjs";
import { OUTCOME_STEPS } from "../core/content.mjs";
import { OUTCOME_DAMAGE, OUTCOME_GRAPPLE } from "../core/action.mjs";
import { placesOwnResistance } from "../core/turn-resistance.mjs";
import { siblingSaveOf, soleSaveOf, sizeGateOf } from "../core/riders.mjs";
import { chargeOnlyEffects } from "../core/variants.mjs";
import { variantPlanOf, useTimeVariant, advantageVariantOf } from "./variants.mjs";
import { contentOf, castItemOf, entryOfIdentifier, rangeUnitsOf } from "./content.mjs";
import { declaredBasicsOf } from "./basics.mjs";
import { projectilesOf } from "./projectiles.mjs";
import { declarationsOfItem } from "./triggers.mjs";
import { originItemOf } from "./facts.mjs";
import { isSpellCast, spellLevelOf, spellSchoolOf } from "./scrolls.mjs";
import { templateOf } from "./template.mjs";
import { isPotion, potionOfCast } from "./potions.mjs";
import { speakerTokenOf } from "./turn.mjs";

/** Stable key of an activity effect (`_id` for an item effect, `uuid` for a reference effect). */
export const effectKey = e => e._id ?? e.uuid;

/**
 * The effect of an activity profile (`activity.effects[i]`), read without waiting: on the item, or via `fromUuidSync` for a
 * UUID reference (null if it is not in memory, a compendium index if it is only indexed). Replaces the
 * `profile.effect` getter, which dnd5e 6.0 deprecates (removed in 6.2, `applied-effect-field.mjs:36`) in favor of `getEffect()`,
 * asynchronous when the profile carries a `uuid` (§126). Where one can wait, `await profile.getEffect()`.
 */
export const effectOfProfile = (profile, item) => (profile?._id ? item?.effects?.get?.(profile._id) : null)
  ?? (profile?.uuid ? fromUuidSync(profile.uuid, { strict: false }) : null) ?? null;

/**
 * The effects the activity applies at the level it is cast at: dnd5e's `applicableEffects`, which filters the profiles
 * by `level.min`/`level.max` according to `relevantLevel` (the spell level of the scaled copy,
 * `getAssociatedActivity({ scaled: true })`) — dnd5e 6.0.3, dnd5e.mjs:20091-20096 and :20165-20169. Without this filter, Aid
 * applied its eight "Level N: +X max HP" effects at once.
 */
export const applicableEffectsOf = activity => [...(activity?.applicableEffects ?? activity?.effects ?? []), ...poolEffectsOf(activity)];

/**
 * §37: the item's effects that the content has this activity offer without it linking them (`choice.pool`) — Bestow Curse's "Curse
 * Ability" links none of its six ability curses. Same shape as an activity effect profile (`_id`, `effect`, `getEffect`),
 * for the plan, the question and the application.
 */
export function poolEffectsOf(activity) {
  const item = activity?.item;
  const ids = item ? (contentOf(item).entry?.choice?.pool?.[activity.id] ?? []) : [];
  return ids.map(id => item.effects?.get(id)).filter(Boolean).map(effect => ({ _id: effect.id, effect, getEffect: async () => effect }));
}

/**
 * The activity's effects, with their moment. `condition` (optional): what the target must meet to receive them,
 * in JSON like a step's condition (M3: size gate).
 * §158, §226: none for a `zoneEffects` item, whatever the activity type — its effects are carried by the area (the
 * core's `applyActiveEffect` behavior, adapter/zone-effects.mjs); applied to the targets as well, they never went away.
 */
const effectsOf = (activity, when, condition=null) => (contentOf(activity.item).entry?.zoneEffects === true) ? []
  : applicableEffectsOf(activity).filter(e => !(contentOf(activity.item).entry?.dropsEffects ?? []).includes(effectKey(e))).map(e => ({
    id: effectKey(e), activity: activity.uuid, when: when(e), ...(condition ? { if: JSON.stringify(condition) } : {})
  }));

/** M5 (§18.8): the attack variant that the situation designates, for the message's first target. */
function attackVariant(message, activity, targets) {
  const attacker = speakerTokenOf(message);
  const target = targets[0]?.token ? fromUuidSync(targets[0].token) : null;
  return attacker ? useTimeVariant(activity, attacker, target) : null;
}

/**
 * M5 (§18.8): effects of the BASE attack that its charge variant also carries — they only hold after a charge
 * (Boar's Defense: "… moved 20+ feet straight toward it …, the target … has the Prone condition").
 */
function chargeOnly(activity) {
  const plan = variantPlanOf(activity.item);
  return (plan && (plan.base === activity.id)) ? chargeOnlyEffects(plan) : [];
}

/** The item's activities, as a list (`system.activities` is a collection). */
const activitiesOf = item => Array.from(item?.system?.activities?.values?.() ?? []);

/**
 * M3 (§18.4): "If the target is a Large or smaller creature, it has the Prone condition". The size is read in
 * `target.affects.special` of the activity or in the "If the target is…" sentence of the description.
 * @returns {object|null}  condition `{ "target.sizeAtMost": "lg" }`
 */
function sizeGate(activity) {
  const item = activity.item;
  const size = sizeGateOf({
    special: activity.target?.affects?.special ?? "",
    description: item?.system?.description?.value ?? "",
    specialOf: id => item?.system?.activities?.get?.(id)?.target?.affects?.special ?? ""
  });
  return size ? { "target.sizeAtMost": size } : null;
}

/**
 * The condition the target must meet to receive the attack's effects: the size gate (M3), and the one the content
 * declares (§71, `effectsIf`: "if the target drops to 0 HP because of this attack" → `{ "target.atZero": true }`, judged after
 * the damage). Both: both of them.
 */
function effectGate(activity) {
  const conditions = [sizeGate(activity), contentOf(activity.item).entry?.effectsIf ?? null].filter(Boolean);
  return (conditions.length > 1) ? { all: conditions } : (conditions[0] ?? null);
}

/**
 * Does the activity roll damage? We read the roll configuration that dnd5e would prepare (`getDamageConfig`), not
 * just the list of parts: a part can be empty (Bigby's Hand "Grapple": neither dice nor formula), and damage
 * can come from elsewhere (the flames of Flaming Sphere: empty part, `(niveau)d6` added by the summon,
 * §16.15). Without this method, the list of parts.
 */
function hasDamageParts(activity) {
  // §81: damage that the data puts where the rule gives none (Ensnaring Strike: on the casting save).
  if ( contentOf(activity.item).entry?.noDamage?.includes(activity.id) ) return false;
  if ( typeof activity.getDamageConfig !== "function" ) return (activity.damage?.parts?.length ?? 0) > 0;
  try { return (activity.getDamageConfig({})?.rolls ?? []).some(r => (r.parts ?? []).some(part => String(part ?? "").trim())); }
  catch { return (activity.damage?.parts?.length ?? 0) > 0; }
}

/**
 * `abilities`: all the allowed abilities (Grapple / Shove: Strength OR Dexterity, at the target's choice);
 * each target rolls the best one for itself (adapter/saves.mjs). `ability`: the first one,
 * for what depends on only one (automatic failure, log).
 * @returns {{ability: string, abilities: string[], dc: number, onSave: string, activity: string}|null}
 */
function saveOf(activity) {
  const dc = activity.save?.dc?.value;
  const abilities = Array.from(activity.save?.ability ?? []).filter(Boolean);
  if ( !Number.isFinite(dc) || !abilities.length ) return null;
  // §92: the rule takes precedence over the data (`saveDamage`: "Fearsome Stride", nothing on a success).
  const onSave = contentOf(activity.item).entry?.saveDamage?.[activity.id] ?? activity.damage?.onSave ?? "half";
  return { ability: abilities[0], abilities, dc, onSave, activity: activity.uuid };
}

/** Target descriptors of the message, reduced to what the core expects. */
const messageTargets = message => (message.system.targets ?? []).map(t => ({
  token: t.token, actor: t.actor, name: t.name, ac: t.ac ?? null
}));

/** The one who speaks in the message, as target (activity that targets only itself). */
function selfTarget(message) {
  const actorId = message.speaker?.actor;
  // §133: a Reaction used on the client of a player who has not selected their token (Defensive Duelist's Parry) speaks without a
  // token (`speaker.token` null): the actor's active token.
  const token = speakerTokenOf(message)
    ?? (actorId ? (game.actors.get(actorId)?.getActiveTokens?.(false, true)?.[0] ?? null) : null);
  return token?.actor ? [{ token: token.uuid, actor: token.actor.uuid, name: token.name, ac: null }] : [];
}

/** §345: the enchantments applied to the item from this profile (`flags.dnd5e.enchantmentProfile`, dnd5e activity/enchant.mjs:165). */
export function enchantedBy(item, profile) {
  return Array.from(item?.effects?.values?.() ?? []).filter(e => !e.disabled && (e.getFlag?.("dnd5e", "enchantmentProfile") === profile));
}

/**
 * The save that a hit attack imposes: the one the item declares, otherwise the sister save that the item's
 * shape announces (M2, Ghoul's Claw).
 */
function chainedSave(activity) {
  const item = activity.item;
  const onHit = item ? contentOf(item).entry?.onHit : null;
  // §345: a save that only applies under an enchantment of the item (the coated blade of the Dagger of Venom).
  if ( onHit?.whileEnchanted && !enchantedBy(item, onHit.whileEnchanted).length ) return null;
  // `"sole"`: the item's only save — the one an enchantment added to it (Sword of Wounding), with an unpredictable id.
  const declared = (onHit?.save === "sole") ? soleSaveOf(activitiesOf(item)) : onHit?.save;
  const id = item ? (declared ?? ((onHit?.save === "sole") ? null
    : siblingSaveOf(activitiesOf(item), item.system?.description?.value ?? ""))) : null;
  const sibling = id ? activity.item.system.activities?.get(id) : null;
  if ( sibling?.type !== "save" ) return null;
  const save = saveOf(sibling);
  return save ? { save: { ...save, chained: true }, effects: saveEffectsOf(sibling) } : null;
}

/**
 * The outcome steps that the content declares for this item (SPEC §16: `move`, `status` on `hit` or
 * `failedSave`), carried by the plan with their condition; the core filters them per target like the effects,
 * the adapter judges `if` at the moment of applying.
 * @param {Item5e} item
 * @param {string} moment   "hit" | "failedSave"
 * @param {string} when     "always" | "failedSave"
 */
/**
 * The items whose declarations hold for a use of this item, each only once (§445): the item; the item that cast
 * this spell copy (`castItemOf`) — the "extra" damage of a creature casting a spell holds for its copy, not for everyone's spell;
 * C12-h, the items that enchant it (Repelling Blast placed on any of the warlock's cantrips).
 * dnd5e puts on the copy of a spell cast by a "cast" activity an enchantment ("Spell Changes", activity/cast.mjs) whose origin
 * is this activity (`system.origin.activity`): without the "once" rule, the feature that casts the spell counted twice — caster
 * and enchanter — and its extra damage applied twice. Two enchantments of the same item do not count it twice either.
 * @param {Item5e} item
 * @returns {Item5e[]}
 */
export function outcomeSourcesOf(item) {
  if ( !item ) return [];
  const enchanters = Array.from(item.effects?.values?.() ?? []).filter(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment")))
    .map(e => originItemOf(e)).filter(i => i?.documentName === "Item");   // an enchantment's origin is the activity
  const out = [];
  for ( const source of [item, castItemOf(item), ...enchanters] ) if ( source && !out.includes(source) ) out.push(source);
  return out;
}

function outcomeStepsOf(item, moment, when) {
  if ( !item ) return [];
  const out = [];
  for ( const d of outcomeSourcesOf(item).flatMap(i => declarationsOfItem(i)) ) {
    if ( !d.on.includes(moment) ) continue;
    // The condition travels as JSON: written as is in a flag, Foundry would split its dotted keys
    // (`"target.sizeAtMost"` → `{ target: { sizeAtMost } }`), seen in play on 2026-09-24 (scenario `traction`).
    for ( const step of d.do ) {
      // Outcome damage (without a recipient: the target hit); `onSave: "half"`: also on a success, halved.
      const outcomeDamage = (step.type === "damage") && !("to" in step);
      if ( !OUTCOME_STEPS.includes(step.type) && !outcomeDamage ) continue;
      const stepWhen = (outcomeDamage && (step.onSave === "half")) ? "always" : when;
      out.push({ when: stepWhen, if: d.if ? JSON.stringify(d.if) : null, name: d.name, ...step });
    }
  }
  return out;
}

/**
 * The effects of the save activity, with their moment: `savedEffects` of the content (success only), `onSave`;
 * `failMargins` (§19.6): a required save margin ("if it fails the roll by 5 or more").
 */
function saveEffectsOf(activity) {
  const entry = activity.item ? contentOf(activity.item).entry : null;
  // §158: nothing for a `zoneEffects` area (`effectsOf`) — Jallarzi's Storm of Radiance: Blinded, Deafened "as long as it is in
  // the Cylinder".
  const saved = new Set(entry?.savedEffects ?? []);
  const margins = entry?.failMargins ?? {};
  // K9 (§330): the size gate (M3) also holds for the effects of a save (Shield Bash, Constrict: "if the target is
  // Large or smaller") — it used to hold only for those of an attack. K12 (§333): `effectsIf` too ("Esoteric Protection":
  // "if the target is an Undead").
  return effectsOf(activity, e => saved.has(effectKey(e)) ? "saved" : (e.onSave === true ? "always" : "failedSave"), effectGate(activity))
    .map(e => (margins[e.id] ? { ...e, margin: margins[e.id] } : e));
}

/** Repeated save ("resave" brick): the message only asks for the save, nothing is applied. */
function resavePlan(message, activity, common, targets) {
  // C12-e: the save declared by the content (`resave.ability`), when the activity has none.
  const declared = message.getFlag(MODULE_ID, "resave")?.save;
  const save = declared ? { ability: declared.ability, abilities: [declared.ability], dc: declared.dc, onSave: "none", activity: activity.uuid } : saveOf(activity);
  if ( !save ) return null;
  return { ...common, targets, plan: { save: { ...save, chained: false }, damage: null, effects: [], steps: [] } };
}

/**
 * The name of an activity effect, for the question asked to the author. Read on the item (or the compendium reference already in
 * cache), not via `profile.effect`: dnd5e 6.0 deprecates it in favor of `getEffect()`, asynchronous (one warning per effect,
 * eighteen for "Assistance").
 */
const effectLabel = (e, item) => effectOfProfile(e, item)?.name ?? e.uuid ?? e._id;

/**
 * EXCLUSIVE effects (content `choice: { effects: "one" }`, Hex): the plan carries the question,
 * one option per effect specific to the activity; the core holds back the application until the answer.
 * Nothing to choose with a single effect.
 */
function withChoice(activity, plan) {
  // §53: the potion that made this spell be cast imposes an effect on it (`potionEffect`: Growth → enlarge) — no question.
  const potion = potionOfCast(activity?.item);
  const imposed = potion?.identifier ? entryOfIdentifier(potion.identifier)?.potionEffect : null;
  // The effect is given, not suffered: no save (that of Enlarge/Reduce applies to an unwilling target).
  if ( imposed ) return { ...plan, save: null, effects: (plan.effects ?? []).filter(e => e.id === imposed).map(e => ({ ...e, when: "always" })) };
  const choice = activity.item ? contentOf(activity.item).entry?.choice : null;
  // §504 (B24): "instead of dealing damage, the creature can grapple the target" — on an attack that deals damage.
  if ( choice?.outcome && plan.attack && plan.damage ) {
    const escapeDc = choice.grapple?.escapeDc ?? null;
    return { ...plan, choice: { prompt: choice.prompt ?? game.i18n.localize("DND5ECOMBAT.ChoixIssue.Question"), outcome: { escapeDc },
      options: [{ id: OUTCOME_DAMAGE, label: game.i18n.localize("DND5ECOMBAT.ChoixIssue.Degats") },
        { id: OUTCOME_GRAPPLE, label: escapeDc ? game.i18n.format("DND5ECOMBAT.ChoixIssue.AgripperDD", { dc: escapeDc }) : game.i18n.localize("DND5ECOMBAT.ChoixIssue.Agripper") }] } };
  }
  if ( choice?.effects !== "one" ) return plan;   // `pool` alone: linked effects, nothing to choose (§53)
  // An attack that chains its sister save (§19.8: push or Grappled): the sister's effects.
  const chained = plan.save?.chained ? activity.item.system.activities?.get(plan.save.activity?.split(".").pop()) : null;
  const own = applicableEffectsOf(chained ?? activity).map(e => ({ id: effectKey(e), label: effectLabel(e, (chained ?? activity).item) }));
  if ( own.length < 2 ) return plan;
  // K3 (§324): rolled with a die — the options in the order of the text (`order`), those it does not name following.
  const order = choice.order ?? [];
  const rank = o => { const i = order.indexOf(o.id.split(".").pop()); return (i < 0) ? order.length : i; };
  const options = choice.roll ? [...own].sort((a, b) => rank(a) - rank(b)) : own;
  return { ...plan, choice: { prompt: choice.prompt ?? null, options, ...(choice.roll ? { roll: true } : {}), ...(choice.perTarget ? { perTarget: true } : {}) } };
}

/**
 * §53: is the spell that a potion makes you cast for the drinker? Yes ("you gain the effect of the spell"), except the potion that
 * "allows casting" the spell on another creature (`castTargets`: Animal Friendship).
 */
export function potionCastsOnDrinker(item) {
  const potion = potionOfCast(item);
  return !!potion && !entryOfIdentifier(potion.identifier)?.castTargets;
}

/**
 * @param {ChatMessage} message  Message of type "usage".
 * @returns {{activity: string, source: string|null, origin: string, plan: object, targets: object[],
 *   area: boolean}|null}  null: nothing to resolve, the native behavior remains.
 */
export function readUsage(message) {
  const usage = readPlan(message);
  if ( !usage ) return null;
  const activity = message.getAssociatedActivity?.({ scaled: true });
  // A repeated save applies nothing (`resavePlan`): no exclusive-effect question — the effect chosen at casting is already applied
  // (seen on 2026-10-26: Blindness/Deafness asked again to "choose an effect" at each end of turn, and the save stayed pending).
  const plan = message.getFlag?.(MODULE_ID, "resave") ? usage.plan : withChoice(activity, usage.plan);
  return { ...usage, plan: casterRules(activity, plan, message) };
}

/**
 * §28: what the caster's features change in a spell's plan — Potent Cantrip (`potent`: a damaging cantrip,
 * missed or saved, deals half damage); Sculpt Spells (`sculpt`: in an Evocation spell with a save,
 * up to 1 + the spell's level allies succeed automatically and take nothing).
 */
function casterRules(activity, plan, message=null) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !isSpellCast(item) || !actor ) return plan;   // §48: a scroll too
  const has = key => actor.items.some(i => contentOf(i).entry?.[key] === true);
  const level = spellLevelOf(item);
  const out = { ...plan };
  if ( plan.damage && (level === 0) && has("potentCantrip") ) out.potent = true;
  // §157: the item itself deals half damage on a miss (Melf's Acid Arrow) — same rule, for it alone.
  if ( plan.damage && plan.attack && (contentOf(item).entry?.halfOnMiss === true) ) out.potent = true;
  // §296: "1 + the spell's level" — the level it is cast at (dnd5e records the upcast on the message: `system.scaling`; §406: not
  // in its flags, which dnd5e 6 no longer writes).
  if ( plan.save && (spellSchoolOf(item) === "evo") && has("sculptSpells") ) out.sculpt = 1 + level + (Number(message?.system?.scaling) || 0);
  // §32: Metamagic carried by the card — Careful Spell: as many allies as the Charisma modifier (at least one) succeed
  // automatically, like Sculpt Spells; Heightened Spell: the first hostile target has Disadvantage (adapter/saves.mjs).
  const meta = usageMetamagic(message);
  if ( plan.save && meta.includes("careful") ) out.sculpt = Math.max(out.sculpt ?? 0, Math.max(1, Number(actor.system.abilities?.cha?.mod) || 0));
  if ( plan.save && meta.includes("heightened") ) out.heightened = true;
  return out;
}

/**
 * Does the activity wait for its template to be placed? Not a straight-line rush (§57, Zephyr Strike): its Line template
 * is not placed, the creatures near the path are the message's targets (`flags.dnd5e-combat.dash`).
 */
// §86: the data's template, or the one the content supplies (adapter/template.mjs).
const templated = (activity, message) => !!templateOf(activity)?.type && !message.getFlag?.(MODULE_ID, "dash");

function readPlan(message) {
  const activity = message.getAssociatedActivity?.({ scaled: true });
  if ( !activity ) return null;
  const common = { activity: activity.uuid, source: message.getAssociatedActor?.()?.uuid ?? null, origin: message.id, area: false };
  // Mirror Image (§16.25): "personal range", without a target type in dnd5e — its duplicates are placed on the caster.
  // §51: "personal" range, no area, used with no designated target — the user is the target (the Potion of Healing of the
  // Dungeon Master's Guide: "personal", target "one creature" without a number; without this, nobody was healed). Healing only:
  // a utility feature with personal range (Rage…) has its effects applied by other paths.
  // §101: likewise a "touch" potion (Potion of Greater Healing of the Dungeon Master's Guide, the only one of its family to carry
  // "touch, one creature"): drink or have someone drink — the designated target if there is one; without a target, the drinker.
  // O9f (§359): a "touch" potion or oil that is not healing (Oil of Etherealness: its effect on no one) follows the same rule.
  const untargetedSelf = !activity.target?.template?.type && !(message.system?.targets?.length)
    && (((activity.type === "heal") && (rangeUnitsOf(activity) === "self")) || (isPotion(activity.item) && (activity.range?.units === "touch")));
  // §53: a "self" potion is for the drinker, whatever the activity type (Invisibility, Giant Strength, Potion of
  // Poison…) and even if another creature is still targeted; likewise the spell that a potion makes you cast (Speed: Haste,
  // Growth…), whatever its range — "when you drink this potion, you gain the effect of the spell".
  // Issue #31: "Give to drink" (engine menu, `administer`) — a "personal" healing potion (Dungeon Master's Guide) goes to the
  // designated creature: the 2024 rule allows drinking a potion or giving it to someone to drink.
  const administered = (activity.type === "heal") && !!message.getFlag?.(MODULE_ID, "administer") && !!(message.system?.targets?.length);
  const potionSelf = !activity.target?.template?.type && !administered
    && ((isPotion(activity.item) && (activity.range?.units === "self")) || potionCastsOnDrinker(activity.item));
  // §124: a feature that the content declares "on self" (`ranges`: { units: "self" } — Ancestral Champion, Holy Nimbus) targets the
  // caster, even if the data say "a creature".
  const declaredSelf = contentOf(activity.item).entry?.ranges?.[activity.id]?.units === "self";
  const self = (activity.target?.affects?.type === "self") || untargetedSelf || potionSelf || declaredSelf
    || (!!activity.item && (contentOf(activity.item).entry?.duplicates === true));
  const targets = self ? selfTarget(message) : messageTargets(message);
  if ( message.getFlag?.(MODULE_ID, "resave") ) return resavePlan(message, activity, common, targets);

  switch ( activity.type ) {
    case "attack": {
      const chain = chainedSave(activity);
      // M5 (§18.8): the variant that applies before the roll (charge, Bloodied, grappled target) gives its effects and its damage;
      // the attack stays the base one (same roll). The "advantage" variant is judged at the damage roll.
      const variant = attackVariant(message, activity, targets);
      const source = variant?.activity ?? activity;
      const advantage = advantageVariantOf(activity);
      return { ...common, targets, plan: {
        attack: true,
        damage: hasDamageParts(activity) ? "author" : null,
        save: chain?.save ?? null,
        variant: variant ? { activity: variant.activity.uuid, kind: variant.kind, name: variant.activity.name } : null,
        damageFrom: [variant?.activity.uuid, advantage?.uuid].filter(Boolean),
        effects: [...effectsOf(source, () => "always", effectGate(source)).filter(e => variant || !chargeOnly(activity).includes(e.id)), ...(chain?.effects ?? [])],
        steps: [...outcomeStepsOf(activity.item, "hit", "always"), ...(chain ? [...outcomeStepsOf(activity.item, "failedSave", "failedSave"),
          ...outcomeStepsOf(activity.item, "savedSave", "saved")] : [])]
      } };
    }
    case "save": {
      const save = saveOf(activity);
      if ( !save ) {
        // Damaged item data that cannot be repaired (adapter/saves.mjs, repairSaveAbility): we say so instead of staying silent.
        console.warn(`${MODULE_ID} | ${activity.item?.name}: saving throw without ability or DC, not automated`, activity);
        if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.SauvegardeIncomplete", { item: activity.item?.name }));
        return null;
      }
      return { ...common, targets, area: templated(activity, message), plan: {
        save: { ...save, chained: false },
        damage: hasDamageParts(activity) ? "author" : null,
        effects: saveEffectsOf(activity),
        steps: [...outcomeStepsOf(activity.item, "failedSave", "failedSave"), ...outcomeStepsOf(activity.item, "savedSave", "saved")]
      } };
    }
    case "damage":
      // §89: a damage activity whose content removes the damage (`noDamage`: Feint) still applies its effects, like a utility.
      if ( !hasDamageParts(activity) ) {
        const effects = effectsOf(activity, () => "always");
        return effects.length ? { ...common, targets, plan: { effects } } : null;
      }
      // A damage activity used after the hit (Eldritch Strike, §16.19) carries the content's "on hit" steps.
      // With a template (Cloud of Daggers, Spike Growth, §16.20), it is an area: its targets are those it covers.
      // Replayed by an area (`areaTick`), nobody clicked: the engine rolls the dice.
      // Magic Missile (§16.27): each missile is a separate cast, whose damage the engine rolls
      // (runtime/projectiles.mjs cuts off dnd5e's chained roll and chains the following ones).
      const dart = projectilesOf(activity.item)?.attack === false;
      return { ...common, targets, area: templated(activity, message), plan: {
        damage: (message.getFlag?.(MODULE_ID, "areaTick") || dart) ? "author" : "system", effects: effectsOf(activity, () => "always"),
        steps: outcomeStepsOf(activity.item, "hit", "always") } };
    case "heal":
      if ( !activity.healing?.formula ) return null;
      // §24: Parry — the "heal" is only an amount removed from the damage (adapter/reactions.mjs): nothing to apply.
      if ( message.getFlag?.(MODULE_ID, "reduceOnly") ) return null;
      // §164: replayed by an area (Healing Light of Summon Celestial), nobody clicked — the engine rolls the healing.
      // §296: a pool to distribute (`healPool`: "Survivance", "Group Healing") — runtime/cure.mjs applies it, not dnd5e's roll.
      if ( contentOf(activity.item).entry?.healPool?.activities?.includes(activity.id) ) {
        const effects = effectsOf(activity, () => "always");
        return effects.length ? { ...common, targets, plan: { effects } } : null;
      }
      return { ...common, targets, plan: { damage: message.getFlag?.(MODULE_ID, "areaTick") ? "author" : "system", heal: true, effects: effectsOf(activity, () => "always") } };
    case "utility":
      // §226: Silence — its effects exist only in its area (`effectsOf` returns none): nothing to resolve.
      if ( !effectsOf(activity, () => "always").length ) return null;
      // An activity that takes a basic action (Cunning Action: Hide, §20): the engine performs it (runtime/hide.mjs); the item's
      // "Hiding" effect is not applied.
      if ( declaredBasicsOf(activity) ) return null;
      // §90: a die added to AC ("Cross-step": one effect per die value in the data) — runtime/maneuver-dice.mjs applies
      // the right one.
      if ( contentOf(activity.item).entry?.rolledAc?.activity === activity.id ) return null;
      // Superior Hunter's Defense: the data carries a Resistance effect per damage type, which dnd5e would apply all at once.
      // Taken as a Reaction, the `resist` step applies the one for the hit (runtime/reactions.mjs); by hand, the card leaves
      // them to the player.
      if ( message.getFlag?.(MODULE_ID, "reaction") && placesOwnResistance(contentOf(activity.item).entry, activity.id) ) {
        return null;
      }
      // §72: a contest (`contest`) — the effect is applied only when won (runtime/contest.mjs).
      const contest = contentOf(activity.item).entry?.contest;
      if ( contest && (!contest.activity || (contest.activity === activity.id)) ) return null;
      // O9h (§363): a self Emanation that applies its effects (Dust of Disappearance: "you and each creature within 3 m") — its
      // targets are those it covers, like a save area.
      return { ...common, targets, ...(!self && (rangeUnitsOf(activity) === "self") && activity.target?.template?.type ? { area: templated(activity, message) } : {}),
        plan: { effects: effectsOf(activity, () => "always") } };
    case "check": {
      // §402: a check activity that the content declares as carrying effects (`checkPoses`: Maze — the data makes it a check, the
      // text banishes automatically) applies its effects to the target, without a check; the escape check remains that of
      // `actionEnds`.
      if ( contentOf(activity.item).entry?.checkPoses !== true ) return null;
      const effects = effectsOf(activity, () => "always");
      return effects.length ? { ...common, targets, plan: { effects } } : null;
    }
    default:
      return null;
  }
}
