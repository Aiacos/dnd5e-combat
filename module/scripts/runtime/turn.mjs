import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { checkUse, spendUse, refundUse, basicAction, BASIC_ACTION_FLAGS, effectiveCost, addDash } from "../core/turn.mjs";
import { rangeIssue, tooClose } from "../core/range.mjs";
import { throwableAttackMode, versatileGrip } from "../core/attack.mjs";
import {
  combatantFor, isOwnTurn, readBudget, writeBudget, requestFor, afterUseRestrictionOf, attacksPerAction, rangeOf, reachOf, canBeThrown,
  distanceBetween, usageTokenOf as usageToken, currentTurnKey, freshBudgetFor, movementOf } from "../adapter/turn.mjs";
import { usageLimitProblems, markUsedThisTurn, applyLowestSlot } from "../adapter/limits.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { promptWait, htmlText } from "../adapter/dialogs.mjs";
import { basicActionOf, basicActionOfActivity, basicChoiceOf, declaredBasicsOf } from "../adapter/basics.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { linkedBearers } from "../adapter/cast-from.mjs";
import { isRaging, rageOptionsTaken } from "../adapter/rage.mjs";
import { secondRageOption } from "../core/limits.mjs";
import { metamagicLimit, mayHold } from "../core/metamagic-rules.mjs";
import { metamagicKindOf, pendingMetamagic, metamagicRulesOf } from "../adapter/metamagic.mjs";
import { enemiesSeeing } from "../adapter/hide.mjs";
import { stealthRules } from "../adapter/stealth.mjs";
import { verbalBlockOf, charmersOf, hostileToCharmer, sightRequired } from "../adapter/conditions.mjs";
import { untrainedArmor } from "../adapter/armor-training.mjs";
import { reactionsBlocked, actionOrBonusOnly } from "../adapter/reactions.mjs";
import { conditionUseIssues } from "../core/conditions.mjs";
import { canSee, pinpointsTarget } from "../adapter/vision.mjs";
import { hiddenDcOf } from "../adapter/search.mjs";
import { locationUnknown } from "../core/hearing.mjs";
import { wrongTypeFor, typesLabel, missesTargetRequirement } from "../adapter/eligibility.mjs";
import { pilotOfActor, summonerCombatant, commandPlan, spellCommandOf, summonsOfWith } from "../adapter/pilot.mjs";
import { freesMovement } from "../adapter/opportunity.mjs";
import { takePendingAttack } from "./actions.mjs";
import { pilotUsage, refundCommand, spellCommandUsage } from "./pilot.mjs";
import { route } from "./router.mjs";
import { log, loc, sleep, viaActiveGM } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { forcedReasons as passedReasons, mergeIssues, askKey } from "../core/forced.mjs";
import { somaticBlockOf, registerSomaticHandsSetting } from "../adapter/hands.mjs";
import { missingResources } from "../adapter/resources.mjs";
import { reportForced, overriddenFlag, refusal } from "./forced.mjs";

/** §417: the reasons overridden — none when the "Impossible action" setting turns the check off (no alert, no marked card). */
const forcedReasons = choice => (refusal().report ? passedReasons(choice) : []);
import { antimagicAround, barrierBetween } from "../adapter/barriers.mjs";
import { magicalUse } from "../adapter/antimagic.mjs";
import { rangedBanAround, formLockAround } from "../adapter/areas.mjs";
import { formAttemptLock } from "../adapter/form-lock.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { selfTeleportOf, tooBrightFor } from "./teleport.mjs";
import { windowDisengaged } from "./reactions.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { chainOf, chainLimit, chainOutliers } from "../adapter/chain.mjs";
import { relaunchUse } from "./relaunch.mjs";
import { commandOutOfRange, controlledMountUncommanded } from "../adapter/mount.mjs";

/* -------------------------------------------- */
/*  Legality, on the client of whoever acts     */
/* -------------------------------------------- */

/** The designated targets that are not within normal range, for a given attack mode if known. */
export function rangeProblems(activity, attackMode=null) {
  const origin = usageToken(activity);
  if ( !origin || !canvas.ready ) return { key: "", problems: [] };
  const factors = readUnitFactors();
  const range = rangeOf(activity, attackMode);
  const problems = [];
  const ids = [];
  // §16.18: the cleric can cast spells from the cell of its illusion — a spell's range is
  // measured from the caster or from one of its `castFrom` summons, whichever is most favorable.
  const from = [origin];
  if ( activity.item?.type === "spell" ) from.push(...summonsOfWith(activity.actor, "castFrom").filter(t => t.parent === origin.parent));
  // Gaze of Two Minds: or from the linked creature's space (`castFromBearer`), within the stated distance.
  if ( activity.item?.type === "spell" ) from.push(...linkedBearers(activity.actor, origin, factors));
  const rank = issue => ({ longRange: 1, outOfRange: 2, tooClose: 3 })[issue] ?? 0;
  // O8h (§351): a minimum range (siege weapons) — too close also blocks.
  const min = contentOf(activity.item).entry?.minRange ?? null;
  const issueFrom = (o, target) => {
    const measured = distanceBetween(o, target);
    return (min && tooClose(measured, min, factors)) ? "tooClose" : (rangeIssue(measured, range, factors) ?? null);
  };
  for ( const target of game.user.targets ) {
    if ( target.document === origin ) continue;
    ids.push(target.id);
    const issue = from.map(o => issueFrom(o, target.document))
      .reduce((best, i) => (rank(i) < rank(best) ? i : best));
    if ( issue ) problems.push({ issue, name: target.name });
  }
  return { key: `${activity.uuid}|${attackMode ?? ""}|${ids.sort().join(",")}`, problems };
}

/**
 * Ranges already flagged, so the same question is not asked twice: range is checked
 * at use AND at the attack roll, because the target is often designated between the two.
 */
const acknowledgedRanges = new Map();
const ACK_LIFETIME = 60000;
const acknowledged = key => (Date.now() - (acknowledgedRanges.get(key) ?? 0)) < ACK_LIFETIME;
/** Notes the flagged range; flags older than a minute, which no longer serve, are forgotten along the way. */
function acknowledge(key) {
  const now = Date.now();
  for ( const [k, at] of acknowledgedRanges ) if ( (now - at) >= ACK_LIFETIME ) acknowledgedRanges.delete(k);
  acknowledgedRanges.set(key, now);
}

/**
 * §416: the range problems overridden at use, per activity and per targets, without the attack mode (unknown at that moment:
 * dnd5e sets it at the roll). The attack roll that follows does not ask again for the same targets and the same problem; a new
 * problem (another target, "too close" instead of "out of range") asks again.
 */
const forcedRanges = new Map();
const withoutMode = key => { const [uuid, , ids] = key.split("|"); return `${uuid}|${ids ?? ""}`; };
const blockingSignature = problems => problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue)).map(r => `${r.name}:${r.issue}`).sort().join(",");
function rememberForced(key, blocking) {
  const now = Date.now();
  for ( const [k, v] of forcedRanges ) if ( (now - v.at) >= ACK_LIFETIME ) forcedRanges.delete(k);
  if ( key ) forcedRanges.set(withoutMode(key), { at: now, signature: blockingSignature(blocking) });
}
function sameAsForced(key, problems) {
  const known = key ? forcedRanges.get(withoutMode(key)) : null;
  if ( !known || ((Date.now() - known.at) >= ACK_LIFETIME) ) return false;
  const signature = blockingSignature(problems);
  return !!signature && (signature === known.signature);
}

/** Splits range problems into blocking ones (out of range) and simple reminders (long range). */
function assessRange(activity, attackMode=null) {
  const { key, problems } = rangeProblems(activity, attackMode);
  if ( acknowledged(key) ) return { key, blocking: [] };
  // §416: the same range, already overridden at use — the attack mode, known only at the roll, changes the key, not the problem.
  if ( attackMode && sameAsForced(key, problems) ) return { key, blocking: [], forced: problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue)) };
  for ( const r of problems.filter(r => r.issue === "longRange") ) ui.notifications.info(loc("PorteeLongue", { name: r.name }));
  const blocking = problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue));
  if ( problems.length && !blocking.length ) acknowledge(key);   // reminder given once
  return { key, blocking };
}

const LEGALITY_CLASS = "dnd5e-combat-legality";

/** The legality window. §381: `actor` — the table sees that its decision is awaited (hourglass above its token). */
function confirmDialog(title, lines, buttons, actor=null) {
  // §417: the "Impossible action" setting. Simple warning or no check: the action goes ahead with its default button, without
  // a window. Strict refusal: a player reads the reasons and can only give up; the GM keeps the full window.
  const outcome = refusal();
  if ( !outcome.window ) {
    if ( outcome.warn ) {
      ui.notifications.warn(`${title} : ${htmlText(lines.join(" · "))}`);
    }
    const go = buttons.find(b => b.default && (b.action !== "cancel")) ?? buttons.find(b => b.action !== "cancel");
    return Promise.resolve(go?.action ?? "go");
  }
  if ( outcome.proceed === false ) {
    lines = [...lines, `<em>${loc("Refus.Strict")}</em>`];
    buttons = [{ action: "cancel", label: loc("Renoncer"), default: true }];
  }
  // §422: in turn — it goes after the question already open on this station instead of stacking on it,
  // without holding back the next ones; and tracked (adapter/dialogs.mjs, `promptWait`):
  // on a GM, its line in the Queue carries its buttons.
  return promptWait({ window: { title }, classes: [LEGALITY_CLASS], content: `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`, buttons },
    { awaiting: actor ? { actor, kind: "choice" } : null, aside: true });
}

/** §448: the "do it anyway" questions open on this station (`askKey`). */
const asking = new Set();

/**
 * Flexible mode (§6) for a gesture that is not a use (moving an area, §16.14): "do it anyway"? §408: forced, the GM and
 * the table are notified (`forced`: `{ actor, item, token }` of whoever acts).
 */
export async function askAnyway(title, lines, forced={}) {
  // §448: the same question already open on this station (double click on a refused cell) — the second is ignored,
  // without a window: otherwise two windows stack, and two "Use anyway" would make two uses.
  const key = askKey(title, lines);
  if ( asking.has(key) ) {
    log(`${title}: same question already open, ignored`);
    return false;
  }
  asking.add(key);
  let choice;
  try {
    choice = await confirmDialog(title, lines, [
      { action: "go", label: loc("UtiliserQuandMeme"), default: true },
      { action: "cancel", label: loc("Renoncer") }
    ], forced.actor ?? null);
  } finally {
    asking.delete(key);
  }
  if ( choice !== "go" ) return false;
  reportForced({ ...forced, reasons: forcedReasons({ lines, action: choice }) }).catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
  return true;
}

/**
 * Right click (§15.1): a use suspended by the legality check is abandoned, like
 * "Give up" — the dialog closes with no choice, `wait` returns null. true if a dialog was open.
 */
export async function closeLegalityDialogs() {
  const open = openLegalityDialogs();
  for ( const app of open ) await app.close();
  return open.length > 0;
}

/** The open legality dialogs. Synchronous: read at click. */
export function openLegalityDialogs() {
  return [...foundry.applications.instances.values()].filter(app => app.rendered && app.options?.classes?.includes(LEGALITY_CLASS));
}

/**
 * What is wrong with a use, before knowing who it targets: budget and turn, spell slot already cast this turn,
 * Silence, usage limits (§16.40), conditions that prevent acting (§17.3). What depends on the targets (range, type, charm,
 * vision, Stealth) is judged at click, in `onPreUseActivity`. `lines`: the reasons, translated; empty = nothing wrong.
 * @param {Activity} activity
 * @param {{cost?: string|null, attackMode?: string|null, recast?: boolean}} [options]
 */
export function useIssues(activity, { cost: forcedCost=null, attackMode=null, recast=false, usageConfig=null }={}) {
  // §16.15: a piloted object acts on its caster's turn, with its budget; the command opened this turn covers the gesture.
  const pilot = pilotOfActor(activity.actor);
  const combatant = pilot ? summonerCombatant(pilot) : combatantFor(activity.actor);
  const budget = combatant ? readBudget(combatant) : null;
  const own = combatant ? isOwnTurn(combatant) : true;
  let request = requestFor(activity, forcedCost, { attackMode });
  if ( pilot ) request = { ...request, cost: commandPlan(pilot, "use").pay, weaponAttack: false, usesSpellSlot: false, offhand: false };
  // §16.21: recast without a slot; §164: at the rule's cost (Swift Quiver: a Bonus Action).
  const recastCost = contentOf(activity.item).entry?.recastCost ?? null;
  if ( recast ) request = { ...request, usesSpellSlot: false, ...(recastCost ? { cost: recastCost } : {}) };
  request = monkRequest(activity, request, budget);
  // "Move Lights": the move command carried by the spell — free if already open this turn.
  const ordered = pilot ? null : spellCommandOf(activity);
  if ( ordered ) request = { ...request, cost: commandPlan(ordered, "move").pay, usesSpellSlot: false };
  const issues = combatant ? checkUse(budget, request, { isOwnTurn: own, turnKey: currentTurnKey() }) : [];
  // Silence: a spell with a verbal component is impossible (adapter/conditions.mjs, SPEC §16.6).
  const silenced = verbalBlockOf(activity);
  // §16.40: "once on each of your turns", "only with no use remaining" ("Wild Regrowth").
  const limits = usageLimitProblems(activity, { inCombat: !!combatant, ownTurn: own });
  // §17.3: Incapacitated (no action, no Bonus Action, no Reaction).
  const cost = (request.cost === "free") ? null : (budget ? effectiveCost(budget, request) : request.cost);
  // §409: a spell cast (not a moved area, nor the command of an already cast spell) or a long activity — even with no action cost.
  const casting = !recast && !ordered && isSpellCast(activity.item);
  const longActivation = ["minute", "hour", "day"].includes(activity.activation?.type);
  const incapacitated = pilot ? [] : conditionUseIssues({ statuses: Array.from(activity.actor?.statuses ?? []), cost,
    noReactions: reactionsBlocked(activity.actor), actionOrBonus: !!budget && actionOrBonusOnly(activity.actor), budget,
    castsSpell: casting, longActivation });
  // §410 (issue #44, batch 3): what is missing — slot, uses, quantity, preparation (force = do not spend it).
  const missing = (pilot || ordered) ? missingResources(null) : missingResources(activity, usageConfig, { recast });
  // What runtime/usage.mjs found missing (§77: the corrected slot, the uses re-read from the repaired copy of the item).
  const lacking = usageConfig?.[MODULE_ID]?.lacking ?? null;
  if ( lacking && !missing.keys.some(k => ["noSlot", "noUses", "noQuantity"].includes(k)) ) missing.keys.unshift(lacking);
  // §409 (issue #44) : composante somatique sans main libre.
  const handsFull = (casting && !pilot) ? somaticBlockOf(activity) : null;
  // §22: "while Raging, you can't cast spells".
  const raging = isSpellCast(activity.item) && isRaging(activity.actor);   // §48: reading a scroll too
  // §163, §436: Antimagic Field — no spell is cast in it; §436: nor a magic item activity (except a weapon attack:
  // dnd5e already removes its bonus). The `antimagic` status of dnd5e 6.1 first, the §163 globe otherwise.
  // Already forced before `use` (runtime/antimagic.mjs, `useDespiteAntimagic`): no second window.
  const antimagicArea = (!pilot && magicalUse(activity) && !usageConfig?.[MODULE_ID]?.antimagicForced) ? antimagicAround(usageToken(activity)) : null;
  const antimagic = (antimagicArea && (antimagicArea.status || isSpellCast(activity.item))) ? antimagicArea : null;
  // §269: Gaseous Form — "the target can neither attack nor cast spells" (the action that ends it remains allowed).
  const shapeless = ((activity.type === "attack") || isSpellCast(activity.item))
    ? (activity.actor?.effects ?? []).map(e => (!e.disabled && !e.isSuppressed) ? originItemOf(e) : null)
      .find(item => item && (item !== activity.item) && (contentOf(item).entry?.noAttacksOrSpells === true)) ?? null
    : null;
  // Dimensional shackles: the bearer of an effect of the item does not teleport (`noTeleport`) — the teleports that the
  // engine knows (dnd5e "teleport" activity, `teleport` of the content).
  const shackled = selfTeleportOf(activity)
    ? (activity.actor?.effects ?? []).map(e => (!e.disabled && !e.isSuppressed) ? originItemOf(e) : null)
      .find(item => item && (contentOf(item).entry?.noTeleport === true)) ?? null
    : null;
  // §284: "Alienation" — "cannot cast spells or take the Magic action" (spells, scrolls, magic items).
  const magicUse = isSpellCast(activity.item) || (activity.item?.system?.properties?.has?.("mgc") && (activity.activation?.type === "action"));
  const befuddled = magicUse
    ? (activity.actor?.effects ?? []).map(e => (!e.disabled && !e.isSuppressed) ? originItemOf(e) : null)
      .find(item => item && (item !== activity.item) && (contentOf(item).entry?.noSpells === true)) ?? null
    : null;
  // C12-c: a summon that does not act freely — the familiar does not attack (§107 removed only the basic attack); the Primal
  // Companion takes only the Dodge action, unless its master commands it (Bonus Action "Command") this round.
  const summonRule = summonRuleOf(activity.actor);
  const familiarAttack = !!summonRule?.familiar && (activity.type === "attack");
  const uncommanded = !!summonRule?.commanded && !!combatant && (activity.activation?.type === "action")
    && (basicActionOfActivity(activity) !== "dodge") && (activity.actor.getFlag(MODULE_ID, "commanded") !== (game.combat?.round ?? null));
  // §490 (B08): a controlled mount, mounted, takes only Dash / Disengage / Dodge without this round's order; an order
  // (`commands`) with no companion designated within range.
  const mountUncommanded = !summonRule?.commanded && controlledMountUncommanded(activity, !!combatant);
  const commandFar = commandOutOfRange(activity);
  // C12-b: "you can't enter a Rage if you are wearing heavy armor" (the end on donning: runtime/endings.mjs).
  const heavyRage = !!contentOf(activity.item).entry?.rage
    && (activity.actor?.items ?? []).some(i => (i.type === "equipment") && i.system?.equipped && (i.system?.type?.value === "heavy"));
  // §509 (Core#98): "Predator's Rage" — one option per Rage; a second during the same Rage is a problem
  // (forceable: the legality window).
  const optionRule = contentOf(activity.item).entry?.duringRage;
  const optionsTaken = optionRule?.oneOption ? rageOptionsTaken(activity.item) : [];
  const secondOption = secondRageOption({ oneOption: optionRule?.oneOption, raging: !!optionRule?.oneOption && isRaging(activity.actor), taken: optionsTaken.length });
  // §519 (DF #164): one more Metamagic option than a spell can carry (one; two under Innate Sorcery) — a problem,
  // forceable through the legality window like any rule refusal.
  const metaKind = metamagicKindOf(activity);
  const metaLimit = metaKind ? metamagicLimit(metamagicRulesOf(activity.actor)) : 0;
  const metaFull = !!metaKind && !mayHold(pendingMetamagic(activity.actor), metaKind, metaLimit);
  // §214: armor worn without training — no spells.
  const unarmored = isSpellCast(activity.item) ? untrainedArmor(activity.actor) : null;
  // §367: Storm of Vengeance — no ranged attack with a weapon from the area; Shadow Walk — not from a lit place.
  const storm = (!pilot && isRangedWeaponAttack(activity, attackMode)) ? rangedBanAround(usageToken(activity)) : null;
  // §403: Moonbeam — no other form in the light (a dnd5e "transform" activity: Wild Shape, Polymorph on self).
  const formLocked = ((activity.type === "transform") && usageToken(activity)) ? formLockAround(usageToken(activity)) : null;
  // B09 (§488): a worn item locks the form (collar) — the steps of the attempt: runtime/form-lock.mjs.
  const wornLock = formAttemptLock(activity);
  const bright = (!pilot && usageToken(activity) && selfTeleportOf(activity)) ? (tooBrightFor(activity, usageToken(activity)) === "from") : false;
  const budgetLines = issues.map(i => loc(`Souci.${i}`));
  const lines = [
    ...budgetLines,
    ...(storm ? [loc("Souci.noRangedWeapons", { item: storm.name })] : []),
    ...(formLocked ? [loc("Souci.formLocked", { item: formLocked.name })] : []),
    ...(wornLock ? [loc("Souci.formLockedWorn", { item: wornLock.item.name })] : []),
    ...(bright ? [loc("Souci.tooBright", { item: activity.item.name })] : []),
    ...(outOfAmmunition(activity, attackMode) ? [loc("Souci.noAmmunition", { item: activity.item.name })] : []),
    ...(silenced ? [loc("Souci.silenced")] : []),
    ...(handsFull ? [loc("Souci.noFreeHand", { items: handsFull.items.join(", ") })] : []),
    ...missing.keys.map(k => loc(`Souci.${k}`, { item: activity.item.name })),
    ...(raging ? [loc("Souci.rage")] : []),
    ...(heavyRage ? [loc("Souci.rageHeavyArmor")] : []),
    ...(metaFull ? [loc("Souci.metamagicLimit", { item: activity.item.name, n: metaLimit })] : []),
    ...(secondOption ? [loc("Souci.rageOneOption", { item: activity.item.name, effect: optionsTaken.map(e => e.name).join(", ") })] : []),
    ...(familiarAttack ? [loc("Souci.familiarAttack")] : []),
    ...(uncommanded ? [loc("Souci.notCommanded")] : []),
    ...(mountUncommanded ? [loc("Souci.mountNotCommanded")] : []),
    ...(commandFar ? [loc("Souci.commandFar", commandFar)] : []),
    ...(shapeless ? [loc("Souci.noAttacksOrSpells", { item: shapeless.name })] : []),
    ...(shackled ? [loc("Souci.noTeleport", { item: shackled.name })] : []),
    ...(befuddled ? [loc("Souci.noSpells", { item: befuddled.name })] : []),
    ...(unarmored ? [loc("Souci.untrainedArmor", { item: unarmored.name })] : []),
    ...(antimagic ? [loc(isSpellCast(activity.item) ? "Souci.antimagic" : "Souci.antimagicItem",
      { item: antimagic.name, use: activity.item.name })] : []),
    ...limits.issues.map(i => loc(`Souci.${i}`, { item: limits.item ?? "", effect: limits.effect ?? "", use: activity.item?.name ?? "",
      activity: activity.name || activity.item?.name || "" })),
    ...incapacitated.map(i => loc(`Souci.${i}`))
  ];
  return { combatant, budget, own, request, cost, lines, budgetLines, missing };
}

/**
 * §142: a weapon with ammunition of a character with no ammunition left — dnd5e lists its ammunition (`ammunitionOptions`,
 * data/item/weapon.mjs: "ammo" consumables of the right subtype, disabled at 0) but fires anyway without. Not for an NPC: a
 * bestiary bow often has no arrows on the sheet. A melee attack (improvised weapon) does not need any.
 */
function outOfAmmunition(activity, attackMode) {
  const item = activity?.item;
  if ( (activity?.type !== "attack") || (item?.type !== "weapon") || (activity.actor?.type !== "character") ) return false;
  if ( !item.system.properties?.has?.("amm") ) return false;
  if ( attackMode && !attackMode.startsWith("ranged") ) return false;
  return !(item.system.ammunitionOptions ?? []).some(o => !o.disabled);
}

/** An unarmed strike (the Unarmed Strike item, or an attack classed "unarmed"). */
const isUnarmedStrike = activity => (activity?.type === "attack")
  && ((identifierOf(activity.item).id === "unarmed-strike") || (activity.attack?.type?.classification === "unarmed"));

/**
 * §24: what the Monk changes to the cost of an unarmed strike. Flurry of Blows open: free (`flurry`). Martial Arts:
 * paid with the Bonus Action when the action (and the attacks it covers) is exhausted.
 */
export function monkRequest(activity, request, budget) {
  if ( !request || !budget ) return request;
  // §90: "Commanded Strike" — the weapon (or unarmed) attack ordered this turn is paid with the Reaction,
  // outside the Attack action.
  const strike = (activity?.type === "attack") && ["weapon", "unarmed"].includes(activity.attack?.type?.classification);
  if ( strike && budget.commanded && (budget.commanded.turn === currentTurnKey()) ) return { ...request, cost: "reaction", weaponAttack: false, commanded: true };
  // §27: War Priest — the open attack also applies to a weapon.
  const weapon = (activity?.type === "attack") && (activity.item?.type === "weapon");
  if ( ((budget.flurry ?? 0) > 0) && (isUnarmedStrike(activity) || (budget.flurryAny && weapon)) ) return { ...request, cost: "free", flurry: true };
  if ( !isUnarmedStrike(activity) ) return request;
  const martial = activity.actor?.items.some(i => contentOf(i).entry?.martialArts === true);
  const actionLeft = (budget.action >= 1) || (budget.attacks.used < budget.attacks.granted);
  if ( martial && (request.cost === "action") && !actionLeft && (budget.bonus >= 1) ) return { ...request, cost: "bonus", weaponAttack: false };
  return request;
}

/* -------------------------------------------- */
/*  K5 (§326): legendary actions                 */
/* -------------------------------------------- */

const isLegendary = activity => activity?.activation?.type === "legendary";

/**
 * The problems of a legendary action (2024 rule: "immediately after another creature's turn", not during its own, one at a
 * time, as long as any remain): on its own turn, with no legendary action left, or already one during this turn.
 */
export function legendaryIssues(activity, combatant, own) {
  if ( !isLegendary(activity) || !combatant || (activity.actor?.type !== "npc") ) return [];
  const legact = activity.actor.system?.resources?.legact;
  if ( !legact?.max ) return [];
  const cost = Number(activity.activation?.value) || 1;
  const name = activity.actor.name;
  const out = [];
  if ( own ) out.push(loc("Souci.legendaryOwnTurn", { name }));
  if ( (legact.value ?? 0) < cost ) out.push(loc("Souci.legendarySpent", { name, left: legact.value ?? 0 }));
  if ( activity.actor.getFlag(MODULE_ID, "legendaryTurn") === currentTurnKey() ) out.push(loc("Souci.legendaryOnce", { name }));
  // K12 (§333): "can't take this action again until the start of its next turn".
  if ( activity.actor.getFlag(MODULE_ID, `legendaryLocked.${activity.item.id}`) ) out.push(loc("Souci.legendaryAgain", { name, item: activity.item.name }));
  return out;
}

/** The attack a legendary action has just announced ("makes one Tail attack"): open for this turn, as long as any remain. */
function legendaryWindowOpen(actor) {
  const w = actor?.getFlag?.(MODULE_ID, "legendaryWindow");
  return !!w && (w.turn === currentTurnKey()) && (w.left > 0);
}

/** K12 (§333): a legendary action that returns only at the start of the creature's next turn. */
const LEGENDARY_AGAIN = /can['’]t (?:take|use) (?:this|that) (?:legendary )?(?:action|ability)? ?again until the start of (?:its|their|his|her) next turn/i;

const COUNT_WORDS = { one: 1, an: 1, a: 1, two: 2, three: 3 };

/**
 * After a legendary action (GM): the cost is spent (`resources.legact.spent`, which dnd5e resets to zero at the end of the
 * creature's turn — data/actor/npc.mjs, `recoverCombatUses`) unless the data already spends it; the turn is noted; and the
 * attack the text announces ("makes one Tail attack", "makes two Claw attacks") is opened: it will go through without a
 * "not its turn" problem, free.
 */
async function onLegendaryUsed(activity) {
  if ( !isLegendary(activity) || (activity.actor?.type !== "npc") || !game.combat?.started ) return;
  const actor = activity.actor;
  const legact = actor.system?.resources?.legact;
  if ( !legact?.max ) return;
  const cost = Number(activity.activation?.value) || 1;
  const consumes = (activity.consumption?.targets ?? []).some(t => String(t.target ?? "").includes("legact"));
  const text = String(activity.item?.flags?.babele?.originalPayload?.description ?? activity.item?.system?.description?.value ?? "")
    .replace(/<[^>]+>/g, " ").replace(/\[\[[^\]]*\]\]/g, "…");
  const m = text.match(/\bmakes? (one|an?|two|three|\d) [^.]*?\battacks?\b/i);
  const left = m ? (COUNT_WORDS[m[1].toLowerCase()] ?? (Number(m[1]) || 1)) : 0;
  const turn = currentTurnKey();
  const update = { [`flags.${MODULE_ID}.legendaryTurn`]: turn, [`flags.${MODULE_ID}.legendaryWindow`]: { turn, left } };
  if ( LEGENDARY_AGAIN.test(text) ) update[`flags.${MODULE_ID}.legendaryLocked.${activity.item.id}`] = true;
  if ( !consumes ) update["system.resources.legact.spent"] = Math.min(legact.max, (Number(legact.spent) || 0) + cost);
  await actor.update(update);
  log(`${actor.name}: legendary action ${activity.item.name} (${cost}), ${Math.max(0, (legact.value ?? 0) - (consumes ? 0 : cost))} left${left ? `, ${left} attack(s) to follow` : ""}`);
}

/**
 * Flexible mode (SPEC §6): a budget, turn or range problem forbids nothing. The use
 * is suspended, the player reads what is wrong and decides. `preUseActivity` is synchronous: we
 * cancel, ask, then relaunch the same use marked as confirmed.
 * Budget and turn exist only in combat; range is always checked.
 */
function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  // What the intent fixed in advance (exclusive effect, attack mode) goes on the card, where the engine reads it.
  // §16.40: the content options first — rule cost (noted on the card right after), lowest slot,
  // no window; no slot: nothing is used.
  // §410: no more slots for a `lowestSlot` rule — no more flat refusal: the legality window says it (`missingResources`, target
  // "spellSlots"), the player can force without spending it.
  applyLowestSlot(activity, usageConfig, dialogConfig);
  // §65: a basic action of choice (Nimble Escape: Disengage OR Hide) — asked before anything, then the use restarts.
  const choices = basicChoiceOf(activity);
  if ( choices && !choices.includes(usageConfig[MODULE_ID]?.basicChoice) ) {
    foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name },
      content: `<p>${loc("ActionAuChoix")}</p>`,
      buttons: choices.map((kind, i) => ({ action: kind, label: loc(`Action.${kind}.Nom`), default: i === 0 })),
      rejectClose: false
    }).then(kind => {
      if ( !choices.includes(kind) ) return;
      relaunchUse(activity, { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), basicChoice: kind } }, dialogConfig, messageConfig);
    });
    return false;
  }
  for ( const key of ["choice", "attackMode", "saveChoice", "legendary", "autoReact", "recast", "cost", "damageType", "order", "cleave", "metamagic", "basicChoice", "ammunition", "overridden", "forcedThrough", "potionMode", "administer"] ) {
    const value = usageConfig[MODULE_ID]?.[key];
    if ( value && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.${key}`, value);
  }
  // K5 (§326): the attack a legendary action has just announced — outside its turn, no problem or Reaction, free.
  if ( !isLegendary(activity) && legendaryWindowOpen(activity.actor) ) {
    const w = activity.actor.getFlag(MODULE_ID, "legendaryWindow");
    activity.actor.setFlag(MODULE_ID, "legendaryWindow", { ...w, left: w.left - 1 });
    if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.cost`, "free");
    log(`${activity.actor.name}: ${activity.item.name} as part of a legendary action`);
    return true;
  }
  if ( usageConfig[MODULE_ID]?.confirmed ) return true;
  // An activity launched without a target has already entered aiming mode before arriving here
  // (ui/pointer.mjs, registered earlier).
  // Attack mode already chosen by the click ("off hand" of the menu: `engage`), otherwise unknown until the roll.
  // A cost imposed by the intent (§16.26: "Size", a weapon attack as a Bonus Action), otherwise that of the activation.
  const use = useIssues(activity, { cost: usageConfig[MODULE_ID]?.cost ?? null,
    attackMode: usageConfig[MODULE_ID]?.attackMode ?? null, recast: !!usageConfig[MODULE_ID]?.recast, usageConfig });
  const { combatant, budget, own, request } = use;
  const legend = legendaryIssues(activity, combatant, own);
  const range = assessRange(activity);
  // Stealth: you must be out of every enemy's field of view (2024 rule, adapter/hide.mjs)
  // — except unmanaged Stealth (issue #65).
  const seenBy = ((basicActionOfActivity(activity, usageConfig[MODULE_ID]?.basicChoice) === "hide") && (stealthRules() !== "off"))
    ? (enemiesSeeing(usageToken(activity)) ?? []) : [];
  // §16.8: "choose a Humanoid" — designated targets of another type will not be affected.
  const origin = usageToken(activity);
  const wrongType = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor)
    .map(t => ({ name: t.name, types: wrongTypeFor(activity, t.actor) })).filter(t => t.types);
  // §17.3: Charmed (not against whoever charmed us); "a creature you can see".
  const aimed = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor);
  // §505 (B25): the content's condition on each target (`targets.requires`: within the swarm's space).
  const unmet = aimed.filter(t => missesTargetRequirement(activity, t.document, origin));
  const charmers = hostileToCharmer(activity) ? charmersOf(activity.actor) : new Set();
  const charmed = aimed.filter(t => charmers.has(t.actor.uuid));
  const offPlane = origin ? aimed.filter(t => !samePlane(origin, t.document)) : [];   // §225: not from one plane to another
  const unseen = (origin && sightRequired(activity)) ? aimed.filter(t => canSee(origin, t.document) === false) : [];
  // §62: a Hidden creature, neither seen nor otherwise perceived, has no known position — no target (an area, yes).
  // §163: Antilife Shell — no melee strike through the barrier.
  const fenced = origin ? aimed.map(t => ({ name: t.name, zone: barrierBetween(origin, t.document, activity) })).filter(t => t.zone) : [];
  // §367: Storm of Vengeance — nor toward a target in the area (from the area: `useIssues`).
  const stormed = isRangedWeaponAttack(activity, usageConfig[MODULE_ID]?.attackMode ?? null)
    ? aimed.map(t => ({ name: t.name, item: rangedBanAround(t.document) })).filter(t => t.item) : [];
  // §286: Chain Lightning — the secondary targets within 9 m of the first.
  const chained = chainOutliers(activity, aimed.map(t => t.document));
  const lost = (origin && !activity.target?.template?.type) ? aimed.filter(t => !unseen.includes(t)
    && locationUnknown({ hidden: hiddenDcOf(t.actor) !== null, sees: pinpointsTarget(origin, t.document) })) : [];
  // §411: what the click has already surveyed that legality does not see (contact, line of sight, impossible approach,
  // target type, link, Cleave, bounce) — `issues`: translated reasons; `issuesCoverRange`: they already state the range.
  const extra = (usageConfig[MODULE_ID]?.issues ?? []).filter(l => typeof l === "string" && l);
  if ( extra.length && usageConfig[MODULE_ID]?.issuesCoverRange ) range.blocking = [];
  if ( !extra.length && !use.lines.length && !legend.length && !range.blocking.length && !seenBy.length && !wrongType.length && !charmed.length && !unseen.length && !lost.length && !fenced.length && !stormed.length && !offPlane.length && !chained.length && !unmet.length ) return true;

  const lines = mergeIssues(
    extra,
    ...use.lines,
    ...legend,
    ...range.blocking.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : "Souci.outOfRange", { name: r.name })),
    ...(seenBy.length ? [loc("Souci.hideSeen", { names: seenBy.map(t => t.name).join(", ") })] : []),
    ...wrongType.map(t => loc("Souci.wrongType", { name: t.name, types: typesLabel(t.types), item: activity.item.name })),
    ...unmet.map(t => loc("Souci.targetRequirement", { name: t.name, item: activity.item.name })),
    ...charmed.map(t => loc("Souci.charmed", { name: t.name })),
    ...offPlane.map(t => loc("Souci.otherPlane", { name: t.name })),
    ...unseen.map(t => loc("Souci.notSeen", { name: t.name })),
    ...lost.map(t => loc("Souci.hiddenTarget", { name: t.name })),
    ...fenced.map(t => loc("Souci.barrier", { name: t.name, item: t.zone.item.name })),
    ...stormed.map(t => loc("Souci.noRangedWeaponsAt", { name: t.name, item: t.item.name })),
    ...chained.map(t => loc("Souci.chainTooFar", { name: t.name, first: aimed[0].name, distance: chainLimit(chainOf(activity.item), aimed[0].document),
      units: aimed[0].document.parent.grid.units }))
  );
  // An action attempted outside its turn is often a Reaction (Opportunity Attack).
  const asReaction = !!combatant && !own && (request.cost === "action") && (budget.reaction > 0);
  const buttons = [{ action: "go", label: loc("UtiliserQuandMeme"), default: !asReaction }];
  if ( asReaction ) buttons.unshift({ action: "reaction", label: loc("UtiliserMaReaction"), default: true });
  buttons.push({ action: "cancel", label: loc("Renoncer") });

  confirmDialog(`${activity.item.name} — ${combatant?.name ?? activity.actor?.name ?? ""}`, lines, buttons, activity.actor ?? null).then(choice => {
    if ( (choice !== "go") && (choice !== "reaction") ) return;
    acknowledge(range.key);
    if ( range.blocking.length ) rememberForced(range.key, range.blocking);   // §416: the attack roll does not ask again
    // §408: what is overridden — the GM and the table notified, the card marked ("Use my Reaction" settles the budget).
    const reasons = forcedReasons({ lines, budgetLines: use.budgetLines, action: choice });
    if ( reasons.length ) reportForced({ actor: activity.actor, item: activity.item, reasons, targets: aimed.map(t => t.name), token: origin })
      .catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
    // The engine options already set (light choice, designated targets…) restart with the confirmation.
    // §518: the card knows it was overridden (whatever the "Impossible action" setting) — Total Cover is no longer
    // an automatic failure there (runtime/engine.mjs, `enrich`).
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), confirmed: true, forcedThrough: true,
      // §436: a reason already overridden before `use` (antimagic, runtime/antimagic.mjs) stays on the card.
      ...(reasons.length ? { overridden: overriddenFlag([...(usageConfig?.[MODULE_ID]?.overridden ?? []), ...reasons]) } : {}) } };
    const message = foundry.utils.mergeObject(messageConfig ?? {}, choice === "reaction"
      ? { data: { flags: { [MODULE_ID]: { cost: "reaction" } } } } : {}, { inplace: false });
    // §410: what is missing is not spent — the "forced" relaunch of §77 (runtime/usage.mjs: nothing is consumed, the spell
    // at its level). Without the dnd5e window, like the former §77 relaunch: the form of a summon and the profile of an
    // enchantment are chosen in the engine's own windows (ui/pointer.mjs, `forced`).
    const forcedUse = use.missing.keys.some(k => ["noSlot", "noUses", "noQuantity"].includes(k));
    if ( forcedUse ) config[MODULE_ID].forced = true;
    // §436, §448: already forced inside an antimagic field — the relaunch still lifts the field (runtime/relaunch.mjs),
    // otherwise dnd5e refuses it without a card.
    Promise.resolve(relaunchUse(activity, config, forcedUse ? { ...(dialogConfig ?? {}), configure: false } : dialogConfig, message))
      .catch(err => console.error(`${MODULE_ID} | relaunch after the legality window`, err));
  });
  return false;
}

/** §149: is the other hand taken — a shield, or another held weapon (not a natural weapon or the unarmed strike)? */
function otherHandBusy(item) {
  return Array.from(item?.actor?.items ?? []).some(i => (i !== item) && i.system?.equipped && (
    ((i.type === "equipment") && (i.system.type?.value === "shield"))
    || ((i.type === "weapon") && (i.system.type?.value !== "natural") && (identifierOf(i).id !== "unarmed-strike"))));
}

/** §149: Versatile weapon — two-handed when the other hand is free (core/attack.mjs, `versatileGrip`). */
function gripVersatile(config, activity, { explicit }) {
  const item = activity?.item;
  if ( (item?.type !== "weapon") || !item.system.properties?.has?.("ver") ) return;
  const versatile = item._source?.system?.damage?.versatile;
  const twoHandedDamage = !(versatile?.custom?.enabled && !versatile.custom.formula?.trim());   // §151
  const mode = versatileGrip({ mode: config.attackMode ?? null, modes: (item.system.attackModes ?? []).map(m => m.value),
    explicit, otherHandBusy: otherHandBusy(item), twoHandedDamage,
    prefersOneHand: Array.from(item.actor?.items ?? []).some(i => identifierOf(i).id === "dueling") });   // §295 : style Duel
  if ( !mode ) return;
  config.attackMode = mode;
  if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = mode;
}

/**
 * Before the attack roll dialog: a melee weapon that can be thrown, against targets all
 * out of reach, is preselected in "thrown" mode. The player keeps control in the dialog.
 */
function onPreRollAttack(config, dialog, message) {
  const activity = config.subject;
  // §150: the mode carried by the use card (`flags["dnd5e-combat"].attackMode`, set at use from the configuration:
  // the Bar's off hand) — the roll that dnd5e chains by itself (activity/attack.mjs, `_triggerSubsequentActions`:
  // `system.origin`) does not go through `engage`, which alone kept the mode of a click.
  const usageId = message?.data?.system?.origin ?? null;
  const carried = usageId ? game.messages.get(usageId)?.getFlag(MODULE_ID, "attackMode") : null;
  // Attack engaged with the mouse: the mode ("thrown") is already chosen, and the roll goes ahead without a dialog.
  const pending = activity?.uuid ? takePendingAttack(activity) : null;
  if ( !pending?.mode && carried && activity?.item?.system.attackModes?.some(m => m.value === carried) ) {
    config.attackMode = carried;
    if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = carried;
    if ( pending?.fast && dialog ) dialog.configure = false;
    if ( pending?.confirmed ) config[MODULE_ID] = { ...(config[MODULE_ID] ?? {}), confirmed: true };
    return true;
  }
  if ( pending ) {
    if ( pending.fast && dialog ) dialog.configure = false;
    if ( pending.confirmed ) config[MODULE_ID] = { ...(config[MODULE_ID] ?? {}), confirmed: true };   // range already accepted
    if ( pending.mode && activity.item?.system.attackModes?.some(m => m.value === pending.mode) ) {
      config.attackMode = pending.mode;
      if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = pending.mode;
      return true;
    }
  }
  // §149: a "chosen" mode — asked for, neither taken from dnd5e's memory nor the default one.
  const byDefaultMode = activity?.item?.system.attackModes?.[0]?.value ?? null;
  const rememberedMode = activity?.item?.getFlag?.("dnd5e", `last.${activity.id}.attackMode`) ?? null;
  const explicit = !!config[MODULE_ID]?.modeChosen
    || (!!config.attackMode && (config.attackMode !== byDefaultMode) && (config.attackMode !== rememberedMode));
  // Only the relaunch after the range window has already chosen its mode (`modeChosen`); a merely confirmed attack
  // (connector, aiming) keeps the preselection — without it, a thrown javelin went off as melee, without `system.mode` on the
  // message and no javelin spent (seen on 2026-09-28, Thrown Weapon Fighting style).
  if ( config[MODULE_ID]?.modeChosen || !activity?.item || !canBeThrown(activity) ) {
    gripVersatile(config, activity, { explicit });
    return true;
  }
  // §39.2: a mode other than dnd5e's default (the first: activity/attack.mjs:111-113) that was asked for (off
  // hand, two hands) is kept — but not the last mode that dnd5e simply took from its memory
  // (activity/attack.mjs:95): after a throw, a contact attack went off again as "thrown".
  const byDefault = activity.item.system.attackModes?.[0]?.value ?? null;
  const remembered = activity.item.getFlag("dnd5e", `last.${activity.id}.attackMode`) ?? null;
  const origin = usageToken(activity);
  const targets = Array.from(game.user.targets).filter(t => t.document !== origin);
  const canTest = !!origin && canvas.ready;
  const factors = canTest ? readUnitFactors() : null;
  const reach = canTest ? reachOf(activity) : null;
  const mode = throwableAttackMode({
    requested: config.attackMode ?? null, remembered, byDefault,
    hasTargets: canTest && (targets.length > 0),
    allBeyondReach: canTest && (targets.length > 0) && targets.every(t => rangeIssue(distanceBetween(origin, t.document), reach, factors)),
    canThrow: activity.item.system.attackModes?.some(m => m.value === "thrown") === true
  });
  if ( mode ) {
    config.attackMode = mode;
    if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = mode;
  }
  gripVersatile(config, activity, { explicit });
  return true;
}

/**
 * Range check of the attack roll, AFTER its dialog: that is where the attack mode is
 * known (melee or thrown), and where the targets are those of the roll (activity/attack.mjs:84).
 */
function onPostAttackRollConfiguration(rolls, config, dialogConfig, messageConfig) {
  const activity = config.subject;
  if ( config[MODULE_ID]?.confirmed || !activity?.item ) return true;
  const options = rolls[0]?.options ?? {};
  const range = assessRange(activity, options.attackMode ?? null);
  // §416: range already overridden at use — no second window or second alert, the attack card stays marked.
  if ( range.forced?.length && messageConfig ) {
    const forcedLines = range.forced.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : "Souci.outOfRange", { name: r.name }));
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.overridden`, overriddenFlag(forcedReasons({ lines: forcedLines, action: "go" })));
  }
  if ( !range.blocking.length ) return true;

  const beyondReach = canBeThrown(activity) && !options.attackMode?.startsWith("thrown");
  const lines = range.blocking.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : (beyondReach ? "Souci.outOfReach" : "Souci.outOfRange"), { name: r.name }));
  const buttons = [{ action: "go", label: loc("AttaquerQuandMeme"), default: true }, { action: "cancel", label: loc("Renoncer") }];
  confirmDialog(`${activity.item.name} — ${activity.actor?.name ?? ""}`, lines, buttons, activity.actor ?? null).then(choice => {
    if ( choice !== "go" ) return;
    acknowledge(range.key);
    // §408: range overridden at the roll — the GM and the table notified, the attack card marked.
    const reasons = forcedReasons({ lines, action: choice });
    reportForced({ actor: activity.actor, item: activity.item, reasons, targets: range.blocking.map(r => r.name), token: usageToken(activity) })
      .catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
    // We start again from a fresh configuration, with the choices already made in the dialog.
    const { ability, ammunition, attackMode, mastery, advantageMode } = options;
    activity.rollAttack({
      event: config.event, ability, ammunition, attackMode, mastery,
      advantage: advantageMode === 1, disadvantage: advantageMode === -1,
      [MODULE_ID]: { confirmed: true, modeChosen: true, ammoChosen: true }
    }, { configure: false },
    { data: { system: { origin: foundry.utils.getProperty(messageConfig ?? {}, "data.system.origin") },
      flags: { [MODULE_ID]: { overridden: overriddenFlag(reasons) } } } });
  });
  return false;
}

/* -------------------------------------------- */
/*  Spending and reset, by the active GM        */
/* -------------------------------------------- */

const WASTE_QUERY = `${MODULE_ID}.wasteUse`;

/**
 * §298 (pass C3): a use that does not go ahead but whose action is lost — a countered spell (Counterspell 2024: "the action,
 * Bonus Action, or Reaction used to cast it is lost; the spell slot is not expended"), a spell missed under Slow.
 * The activity's cost is charged to its caster's budget (no slot, no "one slot-using spell per turn"). Active GM.
 */
async function handleWasteUse({ activity: uuid }, { user=null }={}) {
  const activity = await fromUuid(uuid ?? "");
  // §472: from a player, only their own activity (safety refusal, not forceable).
  if ( !actsFor(user, activity?.actor) ) { console.warn(`${MODULE_ID} | wasteUse query from ${user.name} refused: ${activity?.actor?.name ?? uuid} is not theirs`); return false; }
  const combatant = combatantFor(activity?.actor);
  if ( !activity || !combatant || !game.combat?.started ) return false;
  const before = readBudget(combatant);
  const request = { ...requestFor(activity), usesSpellSlot: false };
  if ( !request.cost || (request.cost === "free") ) return false;
  const after = spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  await writeBudget(combatant, after);
  log(`${combatant.name}: ${activity.item?.name ?? activity.name} wasted — ${request.cost} spent`);
  return true;
}

/** §298: the action of a use that did not happen is lost (Counterspell, failure under Slow). */
export function wasteUse(activity) {
  return viaActiveGM(WASTE_QUERY, handleWasteUse, { activity: activity.uuid }, { fallback: false });
}

async function onUsageMessage(message) {
  if ( message.getFlag(MODULE_ID, "areaTick") ) return;   // area replaying its activity: nobody acts
  if ( message.getFlag(MODULE_ID, "resave") ) return;     // repeated saving throw (SPEC §16): nobody acts either
  const activity = message.getAssociatedActivity?.();
  // §16.15: a piloted object is paid from its caster's budget, per command (runtime/pilot.mjs).
  const pilot = pilotOfActor(message.getAssociatedActor?.());
  if ( pilot ) return activity ? pilotUsage(message, pilot) : undefined;
  const ordered = spellCommandOf(activity);
  if ( ordered ) return spellCommandUsage(message, ordered);
  const combatant = combatantFor(message.getAssociatedActor?.());
  if ( !activity || !combatant ) return;
  const before = readBudget(combatant);
  // Basic action through its item (§15.2): the action is spent and the turn state set (Dash doubles movement…).
  // The others (unarmed attack…) cost what their activation says, like any item.
  const basic = basicActionOf(activity.item);
  const kind = BASIC_ACTION_FLAGS[basic] ? basic : null;
  // §19.6: an activity that takes a basic action at the cost of its activation ("Quick Step": Dash as a Bonus Action).
  // §65: an action of choice counts only as the one chosen at use (noted on the card).
  const declared = basicChoiceOf(activity) ? basicActionOfActivity(activity, message.getFlag(MODULE_ID, "basicChoice"))
    : declaredBasicsOf(activity);
  const request = kind ? null : monkRequest(activity, requestFor(activity, message.getFlag(MODULE_ID, "cost") ?? null,
    { attackMode: message.getFlag(MODULE_ID, "attackMode") ?? null }), before);
  // §24: a Flurry of Blows strike — free, counted, and noted on the card (Open Hand Technique).
  if ( request?.flurry ) {
    const left = Math.max(0, (before.flurry ?? 0) - 1);
    await writeBudget(combatant, { ...before, flurry: left, flurryAny: left ? !!before.flurryAny : false });
    await message.setFlag(MODULE_ID, "flurry", true);
    log(`${combatant.name}: Flurry of Blows strike (${Math.max(0, (before.flurry ?? 0) - 1)} left)`);
    return;
  }
  // §21: Action Surge — "one additional action"; the ("special") activity costs nothing.
  if ( contentOf(activity.item).entry?.grantsAction === true ) {
    await writeBudget(combatant, { ...before, action: (before.action ?? 0) + 1 });
    log(`${combatant.name}: one more action (${activity.item.name})`);
    return;
  }
  if ( request && (!request.cost || (request.cost === "free")) ) {   // §16.27: a chained projectile costs nothing
    // K5 (§334): a legendary action (outside the budget) that "moves without provoking Opportunity Attacks" still frees the
    // path (Unicorn's "Charging Horn", Werewolf's "Charge").
    if ( !before.disengaged && freesMovement(activity.item) ) await writeBudget(combatant, { ...before, disengaged: true });
    return;
  }
  if ( request && message.getFlag(MODULE_ID, "recast") ) {
    request.usesSpellSlot = false;
    const recastCost = contentOf(activity.item).entry?.recastCost;
    if ( recastCost ) request.cost = recastCost;   // §164
  }
  let after = kind ? basicAction(before, kind)
    : spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  for ( const k of [declared].flat() ) if ( k && BASIC_ACTION_FLAGS[k] ) after = (k === "dash") ? addDash(after) : { ...after, [BASIC_ACTION_FLAGS[k]]: true };
  if ( request?.commanded ) after = { ...after, commanded: null };   // §90 : l'ordre est servi
  // §211: the readied action is released — the plan is served with the Reaction (written here, in a single write,
  // so that writes do not cross).
  if ( message.getFlag(MODULE_ID, "readiedRelease") ) after = { ...after, readied: false };
  // §24: Flurry of Blows — the unarmed strikes it opens.
  const flurry = contentOf(activity.item).entry?.flurry;
  if ( flurry && [flurry.activity].flat().includes(activity.id) ) {
    // §295: Heightened Focus (Monk 10) — "three unarmed strikes instead of two": the highest `flurryStrikes` of the
    // bearer's items.
    const strikes = Math.max(flurry.strikes, ...Array.from(combatant.actor?.items ?? []).map(i => contentOf(i).entry?.flurryStrikes ?? 0));
    after = { ...after, flurry: strikes, flurryAny: flurry.weapons === true };
  }
  // §20: "your Speed is 0 until the end of the turn" (Steady Aim) — not a step more, the rest of the budget intact.
  if ( contentOf(activity.item).entry?.holdsStill === true ) after = { ...after, stopped: true };
  // §21: Tactical Shift — Second Wind as a Bonus Action: half the Speed more, with no Opportunity Attack.
  // §22: Instinctive Pounce — entering a Rage: half the Speed more (`disengage: false`).
  const used = identifierOf(activity.item).id;
  const shift = (request?.cost === "bonus") ? combatant.actor?.items.map(i => contentOf(i).entry?.movesAfter)
    .find(m => m && (((typeof m === "string") ? m : m.item) === used)) : null;
  const movement = shift ? movementOf(combatant, readUnitFactors()) : null;
  if ( movement ) {
    const disengage = (typeof shift === "string") || (shift.disengage !== false);
    after = { ...after, bonusMove: (Number(after.bonusMove) || 0) + (movement.speed / 2), ...(disengage ? { disengaged: true } : {}) };
    log(`${combatant.name}: +${movement.speed / 2} ${movement.units} of movement${disengage ? " without provoking Opportunity Attacks" : ""} (${activity.item.name})`);
  }
  // §18.15: "moves … without provoking Opportunity Attacks" — the rest of the turn, as after Disengage.
  if ( !after.disengaged && freesMovement(activity.item) ) after = { ...after, disengaged: true };
  // §503 (B23): "no other spell this turn, except a cantrip" — set after this use, on its own turn.
  const restriction = afterUseRestrictionOf(activity);
  if ( restriction && isOwnTurn(combatant) ) {
    after = { ...after, onlyCantrips: restriction };
    log(`${combatant.name}: ${restriction.item} — no other spell this turn, except a cantrip${restriction.castTime ? ` (${restriction.castTime})` : ""}`);
  }
  await writeBudget(combatant, after);
  // §133: the Disengage action taken (not the one an ability grants while walking) — Sentinel can react.
  if ( ((kind === "disengage") || [declared].flat().includes("disengage")) && combatant.token ) windowDisengaged(combatant.token);
  // Recorded on the card: a cancellation before any roll (runtime/cancel.mjs) refunds exactly this expenditure.
  await message.setFlag(MODULE_ID, "spent", { combatant: combatant.id, before, after, offhand: !!request?.offhand });
  log(`${combatant.name}: ${kind ?? (request.offhand ? "off hand" : request.cost)} (${activity.item.name})`);
}

/** Wait delay for the expenditure recorded on the use card, when the roll follows closely. */
const SPENT_WAIT_MS = 3000;

/**
 * Off-hand attack chosen in the roll dialog (sheet, action bar): at use,
 * the mode was not known and an action was charged. At the roll, that expenditure is refunded and
 * the off-hand attack is charged (Bonus Action, or Nick).
 */
async function onAttackMessage(message) {
  const mode = message.system?.mode;
  if ( !mode?.endsWith?.("offhand") ) return;
  // `system.origin` is a ForeignDocumentField (data/chat-message/roll-message-data.mjs:38): read, it is the
  // message itself; its id is in the source, as adapter/messages.mjs reads it.
  const usage = game.messages.get(message._source.system?.origin);
  if ( !usage ) return;
  // The roll often follows the use closely (quick attack click): the card's expenditure, written by this
  // same GM at the use's \`createChatMessage\`, may not be there yet. We wait for it a little.
  let spent = usage.getFlag(MODULE_ID, "spent");
  for ( let waited = 0; !spent && (waited < SPENT_WAIT_MS); waited += 100 ) {
    await sleep(100);
    spent = usage.getFlag(MODULE_ID, "spent");
  }
  const combatant = spent ? game.combat?.combatants.get(spent.combatant) : null;
  if ( !combatant || spent.offhand ) return;
  const activity = usage.getAssociatedActivity?.();
  if ( !activity ) return;
  const request = requestFor(activity, null, { attackMode: mode });
  const before = refundUse(readBudget(combatant), spent.before, spent.after);
  const after = spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  await writeBudget(combatant, after);
  await usage.setFlag(MODULE_ID, "spent", { combatant: combatant.id, before, after, offhand: true });
  log(`${combatant.name}: off hand chosen at the roll, spending corrected (${activity.item.name})`);
}

/** Card deleted by a cancellation before any roll: the expenditure it had made is refunded. */
async function onUsageCancelled(message) {
  if ( !message.getFlag(MODULE_ID, "cancelled") ) return;
  const spent = message.getFlag(MODULE_ID, "spent");
  const combatant = spent ? game.combat?.combatants.get(spent.combatant) : null;
  if ( !combatant ) return;
  await writeBudget(combatant, refundUse(readBudget(combatant), spent.before, spent.after));
  if ( spent.command ) await refundCommand(combatant, spent.command);
  log(`${combatant.name}: spending refunded (action cancelled before any roll)`);
}

async function resetBudget(combatant) {
  if ( combatant ) await writeBudget(combatant, freshBudgetFor(combatant));
  // K12 (§333): locked legendary actions return at the start of its turn.
  if ( combatant?.actor?.getFlag(MODULE_ID, "legendaryLocked") ) await combatant.actor.unsetFlag(MODULE_ID, "legendaryLocked").catch(() => {});
}

/* -------------------------------------------- */

/** C12-c: the `summon` rule of the item that summoned this actor, or null. */
function summonRuleOf(actor) {
  const origin = actor?.getFlag?.("dnd5e", "summon.origin");
  const item = origin ? fromUuidSync(origin, { strict: false }) : null;
  return item ? (contentOf(item).entry?.summon ?? null) : null;
}

/**
 * C12-c: the order given to a summon (`summon.commanded.activity`: Primal Companion's "Command") — its summons from this item
 * are commanded for this round (`flags.dnd5e-combat.commanded`). On the author's client, which owns the beast.
 */
async function markCommanded(activity) {
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.summon?.commanded : null;
  if ( !rule || (rule.activity !== activity.id) ) return;
  const round = game.combat?.round ?? null;
  // By the id of the origin item: an unlinked caster (token) has a synthetic actor, the summon's origin may name the
  // world actor.
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin") ?? "";
    if ( !origin.endsWith(`Item.${item.id}`) ) continue;
    if ( token.actor?.isOwner ) await token.actor.setFlag(MODULE_ID, "commanded", round);
    log(`${item.name}: ${token.name} is commanded this round`);
  }
}

export function registerTurn() {
  registerSomaticHandsSetting();   // §409: the free-hand check (somatic component)
  route("dnd5e.postUseActivity", activity => markCommanded(activity), { label: "summon command not recorded" });
  CONFIG.queries[WASTE_QUERY] = handleWasteUse;
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "use legality" });
  route("dnd5e.postUseActivity", activity => markUsedThisTurn(activity), { label: "\"once per turn\" limit not recorded" });
  route("dnd5e.postUseActivity", activity => onLegendaryUsed(activity), { label: "legendary action not spent" });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "attack mode preselected" });
  route("dnd5e.postAttackRollConfiguration", onPostAttackRollConfiguration, { cancellable: true, label: "attack roll range" });

  route("createChatMessage", message => (message.type === "usage") ? onUsageMessage(message)
    : (message.type === "attack") ? onAttackMessage(message) : null,
    { executor: true, label: "budget: spending not recorded" });

  route("deleteChatMessage", message => (message.type === "usage") ? onUsageCancelled(message) : null,
    { executor: true, label: "budget: spending refunded on cancel" });

  // The Reaction and the rest are recovered at the start of the combatant's turn.
  route("combatTurnChange", (combat, prior, current) => resetBudget(combat.combatants.get(current.combatantId)),
    { executor: true, label: "budget: turn reset" });
  route("combatStart", combat => Promise.all(combat.combatants.map(resetBudget)),
    { executor: true, label: "budget: combat reset" });
}
