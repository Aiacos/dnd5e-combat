/**
 * Reactions: who can react, how to ask them, and what their choice triggers.
 *
 * Verified:
 *  - requests between core clients: `CONFIG.queries[nom] = (données, {timeout}) => résultat`,
 *    called by `user.query(nom, données, {timeout})` (client/config.mjs:2964, user.mjs:289).
 *    The answer is the signal; the timeout is only a safety net (SPEC §5.3).
 *  - what an item declares (window, target) comes from the registry: content/triggers.mjs, or
 *    `flags["dnd5e-combat"].triggers` on the item (adapter/triggers.mjs)
 *  - Official Shield (packs/_source/spells24/1st-level/shield.yml): identifier `shield`,
 *    utility activity, "reaction" activation, "self" target, AC +5 effect until the start of the
 *    caster's next turn (`expiry: sourceStart`, native in 6.0).
 *  - using an attack activity chains its attack roll (activity/attack.mjs:68-70).
 */

import { MODULE_ID } from "../constants.mjs";
import { levelHidden } from "./level-gate.mjs";
import { offersReaction } from "../core/flow.mjs";
import { reactionAvailable } from "../core/turn.mjs";
import { eligibleReactions } from "../core/reaction.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { rollerFor } from "./concentration.mjs";
import { timedWait } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { markReactionAdvantage, markReactionDamage, markReactionDisadvantage } from "./marks.mjs";
import { combatantFor, readBudget, currentTurnKey, losesOnlyOneReaction } from "./turn.mjs";
import { cannotReact } from "../core/reaction-loss.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";
import { resolveCounter } from "./counter.mjs";
import { polearmFits } from "../core/feats.mjs";
import { spendItemUses } from "./uses.mjs";
import { victimsOf } from "./grapple.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { needsCheck, plainReaction } from "../core/requests.mjs";

export const REACTION_QUERY = `${MODULE_ID}.reaction`;

/** Safety timeout of a reaction request. The GM never waits longer. */
const REACTION_TIMEOUT = 20000;   // beyond the window's timeout (adapter/dialogs.mjs): the player no longer has control

/** §16.47: does the actor carry a spell effect that forbids Reactions (`noReactions`: Arms of Hadar)? */
export function reactionsBlocked(actor) {
  return (actor?.effects ?? []).some(blocksReactions);
}

/** §501: does this Active Effect forbid Reactions (`noReactions` of its origin item)? */
export function blocksReactions(e) {
  return !!e && !e.disabled && !e.isSuppressed && effectRule(e, contentOf(originItemOf(e))?.entry?.noReactions);
}

/** §334: an effect rule true for all of the item's effects (`true`), or for those in the list (Ray of Slowing). */
const effectRule = (e, rule) => (rule === true) || (Array.isArray(rule) && rule.some(id => comesFromItemEffect(e, id)));

/** §77: does the actor carry an effect that leaves only an action OR a Bonus Action per turn (`actionOrBonus`: Stinking Cloud)? */
export function actionOrBonusOnly(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && effectRule(e, contentOf(originItemOf(e))?.entry?.actionOrBonus));
}

/** §23: the bearer of an item effect `noOpportunityAttacks` (Shocking Grasp) makes no Opportunity Attack. */
export function opportunityBlocked(actor) {
  // C12-e: a list of the item's effects — only those (Staggering Strike, not Cleaving Strike).
  return (actor?.effects ?? []).some(e => {
    if ( e.disabled || e.isSuppressed ) return false;
    const rule = contentOf(originItemOf(e))?.entry?.noOpportunityAttacks;
    return (rule === true) || (Array.isArray(rule) && rule.some(id => comesFromItemEffect(e, id)));
  });
}

/** Outside combat the Reaction is always available; in combat, the budget says so. */
export function reactionState(actor) {
  const combatant = combatantFor(actor);
  return {
    reactionAvailable: combatant ? reactionAvailable(readBudget(combatant), currentTurnKey()) : true,
    // "Cannot react": Incapacitated, dead, or an effect that forbids it. §501: `reactions.loseOne` — Incapacitated or the
    // effect only took away one Reaction (runtime/reaction-loss.mjs); dead, unconscious or petrified, it does not react.
    incapacitated: cannotReact({ statuses: Array.from(actor.statuses ?? []), blocked: reactionsBlocked(actor), loseOne: losesOnlyOneReaction(actor) })
  };
}

/**
 * The Reactions an actor can offer, among declarations already kept for the window
 * (runtime/triggers.mjs). One option per `use` step: the item's Reaction activity, or the one
 * the step names; `targetSource` = the Reaction targets whoever provoked the window.
 */
export function reactionOptions(actor, window, declarations) {
  return eligibleReactions(declarations, window, reactionState(actor)).flatMap(d => stepsOf(d, "use").map(step => ({
    activity: step.activity ? `${d.item}.Activity.${step.activity}` : d.activity,
    // §72: a named activity of the item (Bracelet of Charm: one spell per activity) — the button carries its name.
    name: activityLabel(d, step), img: d.img, targetSource: step.target === "source", targetSelf: step.target === "self",
    targetTarget: step.target === "target",   // §133 : Protection
    halve: stepsOf(d, "halve").length > 0,
    resist: stepsOf(d, "resist").length > 0,   // Hunter's Superior Defense: Resistance to the types of the hit, this turn
    endCondition: stepsOf(d, "endCondition").length > 0,
    uncrit: stepsOf(d, "uncrit").length > 0,
    reduce: stepsOf(d, "reduce").length > 0,
    cancel: stepsOf(d, "cancel").length > 0,   // §301 : Feuille morte
    // §493 (B13): Insect Shield — the area's damage spares the reactor (if the source fails its save).
    cancelForSelf: stepsOf(d, "cancelForSelf").length ? { ifSourceFails: stepsOf(d, "cancelForSelf")[0].ifSourceFails === true } : null,
    intercept: stepsOf(d, "intercept").length > 0,   // O8d (§347) : Bouclier antiprojectiles
    reduceBonus: stepsOf(d, "reduce")[0]?.bonus ?? null,
    miss: stepsOf(d, "miss").length > 0,
    reroll: stepsOf(d, "reroll").length > 0,   // §489 : Parade d'un monstre — l'attaquant relance son jet
    free: step.free === true,   // §489: a Parry's riposte costs the budget nothing
    penalty: stepsOf(d, "penalty")[0]?.formula ?? null,
    bonus: stepsOf(d, "bonus")[0]?.formula ?? null,
    disadvantage: stepsOf(d, "disadvantage").length > 0,
    absorb: stepsOf(d, "absorb").length > 0,
    interpose: stepsOf(d, "interpose").length > 0,
    redirect: stepsOf(d, "redirect").length > 0,   // §375 : Bouclier de chair
    // §485: Indomitable — after the Reaction, the save against a carried effect, as chosen (runtime/resave-choice.mjs).
    resave: ownResave(d),
    consume: step.consume !== false,
    approach: step.approach === true,
    advantage: step.advantage === true,
    // §88: the attack is made with a melee weapon of the actor; the item's activity pays and gives the die (Riposte).
    weapon: step.weapon === true
  // §133: a weapon attack as a Reaction needs no item activity to pay (Sentinel has none).
  })).filter(o => (o.activity || o.weapon) && (!o.activity || affordable(o.activity)) && (!o.weapon || meleeAttacksOf(actor).options.length)
    // §375: an attack to redirect to… nobody — only if the reactor grapples a creature.
    && (!o.redirect || victimsOf(actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null).length)));
}

/** §485: the `resave` step at `own` of a declaration, reduced to what the window carries; null without it. */
function ownResave(d) {
  const step = stepsOf(d, "resave").find(s => "own" in s);
  return step ? { own: step.own, advantage: step.advantage === true } : null;
}

/**
 * §28: a Reaction that cannot be paid for is not offered (Shield without a slot, Illusory Double already used). Spell
 * cast through a slot (`method` "spell" or "pact"): a free slot of its level or higher. Activity that consumes
 * the uses of its own item: one is left.
 * §66: the copy of a spell that a feature casts ("cast" activity, `flags.dnd5e.cachedFor`: the Mage's Protective Magic in
 * the Monster Manual 2024, which casts Counterspell or Shield) takes no slot — dnd5e makes the activity that casts it pay
 * (activity/mixin.mjs:609, `spellSlot: false`): it is ITS uses that count.
 */
function affordable(activityUuid) {
  const activity = fromUuidSync(activityUuid, { strict: false });
  if ( levelHidden(activity) ) return false;
  // §301: a named activity the item does not have (two items with the same identifier: the fighter's and rogue's Psionic Energy).
  if ( !activity && /\.Activity\./.test(activityUuid ?? "") && fromUuidSync(activityUuid.split(".Activity.")[0], { strict: false }) ) return false;
  const item = activity?.item;
  if ( !item ) return true;
  const linked = (item.type === "spell") ? (item.system.linkedActivity ?? null) : null;
  if ( linked ) return linkedAffordable(linked);
  const spells = item.actor?.system?.spells ?? {};
  const level = Number(item.system.level) || 0;
  if ( (item.type === "spell") && (level > 0) && ["spell", "pact", undefined, ""].includes(item.system.method) ) {
    const slot = Object.entries(spells).some(([key, v]) => {
      const lvl = (key === "pact") ? Number(v?.level) : Number(key.replace("spell", ""));
      return (lvl >= level) && ((Number(v?.value) || 0) > 0);
    });
    if ( !slot ) return false;
  }
  const ownUses = (activity.consumption?.targets ?? []).some(t => (t.type === "itemUses") && !t.target);
  if ( ownUses && Number(item.system.uses?.max) && !((Number(item.system.uses.value) || 0) > 0) ) return false;
  // §94: the activity's own uses (Supernatural Cry: proficiency bonus per Long Rest).
  const activityUses = (activity.consumption?.targets ?? []).some(t => t.type === "activityUses");
  if ( activityUses && Number(activity.uses?.max) && !((Number(activity.uses.value) || 0) > 0) ) return false;
  // §88: the uses of ANOTHER item (the maneuvers: Martial Superiority; dnd5e has already mapped the target, compendium uuid or
  // identifier, to the actor's item id — data/activity/base-activity.mjs, `_remapConsumptionTarget`).
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( (t.type !== "itemUses") || !t.target ) continue;
    const other = item.actor?.items.get(t.target);
    if ( other && Number(other.system.uses?.max) && !((Number(other.system.uses.value) || 0) > 0) ) return false;
  }
  return true;
}

/** §66: does the "cast" activity that casts a spell copy still have what it takes to pay (its item's uses or its own)? */
function linkedAffordable(linked) {
  for ( const target of linked.consumption?.targets ?? [] ) {
    if ( target.type === "itemUses" ) {
      const source = (target.target ? linked.actor?.items.get(target.target) : null) ?? linked.item;
      if ( Number(source?.system.uses?.max) && !((Number(source.system.uses.value) || 0) > 0) ) return false;
    }
    if ( (target.type === "activityUses") && Number(linked.uses?.max) && !((Number(linked.uses.value) || 0) > 0) ) return false;
  }
  return true;
}

/** The melee attacks an actor has for an Opportunity Attack, and their best reach. */
export function meleeAttacksOf(actor) {
  const options = [];
  let reach = 0;
  let units = "ft";
  for ( const item of actor.items ) {
    // "A melee attack with a weapon or an Unarmed Strike" (PHB 2024, Opportunity Attacks):
    // for a character, only their equipped weapon items (the Unarmed Strike is one) — no spell (Shillelagh,
    // Thorn Whip), no feature (Pact of the Blade), no consumable (scroll); for a monster, its weapons and its
    // natural attacks (feature with a weapon attack: Claws, Bite).
    const weaponItem = item.type === "weapon";
    // §428: the Unarmed Strike is not "held" — it always counts, equipped or not. The one the engine adds to
    // characters is created unequipped (adapter/basics.mjs): a character with only a bow in hand had no melee
    // attack, hence no Opportunity Attack (seen in play by the user, on 2026-11-12).
    const held = item.system.equipped || (identifierOf(item).id === "unarmed-strike");
    if ( actor.type === "character" ? (!weaponItem || !held) : !(weaponItem || (item.type === "feat")) ) continue;
    for ( const activity of item.system.activities ?? [] ) {
      if ( (activity.type !== "attack") || (activity.attack?.type?.value !== "melee") ) continue;
      if ( !["weapon", "unarmed"].includes(activity.attack?.type?.classification) ) continue;
      options.push({ activity: activity.uuid, name: item.name, img: item.img });
      const r = activity.range?.reach ?? item.system.range?.reach ?? 5;
      if ( r > reach ) { reach = r; units = activity.range?.units ?? item.system.range?.units ?? "ft"; }
    }
  }
  return { options, reach, units };
}

/**
 * §136: Polearm Master, Reactive Strike — the melee attacks of held weapons that allow it (quarterstaff, spear, Heavy weapon
 * with Reach), and the greatest reach they give; nothing without a `reactiveStrike` item.
 */
export function reactiveStrikesOf(actor) {
  const out = { options: [], reach: 0, units: "ft" };
  if ( !actor?.items.some(i => contentOf(i).entry?.reactiveStrike === true) ) return out;
  for ( const item of actor.items ) {
    if ( (item.type !== "weapon") || !item.system.equipped ) continue;
    if ( !polearmFits({ baseItem: item.system.type?.baseItem, properties: item.system.properties }) ) continue;
    for ( const activity of item.system.activities ?? [] ) {
      if ( (activity.type !== "attack") || (activity.attack?.type?.value !== "melee") ) continue;
      out.options.push({ activity: activity.uuid, name: item.name, img: item.img });
      const r = activity.range?.reach ?? item.system.range?.reach ?? 5;
      if ( r > out.reach ) { out.reach = r; out.units = activity.range?.units ?? item.system.range?.units ?? "ft"; }
    }
  }
  return out;
}

/**
 * §16.26: Reactive Spell (War Mage) — the spells an actor can cast in place of an Opportunity Attack, if they
 * carry a `reactiveSpell` item: a casting action, a single targeted creature, no area, that does something to
 * the target (attack, save, damage), with a range other than self; prepared, or always available (cantrip, pact, innate, at will).
 */
/** §418: the world setting "Reactions" (declared by runtime/flow.mjs). */
function reactionMode() {
  try { return game.settings.get(MODULE_ID, "reactionPrompts"); } catch { return "level"; }
}

export function reactiveSpellsOf(actor) {
  if ( !actor?.items.some(i => contentOf(i).entry?.reactiveSpell === true) ) return [];
  const options = [];
  for ( const item of actor.items ) {
    if ( item.type !== "spell" ) continue;
    const level = item.system.level ?? 0;
    const ready = (level === 0) || item.system.prepared || ["pact", "innate", "atwill", "always"].includes(item.system.method);
    if ( !ready ) continue;
    // "Target only that creature": not a spell that places an area or summons (even through a sibling activity), nor a
    // personal spell (Shillelagh, Flame Blade).
    // "A casting time of one action": the spell's (Flames, Flame Blade are cast as a Bonus Action, their attack
    // only comes afterwards).
    if ( (item.system.activation?.type ?? "action") !== "action" ) continue;
    const activities = [...(item.system.activities ?? [])];
    if ( item.system.target?.template?.type || activities.some(x => x.target?.template?.type || (x.type === "summon")) ) continue;
    for ( const activity of activities ) {
      if ( !["attack", "save", "damage"].includes(activity.type) ) continue;
      if ( activity.range?.units === "self" ) continue;
      const count = Number(activity.target?.affects?.count || 1);
      if ( (count !== 1) || ["self", "space", "area"].includes(activity.target?.affects?.type) ) continue;
      options.push({ activity: activity.uuid, name: game.i18n.format("DND5ECOMBAT.SortReactif", { name: item.name }), img: item.img });
      break;   // one option per spell
    }
  }
  return options;
}

/**
 * Asks whoever controls the actor whether they react: their player if connected, otherwise the active GM — from any client:
 * the gates before the attack and of Counterspell run on the attacker's client, and without this relay an NPC's Reaction
 * window opened on the attacking PLAYER's client (fixed on 2026-09-29, §38.6). Never throws: no answer = no Reaction.
 * @param {Actor} actor
 * @param {object} payload  { actor, prompt: {key, data}, options: [{activity, name, img}], target? }
 * @returns {Promise<{used: string, message: string|null}|null>}
 */
export async function askReaction(actor, payload) {
  // §418: the "Reactions" setting ("Flow" frame) — not offered, not taken: whoever wants it uses it themselves. The
  // scenario tool (`auto`, the first option without a window) is not a question: it passes.
  if ( !payload?.auto && !offersReaction(reactionMode(), { playerOwned: actor?.hasPlayerOwner === true }) ) {
    console.debug(`${MODULE_ID} | reaction of ${actor?.name}: not offered (setting)`);
    return null;
  }
  const userId = rollerFor(actor) ?? game.users.activeGM?.id ?? null;
  try {
    if ( userId && (userId !== game.user.id) ) return await queryPlayer(game.users.get(userId), REACTION_QUERY, payload,
      { timeout: REACTION_TIMEOUT, actor, label: waitLabel("Reaction") });
    return await handleReactionQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | reaction of ${actor.name}: no answer`, err);
    return null;
  }
}

/**
 * On the side of whoever reacts: the choice window, then the use of the chosen activity. They are
 * the one who uses it: their resources, their dice.
 */
/**
 * §67: joining the source before the Reaction (`use … approach`). The path and the walk belong to the runtime (runtime/actions.mjs,
 * `reactionApproach`), which registers here: the adapter does not import the runtime.
 */
/** An option's button name: the item, followed by the targeted activity's name when it has one ("Bracelet of Charm: Blindness/Deafness"). */
function activityLabel(d, step) {
  if ( !step.activity ) return d.name;
  const activity = fromUuidSync(`${d.item}.Activity.${step.activity}`, { strict: false });
  // The spell of a "cast" activity: its copy on the sheet (translated by Babele), else the compendium (index maybe in English).
  const own = activity?.name || (activity?.type === "cast"
    ? (activity.cachedSpell?.name ?? fromUuidSync(activity.spell?.uuid ?? "", { strict: false })?.name) : null);
  return own ? `${d.name} : ${own}` : d.name;
}

let approachSource = null;

/** The targets of an attack roll, as dnd5e writes them (data/chat-message/fields/targets-field.mjs:32); null without a token. */
function targetDescriptors(tokenDoc) {
  const token = tokenDoc?.document ?? tokenDoc;
  const actor = token?.actor;
  if ( !actor ) return null;
  const ac = actor.statuses?.has("coverTotal") ? null : actor.system.attributes?.ac?.value;
  return [{ actor: actor.uuid, ac: ac ?? null, img: token.texture?.src, name: token.name, token: token.uuid }];
}
export function setReactionApproach(fn) { approachSource = fn; }

/** §403: the counter-Counterspell — the gate (runtime/gates.mjs) a Reaction spell passes before going off; false: countered. */
let reactionSpellGate = null;
export function setReactionSpellGate(fn) { reactionSpellGate = fn; }

export async function handleReactionQuery(payload, { user=null }={}) {
  // §471: from a client other than a GM, this client only answers for
  // a creature it controls and that the sender does not control (otherwise the sender would have asked itself, `askReaction`),
  // the window is always shown, and the use keeps only the legitimate forms (core/requests.mjs). Safety refusal: not forceable.
  const untrusted = needsCheck(user);
  const { actor: actorUuid, prompt, options, target, auto=false, castLevel=null } = untrusted ? plainReaction(payload) : payload;
  const actor = await fromUuid(actorUuid);
  if ( untrusted && (!actor?.isOwner || actor.testUserPermission?.(user, "OWNER")) ) {
    console.warn(`${MODULE_ID} | reaction query from ${user.name} refused: ${actor?.name ?? actorUuid} is not answered here`);
    return null;
  }
  const buttons = options.map((o, i) => ({ action: `use${i}`, label: o.name, icon: "fa-solid fa-bolt", default: i === 0 }));
  buttons.push({ action: "none", label: game.i18n.localize("DND5ECOMBAT.NePasReagir") });
  // With no answer within the timeout: no Reaction (it is not spent without consent).
  // `auto` (scenario tool, `usageConfig["dnd5e-combat"].autoReact`): the first option, without a window.
  const choice = auto ? "use0" : await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.ReactionTitre", { name: actor?.name ?? "" }) },
    classes: ["dnd5e-combat-reaction"],
    position: { width: 520 },
    content: `<p>${game.i18n.format(`DND5ECOMBAT.${prompt.key}`, prompt.data)}</p>`,
    buttons
  }, { fallback: "none", awaiting: { actor, kind: "reaction" } });
  const option = options[Number(String(choice ?? "").replace("use", ""))];
  if ( !choice?.startsWith?.("use") || !option ) return null;

  // §72: a Reaction that targets the reactor itself; otherwise the source, if the window has one.
  const selfToken = option.targetSelf ? (actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
  if ( selfToken ) (selfToken.object ?? selfToken).setTarget?.(true, { releaseOthers: true });
  else if ( target ) {
    const token = (await fromUuid(target))?.object;
    token?.setTarget(true, { releaseOthers: true });
  }
  let activity = option.activity ? await fromUuid(option.activity) : null;
  // §471: the activity is the reactor's (their resources, their dice), wherever the question comes from.
  if ( activity && (activity.actor?.uuid !== actor?.uuid) ) {
    console.warn(`${MODULE_ID} | reaction of ${actor?.name}: activity ${option.activity} is not theirs, refused`);
    return null;
  }
  // §88: Riposte — the item's activity pays (its consumptions: a superiority die) and gives the die; the attack is that of a melee
  // weapon of the actor (the first equipped, `meleeAttacksOf`), against the source, and the die is added to its damage if it hits.
  // §133: without an item activity (Sentinel), the weapon attack alone, paid by the Reaction.
  if ( option.weapon ) {
    const weapon = await fromUuid(meleeAttacksOf(actor).options[0]?.activity ?? "");
    if ( !weapon ) return null;
    if ( activity ) {
      await payWithoutUse(activity);
      const formula = riderFormula(activity);
      if ( formula ) markReactionDamage(weapon.uuid, formula, option.name);
    }
    activity = weapon;
  }
  if ( !activity ) return null;
  if ( option.approach && target && approachSource ) {
    await approachSource(actor, await fromUuid(target), activity).catch(err => console.error(`${MODULE_ID} | reaction approach`, err));
  }
  // §19.6: "… against that enemy, with Advantage" (Riposte) — mark read at the next roll, on this client.
  if ( option.advantage ) markReactionAdvantage(option.activity, option.name);
  // §134: Quick — the Opportunity Attack against this bearer has Disadvantage (mark read at the roll, like the Advantage above).
  if ( option.hampered && activity?.uuid ) markReactionDisadvantage(activity.uuid, option.hampered);
  // Marked confirmed (the question has just been asked) and paid by the Reaction, whatever
  // its activation type: an Opportunity Attack is a weapon action used as a Reaction.
  // §34: a Reaction does not place a template in the middle of a window (Protective Flare: "a 30-foot Emanation to spot",
  // `prompt: true`) — dnd5e would wait for the placement click (activity/mixin.mjs:451, 833) and the window would stay blocked.
  // §38: `consume: false` — the Reaction consumes nothing by itself (Projected Aegis: the pool pays the damage).
  // §67 bis: an attack against the source — dnd5e rolls the attack roll right after the use (attack.mjs:68,
  // `_triggerSubsequentActions`) reading the user's targets at that moment (attack.mjs:84); the resolution of the action
  // that opened the window may have released them in the meantime, and the roll went off with no target (nothing to
  // resolve). The roll is therefore made here, its target written in the message.
  const aimed = (activity?.type === "attack") ? targetDescriptors(target ? await fromUuid(target) : null) : null;
  // §211: a readied action (Ready) — the concentration effect that held the spell falls before it goes off; the spell goes off
  // without a slot, at the level spent (`usage`), and its area is placed (`template`: the window does not wait for a resolution).
  // §471: only an effect of the reactor itself (the concentration effect that held the spell), never another document.
  for ( const uuid of option.drop ?? [] ) {
    const held = await fromUuid(uuid);
    if ( (held?.documentName === "ActiveEffect") && actor && (held.parent?.uuid === actor.uuid) ) await held.delete();
    else console.warn(`${MODULE_ID} | reaction of ${actor?.name}: ${uuid} is not one of their effects, not removed`);
  }
  // §403: a spell cast as a Reaction (Counterspell, Shield) can itself be countered — the gate consults the enemies who see
  // it; countered, it does not go off (the Reaction is lost, the slot is not) and the window that opened it goes on as if
  // without a Reaction.
  if ( reactionSpellGate && isSpellCast(activity.item) ) {
    const goes = await reactionSpellGate(activity, actor).catch(err => { console.error(`${MODULE_ID} | counter-counterspell`, err); return true; });
    if ( goes === false ) return null;
  }
  const results = await activity.use({ [MODULE_ID]: { confirmed: true }, ...(option.template ? {} : { create: { measuredTemplate: false } }),
    ...(option.consume === false ? { consume: false } : {}), ...(option.usage ?? {}),
    ...(aimed ? { subsequentActions: false } : {}) }, { configure: false }, {
    data: { flags: { [MODULE_ID]: { cost: option.free ? "free" : "reaction", reaction: true, ...(option.reduce ? { reduceOnly: true } : {}), ...(option.flags ?? {}) } } }
  });
  if ( results && aimed ) activity.rollAttack({}, {}, { data: { system: { origin: results.message?.id, targets: aimed } } });
  // §24: Parry — the activity's roll (a heal in the data, which the engine does not apply: `reduceOnly`) is the amount removed
  // from the attack's damage. dnd5e rolls it by itself on use (heal.mjs:60); it is awaited a little.
  let reduce = 0;
  if ( results && option.reduce ) {
    const usage = results.message?.id;
    for ( let waited = 0; usage && !reduce && (waited < 8000); waited += 200 ) {
      const roll = game.messages.contents.findLast(m => ["healing", "damage"].includes(m.type) && (m._source.system?.origin === usage));
      reduce = Math.max(0, (roll?.rolls ?? []).reduce((sum, r) => sum + (r.total ?? 0), 0));
      if ( !reduce ) await new Promise(resolve => setTimeout(resolve, 200));
    }
    // §31: the bonus the rule adds to the data's roll (Stone's Endurance: + Constitution).
    if ( reduce && option.reduceBonus ) {
      try { reduce += Number(Roll.safeEval(Roll.replaceFormulaData(option.reduceBonus, actor.getRollData()))) || 0; }
      catch { /* formule illisible : le jet seul */ }
    }
  }
  // §33: Cutting Words — the die subtracted from the attack roll (runtime/reactions.mjs adds it to the AC to judge again);
  // §36: Cosmic Omen, Fortune — the die added to the ally's attack roll.
  const penalty = (results && option.penalty) ? await rollInClear(actor, option.penalty, "DND5ECOMBAT.Penalite", option.name) : 0;
  const bonus = (results && option.bonus) ? await rollInClear(actor, option.bonus, "DND5ECOMBAT.Bonus", option.name) : 0;
  // §66: 2014-style Counterspell (`counter`) — the one who counters makes their check, here, with their dice; the gate
  // (runtime/gates.mjs) reads the answer instead of waiting for a save from the caster.
  const counter = (results && (castLevel !== null)) ? await resolveCounter(actor, activity.item, castLevel) : null;
  return results ? { counter, reduce, penalty, bonus, disadvantage: option.disadvantage === true, used: option.activity, name: option.name, message: results.message?.id ?? null, halve: option.halve === true,
    resist: option.resist === true,
    uncrit: option.uncrit === true, miss: option.miss === true, reroll: option.reroll === true, absorb: option.absorb === true, interpose: option.interpose === true,
    endCondition: option.endCondition === true, cancel: option.cancel === true,
    cancelForSelf: option.cancelForSelf ? { ifSourceFails: option.cancelForSelf.ifSourceFails === true } : null, intercept: option.intercept === true, redirect: option.redirect === true } : null;
}

/** §88: spends what the activity consumes in item uses (Riposte: a superiority die), without using it. */
export async function payWithoutUse(activity) {
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    const item = t.target ? activity.actor?.items.get(t.target) : activity.item;
    if ( !item?.system.uses?.max ) continue;
    const cost = Number(t.value) || 1;
    await spendItemUses(item, cost);
  }
}

/** §88: the formula of the activity's first damage part, read with the actor's data ("@scale…die" → "1d8"). */
function riderFormula(activity) {
  const part = activity?.damage?.parts?.[0];
  if ( !part ) return null;
  const raw = part.custom?.enabled ? part.custom.formula : (part.number && part.denomination ? `${part.number}d${part.denomination}` : null);
  return raw ? Roll.replaceFormulaData(raw, activity.getRollData?.() ?? activity.actor?.getRollData() ?? {}) : null;
}

/** A Reaction die rolled openly (its card in the chat); its total, 0 if the formula is unreadable. */
async function rollInClear(actor, formula, flavorKey, item) {
  try {
    const roll = await new Roll(formula, actor.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: game.i18n.format(flavorKey, { item }) });
    return roll.total;
  } catch(err) {
    console.warn(`${MODULE_ID} | ${item}: unreadable die`, err);
    return 0;
  }
}

/** A token's current AC, as the system describes it on an attack message (targets-field.mjs:38). */
export async function currentAc(tokenUuid) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  return actor.statuses.has("coverTotal") ? null : actor.system.attributes?.ac?.value ?? null;
}
