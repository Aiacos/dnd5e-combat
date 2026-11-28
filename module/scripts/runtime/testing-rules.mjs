/**
 * Test functions (api.mcp): turn and resolution rules — effect endings, Cover, perception, Advantage, saving throws,
 * healing and damage, check aids, budget, Portent, use, factions, stealth. Extracted from runtime/testing.mjs.
 */

import { potionOptions } from "./potion-choice.mjs";
import { potionChoiceActivity } from "../adapter/potions.mjs";
import { masterySlots } from "../core/mastery.mjs";
import { baseWeapons, chosenMasteries, masterySourcesOf, restAllowanceOf } from "../adapter/mastery.mjs";
import { judgeMasteries } from "./mastery-choices.mjs";
import { MODULE_ID } from "../constants.mjs";
import { selfSwitchOf } from "./enchant.mjs";
import { naturalOneFor } from "./natural-one.mjs";
import { combatantFor, readBudget, rangeOf, currentTurnKey } from "../adapter/turn.mjs";
import { attacksLog, attackedDuring } from "../adapter/attacked-this-turn.mjs";
import { useIssues, legendaryIssues, rangeProblems } from "./turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { movementCap } from "./actions.mjs";
import { ownEndingsOf, endingsOn, endFor } from "./action-end.mjs";
import { escapeGrapple } from "./grapple.mjs";
import { escapeDcOf, grappleEffectsOf, grappleFacts } from "../adapter/grapple.mjs";
import { reactionsBlocked, actionOrBonusOnly, reactionState } from "../adapter/reactions.mjs";
import { saveChanceOf } from "../adapter/hitchance.mjs";
import { identifierOf, contentOf, worldOverrides, setWorldOverride } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { placeRemoteEffect } from "../adapter/effects.mjs";
import { attackContext, areAdjacent, coverAgainst } from "../adapter/conditions.mjs";
import { attackModifiers } from "../core/conditions.mjs";
import { portentDice, portentOf, rollPortent } from "../adapter/portent.mjs";
import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { requestSkillAid } from "./skill-aid.mjs";
import { coverFor } from "../adapter/cover.mjs";
import { coverPreviewOf } from "../adapter/cover-preview.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { factionsApi } from "./factions.mjs";
import { coneOf } from "../adapter/cone.mjs";
import { canSee as canSeeToken } from "../adapter/vision.mjs";
import { sightingOf, passiveObservers } from "../adapter/search.mjs";
import { setHidden, check as stealthCheck, stealthViews } from "./stealth.mjs";
import { pickableNear, pickUp, scatterZones } from "./scatter.mjs";
import { unlitZones, ignitableNear, ignite, fireTargetAt, igniteWithActivity } from "./flammable.mjs";
import { lastingRegions } from "../adapter/areas.mjs";
import { readAreaState } from "../adapter/areas.mjs";
import { isHidden, spottedBy } from "../adapter/stealth.mjs";
import { lightAt as lightAtPoint, tokenPoint as stealthPoint } from "../adapter/illumination.mjs";
import { sleep } from "./shared.mjs";
import { setReadyPlan } from "./ready.mjs";
import { extinguish } from "./burning.mjs";
import { upkeepsOf, canMaintain, maintain as maintainSpell } from "./control.mjs";
import { fortifiedExtra } from "./feats.mjs";
import { armCatalyst } from "./catalyst.mjs";
import { canStandUp, standUp } from "./prone.mjs";
import { isBurning } from "../adapter/burning.mjs";
import { readyOptionsOf, slotsFor, heldEffectOf } from "../adapter/ready.mjs";
import { finite, gmOnly, viewedToken } from "./testing-shared.mjs";
import { etherealWallsOf, etherealWallBetween } from "../adapter/plane.mjs";
import { requestGroupRoll, groupRollView, rollsApi } from "./group-roll.mjs";
import { useDespiteAntimagic } from "./antimagic.mjs";

/**
 * §43.2: the effects an action ends — the token's own (`own`), those another removes from it (`byOther`); and the
 * gesture: without `targetId`, the token takes "Escape" for itself; with it, it ends the target's first effect.
 */
export function endings({ tokenId }) {
  const token = viewedToken({ tokenId });
  const tell = e => ({ effect: e.effect.id, name: e.effect.name, item: e.item.name, by: e.rule.by, roll: e.rule.roll ?? null, dc: e.check?.dc ?? null });
  return { own: ownEndingsOf(token.actor).map(tell), byOther: endingsOn(token).map(tell) };
}

/** K4 (§325): the grapples a token suffers — escape DC, reach of the hold, hold held. */
export function grappleState({ tokenId }) {
  const token = viewedToken({ tokenId });
  const factors = readUnitFactors();
  return grappleEffectsOf(token.actor).map(e => {
    const f = grappleFacts(e, token, factors);
    return { effect: e.id, name: e.name, escapeDc: escapeDcOf(e), reach: f?.reach ?? null, withinReach: f?.withinReach ?? null, distance: f?.distance ?? null };
  });
}

/**
 * §43.2: without `targetId`, the token `tokenId` escapes its grapple; with it, it ends the target's first effect that its action
 * ends → `{ done }`.
 */
export async function actionEnd({ tokenId, targetId=null }) {
  const token = viewedToken({ tokenId });
  if ( !targetId ) { await escapeGrapple(token); return { done: true }; }
  const target = viewedToken({ tokenId: targetId });
  const ending = endingsOn(target)[0];
  return { done: ending ? await endFor(token, target, ending) : false };
}

/**
 * §62: what the client sees on screen through a token's eyes — the GM takes control of it (their vision becomes that of this
 * token), we read `isVisible` and each target's detection filter (the outline of hearing, or of a special mode), then the
 * previous control is restored.
 */
export async function perceived({ observerId, targetIds=[] }) {
  gmOnly();
  const observer = canvas.tokens.get(observerId);
  if ( !observer ) throw new Error(`token ${observerId} missing from the viewed scene`);
  const before = canvas.tokens.controlled.map(t => t.id);
  observer.control({ releaseOthers: true });
  canvas.perception.update({ initializeVision: true });
  await sleep(400);
  const out = {};
  for ( const id of targetIds ) {
    const token = canvas.tokens.get(id);
    if ( !token ) continue;
    const visible = token.isVisible;
    const color = token.detectionFilter?.uniforms?.outlineColor;
    out[id] = { name: token.name, visible, filter: visible && token.detectionFilter ? (color ? Array.from(color).map(c => Math.round(c * 100) / 100) : "autre") : null };
  }
  observer.release();
  for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  canvas.perception.update({ initializeVision: true });
  return out;
}

/** §172: the target's Cover against the attacker, as the verdict will compute it (`coverFor`), or null. */
export function cover({ attackerId, targetId, itemId=null, effective=false }) {
  const attacker = canvas.scene?.tokens.get(attackerId);
  const target = canvas.scene?.tokens.get(targetId);
  if ( !attacker || !target ) throw new Error("token not found on the viewed scene");
  // §173: with an item's attack (a ranged weapon in front of Wind Wall).
  const activity = itemId ? attacker.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack") ?? null : null;
  // §353: `effective` — the Cover left to the attack, once what the attacker ignores is removed (shooting feats, Favored Enemy).
  if ( effective && activity ) return coverAgainst(attacker, target, activity, null, { quiet: true });
  return coverFor(attacker, target, { quiet: true, activity });
}

/** #33: the Cover preview (`api.ui.cover`) of the target against an attacker's item attack, on this client (the GM: everything). */
export function coverPreview({ attackerId, targetId, itemId }) {
  const attacker = canvas.scene?.tokens.get(attackerId);
  const target = canvas.scene?.tokens.get(targetId);
  if ( !attacker || !target ) throw new Error("token not found on the viewed scene");
  const activity = attacker.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack") ?? null;
  if ( !activity ) throw new Error("attack activity not found");
  return coverPreviewOf(attacker, target, activity);
}

/**
 * A token's computed values (data prepared by dnd5e, which the connector does not return: it reads the source): AC,
 * speeds, HP, attack and save bonuses — to check a passive effect without going through an attack.
 */
export function stats({ tokenId }) {
  const tok = viewedToken({ tokenId });
  const actor = tok.actor;
  const a = actor?.system?.attributes ?? {};
  // dnd5e 6 stores roll bonuses under `system.rolls` (`system.bonuses` keeps only the spell DC) and translates the
  // old effect keys there (`system.bonuses.mwak.attack` → `system.rolls.attack.mwak.bonus`), seen in play on 2026-09-27.
  const rolls = actor?.system?.rolls ?? {};
  const attack = kind => rolls.attack?.[kind]?.bonus ?? "";
  return {
    ac: a.ac?.value ?? null, exhaustion: Number(a.exhaustion) || 0, hp: { value: a.hp?.value ?? null, max: a.hp?.max ?? null, tempmax: a.hp?.tempmax ?? 0 },
    speed: Object.fromEntries(Object.entries(a.movement ?? {}).filter(([, v]) => typeof v === "number")),
    // dnd5e 6 stores prepared speeds under `movement.speeds` (§295: Gaseous Form).
    speeds: { ...(a.movement?.speeds ?? {}) },
    bonuses: { mwak: attack("mwak"), rwak: attack("rwak"), msak: attack("msak"), rsak: attack("rsak"),
      save: rolls.ability?.save?.bonus ?? "" },
    size: actor?.system?.traits?.size ?? null,
    // §438: prepared Resistances (including dnd5e 6.1 conditional effects: "Stellar Fullness" from Player's Handbook 3.0.0).
    resistances: Array.from(actor?.system?.traits?.dr?.value ?? []),
    prof: a.prof ?? null,
    mods: Object.fromEntries(Object.entries(actor?.system?.abilities ?? {}).map(([k, v]) => [k, v.mod ?? null])),
    statuses: Array.from(actor?.statuses ?? []),
    // §494 (B14): the Concentration limit (prepared: held effect included) and the held spells.
    concentration: { limit: a.concentration?.limit ?? null, held: Array.from(actor?.concentration?.effects ?? []).map(e => e.id) },
    // K6 (§327): lost Reactions, action OR Bonus Action (effects `noReactions`, `actionOrBonus`).
    reactionBlocked: reactionsBlocked(actor), actionOrBonus: actionOrBonusOnly(actor),
    // §501 (B21): can it react now (round budget, Incapacitated or an effect that forbids it, `reactions.loseOne`)?
    reaction: actor ? reactionState(actor) : null,
    // §52: the token's light as the core renders it (prepared data: including `token.light.*` effects).
    light: (() => { const l = (tok?.document ?? tok)?.light ?? {}; return { bright: l.bright ?? 0, dim: l.dim ?? 0, angle: l.angle ?? 360,
      animation: l.animation?.type ?? null }; })()
  };
}

/** The save failure chance the badge would show (§15.3), to compare with the real roll. */
export function saveChance({ casterId, targetId, itemId, activityId=null }) {
  const caster = viewedToken({ tokenId: casterId });
  const target = viewedToken({ tokenId: targetId });
  const item = caster.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "save");
  const info = saveChanceOf(caster, target, activity);
  return info ? { ...info, dice: info.dice.map(d => ({ ...d })) } : null;
}

/**
 * The Advantage and Disadvantage reasons the engine would give this attack (core/conditions.mjs), and the hostile creatures
 * in contact with the attacker — to understand an unexpected "normal" roll.
 */
export function attackReasons({ attackerId, targetId, itemId, attackMode=null }) {
  const origin = viewedToken({ tokenId: attackerId });
  const target = viewedToken({ tokenId: targetId });
  const activity = origin.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack");
  if ( !activity ) throw new Error("no attack on this item");
  const factors = readUnitFactors();
  const { advantage, disadvantage } = attackModifiers(attackContext(origin, target, activity, attackMode, factors));
  const adjacentHostiles = origin.parent.tokens.filter(t => (t !== origin) && t.actor && !t.hidden
    && areEnemies(origin, t) && areAdjacent(origin, t, factors)).map(t => t.name);
  return { advantage: advantage.map(r => `${r.who}.${r.key}`), disadvantage: disadvantage.map(r => `${r.who}.${r.key}`), adjacentHostiles };
}

/**
 * §27: sets (or removes, `entry: null`) the entry of an identifier in the world overlay, and returns the one that was there —
 * so that a scenario restores it (Potent Spellcasting instead of Divine Strike).
 */
export async function overrideContent({ identifier, entry=null }) {
  gmOnly();
  const before = worldOverrides()[identifier] ?? null;
  await setWorldOverride(identifier, entry);
  return { before };
}

/**
 * §29: applies an activity's enchantment (its first profile, or `profile`) to an actor's item — what dnd5e does by a
 * drag-and-drop onto the card (Repelling Blast on Eldritch Blast). Returns the id of the placed effect.
 */
export async function enchant({ tokenId, itemId, activityId, targetItemId, profile=null }) {
  const actor = viewedToken({ tokenId }).actor;
  const activity = actor?.items.get(itemId)?.system.activities?.get(activityId);
  const target = actor?.items.get(targetItemId);
  if ( !activity || !target ) throw new Error("activity or item not found");
  const profileId = profile ?? activity.effects?.[0]?._id;
  // O9h (§363): a self-enchantment is placed without the restrictions, as dnd5e does
  // (activity/enchant.mjs, `_triggerSubsequentActions`).
  let effect = await activity.applyEnchantment(profileId, target, { strict: !(activity.enchant?.self && (target === activity.item)) });
  // §435: an item that enchants itself (Dagger of Venom, "Savage Wrath") — dnd5e creates nothing, the engine activates the
  // profile in place (runtime/enchant.mjs) after the hook: wait for it, and return that profile; its riders are already placed.
  if ( !effect ) {
    const switched = await selfSwitchOf(target);
    if ( switched ) return { effectId: switched.id, riders: 0, self: true };
  }
  // O8e (§348): without a chat card, dnd5e does not create the "riders" (activities and effects added by the enchantment:
  // "Swear Oath" of the Oathbow); they are requested here as the card would (`collectRiders`, enchantmentProfile + activityId).
  const riders = effect ? (await effect.system?.collectRiders?.({ dnd5e: { enchantmentProfile: profileId, activityId } }) ?? []) : [];
  if ( riders.length ) await foundry.documents.modifyBatch(riders);
  return { effectId: effect?.id ?? null, riders: riders.length };
}

/** §23: heals a token as a spell would (`applyDamage` of type "healing"); returns its HP before and after. */
export async function heal({ tokenId, amount }) {
  const actor = viewedToken({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  await actor.applyDamage([{ value: amount, type: "healing" }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23: damage to a token, through `applyDamage` (Resistances included); returns its HP before and after. */
export async function hurt({ tokenId, amount, type="bludgeoning", properties=[] }) {
  const actor = viewedToken({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  // `properties`: those of the roll ("sil": silvered weapon, §78).
  await actor.applyDamage([{ value: amount, type, properties: new Set(properties) }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23: a token's saving throw, without a window; returns its formula and its total. */
export async function rollSave({ tokenId, ability }) {
  const rolls = await viewedToken({ tokenId }).actor.rollSavingThrow({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §93: what a natural 1 triggers on the creature (the roll itself is not forced) — not awaited: the scenario answers. */
export function naturalOne({ tokenId }) {
  naturalOneFor(viewedToken({ tokenId }).actor, "test").catch(err => console.error(err));
  return { started: true };
}

/** §90: a skill check (`skill`) or ability check (`ability`), without a window; what follows the roll (added die) is not awaited. */
export async function rollCheck({ tokenId, skill=null, ability=null }) {
  const actor = viewedToken({ tokenId }).actor;
  const rolls = skill ? await actor.rollSkill({ skill }, { configure: false }) : await actor.rollAbilityCheck({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §113: the aids that the skill or tool check window would offer this token. */
export function skillAids({ tokenId, skill=null, tool=null }) {
  return aidsFor(viewedToken({ tokenId }).actor, { skill, tool }).map(a => ({ kind: a.kind, helper: a.helper.name, token: a.token.id, self: a.self }));
}

/** §113: the aid requested as the window button would; returns whether it is given and whether Help is placed (awaited 10 s). */
export async function skillAid({ tokenId, helperTokenId, kind, skill=null, tool=null }) {
  const tester = viewedToken({ tokenId });
  const helper = viewedToken({ tokenId: helperTokenId }).actor;
  const granted = await requestSkillAid({ kind, helper, tester, skill, tool });
  let guided = skill ? isGuided(tester.actor, skill) : false;
  for ( let waited = 0; granted && (kind === "guidance") && !guided && (waited < 10000); waited += 250 ) {
    await sleep(250);
    guided = isGuided(tester.actor, skill);
  }
  return { granted, guided };
}

/**
 * What is wrong with a use (turn legality, conditions), without using it; `cost` forces the cost ("bonus", "reaction").
 * `attackMode`: dnd5e's attack mode, as chosen by the click (§532: `offhand`, the Light extra attack).
 */
export function issues({ tokenId, itemId, activityType=null, activityId=null, cost=null, attackMode=null }) {
  const item = viewedToken({ tokenId }).actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId)
    : item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  const use = useIssues(activity, { cost, attackMode });
  // K5 (§326): the issues of a legendary action (its turn, no more actions, one per turn).
  return [...use.lines, ...legendaryIssues(activity, use.combatant, use.own)];
}

/** §236: the range the engine applies to an activity (content rules included: Spell Sniper, Improved Elemental Fury). */
export function range({ tokenId, itemId, activityType=null }) {
  const activity = viewedToken({ tokenId }).actor?.items.get(itemId)?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  return rangeOf(activity);
}

/** O8h (§351): the range issues (out of range, long range, too close) of an activity against these targets, designated here. */
export function rangeCheck({ tokenId, itemId, targetIds=[], activityType=null }) {
  const activity = viewedToken({ tokenId }).actor?.items.get(itemId)?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  targetIds.forEach((id, i) => canvas.tokens.get(id)?.setTarget(true, { releaseOthers: i === 0 }));
  const { problems } = rangeProblems(activity);
  for ( const id of targetIds ) canvas.tokens.get(id)?.setTarget(false, { releaseOthers: false });
  return problems;
}

/** Issue #31: what the Combat UI would read for the potion `itemId` of the token (`api.ui.potion`), or null. */
export function potionOptionsOf({ tokenId, itemId }) {
  const token = viewedToken({ tokenId });
  const item = token.actor?.items.get(itemId);
  return potionOptions(potionChoiceActivity(item));
}

/** §20: a combatant's turn budget (action, Bonus Action, Dash, Disengage, Speed at 0, extra movement). */
export function budget({ tokenId }) {
  const token = viewedToken({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  return combatant ? { ...readBudget(combatant), combatantId: combatant.id, cap: finite(movementCap(token)) } : null;
}

/**
 * §492: the "who attacked whom this turn" registry of the current combat, and, between two tokens, the kinds of attack from
 * `sourceId` against `targetId` during this turn.
 */
export function attacksThisTurn({ sourceId=null, targetId=null }={}) {
  const source = sourceId ? viewedToken({ tokenId: sourceId }).actor : null;
  const target = targetId ? viewedToken({ tokenId: targetId }).actor : null;
  return { turn: currentTurnKey(), log: attacksLog(), kinds: (source && target) ? attackedDuring(source, target) : null };
}

/**
 * §19.9: under which identifier the engine recognizes each item of a token, where it gets it from (item, source, compendium,
 * name) and the content keys attached to it — for premium items without an identifier (Ravenloft), translated by Babele.
 */
export function identify({ tokenId }) {
  const actor = viewedToken({ tokenId }).actor;
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    return { item: item.name, id: item.id, identifier: id, from, rules: Object.keys(contentOf(item).entry ?? {}), triggers: contentOf(item).entry?.triggers ?? null };
  }).filter(r => r.rules.length || (r.from !== "item"));
}

/**
 * §335: the source data of a token's item, at the requested paths (`effect:<id>:<chemin>` for an effect of the item) — what a
 * premium data fix wrote.
 */
export function itemData({ tokenId, itemId, paths=[] }) {
  const item = viewedToken({ tokenId }).actor?.items.get(itemId);
  if ( !item ) throw new Error(`item ${itemId} not found`);
  const source = item.toObject();
  const read = path => {
    const m = path.match(/^effect:([^:]+):(.*)$/);
    if ( !m ) return foundry.utils.getProperty(source, path);
    const effect = source.effects.find(e => e._id === m[1]);
    return effect ? foundry.utils.getProperty(effect, m[2]) : undefined;
  };
  return Object.fromEntries(paths.map(p => [p, read(p) ?? null]));
}

/**
 * §36: the noted rolls of a token's Portent — `roll: true` rolls them as at a Long Rest; `rolls: [n…]` sets them (scenario: known
 * values); `clear: true` clears them. Returns the diviner's d20 count and its state.
 */
export async function portent({ tokenId, roll=false, rolls=null, clear=false }) {
  const actor = viewedToken({ tokenId }).actor;
  if ( !actor ) throw new Error("token without an actor");
  if ( clear ) await actor.unsetFlag(MODULE_ID, "portent");
  else if ( Array.isArray(rolls) ) await actor.setFlag(MODULE_ID, "portent", { rolls, turn: null });
  else if ( roll ) await rollPortent(actor);
  return { dice: portentDice(actor), ...portentOf(actor) };
}

/**
 * GM: uses the token's item `itemId` like a click on the dnd5e sheet (`item.use({ event })`, without the engine or the forced
 * activity window), the GM having designated `targetIds`; does not wait for the rest → `{ started }`.
 * §436: inside an antimagic field, dnd5e finds no permitted activity there.
 */
export function sheetUse({ tokenId, itemId, targetIds=null }) {
  gmOnly();
  const item = canvas.scene?.tokens.get(tokenId)?.actor?.items.get(itemId);
  if ( !item ) throw new Error("item not found");
  if ( Array.isArray(targetIds) ) {   // the GM's designated targets, as at the table before the click
    for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
    for ( const id of targetIds ) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
  }
  item.use({ event: null }).catch(err => console.error(`${MODULE_ID} | sheetUse`, err));
  return { started: true };
}

/**
 * An activity used as on click (§47): including dnd5e's area placement — unlike the connector's `use-activity`,
 * which cuts it (`create.measuredTemplate: false`). Without a slot; the dnd5e window, if it opens, is captured then confirmed;
 * GM reactions refused. Returns the use card and the regions created by this activity within 3 s (an interactive placement
 * would wait for a click: nothing).
 */
export async function use({ tokenId, itemId, activityType=null, activityId=null, extra=null, consume=false }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  // §438: `activityId` — a named activity (Spirit Guardians from Player's Handbook 3.0.0: the area is placed by "Cast Spell").
  const activity = activityId ? item?.system.activities.get(activityId)
    : item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  const before = new Set(canvas.scene.regions.map(r => r.id));
  const mine = () => canvas.scene.regions.filter(r => !before.has(r.id) && (r.getFlag("dnd5e", "activity") === activity.uuid));
  // The dnd5e use window, if it opens, is captured (with or without the "Place template" checkbox) then confirmed.
  let dialog = null;
  const hook = Hooks.on("renderActivityUsageDialog", (app, element) => {
    dialog = { templateBox: !!element.querySelector('[name="create.measuredTemplate"]') };
    setTimeout(() => element.querySelector('button[type="submit"], [data-action="use"]')?.click(), 100);
  });
  let used;
  // `consume`: like a real click, resources spent (§77: without a charge, the GM's "No charge left" window).
  // §436: like an engine click — under the `antimagic` status, its forceable window before dnd5e's flat refusal.
  try { used = await useDespiteAntimagic(activity, more => activity.use({ ...(consume ? {} : { consume: false }),
    [MODULE_ID]: { confirmed: true, autoReact: "none", ...(extra ?? {}), ...more } }, { configure: true })); }
  finally { Hooks.off("renderActivityUsageDialog", hook); }
  for ( let i = 0; (i < 30) && !mine().length; i++ ) await sleep(100);
  return {
    messageId: used?.message?.id ?? null,
    dialog,
    regions: mine().map(r => ({ id: r.id, shapes: r.shapes.map(s => s.type), attachedTo: r.attachment?.token?.id ?? r.attachment?.token ?? null,
      elevation: { bottom: r.elevation.bottom, top: r.elevation.top } }))
  };
}

/** §53: for each effect of a token, the origin item the engine finds (destroyed item: reread from the message). */
export function effectOrigins({ tokenId }) {
  const actor = viewedToken({ tokenId }).actor;
  return (actor?.effects ?? []).map(e => {
    const item = originItemOf(e);
    return { id: e.id, effect: e.name, origin: e.origin ?? null, systemOrigin: e.system?.origin ?? null, item: item?.name ?? null,
      identifier: item ? identifierOf(item).id : null, statuses: Array.from(e.statuses ?? []), disabled: !!e.disabled,
      // §436: suspended (dnd5e 6.1 antimagic: `system.magical` under the `antimagic` status), marked magical.
      suppressed: !!e.isSuppressed, magical: !!e.system?.magical };
  });
}

/**
 * §181: the factions, for a scenario. `op`: `state` (setting, grudges, factions of the given tokens), `snapshot` / `restore`
 * (the whole setting, `value`), `add` ({ name } → id), `relation` ({ a, b } faction ids, `relation` or null), `assign`
 * ({ tokenIds, faction|null, actor }), `between` ({ aId, bId } tokens → relation), `grudges` ({ clear }), `stance`,
 * `window` (#275: the Factions window opened through the public API, its edit table unfolded and scrolled to the bottom → its
 * size against the viewport and whether the Save button can be reached; closed again unless `keepOpen`).
 */
export async function factions({ op="state", tokenIds=[], faction=null, actor=false, a, b, relation=null, aId, bId, name, value, clear=false, stance=null, keepOpen=false }={}) {
  const scene = canvas.scene;
  const tokens = tokenIds.map(id => viewedToken({ tokenId: id }));
  switch ( op ) {
    case "snapshot": return { value: foundry.utils.deepClone(game.settings.get(MODULE_ID, "factions")), grudges: scene.getFlag(MODULE_ID, "grudges") ?? [] };
    case "restore":
      await game.settings.set(MODULE_ID, "factions", value);
      if ( clear ) await scene.unsetFlag(MODULE_ID, "grudges");
      return { restored: true };
    case "add": return { id: await factionsApi.add({ name }) };
    case "relation": await factionsApi.setRelation(a, b, relation); return { relations: factionsApi.relations() };
    case "assign": await factionsApi.assign(tokens.map(t => (actor ? t.baseActor : t)), faction); return { factions: tokens.map(t => factionsApi.of(t)) };
    case "between": return { relation: factionsApi.relation(viewedToken({ tokenId: aId }), viewedToken({ tokenId: bId })) };
    case "grudges": if ( clear ) await factionsApi.grudge(null, null, { clear: true, scene }); return { grudges: factionsApi.grudges(scene) };
    case "stance": for ( const t of tokens ) await factionsApi.stance(t, stance); return { stances: tokens.map(t => t.getFlag(MODULE_ID, "stance") ?? null) };
    case "window": return factionsWindow({ keepOpen });
    default: return {
      relations: factionsApi.relations(), grudges: factionsApi.grudges(scene),
      tokens: tokens.map(t => ({ name: t.name, faction: factionsApi.of(t), disposition: t.disposition }))
    };
  }
}

/** #275: the Factions window's layout — see `factions({ op: "window" })`. */
async function factionsWindow({ keepOpen=false }={}) {
  gmOnly();
  const app = await game.modules.get(MODULE_ID).api.factions.open();
  try {
    await sleep(300);
    const root = app.element;
    const details = root.querySelector(".das-factions__edit");
    if ( details ) details.open = true;
    await sleep(200);
    const content = root.querySelector(".window-content");
    const header = root.querySelector(".window-header");
    const save = root.querySelector("[data-action=save]");
    const box = el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
    const before = { scrollHeight: content.scrollHeight, clientHeight: content.clientHeight };
    content.scrollTop = content.scrollHeight;
    await sleep(150);
    const contentBox = box(content);
    const saveBox = box(save);
    return {
      viewport: window.innerHeight, window: box(root), header: box(header), content: contentBox, save: saveBox, ...before,
      overflowY: getComputedStyle(content).overflowY, scrollTop: Math.round(content.scrollTop),
      rows: root.querySelectorAll("tr.das-faction-row").length, editRows: root.querySelectorAll("tr[data-edit]").length,
      saveReachable: (saveBox.height > 0) && (saveBox.top >= contentBox.top - 1) && (saveBox.bottom <= contentBox.bottom + 1)
    };
  } finally { if ( !keepOpen ) await app.close(); }
}

/** §182: does the observer see the target (engine vision), and its Cone. */
export function sees({ observerId, targetId }) {
  const observer = viewedToken({ tokenId: observerId });
  const target = viewedToken({ tokenId: targetId });
  return { sees: canSeeToken(observer, target), cone: coneOf(observer), sighting: sightingOf(observer, target) };
}

/**
 * §211: Ready, for a scenario — without `name`, what the token can prepare and its plan; with it, the stored plan
 * (the option whose name contains `name`, the trigger, the creature `targetId`, the lowest slot for a spell), without the window.
 */
export async function ready({ tokenId, name=null, trigger="enters", targetId=null }={}) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const actor = token.actor;
  const options = readyOptionsOf(actor);
  const state = () => {
    const combatant = combatantFor(actor);
    const held = heldEffectOf(actor);
    return { options: options.map(o => ({ name: o.name, spell: o.spell, level: o.level, reach: o.reach })),
      plan: combatant ? (readBudget(combatant).readied ?? null) : null, held: held ? { id: held.id, name: held.name } : null,
      slots: Object.fromEntries(Object.entries(actor.system.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0])) };
  };
  if ( !name ) return state();
  const option = options.find(o => o.name.toLowerCase().includes(String(name).toLowerCase()));
  if ( !option ) throw new Error(`nothing to ready named "${name}"`);
  const slot = (option.spell && (option.level > 0)) ? (slotsFor(actor, option.level)[0]?.key ?? null) : null;
  const target = targetId ? token.parent.tokens.get(targetId)?.uuid ?? null : null;
  const plan = await setReadyPlan(actor, { option, trigger, target, slot });
  return { set: !!plan, ...state() };
}

/** §212: On Fire, for a scenario — the state, and `extinguish`: put out its flames like the menu entry. */
export async function burning({ tokenId, extinguish: put=false }={}) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const out = { burning: isBurning(token.actor) };
  if ( put ) out.extinguished = await extinguish(token);
  return { ...out, after: isBurning(token.actor), statuses: Array.from(token.actor?.statuses ?? []) };
}

/** §184: BG3 Stealth, for a scenario. `op`: `state` | `set` ({ on }) | `check` | `forget`. */
export async function stealth({ op="state", tokenId, on=true }={}) {
  const token = viewedToken({ tokenId });
  if ( op === "set" ) await setHidden(token, on);
  if ( op === "check" ) await stealthCheck(token.parent);
  // O9g (§361): the passive Perception of each enemy against this token (Cloak of Elvenkind: −5).
  if ( op === "observers" ) return passiveObservers(token.document ?? token).map(o => ({ name: o.token.name, passive: o.passive }));
  const point = lightAtPoint(stealthPoint(token));
  // By name; two observers with the same name (two Bandits) are told apart by their id, otherwise one would hide the other.
  const names = token.parent.tokens.contents.map(t => t.name);
  const label = id => {
    const name = token.parent.tokens.get(id)?.name;
    if ( !name ) return id;
    return (names.filter(n => n === name).length > 1) ? `${name}#${id}` : name;
  };
  return { hidden: isHidden(token), sneaking: isHidden(token), spottedBy: spottedBy(token).map(label),
    views: Object.fromEntries(Object.entries(stealthViews(token.id)).map(([id, v]) => [label(id), v])),
    light: point?.level ?? null };
}

/**
 * §187: the scattered objects of the scene (caltrops, ball bearings) and those this token can pick up; `pickUp`: picks up
 * the first, like the "Pick up" menu entry.
 */
export async function scatter({ tokenId, pickUp: take=false }) {
  const token = viewedToken({ tokenId });
  const tell = r => ({ id: r.id, item: readAreaState(r).scatter.item?.name ?? null, tile: readAreaState(r).scatter.tile ?? null });
  const near = pickableNear(token);
  const out = { zones: scatterZones(token.parent).map(tell), near: near.map(tell) };
  if ( take && near.length ) out.picked = await pickUp(token, near[0]);
  return out;
}

/**
 * §188: the flammable areas of the scene (on fire or not) and those this token can light; `ignite`: sets fire to the first it
 * can light (or `regionId`), like the "Light" menu entry.
 */
export async function flammable({ tokenId, ignite: light=false, regionId=null, fireAt=null }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const tell = r => ({ id: r.id, burning: readAreaState(r)?.burning ?? null, on: readAreaState(r)?.on ?? [] });
  const zones = lastingRegions(token.parent).filter(r => readAreaState(r)?.flammable || readAreaState(r)?.burning
    || unlitZones(token.parent).includes(r));
  const near = ignitableNear(token);
  const out = { zones: zones.map(tell), near: near.map(tell) };
  const target = regionId ? token.parent.regions.get(regionId) : near[0];
  if ( light && target ) out.lit = await ignite(target, "test");
  // §189: aim at this point with a fire activity, like a click on the ground while aiming (`{ itemId, activityId?, x, y }`).
  if ( fireAt ) {
    const item = token.actor.items.get(fireAt.itemId);
    const activity = fireAt.activityId ? item?.system.activities.get(fireAt.activityId) : item?.system.activities.find(a => a.type === "attack");
    const aim = activity ? fireTargetAt(token, activity, { x: fireAt.x, y: fireAt.y }) : null;
    out.aim = aim ? { zone: aim.zone.id, refused: aim.refused ?? null } : null;
    if ( aim && !aim.refused ) out.fired = await igniteWithActivity(token, activity, [{}, {}, {}], aim.zone);
  }
  return out;
}

/**
 * §222: an actor's chosen masteries — sources, slots, recorded choice, what the Long Rest lets change, and the rule's verdict
 * for `keys` if given.
 */
export async function masteries({ actorId, keys=null }) {
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`no actor ${actorId}`);
  await baseWeapons();
  const sources = masterySourcesOf(actor);
  return { sources, slots: masterySlots(sources), chosen: chosenMasteries(actor), allowance: restAllowanceOf(actor),
    verdict: keys ? judgeMasteries(actor, keys) : null };
}

/**
 * §510: the actor's masteries window, opened on this client (GM) by the public API (`api.mastery.open`), the current choice
 * replaced by `keys` if given (nothing is recorded) → `{ rest }`: the text of the Long Rest green line, or null. Closed again.
 */
export async function masteryWindow({ actorId, keys=null }) {
  gmOnly();
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`no actor ${actorId}`);
  const app = await game.modules.get(MODULE_ID).api.mastery.open(actor);
  try {
    if ( keys ) { app.selection = new Set(keys); await app.render(); }
    await sleep(300);
    return { rest: app.element?.querySelector(".das-mastery__rest")?.textContent?.trim() ?? null };
  } finally { await app.close(); }
}

/** §225, batch 3: walls that stop ethereal travel, seen from the token, and if a step from its center to `point` crosses one. */
export function etherealWalls({ tokenId, point }) {
  const token = viewedToken({ tokenId });
  const scene = token.parent;
  const marked = scene.walls.filter(w => w.flags?.[MODULE_ID]?.ethereal === true);
  return { marked: marked.map(w => ({ id: w.id, c: w.c, levels: Array.from(w.levels ?? []) })), level: token._source.level,
    walls: etherealWallsOf(scene, token._source.level).length, crosses: etherealWallBetween(scene, token.object.center, point, token._source.level) };
}


/** §242: the status of a request, in JSON (without documents). */
function plainRoll(view) {
  if ( !view ) return null;
  return { id: view.id, request: view.request, done: view.done, success: view.success, successes: view.successes, cancelled: !!view.cancelled,
    entries: view.entries.map(e => ({ name: e.name, total: e.total, d20: e.d20, status: e.status, success: e.success, user: e.user, atCost: e.atCost ?? null })) };
}

/**
 * §242: a roll request to the given tokens, like the "Request" button; `wait: false` returns the card right away (the players
 * can take their time), otherwise the final status.
 */
export async function groupRoll({ tokenIds=[], wait=true, ...request }) {
  const actors = tokenIds.map(tokenId => viewedToken({ tokenId }).actor).filter(Boolean);
  const before = new Set(game.messages.keys());
  const done = requestGroupRoll({ actors, ...request });
  if ( wait ) return plainRoll(await done);
  for ( let waited = 0; waited < 5000; waited += 100 ) {
    const card = game.messages.find(m => !before.has(m.id) && (m.type === "request"));
    if ( card ) return plainRoll(groupRollView(card.id));
    await sleep(100);
  }
  return null;
}

/** §242: the status of a request card, and a token's bonus tiles for a request. */
export function groupRollState({ id }) {
  return plainRoll(groupRollView(id));
}
/** §242: the bonus tiles of the actor of token `tokenId` for the given request (like `api.rolls.breakdown`). */
export function groupRollBreakdown({ tokenId, ...request }) {
  return rollsApi.breakdown(viewedToken({ tokenId }).actor, request);
}
/** §242: "Roll for them" on a card row (refused if it already has a roll), and the system's mode for a request. */
export async function groupRollForce({ id, tokenId }) {
  return rollsApi.force(id, viewedToken({ tokenId }).actor.uuid);
}
/** §242: the Advantage / Disadvantage dnd5e will give the actor of token `tokenId` for the request (like `api.rolls.mode`). */
export function groupRollMode({ tokenId, ...request }) {
  return rollsApi.mode(viewedToken({ tokenId }).actor, request);
}

/**
 * §285: places on a token the effect `effectId` of item `itemId` of caster `casterId`, with its id (like dnd5e's application) and
 * the item as origin — what the failed save would have placed, without the luck of the roll. Returns the id.
 */
export async function placeItemEffect({ tokenId, casterId, itemId, effectId, uuid=null }) {
  gmOnly();
  const item = viewedToken({ tokenId: casterId }).actor?.items.get(itemId);
  // §438: an effect from the effects compendium (Player's Handbook 3.0.0: Circle of Power, placed by a dnd5e area behavior),
  // copied with the item as origin (adapter/effects.mjs, `placeRemoteEffect`).
  if ( uuid ) {
    if ( !item ) throw new Error("item not found");
    const created = await placeRemoteEffect(item, uuid, viewedToken({ tokenId }).actor);
    if ( !created ) throw new Error("remote effect not found");
    return { effectId: created.id };
  }
  const source = item?.effects.get(effectId);
  if ( !source ) throw new Error("item effect not found");
  const actor = viewedToken({ tokenId }).actor;
  // §438: `system.origin.item` too (the Player's Handbook 3.0.0 effects carry the compendium item there), like adapter/effects.mjs.
  const data = foundry.utils.mergeObject(source.toObject(), { origin: item.uuid, transfer: false, disabled: false, system: { origin: { item: item.uuid } } });
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data], { keepId: true });
  return { effectId: created?.id ?? null };
}

/** §285: the caster concentrates on the item's first activity (dnd5e's Concentration effect), without casting anything. */
export async function concentrate({ tokenId, itemId }) {
  gmOnly();
  const actor = viewedToken({ tokenId }).actor;
  const activity = actor?.items.get(itemId)?.system.activities.contents[0];
  if ( !activity ) throw new Error("activity not found");
  const effect = await actor.beginConcentrating(activity);
  return { effectId: effect?.id ?? null };
}

/** §285: maintaining a spell (Crown of Madness) — the state, the menu entry offered, and `maintain`: the Magic action taken. */
export async function upkeep({ tokenId, maintain=false }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const doc = token.document ?? token;
  const list = upkeepsOf(doc.actor);
  const out = list.map(({ effect, item }) => ({ item: item.name, flag: effect.getFlag(MODULE_ID, "upkeep") ?? null, offered: canMaintain(doc, effect) }));
  if ( maintain && list[0] ) out[0].maintained = await maintainSpell(doc, list[0].effect, list[0].item);
  return out;
}

/** §285: standing up (`standUp`), for a scenario — returns whether it stood up and whether the menu entry is offered. */
export async function stand({ tokenId }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const doc = token.document ?? token;
  return { offered: canStandUp(doc), stood: await standUp(doc) };
}

/** §289: "Favor of Vigor" — the Constitution bonus granted now to a heal (0 if already taken since the start of its turn). */
export async function fortified({ tokenId }) {
  gmOnly();
  const actor = viewedToken({ tokenId }).actor;
  return { extra: await fortifiedExtra(actor), con: Number(actor.system.abilities?.con?.mod) || 0 };
}

/** §289: "Second Skin" — the GM declares the catalyst experienced (token menu). */
export async function catalyst({ tokenId }) {
  gmOnly();
  const actor = viewedToken({ tokenId }).actor;
  return (await armCatalyst(actor)) ?? null;
}
