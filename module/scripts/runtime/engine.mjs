/**
 * The engine: it translates what happens in Foundry into EVENTS for the action machine
 * (core/action.mjs), and executes the COMMANDS it returns. No rule here: the core decides,
 * the adapters read and write, the dispatcher (runtime/dispatcher.mjs) keeps the order.
 *
 * A resolution's BEARER is the activity's use message. An attack roll made
 * outside a card (or rerolled from an already resolved card) has none: the attack message is
 * then its own bearer.
 */

import { MODULE_ID } from "../constants.mjs";
import { current, undoPlan, wantsDamageRoll, isCriticalHit, mixedCriticalTokens, pendingChoice, pendingAllocation, STEPS, creatureAutoSuccess }
  from "../core/action.mjs";
import { isAutoCritical, autoFailSave, typeAutoSave } from "../core/conditions.mjs";
import { maximizeDice } from "../core/max-dice.mjs";
import { spellCastLevel } from "../core/usage.mjs";
import { unaffectedBy } from "../adapter/eligibility.mjs";
import { restoreHp, rollDamageFor } from "../adapter/messages.mjs";
import { removeEffects, TARGETS_QUERY, handleTargetsQuery, SAVE_QUERY, handleSaveQuery, magicEvasionAgainst,
  autoSaveAgainst } from "../adapter/saves.mjs";
import { statusesOf, areAdjacent, evades, avoids, coverAgainst, isRangedAttack } from "../adapter/conditions.mjs";
import { rangedAcBonus, wearsAdamantine } from "../adapter/defenses.mjs";
import { currentAc } from "../adapter/reactions.mjs";
import { CHOICE_QUERY, handleChoiceQuery, askChoice } from "../adapter/choices.mjs";
import { ALLOCATION_QUERY, handleAllocationQuery } from "../adapter/projectiles.mjs";
import { ZONE_CHOICE_QUERY, handleZoneChoiceQuery, registerZoneChoiceSetting } from "../adapter/zone-choice.mjs";
import { canJudgeCover, isCoverAvailable } from "../adapter/cover.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { createDispatcher } from "./dispatcher.mjs";
import { canReactToHit } from "./reactions.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { contentOf, identifierOf, enchantmentSourcesOf } from "../adapter/content.mjs";
import { duplicatesAgainst } from "../adapter/duplicates.mjs";
import { log, loc, isExecutor, whenCanvasReady } from "./shared.mjs";
import { damageFlow } from "./flow.mjs";
import { damageDialog } from "../core/flow.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { areAllies, areEnemies } from "../adapter/factions.mjs";
import { COMMANDS } from "./engine-commands.mjs";
import { onAttackMessage, onDamageMessage, onSaveMessage, onUsageMessage } from "./engine-messages.mjs";
import { onRegionCreated } from "./engine-areas.mjs";

/** How many recent messages we go back when a roll does not say which action it relates to. */
export const LOOKBACK = 50;

/** A bearer's resolution, including one not yet written (grouped writes, runtime/dispatcher.mjs). */
export const resolutionOn = message => message ? current(dispatcher.peek(message.id)) : null;

/** "Lightened chat log" setting: resolution writes grouped (here) and off-screen cards not drawn (ui/chat.mjs). */
export const CHAT_LIGHT_SETTING = "chatLight";

/** The token that speaks in a message, or null. */
export function speakerTokenUuid(message) {
  const { scene, token } = message?.speaker ?? {};
  return scene && token ? `Scene.${scene}.Token.${token}` : null;
}

/** Damage properties are a Set on the system side, an array in a flag. */
export const serializeDamages = damages => damages.map(d => ({ ...d, properties: Array.from(d.properties ?? []) }));
/** Does the creature carry an effect from a `healMax` item (Beacon of Hope) — effect placed or transferred? */
/**
 * §160: the HP tier (content `hpTiers`) that applies to this target, read from its current HP (before the damage): the plan entry
 * rewritten (damage removed if `damage: false`, effects reduced to `effects`) and the conditions to place. Null without tiers.
 */
export function hpTierFor(item, actor, entry, plan=null, activity=null, saveFailed=false) {
  // K2 (§323): a tier reserved to certain activities of the item (a ray among the Eye Rays) only applies to them.
  const tiers = (item ? contentOf(item).entry?.hpTiers : null)?.filter(t => !t.activities || (activity && t.activities.includes(activity.id)));
  if ( !tiers?.length || !actor ) return null;
  const hp = Number(actor.system?.attributes?.hp?.value ?? 0);
  const tier = tiers.find(t => !("atMost" in t) || (hp <= t.atMost));
  // §402: outside the tiers, the outcome steps remain (Divine Word: a Fiend with more than 50 HP that fails is still sent back).
  if ( !tier ) return { hp, statuses: [], entry: { ...entry, multiplier: 0, effects: [], steps: entry.steps ?? [] } };
  // A spell with a save (Divine Word) only places its conditions on a failed save: the target that succeeded received no effect.
  // K2 (§323): a save with no effect ("Deadly Gaze") — the failure is read on the target's resolution (`saveFailed`).
  const failed = !plan?.save || saveFailed || ((entry.effects ?? []).length > 0);
  return { hp, statuses: failed ? (tier.statuses ?? []) : [], zero: failed && (tier.zero === true), entry: {
    ...entry,
    multiplier: (tier.damage === false) ? 0 : entry.multiplier,
    effects: tier.effects ? (entry.effects ?? []).filter(e => tier.effects.includes(e.id)) : entry.effects
  } };
}

/**
 * §161: the level at which the message's spell is cast — the item's, plus the slot upcast that dnd5e notes on the use
 * message (`system.scaling`, dnd5e.mjs:17956). §406: it was read from the message's `flags.dnd5e.scaling`, which dnd5e 6 no longer
 * writes (the migration removes it, dnd5e.mjs:94993) — always the base level.
 */
export function castLevelOfMessage(message) {
  const item = message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
  if ( item?.type !== "spell" ) return null;
  return Number(item.system?.level ?? 0) + (Number(message.system?.scaling) || 0);
}

/** §164: the colors of Prismatic Spray — 1 to 5, a damage type; 6, indigo; 7, violet. */
const PRISM_TYPES = Object.freeze({ 1: "fire", 2: "acid", 3: "lightning", 4: "poison", 5: "cold" });

/**
 * §164: Prismatic Spray (`prismatic`) — a d8 per target; on an 8, two rays (the 8s rerolled). Returns the colors rolled,
 * the plan entry reduced to their effects (without damage if there is only indigo or violet) and the damage types. Null without
 * the rule.
 */
export async function prismaticFor(item, entry, activity=null, plan=null) {
  const rule = item ? contentOf(item).entry?.prismatic : null;
  if ( !rule ) return null;
  // The activity that made the roll: an area replay by a sibling keeps, in its flags, the placement's activity — the one of the
  // plan's save says the sibling (Prismatic Wall: the "Traversal Save").
  const ids = [activity?.id, String(plan?.save?.activity ?? "").split(".").pop()].filter(Boolean);
  if ( rule.activities && !rule.activities.some(id => ids.includes(id)) ) return null;
  const d8 = async () => (await new Roll("1d8").evaluate()).total;
  // §173: the Prismatic Wall crossed — all the layers at once (one save for all: simplification).
  let colors = rule.all ? [1, 2, 3, 4, 5, 6, 7] : [await d8()];
  if ( colors[0] === 8 ) {
    colors = [];
    while ( colors.length < 2 ) { const c = await d8(); if ( c !== 8 ) colors.push(c); }
  }
  const types = colors.filter(c => PRISM_TYPES[c]).map(c => PRISM_TYPES[c]);
  const keep = [colors.includes(6) ? rule.indigo : null, colors.includes(7) ? rule.violet : null].filter(Boolean);
  return { colors, types, entry: { ...entry, multiplier: types.length ? entry.multiplier : 0, effects: (entry.effects ?? []).filter(e => keep.includes(e.id)) } };
}

export function healsMax(actor) {
  for ( const effect of actor?.appliedEffects ?? [] ) {
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.healMax === true) ) return true;
  }
  return false;
}

/**
 * §19.9: Return to Life (Grave Domain) — the healing dice of a spell or a Channel Divinity are at their maximum when the
 * healed creature is at 0 HP. The healer carries a `healsDownedMax` item, the target is at 0 HP.
 */
export function healsDownedToMax(healer, activity, target) {
  if ( !healer || !activity?.item ) return false;
  const kind = isSpellCast(activity.item) || identifierOf(activity.item).id?.startsWith("channel-divinity");
  if ( !kind ) return false;
  // §27: Supreme Healing — the maximum of each die, whatever the creature healed.
  if ( healer.items.some(i => contentOf(i).entry?.supremeHealing === true) ) return true;
  return ((target?.system?.attributes?.hp?.value ?? 1) <= 0) && healer.items.some(i => contentOf(i).entry?.healsDownedMax === true);
}

/**
 * §233: on a healing roll (on the healer's client), when each designated target receives it at maximum (`healsMax`,
 * `healsDownedToMax`: Circle of Mortality's Return to Life, Supreme Healing, Beacon of Hope), the dice become their maximum
 * BEFORE the roll — "do not roll these dice". Before, dnd5e rolled the dice (Channel Divinity: Divine Spark) and the engine only
 * applied the maximum to the HP restored: the card showed an ordinary roll. The application keeps its maximum
 * (`maximizedHealing`, no effect on a formula already without dice).
 */
function onPreRollHealing(config) {
  const activity = config?.subject;
  if ( (activity?.type !== "heal") || !(config.rolls?.length) ) return true;
  const patients = Array.from(game.user.targets ?? []).map(t => t.actor).filter(Boolean);
  if ( !patients.length ) return true;
  const healer = activity.actor;
  if ( !patients.every(p => healsMax(p) || healsDownedToMax(healer, activity, p)) ) return true;
  for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(part => maximizeDice(part));
  log(`${activity.item?.name}: healing dice at their maximum (${patients.map(p => p.name).join(", ")})`);
  return true;
}

/**
 * §27: Disciple of Life and Blessed Healer — "a spell cast with a slot that restores hit points": 2 + the
 * slot's level (the activity is that of the spell at the level cast). Returns { disciple, healer } (0 if the healer lacks
 * the feature), or null outside this case.
 */
export function slotHealBonus(healer, activity) {
  const item = activity?.item;
  // §406: the slot's level — `system.level` stays the spell's on a scaled copy (`scaledClone` only writes
  // `flags.dnd5e.scaling`, dnd5e.mjs:35309; `@item.level` adds it, dnd5e.mjs:34568).
  const level = spellCastLevel(item);
  if ( !healer || (item?.type !== "spell") || (level < 1) || !["spell", "pact", undefined, ""].includes(item.system.method) ) return null;
  const has = key => healer.items.some(i => contentOf(i).entry?.[key] === true);
  // §433: dnd5e 6.1's SRD makes Disciple of Life an enchantment of the healing spell ("2 + @item.level" on `healing.bonus`) — a
  // spell that carries it already has its bonus in the formula: the engine does not add its own.
  const enchantedBy = enchantmentSourcesOf(item);
  const inFormula = healer.items.some(i => (contentOf(i).entry?.discipleOfLife === true) && enchantedBy.includes(identifierOf(i).id));
  const bonus = { disciple: (has("discipleOfLife") && !inFormula) ? 2 + level : 0, healer: has("blessedHealer") ? 2 + level : 0 };
  return (bonus.disciple || bonus.healer) ? bonus : null;
}

export const deserializeDamages = damages => damages.map(d => ({ ...d, properties: new Set(d.properties ?? []) }));

/** The time an instant area stays visible after its resolution (other modules' animations included). */
export const TRANSIENT_LINGER_MS = 4000;

export const dispatcher = createDispatcher({
  read: id => game.messages.get(id)?.getFlag(MODULE_ID, "resolution") ?? null,
  write: (id, resolution) => game.messages.get(id)?.setFlag(MODULE_ID, "resolution", resolution),
  execute: (command, id, resolution) => COMMANDS[command.type]?.(command, game.messages.get(id), resolution),
  enqueue,
  coalesce: () => game.settings.get(MODULE_ID, CHAT_LIGHT_SETTING),
  publish: (resolution, event) => {
    if ( resolution.step === STEPS.DONE ) log("action resolved →", resolution.targets.map(t =>
      `${t.name}:${t.save ? ` save ${t.save.success ? "succeeded" : "failed"}${t.save.total === null ? " automatically" : ` (${t.save.total})`}` : ""}`
      + `${t.damage ? ` ${t.damage.applied} HP` : ""}${t.effects.length ? ` ${t.effects.length} effect(s)` : ""}`).join(" ; "));
    // SPEC §5.6: at each step of a resolution (verdict, saves, damage, effects…), on the client that runs it (the active GM):
    // `(resolution, event)` — the state of the resolution and what advanced it. Read-only output for animations, a combat log,
    // the MCP connector.
    Hooks.callAll(`${MODULE_ID}.resolution`, resolution, event);
  }
});

/* -------------------------------------------- */
/*  What the core cannot read by itself         */
/* -------------------------------------------- */

/**
 * §518: did this card (or the use card it comes from) go past an engine refusal? `forcedThrough` (legality window,
 * runtime/turn.mjs) or `overridden` (reasons carried on the card, §408).
 * @param {ChatMessage} message
 */
export function forcedThrough(message) {
  const origin = game.messages.get(message?._source?.system?.origin ?? "") ?? null;
  return [message, origin].some(m => !!m && ((m.getFlag(MODULE_ID, "forcedThrough") === true) || !!m.getFlag(MODULE_ID, "overridden")?.length));
}

/**
 * Completes targets with what depends on conditions and the situation (core/conditions.mjs):
 * automatic failure on the plan's save, automatic Critical Hit, Reaction possible if hit.
 */
export async function enrich(targets, plan, originUuid, activityUuid=null, attackMode=null, castLevel=null, { forced=false }={}) {
  const activity = activityUuid ? await fromUuid(activityUuid) : null;
  const origin = plan.attack && originUuid ? await fromUuid(originUuid) : null;
  const factors = origin ? readUnitFactors() : null;
  // Cover is read from the canvas: we wait for a redraw to finish (level change) rather than
  // judging "no cover" for lack of a canvas. If it does not come, or shows another scene, we say so.
  if ( origin && isCoverAvailable() && targets.length ) {
    await whenCanvasReady();
    if ( !canJudgeCover(origin.parent) ) {
      log(`cover not evaluated: the GM's canvas ${canvas?.ready ? "shows another scene" : "is not ready"}`);
      ui.notifications.warn(loc("AbriNonEvalue", { scene: origin.parent?.name ?? "" }));
    }
  }
  const out = [];
  // §28: Sculpt Spells — the caster's allies (same disposition, the caster excepted), in order, up to `plan.sculpt`.
  const caster = activity?.actor ?? null;
  const casterToken = caster?.getActiveTokens?.(false, true)?.[0] ?? null;
  let sculpts = plan.sculpt ?? 0;
  for ( const target of targets ) {
    const token = await fromUuid(target.token);
    const statuses = statusesOf(token);
    // P1 (b): cover corrects the AC before the verdict — nothing is placed on the target (SPEC §14.1, decided).
    // §131: a shooting feat (Sharpshooter, Spell Sniper) ignores half Cover or three-quarters Cover.
    const cover = (origin && token && (target.ac !== null) && (target.ac !== undefined)) ? coverAgainst(origin, token, activity, attackMode, { forced }) : null;
    // O8d (§347): an AC bonus against ranged attacks only ("Anti-Projectile Shield").
    const shield = (origin && activity && token && isRangedAttack(activity, attackMode)) ? rangedAcBonus(token.actor) : 0;
    let ac = cover ? ((cover.bonus === null) ? null : target.ac + cover.bonus) : target.ac;
    if ( shield && (ac !== null) && (ac !== undefined) ) ac += shield;
    // §16.8: creature type, content rule, immunity to all effects — the target stays readable, out of reach.
    const unaffected = await unaffectedBy(activity, plan, token, { castLevel });
    if ( unaffected ) log(`${target.name}: unaffected by ${activity?.item?.name ?? "the action"} (${unaffected.reason}${unaffected.detail ? `: ${unaffected.detail}` : ""})`);
    out.push({
      ...target,
      ac,
      cover,
      autoFail: plan.save ? autoFailSave(statuses, plan.save.ability) : null,
      defenceless: !!origin && !!token && isAutoCritical(statuses, areAdjacent(origin, token, factors)),
      // §74: the attack and its author are known here — a Reaction that depends on it (Parry: "in melee") is counted.
      canReact: plan.attack ? await canReactToHit(target.token, { activity, source: origin?.actor ?? null }) : false,
      duplicates: plan.attack ? duplicatesAgainst(token?.actor, origin?.actor) : 0,
      // §20: Evasion (Rogue, Monk, monsters) — judged at application (core/action.mjs, `applicationPlan`).
      evasion: !!plan.save && (evades(token?.actor) || ((avoids(token?.actor) || magicEvasionAgainst(token?.actor, activity)) ? "any" : false)),
      sculpted: (sculpts > 0) && !!token && !!casterToken && (token.actor !== caster) && areAllies(token, casterToken)
        && (sculpts-- > 0),
      // O9a (§354): "any Critical Hit against you becomes a normal hit" (adamantine armor worn: dnd5e `ada` property).
      noCrit: !!plan.attack && wearsAdamantine(token?.actor),
      unaffected
    });
  }
  return out;
}

/**
 * §232: a save that a willing creature can fail automatically (content `willingFails`: Otiluke's Resilient Sphere, "an
 * unwilling creature must succeed…"). For each target that is not an enemy of the caster, the caster (their player, else the GM)
 * says whether it consents; if willing, its save is failed automatically (`autoFail: "willing"`, no roll). No answer: unwilling.
 */
async function askWilling(activity, targets, casterToken) {
  const item = activity?.item;
  const caster = activity?.actor;
  if ( !caster || (contentOf(item).entry?.willingFails !== true) ) return targets;
  const out = [];
  for ( const target of targets ) {
    const token = await fromUuid(target.token);
    const ask = token?.actor && !target.autoFail && !target.unaffected && !(casterToken && areEnemies(casterToken, token));
    if ( !ask ) { out.push(target); continue; }
    const answer = await askChoice(caster, { actor: caster.uuid, item: item.name, prompt: loc("Consentant.Question", { name: target.name }),
      options: [{ id: "unwilling", label: loc("Consentant.Non") }, { id: "willing", label: loc("Consentant.Oui") }] });
    const willing = answer?.id === "willing";
    if ( willing ) log(`${target.name}: willing — fails the ${item.name} saving throw without a roll`);
    out.push(willing ? { ...target, autoFail: "willing" } : target);
  }
  return out;
}

/** The core's `open()` data for a message, or null if there is nothing to resolve. */
export async function openingFor(message, usage, extra={}) {
  if ( !usage.plan.attack && !usage.targets.length ) {
    log(usage.area ? "area placed on nobody: nothing to resolve" : "no target designated: left to the card buttons");
    return null;
  }
  const { area, ...data } = usage;
  // An exclusive effect chosen in advance by the click (menu: "Grapple", "Shove: Prone"…): no question.
  const choice = game.messages.get(usage.origin ?? message.id)?.getFlag(MODULE_ID, "choice") ?? message.getFlag(MODULE_ID, "choice") ?? null;
  // §16.27: the split of projectiles made at multiple targeting (Magic Missile).
  const pairs = game.messages.get(usage.origin ?? message.id)?.getFlag(MODULE_ID, "allocation");   // [[token, nombre], …]
  const allocation = Array.isArray(pairs) ? Object.fromEntries(pairs) : null;
  let targets = await enrich(usage.targets, usage.plan, speakerTokenUuid(message), usage.activity, null, castLevelOfMessage(message),
    { forced: forcedThrough(message) });
  // §169: a replay without a save (Wall of Fire crossed, end of turn on the burning side) — full damage, automatically.
  if ( usage.plan.save && message.getFlag(MODULE_ID, "areaTick")?.noSave ) targets = targets.map(t => ({ ...t, autoFail: "noSave" }));
  if ( usage.plan.save ) {
    const activity = fromUuidSync(usage.activity, { strict: false });
    // §402: the token that speaks first — an unlinked NPC has no "active" token through its synthetic actor.
    targets = await askWilling(activity, targets, fromUuidSync(speakerTokenUuid(message) ?? "", { strict: false })
      ?? activity?.actor?.getActiveTokens?.(false, true)?.[0] ?? null);
    // "Superior Magic Resistance" (`saveAutoSuccessAgainst`): the bearer succeeds automatically against a spell or magical effect.
    targets = targets.map(t => {
      if ( t.autoFail || t.autoSucceed ) return t;
      const bearer = fromUuidSync(t.token, { strict: false })?.actor ?? fromUuidSync(t.actor, { strict: false });
      const trait = autoSaveAgainst(bearer, activity);
      return trait ? { ...t, autoSucceed: `trait:${trait}` } : t;
    });
    // §402: `saveAutoSuccess` — `types`: these creature types succeed automatically ("Petrification": Constructs);
    // `fighting`: a creature the caster is also fighting (in combat, an enemy: "Captivating Speech", "False Friends").
    // `sizeAtLeast`: a creature of at least this size ("Falling Net").
    const rule = contentOf(activity?.item).entry?.saveAutoSuccess ?? null;
    // The token that speaks (an unlinked NPC has no "active" token through its synthetic actor).
    const caster = rule?.fighting ? (fromUuidSync(speakerTokenUuid(message) ?? "", { strict: false })
      ?? activity?.actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
    // A combat that has started (not necessarily the one this client shows) where both are present, enemies of each other.
    const fighting = token => !!(caster && token && areEnemies(caster, token) && game.combats.some(c => c.started
      && c.combatants.some(k => k.tokenId === token.id) && c.combatants.some(k => k.tokenId === caster.id)));
    // `saveAutoFail` — these types fail automatically ("Withering": a Plant).
    const failRule = contentOf(activity?.item).entry?.saveAutoFail ?? null;
    if ( rule || failRule ) targets = targets.map(t => {
      if ( t.autoFail ) return t;
      const token = fromUuidSync(t.token, { strict: false });
      const actor = token?.actor ?? fromUuidSync(t.actor, { strict: false });
      const type = actor?.system?.details?.type?.value;
      const failed = typeAutoSave({ fail: failRule?.types }, type);
      if ( failed ) return { ...t, ...failed };
      const own = creatureAutoSuccess(rule, { type, size: actor?.system?.traits?.size });
      if ( own ) return { ...t, autoSucceed: own };
      return (rule && fighting(token)) ? { ...t, autoSucceed: "fighting" } : t;
    });
  }
  return { id: foundry.utils.randomID(), ...data, choice, allocation, targets, ...extra };
}

/* -------------------------------------------- */
/*  Cancellation, the author's damage, resumption */
/* -------------------------------------------- */

/**
 * Cancels what a resolution applied. `message` is the message that shows the button: the
 * bearer, or the damage message that restates its result. Active GM only.
 */
export async function undo(message) {
  if ( !isExecutor() ) return;
  const carrier = game.messages.get(message.getFlag(MODULE_ID, "applied")?.carrier) ?? message;
  const resolution = resolutionOn(carrier);
  if ( resolution?.step !== STEPS.DONE ) return;
  const plan = undoPlan(resolution);
  for ( const { actor, restore } of plan.hp ) await restoreHp(actor, restore);
  await removeEffects(plan.effects);
  await dispatcher.send(carrier.id, { type: "undone" });
  log("resolution cancelled");
}

/**
 * On the AUTHOR's client of the action: as soon as the resolution moves to a step that awaits their
 * damage, they roll it. We react to a signal, not to a delay, and each one rolls their own dice
 * (SPEC, principle 2). `step` is in the diff only when it changes: a step relaunches nothing.
 */
function onResolutionFlag(message, changes) {
  const diff = changes.flags?.[MODULE_ID]?.resolution;
  if ( !diff || !("step" in diff) || !message.isAuthor ) return;
  const resolution = resolutionOn(message);
  if ( !resolution || !wantsDamageRoll(resolution) ) return;
  // §90: a resolution that a reaction window passes through goes back through "awaited rolls" before the first roll is
  // recorded — and the question about roll boons (adapter/smite.mjs) delays it: without this guard, a second roll went out
  // (Parry: left to the board; Riposte: applied, without the maneuver's die). One roll per resolution; a failure releases it.
  if ( damageRolling.has(resolution.id) ) return;
  damageRolling.add(resolution.id);
  // §419: "Damage" setting, on click — the author rolls themself. §524: "on click for players" — this client is the author's
  // (`message.isAuthor`): a player clicks, the GM chains on.
  // #173 (§556): the author's window is dnd5e's own damage dialog (situational bonus, Critical / Normal, roll mode) — "required" in
  // the click modes; otherwise "offered", shown only on a client that turned "Rolls without dialog" off. Closed or timed out,
  // the roll still goes with the default button (adapter/damage-dialog.mjs): a hit has damage.
  const dialog = damageDialog(damageFlow({ playerAuthor: !game.user.isGM }));
  log(dialog === "required" ? "damage roll: dnd5e's dialog for the author" : "chained damage roll");
  rollDamageFor(message, resolution, isCriticalHit(resolution), mixedCriticalTokens(resolution), { dialog }).catch(err => {
    damageRolling.delete(resolution.id);
    console.error(`${MODULE_ID} | automatic damage roll failed`, err);
    ui.notifications.warn("DND5ECOMBAT.DegatsManuels", { localize: true });
  });
}

/** The resolutions whose chained damage roll has gone out, on this client. */
const damageRolling = new Set();

/**
 * §421: the damage or healing rolls that a resolution awaits from an author who is no longer connected — nobody will roll them.
 * Read from the latest messages: `{ messageId, userId, userName, actor, actorName, item, heal }`.
 */
export function blockedRolls() {
  const stuck = [];
  for ( const message of game.messages?.contents.slice(-LOOKBACK) ?? [] ) {
    const resolution = resolutionOn(message);
    if ( !resolution || !wantsDamageRoll(resolution) || (message.author?.active !== false) ) continue;
    const activity = message.getAssociatedActivity?.() ?? null;
    stuck.push({ messageId: message.id, userId: message.author?.id ?? null, userName: message.author?.name ?? "",
      actor: activity?.actor?.uuid ?? null, actorName: activity?.actor?.name ?? message.speaker?.alias ?? "",
      item: activity?.item?.name ?? "", heal: !!resolution.plan?.heal });
  }
  return stuck;
}

/**
 * §421: the active GM rolls, in place of a departed author, the roll its resolution awaits. These are the GM's dice;
 * the resolution resumes as if the author had rolled them. Returns false if nothing is due, if the author is present,
 * or if the roll has already gone out.
 * @param {string} messageId  The message that carries the resolution.
 */
export async function rollForAbsent(messageId) {
  if ( !isExecutor() ) return false;
  const message = game.messages.get(messageId);
  const resolution = message ? resolutionOn(message) : null;
  if ( !resolution || !wantsDamageRoll(resolution) || (message.author?.active !== false) || damageRolling.has(resolution.id) ) return false;
  damageRolling.add(resolution.id);
  log(`damage roll for ${message.author?.name ?? "an absent author"}, by the GM`);
  try { await rollDamageFor(message, resolution, isCriticalHit(resolution), mixedCriticalTokens(resolution)); return true; }
  catch(err) {
    damageRolling.delete(resolution.id);
    console.error(`${MODULE_ID} | damage roll for an absent author failed`, err);
    return false;
  }
}

/**
 * After a GM F5: an open reaction window has nobody left to listen to it. The
 * resolution itself is written: we close it by re-judging each target against its AC of the moment
 * (if Shield was cast in the meantime, it counts).
 */
async function resume() {
  for ( const message of game.messages.contents.slice(-LOOKBACK) ) {
    const resolution = resolutionOn(message);
    if ( resolution && pendingAllocation(resolution) ) {
      log("resume: projectile split pending, question asked again");
      const targets = resolution.targets.filter(t => !t.unaffected).map(({ token, name }) => ({ token, name }));
      const [event] = await COMMANDS.askAllocation({ type: "askAllocation", count: resolution.plan.darts, targets }, message, resolution);
      if ( event ) await dispatcher.send(message.id, event);
      continue;
    }
    if ( resolution && pendingChoice(resolution) ) {
      // An effect choice left unanswered (F5, player gone): the question is asked again.
      log("resume: effect choice pending, question asked again");
      const command = { type: "askChoice", prompt: resolution.plan.choice.prompt ?? null, options: resolution.plan.choice.options, ...(resolution.plan.choice.roll ? { roll: true } : {}) };
      const [event] = await COMMANDS.askChoice(command, message, resolution);
      if ( event ) await dispatcher.send(message.id, event);
      continue;
    }
    if ( resolution?.step !== STEPS.AWAITING_REACTION ) continue;
    // Issue #32: a success-at-a-price pause left open (GM F5): the failure stands.
    if ( resolution.pending.some(p => p.kind === "atCost") ) {
      log("resume: success at a cost not offered before the reload, the failure stands");
      await dispatcher.send(message.id, { type: "atCostDecided", accepted: false });
      continue;
    }
    log(`resume: reaction window closed (${resolution.pending.length} pending)`);
    // Replies whose dice have not been rolled: we roll them.
    const duplicates = resolution.pending.filter(p => p.kind === "duplicates").map(p => p.token);
    if ( duplicates.length ) {
      for ( const event of await COMMANDS.rollDuplicates({ tokens: duplicates }, message, resolution) ) await dispatcher.send(message.id, event);
      continue;
    }
    for ( const { token } of resolution.pending ) {
      const target = resolution.targets.find(t => t.token === token);
      const ac = await currentAc(token) + (target?.cover?.bonus ?? 0);   // l'abri du verdict reste acquis
      const before = target?.ac;
      await dispatcher.send(message.id, { type: "reactionResolved", token, ac, used: (ac !== before) ? game.i18n.localize("DND5ECOMBAT.ReactionReprise") : null });
    }
  }
}

/* -------------------------------------------- */

/** The system's roll messages that advance a resolution. */
const MESSAGE_HANDLERS = Object.freeze({
  usage: onUsageMessage, attack: onAttackMessage, damage: onDamageMessage, healing: onDamageMessage, save: onSaveMessage
});

export function registerEngine() {
  game.settings.register(MODULE_ID, CHAT_LIGHT_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CHAT_LIGHT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CHAT_LIGHT_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  CONFIG.queries[TARGETS_QUERY] = handleTargetsQuery;
  CONFIG.queries[SAVE_QUERY] = handleSaveQuery;
  CONFIG.queries[CHOICE_QUERY] = handleChoiceQuery;   // on all clients: the author answers
  CONFIG.queries[ALLOCATION_QUERY] = handleAllocationQuery;
  // §401: "creatures of your choice" in an area — the caster answers.
  registerZoneChoiceSetting();
  CONFIG.queries[ZONE_CHOICE_QUERY] = handleZoneChoiceQuery;
  route("updateChatMessage", onResolutionFlag, { label: "chained damage roll" });
  route("dnd5e.preRollDamageV2", onPreRollHealing, { cancellable: true, label: "healing dice at their maximum" });
  // A resolution that fails must never block the game: the system's buttons and boards stay usable.
  const failure = { executor: true, notify: "DND5ECOMBAT.ResolutionInterrompue" };
  route("createRegion", onRegionCreated, { ...failure, label: "area resolution interrupted" });
  route("createChatMessage", message => MESSAGE_HANDLERS[message.type]?.(message), { ...failure, label: "resolution interrupted" });
  route("ready", resume, { executor: true, label: "resuming pending resolutions" });
}
