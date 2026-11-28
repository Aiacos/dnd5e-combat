/**
 * dnd5e 6.0 saving throw activities: reading messages, roll requests, effects.
 *
 * Verified in dnd5e 6.0.3:
 *  - what a use message asks of the engine is read in adapter/usage.mjs
 *  - the card's "Save" button calls `actor.rollSavingThrow` with
 *    `system.origin = id du message d'utilisation` (documents/activity/save.mjs:117-135)
 *  - the system knows how to ask a player for a roll: message `type: "request"`, `handler: "save"`,
 *    whose result carries `flags.dnd5e.requestResult.requestId`
 *    (data/chat-message/request-message-data.mjs, documents/actor/actor.mjs:1272-1277).
 *    It is reused as is: a single owner of the roll request interface.
 *  - `SaveActivity#rollDamage` writes `system.onSave` on the damage message (save.mjs:86-91)
 */

import { isThinWall, touchesWallRegion } from "./wall-side.mjs";
import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { rollerFor } from "./concentration.mjs";
import { committedPosition, usageTokenOf, tokenCenter } from "./turn.mjs";
import { areaOriginOf, reachesFromPoint, sphereOf, insideSphere, shapesReach } from "./space.mjs";
import { effectOfProfile } from "./usage.mjs";
import { timedWait, closeRollDialogAfter, inLine } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { originItemOf, creatureTypeOf } from "./facts.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { hiddenFrom } from "./stealth.mjs";
import { inescapableFor } from "./grapple-rules.mjs";
import { fightingAdvantage } from "../core/conditions.mjs";
import { sizeAtLeast } from "../core/content/enums.mjs";
import { isObjectToken } from "./bodies.mjs";
import { usageMetamagic } from "./metamagic.mjs";
import { foretellFor } from "./portent.mjs";
import { foretoldRange } from "../core/portent.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { normalizeTargetModes, saveModeFor } from "../core/target-modes.mjs";
import { areEnemies, sideOf, factionOf } from "./factions.mjs";
import { samePlane } from "./plane.mjs";
import { coverFor } from "./cover.mjs";
import { dexSaveTakesCover, coverSaveBonus } from "../core/save-cover.mjs";
import { isBreathWeapon, breathAdvantageHolds } from "../core/breath.mjs";
import { saveDisadvantageAgainst } from "./save-against.mjs";
export { applyEffectsToToken, applyMarkToToken, applyStatusToToken, removeEffects, splitPushes } from "./apply-effects.mjs";
export { TARGETS_QUERY, handleTargetsQuery, showTargetsTo } from "./show-targets.mjs";

/**
 * A plan's activity, as the carrying message sees it (including the spell's scaling).
 * `uuid` can designate another activity of the same item: the save imposed by an attack.
 */
export function activityFor(carrier, uuid=null) {
  const primary = carrier.getAssociatedActivity?.({ scaled: true }) ?? null;
  if ( !uuid || !primary || (primary.uuid === uuid) ) return primary;
  return primary.item?.system.activities?.find(a => a.uuid === uuid) ?? fromUuidSync(uuid) ?? null;
}

/**
 * What a region placed by an activity (template-placement.mjs:150-163) lets us know.
 * @param {RegionDocument} region
 * @returns {Promise<object|null>}  null if the region does not come from an activity.
 */
/** Whom an area affects: `ally`, `enemy`, or "" (everyone); an "as chosen" area spares allies. */
export function areaAffects(activity) {
  // §86: what the content says about the item's area takes precedence (Yolande's Regal Presence: allies spared).
  const declared = activity?.item ? contentOf(activity.item).entry?.zoneAffects : null;
  if ( declared ) return declared;
  const affects = activity?.target?.affects ?? {};
  const type = affects.type ?? "";
  if ( ["ally", "enemy"].includes(type) ) return type;
  return affects.choice ? "enemy" : type;
}

export async function readActivityRegion(region) {
  const uuid = region.getFlag("dnd5e", "activity");
  if ( !uuid ) return null;
  const activity = await fromUuid(uuid);
  const origin = region.getFlag("dnd5e", "origin") ?? null;
  const originToken = origin ? await fromUuid(origin) : null;
  // P2: the area's origin point, for line of effect (a floor between the area and the creature).
  const areaOrigin = areaOriginOf(region, originToken);
  // P2: a true Sphere — the region's slice makes it a cylinder, its corners are outside the Sphere.
  const sphere = sphereOf(region, activity, originToken);
  const thinWall = isThinWall(region);
  // §286: the `count` templates that dnd5e places in a single region — not a wall's segments (one shape per segment).
  const several = !thinWall && ((Number(activity?.target?.template?.count) || 1) > 1) && ((region.shapes?.length ?? 0) > 1);
  return {
    activity: uuid,
    origin,
    originDisposition: originToken?.disposition ?? null,
    originSide: originToken ? sideOf(originToken) : null,   // §181
    // O4 (§338): `includesOrigin` — a self area that also takes its origin (Sneezing Powder, Bag of Beans).
    // §462 / §463: the area of a teleportation, at departure (its author has left) or at arrival (Emanation around them): not them.
    excludeOrigin: ((activity?.range?.units === "self") || !!(activity?.item && contentOf(activity.item).entry?.teleport?.area))
      && !(activity?.item && contentOf(activity.item).entry?.includesOrigin),
    // "You can designate creatures that are not affected" (`affects.choice`, Spirit Guardians): by default,
    // the caster's allies are spared — the engine does not ask the question (§16.23).
    affects: areaAffects(activity),
    // §296: the area's creature cap (`zoneMax`), and each one's distance to the center to tell them apart.
    max: (activity?.item ? contentOf(activity.item).entry?.zoneMax : null) ?? null,
    // Membership computed by the core (TokenDocument#testInsideRegion, client/documents/token.mjs:3236).
    // §169, §173: a thin wall, placed between cells — "in its area" on appearance: the space touches the wall.
    candidates: region.parent.tokens.filter(t => t.actor && !isObjectToken(t)
      && (thinWall ? touchesWallRegion(region, t) : t.testInsideRegion(region, committedPosition(t)))).map(t => ({
      token: t.uuid,
      actor: t.actor.uuid,
      name: t.name,
      disposition: t.disposition,
      faction: factionOf(t), stance: t.getFlag(MODULE_ID, "stance") ?? null,   // §181
      defeated: t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true,
      // §286: several shapes (Meteor Swarm, Fire Storm) — each its own origin; taken only once.
      ...(several ? shapesReach(region, activity, originToken, t) : { lineOfEffect: reachesFromPoint(areaOrigin, t), inVolume: insideSphere(sphere, t) }),
      offPlane: originToken ? !samePlane(originToken, t) : false,   // §225: the area is on its caster's plane
      distance: areaOrigin ? Math.hypot(tokenCenter(t).x - areaOrigin.x, tokenCenter(t).y - areaOrigin.y) : null
    }))
  };
}

/**
 * @param {ChatMessage} message  Message de type "save".
 * @returns {{origin: string|null, request: string|null, actor: string|null, total: number}|null}
 */
export function readSaveMessage(message) {
  const roll = message.rolls?.[0];
  if ( !roll || (message.system?.type && (message.system.type !== "ability")) ) return null;   // ni concentration ni mort
  return {
    origin: message._source.system?.origin ?? null,
    request: message.getFlag("dnd5e", "requestResult")?.requestId ?? null,
    actor: message.getAssociatedActor?.()?.uuid ?? null,
    total: roll.total,
    // §231: the d20's mode, for the visual feedback (Advantage / Disadvantage).
    mode: (roll.hasAdvantage === true) ? "advantage" : (roll.hasDisadvantage === true) ? "disadvantage" : null
  };
}

export const SAVE_QUERY = `${MODULE_ID}.rollSave`;
const SAVE_TIMEOUT = 40000;   // two possible windows (choice, roll), each bounded by adapter/dialogs.mjs

/** The cover bonus to `token`'s Dexterity save against this activity (0: none), judged from the author's token. */
function coverBonusForSave(activity, token, ability) {
  const area = !!activity?.target?.template?.type;
  const ignores = contentOf(activity?.item).entry?.saveIgnoresCover === true;
  if ( !dexSaveTakesCover({ ability, area, ignores }) ) return 0;
  const caster = usageTokenOf(activity);
  const target = token?.document ?? token;
  if ( !caster || !target || (caster === target) ) return 0;
  return coverSaveBonus(coverFor(caster.document ?? caster, target, { activity, quiet: true }));
}

/** The "cover" part added to a saving throw's parts, under its own data key. */
function withCoverPart(bonus, cover) {
  const part = `@${MODULE_ID.replace(/[^a-zA-Z]/g, "")}Cover`;
  const data = { [part.slice(1)]: cover };
  return bonus.parts.length ? { ...bonus, parts: [...bonus.parts, part], data: { ...bonus.data, ...data } } : { parts: [part], data };
}

/** Roll parameters, the same as the card's "Save" button (save.mjs:122-134). */
function saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage=false, disadvantage=false, foretold=null }) {
  // Issue #183: cover also applies to Dexterity saves ("+2 / +5 to AC and Dexterity saving throws").
  // Here for a save that targets its target, without an area: cover is judged from the author, as for an attack.
  const cover = coverBonusForSave(activity, token, ability);
  if ( cover ) console.log(`${MODULE_ID} | ${actor?.name}: cover, +${cover} to the Dexterity saving throw`);
  let bonus = CONFIG.Dice.BasicRoll.constructParts({ activityBonus: activity.save?.bonus }, activity.getRollData());
  // Cover enters alone, with its own data: the activity's roll data are the AUTHOR's (their `@mod`, their `@prof`) and
  // must not replace those of the creature that saves.
  if ( cover ) bonus = withCoverPart(bonus, cover);
  const rollConfig = { ability, target: dc };
  // §16.25: Fey Ancestry — Advantage against an activity that applies a condition that one of its items designates.
  if ( saveAdvantageAgainst(actor, activity) || fightingAdvantageFor(activity, token) || sizeAdvantageFor(actor, activity) ) rollConfig.advantage = true;
  // §32: Heightened Spell (the target chosen by requestSaves); §249: the mode given per target in the use message.
  if ( advantage ) rollConfig.advantage = true;
  if ( disadvantage ) rollConfig.disadvantage = true;
  // §36: Portent — the d20 replaced by the noted roll (die bounds, adapter/portent.mjs).
  if ( Number.isInteger(foretold) ) rollConfig.rolls = [{ ...bonus, options: foretoldRange(foretold) }];
  else if ( bonus.parts.length ) rollConfig.rolls = [bonus];
  return [rollConfig, {
    data: {
      speaker: ChatMessage.getSpeaker({ actor, scene: token.parent, token }),
      system: { ...activity.messageSources, origin: usageMessage.id }
    }
  }];
}

/**
 * §32: Heightened Spell — "Disadvantage on a target of the spell": among the targets whose save is requested, the first one hostile
 * to the caster (token uuid), or null if the card does not carry the option.
 */
function heightenedTarget(activity, usageMessage, targets) {
  if ( !usageMetamagic(usageMessage).includes("heightened") ) return null;
  const caster = usageTokenOf(activity);
  for ( const t of targets ) {
    const token = fromUuidSync(t.token ?? "", { strict: false });
    if ( token && caster && areEnemies(caster, token) ) return token.uuid;
  }
  return null;
}

/**
 * C12-b: Heightened Spell over time. On casting, the heightened target receives a mark per item (`flags.dnd5e-combat.heightened`),
 * another target of the same casting loses it; a replayed save (`resave` card) or one from an area that acts again (`areaTick`)
 * reads the mark. Returns true if this save has the Disadvantage of Heightened Spell. Active GM.
 */
async function heightenedMark(usageMessage, activity, token, heightened) {
  const actor = token.actor;
  const key = activity.item?.uuid?.replaceAll(".", "_");
  if ( !actor || !key ) return token.uuid === heightened;
  // Replayed save, or area that acts again (Spirit Guardians, Moonbeam: `areaTick` card).
  if ( usageMessage.getFlag(MODULE_ID, "resave") || usageMessage.getFlag(MODULE_ID, "areaTick") ) return !!actor.getFlag(MODULE_ID, `heightened.${key}`);
  const marked = !!actor.getFlag(MODULE_ID, `heightened.${key}`);
  if ( (token.uuid === heightened) && !marked ) await actor.setFlag(MODULE_ID, `heightened.${key}`, true);
  else if ( (token.uuid !== heightened) && marked ) await actor.unsetFlag(MODULE_ID, `heightened.${key}`);
  return token.uuid === heightened;
}

/**
 * §16.47: "Advantage if you or your allies are fighting it" (`advantageIfFighting`: Charm Person) — the target is in a
 * combat that has started and hostile to the caster.
 */
export function fightingAdvantageFor(activity, token) {
  if ( !token || (contentOf(activity?.item).entry?.advantageIfFighting !== true) ) return false;
  const caster = usageTokenOf(activity);
  const targetInCombat = game.combats.some(c => c.started && c.combatants.some(x => x.tokenId === token.id));
  return fightingAdvantage({ targetInCombat, hostile: !!caster && areEnemies(caster, token) });
}

/**
 * C12-e: the Disadvantage that a caster imposes on the save against their spell — returns the rule's name, or null.
 *  - Magical Ambush (Arcane Trickster Rogue 9): "if you have the Invisible condition when you cast a spell on a creature, it has
 *    Disadvantage on any save against it this turn" — Invisible, or hidden from it (the engine's Stealth); not the
 *    saves replayed on the following turns.
 *  - Eldritch Strike (Eldritch Knight 10): "when you hit a creature with a weapon attack, it has Disadvantage
 *    on the next save it makes against one of your spells before the end of your next turn" — the mark set at the hit
 *    (runtime/feats.mjs), consumed here. Active GM.
 */
function casterImposedDisadvantage(activity, token) {
  const caster = activity?.actor;
  if ( !caster || (activity.item?.type !== "spell") || !token?.actor ) return null;
  if ( caster.items.some(i => identifierOf(i).id === "magical-ambush") ) {
    const casterToken = usageTokenOf(activity);
    if ( casterToken && (casterToken.hasStatusEffect?.("invisible") || hiddenFrom(token, casterToken)) ) return "Magical Ambush";
  }
  const round = game.combat?.round ?? null;
  const mark = token.actor.effects.find(e => {
    const m = e.getFlag(MODULE_ID, "eldritchStrike");
    return (m?.source === caster.uuid) && ((m.round === null) || (round === null) || (round - m.round <= 1));
  });
  if ( mark ) {
    mark.delete().catch(err => console.warn(`${MODULE_ID} | Eldritch Strike mark`, err));
    return "Eldritch Strike";
  }
  return null;
}

/**
 * §206: "a Large or larger creature has Advantage on this roll" (`saveAdvantageSize` on the activity's item: Trip
 * Strike). The size is the sheet's (`system.traits.size`).
 */
export function sizeAdvantageFor(actor, activity) {
  const min = contentOf(activity?.item).entry?.saveAdvantageSize;
  return !!min && !!actor && sizeAtLeast(actor.system?.traits?.size, min);
}

/** The conditions applied by an activity's effects (`activity.effects[]` profiles, read by `effectOfProfile`, §126). */
function statusesPosedBy(activity) {
  return new Set((activity?.effects ?? []).flatMap(ref => [...(effectOfProfile(ref, activity.item)?.statuses ?? [])]));
}

/**
 * "Spells and other magical effects" (Magic Resistance, §18.9): a spell — including the copy that Casting creates
 * (`flags.dnd5e.cachedFor`, of type "spell") —, or an item with dnd5e's Magical property (`mgc`).
 */
export function isMagical(activity) {
  const item = activity?.item;
  if ( !item ) return false;
  return (item.type === "spell") || (item.system?.properties?.has?.("mgc") === true);
}

/**
 * Does the actor automatically succeed on the save of this activity (`saveAutoSuccessAgainst`)? "magic": against a spell or a
 * magical effect (Greater Magic Resistance). Returns the identifier of the trait that gives it, or null.
 */
export function autoSaveAgainst(actor, activity) {
  if ( !actor || !isMagical(activity) ) return null;
  for ( const item of actor.items ?? [] ) {
    const content = contentOf(item);
    if ( (content.entry?.saveAutoSuccessAgainst ?? []).includes("magic") ) return content.identifier ?? item.name;
  }
  return null;
}

/** The types of objects one carries (not features or spells). */
const GEAR = new Set(["equipment", "weapon", "consumable", "tool", "loot", "container"]);
/** Equipped, and attuned if it requires attunement. */
const worn = item => (item.system?.equipped !== false) && ((item.system?.attunement !== "required") || (item.system?.attuned === true));

/** `breathAdvantage`: a carried object gives Advantage against the breath (identifier "…-breath") of a creature of these types. */
function breathAdvantageFor(actor, activity) {
  if ( !isBreathWeapon(identifierOf(activity?.item).id) ) return false;
  const type = creatureTypeOf(activity?.actor);
  return (actor?.items ?? []).some(item => (!GEAR.has(item.type) || worn(item))
    && breathAdvantageHolds(contentOf(item).entry?.breathAdvantage, type));
}

/**
 * Does the actor have Advantage on the save of this activity (`saveAdvantage`)? What gives it: an item they carry
 * (Fey Ancestry, Magic Resistance), or, for a spell, an effect of that spell placed on them (Protection from
 * Poison) — the caster, who has the spell on their sheet, does not benefit from it.
 */
export function saveAdvantageAgainst(actor, activity) {
  // Dragon Scale Mail: "Advantage on saving throws against the breath of Dragons" (`breathAdvantage`) — a
  // breath is neither magical nor necessarily carrying a condition: judged before the rest.
  if ( breathAdvantageFor(actor, activity) ) return true;
  const posed = statusesPosedBy(activity);
  const magical = isMagical(activity);
  if ( !posed.size && !magical ) return false;
  // O2 (§336): an effect carrying `flags.dnd5e-combat.saveAdvantage.<état|magic>` (the Antidote drunk: its vial is often used up).
  const flagged = actor?.flags?.[MODULE_ID]?.saveAdvantage ?? {};
  if ( [...posed].some(s => flagged[s]) || (magical && flagged.magic) ) return true;
  // §48: neither a spell on their sheet, nor a scroll they carry — it is the placed effect that counts. O2 (§336): an object
  // (ring, cloak, amulet) protects only when carried, and attuned if it requires it.
  const owned = (actor?.items ?? []).filter(item => !isSpellCast(item) && (!GEAR.has(item.type) || worn(item)));
  const borne = (actor?.effects ?? []).filter(e => !e.disabled && !e.isSuppressed).map(originItemOf)
    .filter(item => isSpellCast(item));
  if ( [...owned, ...borne].some(item => (contentOf(item).entry?.saveAdvantage ?? [])
    .some(s => posed.has(s) || ((s === "magic") && magical))) ) return true;
  // §402: `saveAdvantageFrom: { types, statuses }` — against these conditions applied by a creature of these types (Protection
  // from Evil and Good: "a target already Charmed or Frightened by one of them has Advantage on any new save against that effect").
  const type = creatureTypeOf(activity?.actor);
  return !!type && borne.some(item => {
    const rule = contentOf(item).entry?.saveAdvantageFrom;
    return !!rule && rule.types.includes(type) && rule.statuses.some(s => posed.has(s));
  });
}

/**
 * §402: Circle of Power — "if it succeeds on a save against a spell or magical effect that deals half damage on a
 * success, it takes none": a carried effect that comes from a spell whose content declares `magicEvasion`, against a magical
 * activity, whatever the ability (rendered "any", like the monster's Evasion).
 */
export function magicEvasionAgainst(actor, activity) {
  if ( !actor || !isMagical(activity) ) return false;
  return (actor.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e)).entry?.magicEvasion === true));
}

/**
 * Several abilities at the target's choice (Grapple / Shove: Strength or Dexterity): the
 * best save for it — the choice of any player. The system, for its part, puts a button
 * per ability on the card (documents/activity/save.mjs:55-71); the roll window does not allow
 * changing it.
 */
export function bestSaveAbility(actor, abilities) {
  const bonus = a => actor.system.abilities?.[a]?.save?.value ?? actor.system.abilities?.[a]?.mod ?? -Infinity;
  return abilities.reduce((best, a) => (bonus(a) > bonus(best) ? a : best), abilities[0]);
}

/**
 * The target chooses their ability (Grapple / Shove: "it is the one who chooses", PHB glossary):
 * a "Strength (+x) / Dexterity (+y)" window on the client of whoever controls it — the player, or the GM for an NPC.
 * Closed without a choice: the best one.
 * @returns {Promise<string>}
 */
export async function chooseSaveAbility(actor, abilities, { dc, item }) {
  const best = bestSaveAbility(actor, abilities);
  const signed = n => (n >= 0 ? `+${n}` : `${n}`);
  const buttons = abilities.map(a => ({
    action: a,
    label: `${game.i18n.localize(CONFIG.DND5E.abilities[a]?.label ?? a)} (${signed(actor.system.abilities?.[a]?.save?.value ?? 0)})`,
    default: a === best
  }));
  // With no answer within the timeout: the best one.
  const choice = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.ChoixSauvegarde.Titre", { name: actor.name }) },
    content: `<p>${game.i18n.format("DND5ECOMBAT.ChoixSauvegarde.Texte", { item, dc })}</p>`,
    buttons
  }, { fallback: best, awaiting: { actor, kind: "roll", token: actor.token ?? null } });
  return abilities.includes(choice) ? choice : best;
}

/**
 * Player side: the saving throw window opens on THEIR screen, they are their dice. The roll
 * is never rolled for them; window closed → false, and the active GM leaves them the system's request
 * card so they roll when they want. Several abilities at their choice: they choose first.
 */
export async function handleSaveQuery({ usage, token: tokenUuid, ability, abilities=null, ask=true, dc, item, activity: activityUuid=null, advantage=false, disadvantage=false, foretold=null }, { user=null }={}) {
  // §472: only the GM sends this request in the game; from a player, it is dropped (safety refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | save query from ${user.name} refused: only a GM sends it`); return false; }
  const usageMessage = game.messages.get(usage);
  const token = await fromUuid(tokenUuid);
  const actor = token?.actor;
  const activity = usageMessage ? activityFor(usageMessage, activityUuid) : null;
  if ( !actor || !activity ) return false;
  ui.notifications.info(game.i18n.format("DND5ECOMBAT.DemandeSauvegardeJoueur", { name: actor.name, item }));
  if ( ask && (abilities?.length > 1) ) ability = await chooseSaveAbility(actor, abilities, { dc, item });
  // The roll window closes at the end of the timeout; the roll then goes off by itself (its dice, without a dialog).
  let timedOut = false;
  // §401: the roll window in turn goes into this station's window queue; its timeout starts when it opens.
  let rolls = await inLine(async () => {
    const cancel = closeRollDialogAfter(actor, () => { timedOut = true; }, null, { awaiting: "roll" });
    const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
    try { return await actor.rollSavingThrow(rollConfig, { configure: true }, messageConfig); }
    finally { cancel(); }
  });
  if ( !rolls?.length && timedOut ) {
    const [again, againMessage] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
    rolls = await actor.rollSavingThrow(again, { configure: false }, againMessage);
  }
  return !!rolls?.length;
}

/**
 * Triggers the expected saving throws: the engine rolls for NPCs (and PCs with no connected player); each player sees their roll
 * window (request) open on their side, and only receives the system's request card if they closed it or did not answer.
 * Active GM only.
 * @param {ChatMessage} usageMessage              The bearer of the resolution.
 * @param {{ability: string, dc: number, activity: string}} save  The plan's save.
 * @param {Array<{token: string, actor: string}>} targets  Targets whose roll is awaited.
 * @param {object} [options]
 * @param {boolean} [options.askPlayers]  Several abilities: the player chooses (otherwise the best one).
 * @param {boolean} [options.askGM]       Same for a target rolled by the GM (NPC, PC with no connected player).
 * @param {string|null} [options.auto]    The scenario tool `autoReact` (§36: Portent — "none": nobody; "first": no window).
 */
export async function requestSaves(usageMessage, save, targets, { askPlayers=true, askGM=false, auto=null }={}) {
  const activity = activityFor(usageMessage, save.activity);
  if ( !activity ) return;
  const { dc } = save;
  const heightened = heightenedTarget(activity, usageMessage, targets);
  // §249: the Advantage or Disadvantage given per target by whoever used the activity (the GM in front of a trap).
  const given = normalizeTargetModes(usageMessage.getFlag(MODULE_ID, "targetModes"));
  const requested = [];
  const asked = [];
  // §36: a diviner who declines Portent for one target is no longer consulted for the others (Fireball: one question, not five).
  const declined = new Set();
  let ability = save.ability;

  for ( const target of targets ) {
    const token = await fromUuid(target.token);
    const actor = token?.actor;
    if ( !actor ) continue;
    const abilities = save.abilities ?? [save.ability];
    ability = bestSaveAbility(actor, abilities);
    // §157: "a Construct has Disadvantage on the saving throw" (Shatter) — `saveDisadvantageFor` from the content.
    const byType = (contentOf(activity.item).entry?.saveDisadvantageFor ?? []).includes(creatureTypeOf(actor));
    // §281: Relentless — saves against the Grapple and Shove of a grappler that has it (Unarmed Strike) have Disadvantage.
    const inescapable = unarmedSave(activity) && await inescapableFor(activity.actor, token.name);
    if ( inescapable ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} has Disadvantage against the grapple or shove`);
    const mode = saveModeFor(given, token.uuid);
    // C12-e: Magical Ambush, "Occult Weakening" — the Disadvantage that the caster imposes.
    const imposed = usageMessage.getFlag(MODULE_ID, "resave") ? null : casterImposedDisadvantage(activity, token);
    if ( imposed ) console.log(`${MODULE_ID} | ${imposed}: ${token.name} has Disadvantage on its saving throw against ${activity.item.name}`);
    // C12-b: Heightened Spell applies to all the spell's saves, replayed ones included (Hold Person) — the target is
    // noted on its actor at casting (per item), read at each replayed save, forgotten at the next casting without the option.
    const heightenedNow = await heightenedMark(usageMessage, activity, token, heightened);
    // "Demonic Armor": a worn item gives Disadvantage against the saves of a creature of a subtype.
    const cursed = saveDisadvantageAgainst(actor, activity.actor);
    if ( cursed ) console.log(`${MODULE_ID} | ${cursed.name}: ${token.name} has Disadvantage against ${activity.item.name}`);
    const disadvantage = heightenedNow || byType || inescapable || !!imposed || !!cursed || mode.disadvantage;
    const advantage = mode.advantage;
    if ( given?.[token.uuid] ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} has ${given[token.uuid]} on its saving throw (given by the user)`);
    if ( heightenedNow ) console.log(`${MODULE_ID} | Heightened Spell: ${token.name} has Disadvantage on its saving throw`);
    else if ( byType ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} (${creatureTypeOf(actor)}) has Disadvantage on its saving throw`);
    // §36: Portent — "to be decided before the roll": a diviner who sees the target can replace its d20 with a noted
    // roll. The question holds the request back (until the answer or the window's timeout): that is the price of "before the roll".
    const foretold = (await foretellFor(token, { kind: "save", item: activity.item.name, auto, declined }))?.value ?? null;
    if ( foretold !== null ) console.log(`${MODULE_ID} | Portent: ${token.name}'s saving throw will use ${foretold} on the d20`);
    const userId = rollerFor(actor);
    if ( userId ) {
      // Without waiting: the players roll in parallel, the NPCs wait for nobody.
      asked.push(queryPlayer(game.users.get(userId), SAVE_QUERY,
        { usage: usageMessage.id, token: token.uuid, ability, abilities, ask: askPlayers, dc, item: activity.item.name, activity: activity.uuid, advantage, disadvantage, foretold },
        { timeout: SAVE_TIMEOUT, actor, label: waitLabel("Sauvegarde", { item: activity.item.name }) })
        .catch(() => false)
        .then(rolled => { if ( !rolled ) requested.push({ actor: actor.uuid, user: userId }); }));
      continue;
    }
    if ( askGM && (abilities.length > 1) ) ability = await chooseSaveAbility(actor, abilities, { dc, item: activity.item.name });
    const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
    await actor.rollSavingThrow(rollConfig, { configure: false }, messageConfig);
  }

  // Without blocking the engine's queue: a player may take their time in front of their window.
  Promise.all(asked).then(() => {
    if ( !requested.length ) return null;
    return ChatMessage.implementation.create({
      type: "request",
      content: `<p>${game.i18n.format("DND5ECOMBAT.DemandeSauvegarde", { item: activity.item.name })}</p>`,
      speaker: usageMessage.speaker,
      system: { handler: "save", data: { ability, target: dc }, targets: requested },
      flags: { [MODULE_ID]: { requestFor: usageMessage.id } }
    });
  }).catch(err => console.error(`${MODULE_ID} | saving throw request card not created`, err));
}

/**
 * Applies effects of the activity to a target, exactly like the system's effects tray
 * (scaling, dependence on Concentration, origin). It goes through its `<effect-application>` element,
 * whose `_applyEffectToActor` is protected and not private
 * (applications/components/effect-application.mjs:216): no patch, but an undocumented method —
 * to be rechecked at each version of the system. Active GM only.
 * @param {ChatMessage} usageMessage  The bearer of the resolution.
 * @param {string} tokenUuid
 * @param {Array<{id: string, activity: string}>} refs  Effects of the plan (core/action.mjs).
 * @returns {Promise<string[]>}  UUIDs of the effects placed on the target.
 */
/**
 * Repairs a save activity whose ability is empty, by rereading it from the compendium the item comes from.
 * Seen in play on 2026-09-20: the pregenerated characters of the premium PHB module ship a *Burning Hands* whose
 * `save.ability` is `[""]`, while the compendium spell carries `["dex"]`. Without an ability, neither the engine nor the
 * system's "Save" button knows what to roll. The fix is written on the item: it is not redone.
 * Active GM only.
 * @returns {Promise<boolean>}  true if the item was repaired.
 */
export async function repairSaveAbility(message) {
  const activity = message.getAssociatedActivity?.();
  if ( (activity?.type !== "save") || activity.save?.ability?.first?.() ) return false;
  const item = activity.item;
  const sourceUuid = item?._stats?.compendiumSource;
  const source = sourceUuid ? await fromUuid(sourceUuid) : null;
  const twin = source?.system?.activities?.get(activity.id)
    ?? source?.system?.activities?.find(a => a.type === "save");
  const abilities = Array.from(twin?.save?.ability ?? []).filter(a => a in CONFIG.DND5E.abilities);
  if ( !abilities.length || !item.isOwner || item.inCompendium ) return false;
  await item.update({ [`system.activities.${activity.id}.save.ability`]: abilities });
  console.log(`${MODULE_ID} | ${item.name} (${item.actor?.name}): saving throw ability repaired from the compendium -> ${abilities.join(", ")}`);
  return true;
}

/** §281: a Grapple or Shove save — one from an item with an attack that is an Unarmed Strike (Unarmed Strike). */
function unarmedSave(activity) {
  return (activity?.type === "save") && !!activity.item?.system?.activities?.some?.(a => a.attack?.type?.classification === "unarmed");
}
