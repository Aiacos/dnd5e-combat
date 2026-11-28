/**
 * The turn as seen from dnd5e 6.0 and the Foundry V14 core: combatant, persistent budget, cost
 * of an activity, distances, movement.
 *
 * Verified:
 *  - a player can modify the `flags` of their own combatant (common/documents/combatant.mjs:76-84):
 *    the budget lives there, readable by all, correctable by its owner and by the GM
 *  - the core keeps each token's movement history and clears it at the start of its turn
 *    (client/documents/combat.mjs:1106, token.mjs:371): the engine recounts nothing, it reads
 *  - speeds: `system.attributes.movement.speeds.<type>` in 6.0, unit in `movement.units`
 */

import { spentMovement } from "../core/movement.mjs";
import { oneThingBudget, oneThingStopsMove } from "../core/one-thing.mjs";
import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf, hasClassFeature } from "./content.mjs";
import { basicActionOf, declaredBasicsOf } from "./basics.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";
import { spellClassOf } from "./spell-class.mjs";
import { freshBudget, costOf } from "../core/turn.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";
import { depthOf, verticalExtent, verticalGap } from "../core/space.mjs";
import { climbSpeed } from "../core/climb.mjs";
import { actionSpeed } from "../core/movement.mjs";
import { multiattackOf, useKeysOf, isMultiattackItem } from "./multiattack.mjs";
import { rangedFeatsOf } from "./conditions.mjs";
import { pendingMetamagic, distantRange } from "./metamagic.mjs";

/** The actors of the combat's scene (unlinked tokens included), once each. */
export function combatSceneActors(combat) {
  const scene = combat?.scene ?? canvas.scene;
  return [...new Set((scene?.tokens ?? []).map(t => t.actor).filter(Boolean))];
}

/** An actor's combatant in the current combat, or null outside combat. */
export function combatantFor(actor) {
  if ( !actor || !game.combat?.started ) return null;
  // §236: two combatants for the same creature (Thief's Reflexes) — the one whose turn it is, otherwise the first.
  const all = game.combat.getCombatantsByActor(actor);
  return all.find(c => c.id === game.combat.combatant?.id) ?? all[0] ?? null;
}

/** The current game turn ("combat.round.turn"), for "one Reaction per turn" (§19.6). */
export function currentTurnKey() {
  const c = game.combat;
  return c?.started ? `${c.id}.${c.round}.${c.turn}` : null;
}

/** The key of a given combat turn (`{ round, turn }`, the `prior` of `combatTurnChange`), as `currentTurnKey` formats it, or null. */
export function turnKeyAt(combat, entry) {
  return entry ? `${combat.id}.${entry.round}.${entry.turn}` : null;
}

/** An actor's Reactions per round (content `reactions.perRound`, for example three), otherwise one. */
export function reactionsPerRound(actor) {
  let n = 1;
  for ( const item of actor?.items ?? [] ) n = Math.max(n, contentOf(item).entry?.reactions?.perRound ?? 1);
  return n;
}

/**
 * §503 (B23): the restriction that a use imposes for the rest of the turn (`afterUse.onlyCantrips` of its item) —
 * `{ castTime, item }`, or null. A spell cast by a "cast" activity of a feature (copy marked `cachedFor` = the activity,
 * documents/activity/cast.mjs:140) reads the feature's rule; `afterUse.activity` reserves it for one of its activities.
 */
export function afterUseRestrictionOf(activity) {
  const item = activity?.item;
  if ( !item ) return null;
  let owner = item;
  let activityId = activity.id;
  const cached = item.getFlag?.("dnd5e", "cachedFor");
  if ( cached ) {
    const m = String(cached).match(/Item\.([^.]+)\.Activity\.([^.]+)/);
    const host = m ? item.actor?.items?.get(m[1]) : null;
    if ( host ) { owner = host; activityId = m[2]; }
  }
  const rule = contentOf(owner).entry?.afterUse;
  if ( !rule?.onlyCantrips || (rule.activity && (rule.activity !== activityId)) ) return null;
  const castTime = (typeof rule.onlyCantrips === "object") ? (rule.onlyCantrips.castTime ?? null) : null;
  return { castTime, item: owner.name };
}

/** §501: does one of the actor's items declare `reactions.loseOne` ("it loses only one Reaction")? */
export function losesOnlyOneReaction(actor) {
  return (actor?.items ?? []).some(item => contentOf(item).entry?.reactions?.loseOne === true);
}

/** Fresh budget of a combatant, at its Reactions per round. */
export function freshBudgetFor(combatant) {
  return { ...freshBudget({ reactions: reactionsPerRound(combatant?.actor) }), limited: carriesRuleEffect(combatant?.actor, "limitedAction") ? 1 : 0 };
}

/**
 * Does the actor carry the effect that the content of its origin item names under `key` (§157 `limitedAction`: "Hasted" of Haste;
 * §158 `noActions`: "Stinking Poison" of Stinking Cloud)? `effect`: look only at that one.
 */
export function carriesRuleEffect(actor, key, effect=null) {
  return (effect ? [effect] : Array.from(actor?.effects ?? [])).some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const id = contentOf(originItemOf(e)).entry?.[key];
    return !!id && comesFromItemEffect(e, id);
  });
}

export function isOwnTurn(combatant) {
  return game.combat?.combatant?.id === combatant.id;
}

export function readBudget(combatant) {
  const budget = combatant.getFlag(MODULE_ID, "turn") ?? freshBudgetFor(combatant);
  // §158: Stinking Cloud — "cannot take an action or a Bonus Action" while it carries the effect. Read here, not written: resetting
  // the budget at the turn change could happen AFTER the effect applied at the start of the turn and undo it (seen on 2026-10-12).
  if ( carriesRuleEffect(combatant.actor, "noActions") ) return { ...budget, action: 0, bonus: 0, limited: 0 };
  // §285: Confusion — "cannot take a Bonus Action".
  if ( carriesRuleEffect(combatant.actor, "noBonus") ) return { ...budget, bonus: 0 };
  // "Dazed" — "only one of these things: move, take an action or take a Bonus Action" (core/one-thing.mjs).
  if ( carriesRuleEffect(combatant.actor, "oneThingPerTurn") ) {
    return oneThingBudget(budget, freshBudgetFor(combatant), historyCosts(combatant.token).spent > 0);
  }
  return budget;
}

export async function writeBudget(combatant, budget) {
  await combatant.setFlag(MODULE_ID, "turn", budget);
}

/** §31, §188: does the activity replace an attack of the Attack action? The whole item (`true`), or those activities. */
function replacesAttack(item, activity) {
  const r = contentOf(item).entry?.replacesAttack;
  return (r === true) || (Array.isArray(r) && r.includes(activity?.id));
}

/**
 * §298 (pass C3): a spell cast in place of attacks of the Attack action — War Magic (Eldritch Knight 3: a Wizard cantrip),
 * Extra Attack of the College of Valor (a cantrip), Improved War Magic (Eldritch Knight 18: a level 1 or 2 Wizard
 * spell, for two attacks). Key `spellsInAttack: { maxLevel, class?, attacks? }` on the feature; the spell
 * must be cast by an action. Returns the number of attacks it takes, or 0.
 */
export function spellAttackCost(activity) {
  const item = activity?.item;
  if ( (item?.type !== "spell") || (activity.activation?.type !== "action") || !activity.actor ) return 0;
  const level = Number(item.system?.level ?? 0);
  let best = 0;
  for ( const feature of activity.actor.items ) {
    const rule = contentOf(feature).entry?.spellsInAttack;
    if ( !rule || (level > rule.maxLevel) ) continue;
    if ( rule.class && (spellClassOf(item) !== rule.class) ) continue;
    const attacks = rule.attacks ?? 1;
    if ( !best || (attacks < best) ) best = attacks;
  }
  return best;
}

/**
 * The cost of an activity to the turn budget (§137: also read by the interface, `api.ui.cost`): the data's activation,
 * unless a rule says otherwise.
 */
export function costFor(activity) {
  const item = activity.item;
  // §31: an activity that "replaces one of your attacks" (Breath) counts as an attack of the Attack action — §90: even
  // without activation in the data (Commander's Strike: "when you take the Attack action").
  const replaces = replacesAttack(item, activity);
  // §134: Observant, Quick Search — "you can take the Search action as a Bonus Action": the Bonus Action if it is
  // free, otherwise the action.
  const quickSearch = (item?.system?.identifier === "dnd5e-combat-search")
    && Array.from(activity.actor?.items ?? []).some(i => contentOf(i).entry?.quickSearch === true);
  const searchCost = quickSearch ? (((() => { const c = combatantFor(activity.actor); return c ? (readBudget(c).bonus ?? 1) : 1; })() >= 1) ? "bonus" : "action") : null;
  // §490 (B08): a command to a companion (`commands`) without activation in the data is paid at the cost of its rule
  // (Bonus Action by default).
  const commanding = contentOf(item)?.entry?.commands ?? null;
  return searchCost ?? costOf(activity.activation?.type) ?? (commanding ? (commanding.cost ?? "bonus") : null) ?? (replaces ? "action" : null);
}

/**
 * §236: "Swift Step" — "when you take a Bonus Action other than Step of the Wind, you can also use Step of the Wind right after".
 * "free": the activity that the `fleetStep` rule names; "opens": any other (the core opens only on a Bonus Action);
 * null without the rule.
 */
function fleetStepOf(activity) {
  const rule = Array.from(activity?.actor?.items ?? []).map(i => contentOf(i).entry?.fleetStep).find(Boolean);
  if ( !rule ) return null;
  return ((identifierOf(activity.item ?? {}).id === rule.item) && (activity.id === rule.activity)) ? "free" : "opens";
}

/**
 * What an activity asks of the budget (the core's UseRequest). `costOverride`: "use my Reaction".
 * `attackMode`: the attack mode if known. `offhand` is dnd5e's mode for a Light weapon
 * (data/item/weapon.mjs:188-195; the damage there already loses the positive modifier, attack-data.mjs:426);
 * Nick is read in the mastery properties the actor has mastered for this weapon (`masteryOptions`, weapon.mjs:331).
 */
export function requestFor(activity, costOverride=null, { attackMode=null }={}) {
  const item = activity.item;
  const weapon = item?.type === "weapon";
  const offhand = weapon && (attackMode?.endsWith("offhand") === true);
  const spellSlot = (item?.type === "spell") && ((item.system.level ?? 0) > 0)
    && !["atwill", "innate", "ritual"].includes(item.system.method)
    && (activity.consumption?.spellSlot !== false)
    // §144: a spell cast by another object ("cast" activity: Favored Enemy, magic item) is a copy marked `cachedFor`; dnd5e
    // never makes it spend a slot (activity/mixin.mjs: `consume.spellSlot = !linked && …`) — nor the "one spell slot spell per
    // turn" rule.
    && !item.getFlag?.("dnd5e", "cachedFor");
  // §298: a spell cast within the Attack action (War Magic: "replace one of the attacks") — counted as attacks when
  // the Attack action has enough: the ones that remain, or, the action not yet taken, the ones it would open. Otherwise it is the
  // ordinary Magic action.
  const spellAttacks = spellAttackCost(activity);
  const inAttack = spellAttacks > 0 && (() => { const c = combatantFor(activity.actor); const b = c ? readBudget(c) : null;
    if ( !b ) return false;
    if ( (b.attacks?.used ?? 0) > 0 ) return b.attacks.used + spellAttacks <= b.attacks.granted;
    return (b.action >= 1) && (attacksPerAction(activity.actor) >= spellAttacks); })();
  const replaces = replacesAttack(item, activity) || inAttack;
  return {
    cost: costOverride ?? costFor(activity),
    ...(inAttack ? { attackCost: spellAttacks } : {}),
    weaponAttack: ((activity.type === "attack") && ["weapon", "unarmed"].includes(activity.attack?.type?.classification)) || replaces
      || isUnarmedOption(activity),
    usesSpellSlot: spellSlot,
    // §503 (B23): the spell used (level), for "no more spells this turn, except a cantrip".
    spell: (item?.type === "spell") ? { level: Number(item.system.level) || 0 } : null,
    lightWeapon: weapon && (item.system.properties?.has("lgt") === true),
    // O5a (§339): Loading property, unless a feat lifts it (Crossbow Expert).
    loading: weapon && (activity.type === "attack") && (item.system.properties?.has("lod") === true) && !rangedFeatsOf(activity.actor, activity, attackMode).loading,
    offhand,
    nick: offhand && !!item.system.masteryOptions?.some(m => m.value === "nick"),
    // M1 (§18.6): a monster's Multiattack, read from its English text.
    multiattack: multiattackOf(activity.actor),
    keys: useKeysOf(activity),
    opensMultiattack: !!item && isMultiattackItem(item),
    basic: item ? (basicActionOf(item) ?? declaredBasicsOf(activity)) : null,   // §157: Haste's limited action
    utilize: isUtilize(activity),
    fleetStep: fleetStepOf(activity)
  };
}

/** Standalone items that perform a Grapple or a Shove (Midi-QOL examples "Shove", kept on a sheet). */
const UNARMED_OPTION_ITEMS = new Set(["shove", "grapple"]);

/**
 * Grapple and Shove (PHB 2024, Unarmed Strike): the Unarmed Strike's save activity replaces one of the
 * attacks of the Attack action — counted as an attack, not as a whole action (table feedback of 2026-10-16:
 * "no more action" after a first attack with Extra Attack). Likewise a standalone Grapple or
 * Shove item, which costs an action (the ranger's sheet from that feedback carried Midi-QOL's "Shove").
 */
function isUnarmedOption(activity) {
  const item = activity?.item;
  if ( !item ) return false;
  const id = identifierOf(item).id;
  if ( UNARMED_OPTION_ITEMS.has(id) ) return activity.activation?.type === "action";
  return (activity.type === "save") && (item.type === "weapon") && (id === "unarmed-strike");
}

/** Les objets dont l'usage est l'action Utiliser (PHB 2024) : ni arme, ni sort, ni aptitude. */
const UTILIZE_TYPES = new Set(["consumable", "tool", "loot", "equipment", "container"]);

/**
 * B10 (§157): is this activity the Utilize action — "use a nonmagical object"? A magic item requires the Magic
 * action, which Haste's limited action does not allow; an attack (a thrown vial of acid) is an attack, not Utilize.
 */
export function isUtilize(activity) {
  const item = activity?.item;
  if ( !item || !UTILIZE_TYPES.has(item.type) || (activity.type === "attack") ) return false;
  // Magic: the property, or a rarity ("Activate Alchemy Jug" of the DMG, rarity without the property). Known limitation: "Activate
  // Folding Boat" has neither and passes for Utilize.
  return (item.system.properties?.has("mgc") !== true) && !item.system.rarity;
}

/**
 * Number of attacks that the Attack action opens. Accepted limitation: the system does not expose this
 * number, so it is deduced (Extra Attack, fighter 11 and 20). An NPC with Multiattack
 * follows its plan (M1, core/multiattack.mjs); if its text cannot be read, it is not limited.
 */
export function attacksPerAction(actor) {
  // §267: Slow — "it can make only one attack if it takes the Attack action".
  if ( (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e))?.entry?.singleAttack === true)) ) return 1;
  // By `identifierOf`: an item from a translated premium module, or created without an identifier, carries an identifier
  // derived from its translated name (§19.9) — read raw, "Attaque supplémentaire" was not recognized and the action gave only
  // one attack.
  const identifiers = new Set(actor.items.map(i => identifierOf(i).id));
  const has = identifier => identifiers.has(identifier);
  if ( actor.type === "npc" ) return (actor.items.some(isMultiattackItem) && !multiattackOf(actor)) ? 99 : 1;
  const fighter = actor.classes?.fighter?.system.levels ?? 0;
  if ( fighter >= 20 ) return 4;
  if ( fighter >= 11 ) return 3;
  // Thirsting Blade (warlock 5, §16.25): one Extra Attack, reserved to the pact weapon — the weapon is
  // not judged (the budget does not know the weapon of the second attack).
  // Devouring Blade (warlock 12, §29): the extra attack becomes two.
  if ( has("devouring-blade") ) return 3;
  // §298: "valor-extra-attack" — the Extra Attack of the College of Valor, recognized by its source.
  return (has("extra-attack") || has("valor-extra-attack") || has("thirsting-blade")) ? 2 : 1;
}

/**
 * Range of an activity. For a weapon attack we read the item: the activity's prepared range
 * overrides the normal range of a thrown weapon with its long range (seen in play: Spear 6/18 m →
 * `activity.range.value = 18`), which would lose the Disadvantage at long range.
 *
 * A melee weapon that can be thrown (Dagger 20/60) has two ranges depending on the **attack mode** chosen
 * in the roll dialog (weapon.mjs:196-205): its melee reach, its throwing range in
 * "thrown" mode. As long as the mode is not known (on use of the item), the more
 * generous of the two is taken; it is at the attack roll that the range is truly judged.
 * @param {Activity} activity
 * @param {string|null} [attackMode]  Chosen attack mode, if known.
 */
export function rangeOf(activity, attackMode=null) {
  // §16.43: the rule's range when the data says something else (Witch Bolt: "personal" → 18 m).
  const fixed = activity.item ? contentOf(activity.item).entry?.ranges?.[activity.id] : null;
  if ( fixed ) return { value: fixed.value, long: null, units: fixed.units };
  const prepared = activity.range ?? {};
  const weapon = (activity.type === "attack") && (activity.item?.type === "weapon") ? activity.item.system.range : null;
  if ( !weapon ) {
    const range = { value: prepared.value ?? prepared.reach ?? null, long: prepared.long ?? null, units: prepared.units };
    // §32 : Sort ample, retenu pour ce sort.
    const distant = (activity.item?.type === "spell") && (range.units !== "self") && pendingMetamagic(activity.actor).includes("distant");
    return cantripRange(activity, spellSniperRange(activity, distant ? distantRange(range) : range));
  }
  const units = weapon.units ?? prepared.units;
  const reach = weapon.reach ?? prepared.reach ?? null;
  if ( activity.attack?.type?.value === "ranged" ) return { value: weapon.value ?? null, long: weapon.long ?? null, units };
  if ( !canBeThrown(activity) ) return { value: reach, long: null, units };
  if ( attackMode?.startsWith("thrown") ) return { value: weapon.value ?? null, long: weapon.long ?? null, units };
  if ( attackMode ) return { value: reach, long: null, units };
  return { value: Math.max(reach ?? 0, weapon.value ?? 0) || null, long: weapon.long ?? null, units };
}

/**
 * §131: Spell Sniper — "when you cast a spell with a range of at least 3 m that requires an attack roll, its range increases by
 * 18 m". The `rangedFeat.spellRange` rule of a caster item (read here: adapter/conditions.mjs imports this file).
 */
function spellSniperRange(activity, range) {
  if ( (activity.item?.type !== "spell") || !Number.isFinite(range.value) || !range.units ) return range;
  // §306: `spellRange.school` — spells of this school, with or without an attack roll (Improved Illusions: +18 m to Illusions);
  // without a school, those that require an attack roll (Spell Sniper).
  const school = activity.item.system?.school;
  const rule = Array.from(activity.actor?.items ?? []).map(i => contentOf(i).entry?.rangedFeat)
    .find(r => (r?.kind === "spell") && r.spellRange && (r.spellRange.school ? (r.spellRange.school === school) : (activity.type === "attack")));
  if ( !rule ) return range;
  const factors = readUnitFactors();
  let add, least;
  try {
    add = convertLength(rule.spellRange.value, rule.spellRange.units, range.units, factors);
    least = convertLength(10, "ft", range.units, factors);
  } catch { return range; }
  if ( range.value < least - 1e-6 ) return range;
  return { ...range, value: range.value + add, long: Number.isFinite(range.long) ? range.long + add : range.long };
}

/**
 * §236: Improved Elemental Fury, Potent Spellcasting — "when you cast a Druid cantrip with a range of at least 3 m,
 * its range increases by 90 m". The `cantripRange` rule of a caster item, if it has the option item it requires (`requires`).
 * §431: `requires` may name several identifiers (the Manual's, that of dnd5e 6.1's SRD); the item must be of the rule's
 * class (`potent-spellcasting` is also the Cleric's option in 6.1).
 */
function cantripRange(activity, range) {
  const item = activity.item;
  const actor = activity.actor;
  if ( (item?.type !== "spell") || (Number(item.system?.level) !== 0) || !Number.isFinite(range.value) || !range.units || !actor ) return range;
  const rule = Array.from(actor.items).map(i => contentOf(i).entry?.cantripRange)
    .find(r => r && (!r.requires || hasClassFeature(actor, r.requires, r.class)));
  if ( !rule || ((spellClassOf(item) || (actor.classes?.[rule.class] ? rule.class : null)) !== rule.class) ) return range;
  const factors = readUnitFactors();
  let add, least;
  try {
    add = convertLength(rule.add.value, rule.add.units, range.units, factors);
    least = convertLength(10, "ft", range.units, factors);
  } catch { return range; }
  if ( range.value < least - 1e-6 ) return range;
  return { ...range, value: range.value + add, long: Number.isFinite(range.long) ? range.long + add : range.long };
}

/** Is this attack that of a melee weapon that can also be thrown? */
export function canBeThrown(activity) {
  return (activity.type === "attack") && (activity.item?.type === "weapon")
    && (activity.attack?.type?.value !== "ranged") && (activity.item.system.properties?.has("thr") === true);
}

/** Melee reach of a weapon attack, with its unit. */
export function reachOf(activity) {
  const weapon = activity.item?.system.range ?? {};
  return { value: weapon.reach ?? activity.range?.reach ?? null, long: null, units: weapon.units ?? activity.range?.units };
}

/**
 * VALIDATED position of a token: that of its source data, that is, the destination of its
 * last movement. Foundry V14 trap, seen in play on 2026-09-20: `token.x` / `token.y` are
 * the VISUAL position, which follows the animation. Read 200 ms after a `moveToken`, it is still
 * close to the starting point: the engine computed everything one step behind (an aura removed
 * when approaching, restored when moving away). In a hidden tab the animation does not run
 * and the gap never closes. Every engine measurement therefore starts from `_source`.
 */
export function committedPosition(token) {
  return positionOf(token._source);
}

/**
 * The center of a token in pixels, at the height of its feet: at its validated position, or at `pos` (waypoint, arrival position);
 * a size or an elevation absent from `pos` is the token's.
 */
export function tokenCenter(token, pos=committedPosition(token)) {
  const grid = token.parent.grid;
  const width = pos.width ?? token._source?.width ?? 1;
  const height = pos.height ?? token._source?.height ?? 1;
  return { x: pos.x + ((width * grid.sizeX) / 2), y: pos.y + ((height * grid.sizeY) / 2),
    elevation: pos.elevation ?? token._source?.elevation ?? 0 };
}

/**
 * What makes up a token position, extracted from any object that carries it (source, waypoint).
 * `depth` (height in cells, a V14 core field) goes through the engine's rule: dnd5e does not
 * fill it in, a creature is taken to be as tall as it is wide (core/space.mjs, P2).
 */
export function positionOf({ x, y, elevation, width, height, depth, shape, level }) {
  return { x, y, elevation, width, height, depth: depthOf({ width, height, depth }), shape, level };
}

/** The token that speaks in a message (`speaker.scene` / `speaker.token`), or null. */
export function speakerTokenOf(message) {
  const { scene, token } = message?.speaker ?? {};
  return (scene && token) ? (game.scenes.get(scene)?.tokens.get(token) ?? null) : null;
}

/** The token that uses an activity. `getUsageToken()` already returns a TokenDocument (activity/mixin.mjs:1252). */
export function usageTokenOf(activity) {
  return activity.getUsageToken?.() ?? activity.actor?.token ?? activity.actor?.getActiveTokens()[0]?.document ?? null;
}

/** Centers of the cells a token occupies at a given position. Pure geometry: no walls, no levels. */
function occupiedCenters(token, pos) {
  const grid = token.parent.grid;
  const width = Math.max(pos.width ?? token._source.width ?? 1, 0.5);
  const height = Math.max(pos.height ?? token._source.height ?? 1, 0.5);
  if ( grid.isGridless || !grid.isSquare ) {
    return [{ x: pos.x + ((width * grid.sizeX) / 2), y: pos.y + ((height * grid.sizeY) / 2) }];
  }
  const centers = [];
  for ( let i = 0; i < Math.ceil(height); i++ ) for ( let j = 0; j < Math.ceil(width); j++ ) {
    centers.push(grid.getCenterPoint({ x: pos.x + ((j + 0.5) * grid.sizeX), y: pos.y + ((i + 0.5) * grid.sizeY) }));
  }
  return centers;
}

/**
 * Distance between two tokens, grid unit, **in three dimensions** (P2, §14.2): the shortest
 * between two cells they occupy, at their validated position, plus the vertical gap between the slices
 * they occupy (from feet to head, `depth`) — zero when they overlap. The diagonal rule
 * is the grid's: the core's `measurePath` plays it in 3D as soon as the points carry
 * an elevation (common/grid/square.mjs:542-545, gridless.mjs:167). A flier at 60 ft above an
 * enemy is no longer "adjacent".
 *
 * `posA` / `posB`: hypothetical position (start or arrival of a movement) instead. We
 * do not use the core's `getOccupiedGridSpaceOffsets`: it starts from the visual position and discards
 * the cells hidden by a wall, which has no place here.
 */
export function distanceBetween(a, b, { posA, posB }={}) {
  const grid = a.parent.grid;
  const pa = posA ? { ...committedPosition(a), ...posA } : committedPosition(a);
  const pb = posB ? { ...committedPosition(b), ...posB } : committedPosition(b);
  const gap = verticalGap(verticalExtent(pa, grid.distance), verticalExtent(pb, grid.distance));
  let best = Infinity;
  for ( const p of occupiedCenters(a, pa) ) {
    for ( const q of occupiedCenters(b, pb) ) {
      best = Math.min(best, grid.measurePath([{ x: p.x, y: p.y, elevation: 0 }, { x: q.x, y: q.y, elevation: gap }]).distance);
    }
  }
  return { value: best, units: grid.units };
}

/**
 * The movement history of a token's turn, split into spent and teleported (`blink`, `displace`: actions
 * that the core marks `teleport`, CONFIG.Token.movement.actions; the core nevertheless measures a `blink` as a step).
 * @returns {{spent: number, excluded: number}}
 */
export function historyCosts(token) {
  return spentMovement((token?.movementHistory ?? []).map(w => ({ cost: w.cost, teleport: CONFIG.Token.movement.actions[w.action]?.teleport === true })));
}

/**
 * Movement spent this turn and walking speed, in the grid unit.
 * @returns {{spent: number, speed: number, units: string}|null}
 */
export function movementOf(combatant, factors) {
  const token = combatant.token;
  const movement = combatant.actor?.system.attributes?.movement;
  if ( !token || !movement ) return null;
  // P2: plus the height climbed via stairs this turn, which the core does not keep (see walk, adapter/movement.mjs).
  // §16.10: a teleportation or forced movement does not consume movement.
  // §17.2: plus the movement spent to stand up.
  const budget = readBudget(combatant);
  const spent = historyCosts(token).spent + (Number(budget.climbed) || 0) + (Number(budget.stood) || 0) - (Number(budget.jumped) || 0);
  const speed = speedOf(combatant.actor, factors, token._source?.movementAction ?? null, token.parent);
  // "Dazed": an action or Bonus Action taken, no more movement this turn.
  const stored = combatant.getFlag(MODULE_ID, "turn");
  if ( speed && stored && carriesRuleEffect(combatant.actor, "oneThingPerTurn")
    && oneThingStopsMove(stored, freshBudgetFor(combatant)) ) {
    return { spent, ...speed, speed: Math.min(speed.speed, spent) };
  }
  return { spent, ...speed };
}

/**
 * Speed of an actor, in the grid unit (outside combat too: §67, the Reaction that joins the attacker): walking, or that
 * of the movement action `mode` (§229: fly, swim, burrow — `actionSpeed`, core/movement.mjs).
 * §192: when climbing (`mode` = `climb`), the climb speed if the sheet has one, otherwise walking (the ×2 is in dnd5e's cost).
 * `scene`: the token's scene — the spent movement is counted in its unit, not in that of the scene this client is viewing
 * (a GM on another scene, in meters, compared a speed of 9 to spent feet). Without a token, the displayed scene.
 * @returns {{speed: number, units: string}|null}
 */
export function speedOf(actor, factors, mode=null, scene=canvas.scene) {
  const movement = actor?.system.attributes?.movement;
  if ( !movement ) return null;
  const gridUnits = scene?.grid.units ?? movement.units;
  const speeds = movement.speeds ?? movement;
  const value = (mode === "climb") ? climbSpeed(speeds).speed : actionSpeed(speeds, mode, CONFIG.DND5E?.movementTypes ?? {});
  let speed = lengthIn(value, movement.units, gridUnits, factors);
  return { speed, units: gridUnits };
}
