/**
 * Reading dnd5e 6.0 roll messages and writing the consequences. The only place, with
 * units.mjs, that knows the shape of the system's documents (SPEC §5.1).
 *
 * Verified in dnd5e 6.0.3:
 *  - an attack roll creates a `type: "attack"` message with `system.targets` (token, AC),
 *    `system.activity.uuid` and `system.origin` = use message (activity/attack.mjs:158-166)
 *  - a damage roll creates a `type: "damage"` message of the same shape (activity/mixin.mjs:879-885)
 *  - the Critical Hit of the last attack roll is carried over to the damage roll by the system
 *    itself (activity/attack.mjs:306-310): the engine need not get involved.
 */

import { MODULE_ID } from "../constants.mjs";
import { timedWait } from "./dialogs.mjs";
import { damageDialogConfig } from "./damage-dialog.mjs";
import { applyDamageShields, resistRangedWeapon } from "./defenses.mjs";
import { damageVariant } from "./variants.mjs";
import { sneakAttackFor, askHitOptions } from "./sneak.mjs";
import { savageToAsk } from "./savage.mjs";
import { optionalBonusesFor } from "./triggers.mjs";
import { speakerTokenOf } from "./turn.mjs";
import { chooseSmite } from "./smite.mjs";
import { criticalChoice, drawCriticalTable } from "./criticals.mjs";
import { current, STEPS } from "../core/action.mjs";
import { atCastLevel } from "../core/usage.mjs";
import { criticalExtraFormula } from "../core/critical-dice.mjs";
import { contentOf } from "./content.mjs";
import { spellClassOf } from "./spell-class.mjs";
import { weaponKind } from "./facts.mjs";
import { retypeOffers } from "../core/retype.mjs";

// §279: moved to facts.mjs (fact `activity.weaponKind`); re-exported for existing callers.
export { weaponKind };
import { offerCombatInspirationDamage, usesLeftFor } from "./inspiration.mjs";

const SETTLED_STEPS = new Set([STEPS.DONE, STEPS.MISSED, STEPS.UNDONE]);

/**
 * Waits until a message's resolution is settled (done, missed or defeated), from any client: the flag is re-read
 * every `every` ms. Returns the resolution (in the current schema, `current`), or null after `timeout`.
 */
export async function settledResolution(messageId, { timeout=60000, every=400 }={}) {
  for ( const until = Date.now() + timeout; Date.now() < until; ) {
    const resolution = current(game.messages.get(messageId)?.getFlag(MODULE_ID, "resolution"));
    if ( resolution && SETTLED_STEPS.has(resolution.step) ) return resolution;
    await new Promise(resolve => setTimeout(resolve, every));
  }
  return null;
}

/** Id of the use message that a roll originates from, or null. */
function originOf(message) {
  return message._source.system?.origin ?? null;
}

/** §231: "advantage", "disadvantage" or null — the d20 mode (dnd5e dice/d20-roll.mjs:137-147). */
export function d20Mode(roll) {
  if ( roll?.hasAdvantage === true ) return "advantage";
  if ( roll?.hasDisadvantage === true ) return "disadvantage";
  return null;
}

/**
 * @param {ChatMessage} message  Message of type "attack".
 * @returns {object|null}        Core inputs, or null if the message cannot be used.
 */
export function readAttackMessage(message) {
  const roll = message.rolls?.[0];
  const activity = message.system?.activity?.uuid;
  if ( !roll || !activity ) return null;
  return {
    origin: originOf(message),
    activity,
    source: message.getAssociatedActor?.()?.uuid ?? null,
    // `natural`: the kept d20 — a lowered Critical Hit threshold does not make it hit, only a natural 20 does (core/attack.mjs).
    roll: { total: roll.total, isCritical: roll.isCritical === true, isFumble: roll.isFumble === true,
      ...(Number.isFinite(roll.d20?.total) ? { natural: roll.d20.total } : {}), ...(d20Mode(roll) ? { mode: d20Mode(roll) } : {}) },
    targets: (message.system.targets ?? []).map(t => ({ token: t.token, actor: t.actor, name: t.name, ac: t.ac ?? null }))
  };
}

/**
 * @param {ChatMessage} message  Message of type "damage" or "healing" (same shape, heal.mjs:69-73).
 * @returns {{origin: string|null, activity: string, damages: object[]}|null}
 */
export function readDamageMessage(message) {
  const activity = message.system?.activity?.uuid;
  const all = message.rolls?.filter(r => r instanceof CONFIG.Dice.DamageRoll) ?? [];
  // #269 (§545): the extra critical dice rolled apart for some targets only, read on their own.
  const rolls = all.filter(r => !isCriticalExtra(r));
  if ( !activity || !rolls.length ) return null;
  // Same aggregation as the system's damage tray (applications/components/damage-application.mjs:271).
  const aggregate = list => dnd5e.dice.aggregateDamageRolls(list, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type,
    value: Math.max(0, roll.total)
  }));
  const extra = all.filter(isCriticalExtra);
  return { origin: originOf(message), activity, damages: aggregate(rolls), ...(extra.length ? { critical: aggregate(extra) } : {}) };
}

/** #269 (§545): a roll of extra critical dice, added to the damage message for the Critical Hit targets only. */
export const isCriticalExtra = roll => roll?.options?.[MODULE_ID]?.criticalExtra === true;

/**
 * #269 (§545): the terms of a configured, not yet evaluated, damage roll, as `core/critical-dice.mjs` reads them.
 * @param {DamageRoll} roll
 */
function termsOf(roll) {
  const { OperatorTerm, NumericTerm, DiceTerm } = foundry.dice.terms;
  return roll.terms.map(term => {
    const flavor = term.options?.flavor || undefined;
    if ( term instanceof OperatorTerm ) return { operator: term.operator };
    if ( term instanceof NumericTerm ) return { number: term.number, flavor };
    if ( (term instanceof DiceTerm) && Number.isFinite(term._number ?? term.number) && !(term._number instanceof Roll) ) {
      return { number: term.number, faces: term.faces, modifiers: [...(term.modifiers ?? [])], flavor };
    }
    let max = null;
    try { max = Roll.create(term.formula).evaluateSync({ maximize: true }).total; } catch { max = null; }
    return { formula: term.formula, deterministic: term.isDeterministic === true, max };
  });
}

/**
 * #269 (§545): the rolls of extra critical dice for these damage rolls (configured, not evaluated, not critical), in the same
 * damage type and properties — dnd5e's critical settings of each roll (`options.critical`: multiplier, bonus dice, modifiers,
 * maximized dice, bonus damage). Each is marked `criticalExtra`, and named for the targets it is for.
 * @param {DamageRoll[]} rolls
 * @param {string} flavor  The roll's label on the card.
 * @returns {DamageRoll[]}
 */
export function criticalExtraRolls(rolls, flavor) {
  const out = [];
  for ( const roll of rolls ) {
    if ( isCriticalExtra(roll) ) continue;
    const formula = criticalExtraFormula(termsOf(roll), roll.options?.critical ?? {});
    if ( !formula ) continue;
    const { type, types, properties } = roll.options;
    out.push(new CONFIG.Dice.DamageRoll(formula, roll.data, {
      type, types, properties, isCritical: false, flavor, [MODULE_ID]: { criticalExtra: true }
    }));
  }
  return out;
}

/**
 * The author of an action rolls their damage on the resolution signal: that of their attack if it
 * has one, otherwise that of the activity, like the card's "Damage" button (save.mjs:104-106).
 * To call on the author's client: these are their dice.
 * @param {ChatMessage} carrier   The message that carries the resolution.
 * @param {object} resolution
 * @param {boolean} critical      Engine verdict (core/action.mjs, isCriticalHit).
 * @param {string[]} [criticalFor]  #269 (§545): only these hit targets are Critical Hits (core/action.mjs, `mixedCriticalTokens`) —
 *                                 the damage is rolled normally, the critical dice apart for them.
 * @param {{dialog?: string|null}} [options]  #173 (§556): dnd5e's damage dialog — "required", "offered"
 *                                 (core/flow.mjs, `damageDialog`) or null (no dialog: a roll made for someone else).
 */
export async function rollDamageFor(carrier, resolution, critical, criticalFor=[], { dialog=null }={}) {
  if ( resolution.attack ) {
    const attackMessage = game.messages.get(resolution.attack.messageId);
    // §556: a hit target that cannot be critically hit (`uncritted`, core/action.mjs) — the dialog offers no Critical Hit button.
    const noCritical = resolution.targets.some(t => t.hit && t.uncritted);
    return attackMessage ? rollDamageForAttack(attackMessage, { critical, criticalFor, variant: resolution.plan.variant?.activity ?? null,
      names: resolution.targets.filter(t => criticalFor.includes(t.token)).map(t => t.name), dialog, noCritical }) : null;
  }
  const activity = carrier.getAssociatedActivity?.({ scaled: true });
  if ( !activity?.rollDamage ) return null;
  // Area traversed cell by cell (§16.20): the dice are multiplied at the `preRollDamageV2` hook (runtime/areas.mjs).
  const times = carrier.getFlag?.(MODULE_ID, "areaTick")?.times ?? 1;
  const damageType = await chosenDamageType(carrier, activity);
  const ours = { ...(times > 1 ? { times } : {}), ...(damageType ? { damageType } : {}), ...(dialog ? { dialog } : {}) };
  // Animation modules (BLFX, `_afterAttackOrDamageRoll`) take the user's targets at the roll hook, failing that the
  // tokens they control: for an area or an aura (Spirit Guardians on entry, at the start of a turn), these are not the creatures
  // hit. For the duration of the roll, the author's targets are those of the resolution, then theirs are put back (§55).
  const restore = targetResolution(resolution.targets.map(t => t.token));
  try {
    return await activity.rollDamage(Object.keys(ours).length ? { [MODULE_ID]: ours } : {}, damageDialogConfig(dialog), {
      // The resolution's targets, not the message's: for an area, only the first ones are right.
      data: { system: { origin: carrier.id, targets: resolution.targets.map(({ token, actor, name }) => ({ token, actor, name })) } }
    });
  } finally {
    restore();
  }
}

/**
 * Designates these tokens (uuids) as the targets of this client's user, the others released. Returns the function that restores
 * the previous targets. Does nothing if the targets are already those, or if none of these tokens is on the displayed scene.
 * @param {string[]} uuids
 * @returns {() => void}
 */
export function targetResolution(uuids) {
  // The tokens of the displayed scene (TokenLayer#setTargets, client/canvas/layers/tokens.mjs:341:
  // broadcast to the other clients).
  const ids = uuids.map(uuid => fromUuidSync(uuid, { strict: false })?.object).filter(t => t?.scene === canvas.scene).map(t => t.id);
  const before = Array.from(game.user.targets).map(t => t.id);
  if ( !ids.length || ((before.length === ids.length) && ids.every(id => before.includes(id))) ) return () => {};
  canvas.tokens.setTargets(ids);
  return () => canvas.tokens.setTargets(before);
}

/**
 * Rolls the damage of an attack that hit, like the card's "Damage" button (activity/attack.mjs:303-311): same ability, ammunition,
 * attack mode and critical as the attack roll. Without dnd5e's dialog, unless `dialog` asks for it (#173, §556). To be called on the
 * attack author's client: these are their dice.
 * @param {ChatMessage} attackMessage
 */
export async function rollDamageForAttack(attackMessage, { critical, variant=null, criticalFor=[], names=[], dialog=null, noCritical=false }={}) {
  const used = await fromUuid(attackMessage.system.activity.uuid);
  // M5 (§18.8): the damage of the variant chosen in the plan (charge, Bloodied), otherwise that of the "Attack with
  // Advantage" variant if the roll had Advantage ("plus 1d4 if the attack roll had Advantage").
  const origin = originOf(attackMessage);
  // §404: at the casting level — the activity re-read by its uuid is the sheet's, at the base level; the slot
  // upcast is on the use message (`system.scaling`), as dnd5e's "Damage" button reads it.
  const activity = atCastLevel((variant ? await fromUuid(variant) : null) ?? damageVariant(used, attackMessage.rolls[0]) ?? used,
    game.messages.get(origin ?? "")?.system?.scaling);
  if ( !activity?.rollDamage ) return null;
  const { ability, ammunitionItem: ammunition, mode: attackMode } = attackMessage.system;
  // The engine's verdict takes precedence: a hit on a Paralyzed target within 5 ft is a Critical Hit without a natural 20.
  let isCritical = critical ?? (attackMessage.rolls[0]?.isCritical === true);
  // §207: standard Critical Hit, critical table (normal damage) or a neighbor that handles it — before smites, whose dice
  // are doubled only on a standard Critical Hit. The hit stays a Critical Hit (death saves: `criticalHit` on the damage).
  let criticalTable = null;
  // #269 (§545): only some hit targets are Critical Hits — the roll is normal, the critical dice are added apart for them.
  let criticalExtra = null;
  if ( isCritical ) {
    const target = fromUuidSync(criticalFor[0] ?? attackMessage.system?.targets?.[0]?.token ?? "", { strict: false });
    const choice = await criticalChoice(used, target);
    if ( choice !== "standard" ) {
      isCritical = false;
      criticalTable = choice;
      if ( choice === "table" ) await drawCriticalTable({ speaker: ChatMessage.implementation.getSpeaker({ actor: used.actor }) });
    }
    else if ( criticalFor.length ) {
      isCritical = false;
      criticalExtra = { tokens: criticalFor, names };
    }
  }
  const damageType = await chosenDamageType(game.messages.get(origin ?? "") ?? attackMessage, activity);
  // §20: Cunning Strikes — chosen before the roll, they remove dice from Sneak Attack (runtime/sneak.mjs). §223: in the same
  // window, Sneak Attack itself ("ask" setting) and the optional bonus damage (Dreadful Strikes, runtime/triggers.mjs).
  const sneak = sneakAttackFor(used, attackMessage);
  const target = sneak?.target ?? fromUuidSync(attackMessage.system?.targets?.[0]?.token ?? "", { strict: false });
  const optional = ((attackMessage.system?.targets ?? []).length === 1)
    ? optionalBonusesFor({ actor: used.actor, activity, sourceToken: sneak?.source ?? speakerTokenOf(attackMessage), targetToken: target }) : [];
  // §516: the optional "Martial Savagery" ("ask" setting), in the same window.
  const hitOptions = await askHitOptions(used.actor, target, sneak, optional, { savage: savageToAsk(used) });
  const strikes = hitOptions.strikes;
  // Survey of the gaps: Combat Inspiration, Attack — the Valor Bard's die, added to the damage (runtime/feats.mjs).
  const inspired = await offerCombatInspirationDamage(used.actor);
  // §25: a smite — cast "immediately after hitting", its dice are added to this roll (runtime/smite.mjs).
  const smite = await chooseSmite(used, attackMessage);
  const ours = { ...(damageType ? { damageType } : {}), ...(strikes.length ? { strikes } : {}), ...(smite ? { smite } : {}),
    ...(typeof hitOptions.sneak === "boolean" ? { sneak: hitOptions.sneak } : {}), ...(hitOptions.bonuses.length ? { acceptedBonuses: hitOptions.bonuses } : {}),
    ...(criticalTable ? { criticalHit: criticalTable } : {}), ...(inspired ? { combatInspiration: inspired } : {}),
    ...(typeof hitOptions.savage === "boolean" ? { savageAttacker: hitOptions.savage } : {}),
    ...(criticalExtra ? { criticalExtra } : {}), ...(dialog ? { dialog } : {}), ...((dialog && noCritical) ? { noCritical } : {}) };
  // §373: the attack's targets on the damage card — dnd5e would read them from the user's selection at the time of the roll
  // (`TargetsField.getDescriptors()`), which another resolution (a grapple after the hit) may have released in the meantime.
  const targets = attackMessage?.system?.targets?.length ? attackMessage.system.targets : null;
  const system = { ...(origin ? { origin } : {}), ...(targets ? { targets } : {}) };
  return activity.rollDamage(
    { ability, ammunition, attackMode, isCritical, ...(Object.keys(ours).length ? { [MODULE_ID]: ours } : {}) },
    damageDialogConfig(dialog),
    Object.keys(system).length ? { data: { system } } : {}
  );
}

/**
 * The chosen types of an activity (Chromatic Orb: acid, cold, fire…; Divine Spark: necrotic or radiant):
 * those of the first damage part that offers several (`DamageData#types`, a Set). dnd5e only has them chosen
 * in the roll window — which the engine does not show: without a choice, it would keep the first.
 */
export function damageTypeChoices(activity) {
  const size = types => types?.size ?? types?.length ?? 0;
  // Survey of the gaps: Psychic Spells — the types the caster can give to the damage of a spell of their class, after those of
  // the spell. §279: likewise for a weapon or unarmed attack (`weaponDamageTypes`) — the weapon's types first.
  const extra = spellRetypes(activity);
  if ( extra.length ) {
    const parts = activity.damage?.parts ?? [];
    const base = (activity.item?.type === "weapon") ? activity.item.system.damage?.base?.types : null;
    const own = [...((parts.find(p => size(p.types) > 1) ?? parts[0])?.types ?? base ?? [])];
    return [...new Set([...own, ...extra])];
  }
  const part = (activity?.damage?.parts ?? []).find(p => size(p.types) > 1);
  if ( part ) return [...part.types];
  // §16.45: a weapon's base damage (the pact weapon: its normal type, necrotic, psychic or radiant, chosen at each
  // attack) — the normal type first, chosen by default.
  const base = (activity?.damage?.includeBase && (activity.item?.type === "weapon")) ? activity.item.system.damage?.base?.types : null;
  return size(base) > 1 ? [...base] : [];
}

/**
 * Survey of the gaps (2026-10-22): the types a caster's item lets them give to this spell's damage (key `spellDamageTypes`) —
 * Psychic Spells: "when you cast a Warlock spell that deals damage, you can change its type to psychic". A
 * class spell: filed under it (`spellClassOf`), or classless for an actor that has it (like `activity.cantripOf`).
 * @returns {string[]}
 */
export function spellRetypes(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( (item?.type === "weapon") && (activity.type === "attack") && actor ) return weaponRetypes(activity);
  return spellRetypeOffers(activity).map(o => o.type);
}

/**
 * The types offered to this spell and, for each, the activity that pays for it if it costs (Transmuted Spell: 1 Sorcery Point),
 * or null.
 * A paid change is only offered if there is enough left to pay for it.
 * @returns {Array<{type: string, cost: Activity|null}>}
 */
export function spellRetypeOffers(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( (item?.type !== "spell") || !actor || !(activity.damage?.parts ?? []).length ) return [];
  const rules = [];
  const payers = new Map();
  for ( const i of actor.items ) {
    const rule = contentOf(i).entry?.spellDamageTypes;
    if ( !rule ) continue;
    // §447: classless, any spell ("Marked by the Grave").
    const cls = rule.class ? (spellClassOf(item) || (actor.classes?.[rule.class] ? rule.class : null)) : null;
    if ( rule.class && (cls !== rule.class) ) continue;
    const payer = rule.cost ? i.system.activities?.get(rule.cost) ?? null : null;
    if ( rule.cost ) payers.set(rule.cost, payer);
    rules.push({ types: rule.types, from: rule.from, cost: rule.cost ?? null,
      payable: !rule.cost || (!!payer && (usesLeftFor(payer) > 0)) });
  }
  const own = (activity.damage?.parts ?? []).flatMap(p => [...(p.types ?? [])]);
  return retypeOffers(rules, own).map(o => ({ type: o.type, cost: o.cost ? payers.get(o.cost) : null }));
}


/** §279: `weaponDamageTypes` — the types an author's item lets them give to the damage of an attack with these weapon kinds. */
function weaponRetypes(activity) {
  const kind = weaponKind(activity);
  const out = new Set();
  for ( const i of activity.actor.items ) {
    const rule = contentOf(i).entry?.weaponDamageTypes;
    if ( rule && kind && rule.weapons.includes(kind) ) for ( const t of rule.types ) out.add(t);
  }
  return Array.from(out);
}

/**
 * The type chosen by the author, on their client, before the roll (SPEC §16.27); kept on the use card (`damageType`)
 * so that a rebound or a reroll picks up the same one. No answer: the first. null if the activity offers no choice.
 */
async function chosenDamageType(carrier, activity) {
  const types = damageTypeChoices(activity);
  if ( types.length < 2 ) return null;
  const known = carrier?.getFlag?.(MODULE_ID, "damageType");
  if ( types.includes(known) ) return known;
  const label = t => game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t);
  const choice = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.TypeDegats.Titre", { item: activity.item?.name ?? "" }) },
    content: `<p>${game.i18n.localize("DND5ECOMBAT.TypeDegats.Texte")}</p>`,
    buttons: types.map((t, i) => ({ action: t, label: label(t), default: i === 0 }))
  }, { fallback: types[0], awaiting: { actor: activity.actor ?? null, kind: "choice" } });
  let type = types.includes(choice) ? choice : types[0];
  // A type that is paid for (Transmuted Spell): the item's activity settles it, once, at the time of choice;
  // otherwise the spell's type.
  const payer = spellRetypeOffers(activity).find(o => o.type === type)?.cost ?? null;
  if ( payer ) {
    const paid = await payer.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, { create: false }).catch(() => null);
    if ( !paid ) type = types[0];
    else console.log(`${MODULE_ID} | ${activity.actor?.name}: ${payer.item.name}, ${activity.item?.name} deals ${type} damage`);
  }
  if ( carrier?.isOwner ) await carrier.setFlag(MODULE_ID, "damageType", type).catch(() => {});
  return type;
}

function readHp(actor) {
  const hp = actor.system.attributes.hp;
  return { value: hp.value, temp: hp.temp ?? 0 };
}

/**
 * Applies damage to a token through the system's public method, which handles Resistances,
 * Immunities, Vulnerabilities and Temporary Hit Points. To be called only on the active GM's client.
 * @returns {Promise<object|null>}  Log entry for recordDamage(), or null if the target has disappeared.
 */
export async function applyDamageToToken(tokenUuid, raw, originMessage, { multiplier=1, reduction=0, absorbInto=null, ignoreResistance=[], rangedWeapon=false, critical=null }={}) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  const before = readHp(actor);
  // §16.46: Resistance — the damage of the protected type reduced, before it is applied.
  // O8d (§347): Resistance to the damage of an attack with a ranged weapon ("Attraction Shield"), before the rest.
  const ranged = rangedWeapon ? resistRangedWeapon(actor, raw) : { damages: raw, reduced: 0 };
  if ( ranged.reduced ) console.log(`${MODULE_ID} | ${actor.name}: Resistance to ranged weapon damage, -${ranged.reduced}`);
  const shielded = await applyDamageShields(actor, ranged.damages);
  const shields = shielded.done;
  // §24: Parry — "reduces the attack's total damage": removed part by part (before Resistances and multiplier).
  let left = Math.max(0, Number(reduction) || 0);
  const damages = shielded.damages.map(d => {
    const cut = Math.min(left, d.value);
    left -= cut;
    return cut ? { ...d, value: d.value - cut } : d;
  });
  // `multiplier`: share of the damage taken after a successful save (actor.mjs:872).
  // §38: `absorbInto` — another creature's pool (Projected Ward) absorbs first (adapter/absorb.mjs, `absorbDamage`).
  // §134: `ignoreResistance` — the types whose Resistance is ignored (Elemental Adept, Poisoner): dnd5e's `ignore` option
  // (documents/actor/actor.mjs, `#changeIsIgnored`).
  const ignore = ignoreResistance.length ? { ignore: { resistance: new Set(ignoreResistance) } } : {};
  // #269 (§545): `critical` is the engine's verdict for THIS target (an attack on several targets is not critical for all of them);
  // death saves (adapter/death.mjs) and regeneration read it before the message's roll.
  const ours = { ...(absorbInto ? { absorbInto } : {}), ...((typeof critical === "boolean") ? { criticalHit: critical } : {}) };
  await actor.applyDamage(damages, { isDelta: true, origin: originMessage, multiplier, ...ignore, ...(Object.keys(ours).length ? { [MODULE_ID]: ours } : {}) });
  return {
    token: tokenUuid,
    actor: actor.uuid,
    rolled: damages.map(d => ({ type: d.type, value: d.value })),
    before,
    after: readHp(actor),
    shields
  };
}

/**
 * The maximum of a healing roll (Beacon of Hope, §16.24): each roll of the message rerolled at its maximum (the core's `maximize`),
 * returned in the shape of serialized damage (one per type). null if the message is missing.
 */
export async function maximizedHealing(damageMessage, { critical=false }={}) {
  // #269 (§545): the critical dice rolled apart count only for a Critical Hit target.
  const rolls = (damageMessage?.rolls ?? []).filter(r => critical || !isCriticalExtra(r));
  if ( !rolls.length ) return null;
  const out = [];
  for ( const roll of rolls ) {
    const max = await roll.clone().evaluate({ maximize: true });
    const type = roll.options?.type ?? "healing";
    out.push({ type, value: max.total, properties: new Set(roll.options?.properties ?? []) });
  }
  return out;
}

/** Restores HP recorded in the log of a resolution. */
export async function restoreHp(actorUuid, hp) {
  const actor = await fromUuid(actorUuid);
  await actor?.update({ "system.attributes.hp.value": hp.value, "system.attributes.hp.temp": hp.temp });
}
