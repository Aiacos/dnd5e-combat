/**
 * The Barbarian (SPEC §22): what dnd5e does not hold of Rage, and Reckless Attack.
 *
 *  - Rage kept up (active GM): taking Rage, attacking an enemy, imposing a save on an enemy mark the turn
 *    (`rageKept`); at the end of its turn, a Rage neither kept up nor fed by a Bonus Action ends (except Persistent Rage).
 *    It also ends when the barbarian becomes Incapacitated (Unconscious only with Persistent Rage). Taking Rage ends
 *    Concentration; in Rage, a spell is a legality matter (runtime/turn.mjs).
 *  - Relentless Rage (active GM): at 0 HP in Rage, the item's Constitution save, rolled by the engine; if passed, HP
 *    become twice the Barbarian level (a use spent: the DC rises by 5); if failed, Rage stops and they fall.
 *  - Reckless Attack (author's client): on the first Strength attack of its turn, the question; the use is suspended then
 *    relaunched with the answer (`usageConfig["dnd5e-combat"].reckless`, which an intent can also give in advance). Yes: a
 *    "Reckless Attack" mark (adapter/mastery.mjs) until the start of its next turn.
 */

import { MODULE_ID } from "../constants.mjs";
import { isRaging, barbarianRule, statusEndsRage, endRage, keepRage, rageKeptOn, relentlessAtZero, recklessChoice } from "../adapter/rage.mjs";
import { markData, marksOn } from "../adapter/mastery.mjs";
import { combatantFor, isOwnTurn, readBudget, currentTurnKey, usageTokenOf, speakerTokenOf, turnKeyAt } from "../adapter/turn.mjs";
import { ensureDowned, AFTER_ZERO_HP_MS } from "../adapter/death.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { tokenOf, originItemOf } from "../adapter/facts.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep, say, locEsc } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { spendItemUses } from "../adapter/uses.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { STEPS } from "../core/action.mjs";
import { relaunchUse } from "./relaunch.mjs";

/** Is one of the message's targets hostile to this token? */
function hostileTarget(message, token) {
  return (message.system?.targets ?? []).some(t => {
    const target = fromUuidSync(t.token ?? "", { strict: false });
    return target && areEnemies(token, target);
  });
}

async function stopRage(actor, why) {
  if ( !(await endRage(actor)) ) return;
  const token = tokenOf(actor);
  if ( token ) notice(token, loc("Rage.Retour"), "effectOff");
  await say({ actor }, locEsc("Rage.Fin", { name: actor.name, why: loc(`Rage.Pourquoi.${why}`) }), { rageEnded: { actor: actor.uuid, why } });
  log(`${actor.name}: Rage ends (${why})`);
}

/* -------------------------------------------- */
/*  Rage entretenue                             */
/* -------------------------------------------- */

async function onMessage(message) {
  const token = speakerTokenOf(message);
  const actor = token?.actor ?? message.getAssociatedActor?.();
  if ( !actor ) return;
  if ( message.type === "usage" ) {
    const activity = message.getAssociatedActivity?.();
    // Taking Rage: "you can't maintain Concentration".
    if ( activity?.item && contentOf(activity.item).entry?.rage ) {
      await keepRage(actor);
      if ( actor.concentration?.effects?.size ) await actor.endConcentration();
      return;
    }
    // "Impose a saving throw on an enemy".
    if ( isRaging(actor) && token && (activity?.type === "save") && hostileTarget(message, token) ) await keepRage(actor);
    return;
  }
  // "Make an attack roll against an enemy".
  if ( (message.type === "attack") && token && isRaging(actor) && hostileTarget(message, token) ) await keepRage(actor);
}

function onTurnEnd(combat, prior) {
  const combatant = combat.combatants.get(prior?.combatantId);
  const actor = combatant?.actor;
  if ( !actor || !isRaging(actor) || barbarianRule(actor, "persistentRage") ) return;
  const priorKey = turnKeyAt(combat, prior);
  // "Take a Bonus Action to keep Rage up": the Bonus Action spent this turn.
  const bonusSpent = (readBudget(combatant)?.bonus ?? 1) < 1;
  if ( (rageKeptOn(actor) === priorKey) || bonusSpent ) return;
  return enqueue(`rage:${actor.uuid}`, () => stopRage(actor, "entretien"));
}

function onEffectCreated(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || !effect.statuses?.size || !isRaging(actor) ) return;
  if ( !statusEndsRage(actor, effect.statuses) ) return;
  // At 0 HP with Relentless Rage, the save decides first (the Unconscious that dnd5e sets will be removed if it succeeds).
  if ( ((actor.system.attributes?.hp?.value ?? 1) <= 0) && relentlessAtZero(actor) ) return;
  return enqueue(`rage:${actor.uuid}`, () => stopRage(actor, "etat"));
}

/* -------------------------------------------- */
/*  Rage implacable                             */
/* -------------------------------------------- */

function onZero(actor) {
  if ( !actor || !relentlessAtZero(actor) ) return;
  return enqueue(`rage:${actor.uuid}`, async () => {
    await sleep(AFTER_ZERO_HP_MS);
    const found = relentlessAtZero(actor);
    if ( !found || ((actor.system.attributes?.hp?.value ?? 1) > 0) ) return;
    const dc = found.activity.save?.dc?.value ?? 10;
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
      { data: { flavor: loc("Rage.ImplacableCarte", { name: actor.name, dc }), flags: { [MODULE_ID]: { relentless: { actor: actor.uuid, dc } } } } });
    const total = rolls?.[0]?.total;
    if ( Number.isFinite(total) && (total >= dc) ) {
      const hp = 2 * (actor.classes?.barbarian?.system?.levels ?? 1);
      await spendItemUses(found.item);
      await actor.update({ "system.attributes.hp.value": hp });   // HP > 0: Unconscious, failures and Stable removed (runtime/death.mjs)
      const token = tokenOf(actor);
      if ( token ) notice(token, loc("Rage.Implacable", { name: actor.name, hp }), "gain");
      log(`Relentless Rage: ${actor.name} succeeds (${total} vs DC ${dc}) and stays up at ${hp} HP`);
      return;
    }
    log(`Relentless Rage: ${actor.name} fails (${total} vs DC ${dc})`);
    await stopRage(actor, "etat");
    await ensureDowned(actor);
  });
}

/* -------------------------------------------- */
/*  Reckless Attack                             */
/* -------------------------------------------- */

/** Puts the Reckless Attack mark on the attacker (its client, which owns the actor). */
async function beReckless(actor, token) {
  if ( !token || marksOn(actor, "reckless").length ) return;
  const found = barbarianRule(actor, "reckless");
  await actor.createEmbeddedDocuments("ActiveEffect", [markData("reckless", { source: token, target: token, weapon: found?.item ?? null, turnKey: currentTurnKey() })]);
  notice(token, loc("Botte.Retour.reckless"), "gain");
  log(`${actor.name}: Reckless Attack until the start of their next turn`);
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || (activity.ability !== "str") || !barbarianRule(actor, "reckless") ) return true;
  const combatant = combatantFor(actor);
  if ( !combatant || !isOwnTurn(combatant) ) return true;
  const token = usageTokenOf(activity);
  const decided = usageConfig?.[MODULE_ID]?.reckless;
  const record = reckless => actor.setFlag(MODULE_ID, "recklessTurn", { key: currentTurnKey(), reckless })
    .then(() => (reckless ? beReckless(actor, token) : null));
  if ( typeof decided === "boolean" ) {
    if ( recklessChoice(actor) === null ) record(decided).catch(err => console.error(`${MODULE_ID} | Reckless Attack`, err));
    return askBrutal(activity, token, decided, usageConfig, dialogConfig, messageConfig);
  }
  if ( recklessChoice(actor) !== null ) return askBrutal(activity, token, recklessChoice(actor), usageConfig, dialogConfig, messageConfig);   // decided this turn
  // The targets of the suspended use restart with the relaunch (a caller may have released them in the meantime).
  const targets = Array.from(game.user.targets);
  timedWait({
    window: { title: loc("Rage.Temerite.Titre", { name: actor.name }) },
    content: `<p>${loc("Rage.Temerite.Question")}</p>`,
    buttons: [
      { action: "yes", label: loc("Rage.Temerite.Oui"), icon: "fa-solid fa-fire", default: true },
      { action: "no", label: loc("Rage.Temerite.Non") }
    ]
  }, { fallback: "no" }).then(async choice => {
    const reckless = choice === "yes";
    await record(reckless);
    if ( !game.user.targets.size ) for ( const t of targets ) t.setTarget(true, { releaseOthers: false });
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), reckless } };
    relaunchUse(activity, config, dialogConfig, messageConfig);
  }).catch(err => console.error(`${MODULE_ID} | Reckless Attack`, err));
  return false;
}

/* -------------------------------------------- */
/*  Coup brutal (C12-e)                          */
/* -------------------------------------------- */

/**
 * Brutal Strike (Barbarian 9): "if you use Reckless Attack, you can forgo any Advantage on one Strength-based attack roll of your
 * choice on your turn; if it hits, the target takes 1d10 extra damage of the weapon's type, and you cause a Brutal Strike effect".
 * Once per turn. Improved Brutal Strike (13) adds two effects; (17): 2d10 (the subclass's scale), two different effects.
 * The options, their push or effect: the content (`brutalStrike`), gathered from all the actor's items.
 * The choice puts a mark on the barbarian, tied to the activity: the Advantage is forgone at the roll (runtime/conditions.mjs),
 * the damage added by its declaration (content/barbarian.mjs), the effects placed at resolution by the active GM, then the
 * mark falls.
 */
function brutalRules(actor) {
  const options = new Map();
  let count = 0;
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.brutalStrike;
    if ( !rule ) continue;
    for ( const [name, option] of Object.entries(rule.options ?? {}) ) options.set(name, { item, ...option });
    count = Math.max(count, rule.count ?? 1);
  }
  return options.size ? { options, count } : null;
}

/** §433: the item and effect of an option — the first of the given identifiers that a Brutal Strike item of the actor carries. */
function brutalEffectOf(actor, option) {
  const items = [option.item, ...Array.from(actor?.items ?? []).filter(i => (i !== option.item) && contentOf(i).entry?.brutalStrike)];
  for ( const effect of [option.effect].flat() ) {
    const item = items.find(i => i?.effects?.has?.(effect));
    if ( item ) return { item, effect };
  }
  return null;
}

/** The choices offered: one option, or two different ones (Improved Brutal Strike, level 17). */
function brutalChoices(names, count) {
  if ( count < 2 ) return names.map(n => [n]);
  const out = [];
  for ( let i = 0; i < names.length; i++ ) for ( let j = i + 1; j < names.length; j++ ) out.push([names[i], names[j]]);
  return out;
}

const brutalLabel = names => names.map(n => loc(`CoupBrutal.Option.${n}`)).join(" + ");

async function markBrutal(actor, activity, options) {
  const item = actor.items.find(i => contentOf(i).entry?.brutalStrike && (identifierOf(i).id === "brutal-strike")) ?? actor.items.find(i => contentOf(i).entry?.brutalStrike);
  const created = actor.createEmbeddedDocuments("ActiveEffect", [{ name: loc("CoupBrutal.Marque", { options: brutalLabel(options) }), img: item.img, origin: item.uuid,
    transfer: false, disabled: false, changes: [], flags: { [MODULE_ID]: { brutalStrike: { activity: activity.uuid, options } } } }]);
  await actor.setFlag(MODULE_ID, "brutalTurn", currentTurnKey());
  await created;
  log(`${actor.name}: Brutal Strike (${options.join(", ")}) — no Advantage on this attack`);
}

function askBrutal(activity, token, reckless, usageConfig, dialogConfig, messageConfig) {
  const actor = activity.actor;
  if ( !reckless ) return true;
  const rules = brutalRules(actor);
  if ( !rules ) return true;
  const decided = usageConfig?.[MODULE_ID]?.brutal;
  // Decided in advance by an intent (`brutal: ["forceful"]`): the mark goes out before the use message (the server handles
  // requests in order), so before the attack roll.
  if ( Array.isArray(decided) ) {
    if ( decided.length && (actor.getFlag(MODULE_ID, "brutalTurn") !== currentTurnKey()) ) markBrutal(actor, activity, decided).catch(err => console.error(`${MODULE_ID} | Brutal Strike`, err));
    return true;
  }
  if ( (decided === false) || (decided === "marked") ) return true;   // "marked": the mark is placed (relaunch after the question)
  if ( actor.getFlag(MODULE_ID, "brutalTurn") === currentTurnKey() ) return true;   // once per turn
  const choices = brutalChoices([...rules.options.keys()], rules.count);
  const targets = Array.from(game.user.targets);
  timedWait({
    window: { title: loc("CoupBrutal.Titre", { name: actor.name }) },
    content: `<p>${loc("CoupBrutal.Question")}</p>`,
    buttons: [
      ...choices.map((names, i) => ({ action: `b${i}`, label: brutalLabel(names) })),
      { action: "no", label: loc("CoupBrutal.Non"), default: true }
    ]
  }, { fallback: "no" }).then(async choice => {
    const picked = (choice && (choice !== "no")) ? (choices[Number(choice.slice(1))] ?? []) : [];
    if ( picked.length ) await markBrutal(actor, activity, picked);
    if ( !game.user.targets.size ) for ( const t of targets ) t.setTarget(true, { releaseOthers: false });
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), reckless, brutal: picked.length ? "marked" : false } };
    relaunchUse(activity, config, dialogConfig, messageConfig);
  }).catch(err => console.error(`${MODULE_ID} | Brutal Strike`, err));
  return false;
}

/** Active GM: the marked attack is resolved — on a hit, the chosen effects; then the mark falls. */
async function onBrutalResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const marker = actor?.effects?.find(e => e.getFlag(MODULE_ID, "brutalStrike")?.activity === resolution.activity);
  if ( !marker ) return;
  const { options } = marker.getFlag(MODULE_ID, "brutalStrike");
  const rules = brutalRules(actor);
  const source = tokenOf(actor);
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor ) continue;
    for ( const name of options ) {
      const option = rules?.options.get(name);
      if ( !option ) continue;
      if ( option.push && source ) {
        const { cells } = await pushAway(source, target, option.push, readUnitFactors());
        log(`Brutal Strike, ${name}: ${target.name} pushed ${cells} square(s)`);
      }
      if ( option.effect ) {
        // §433: the option's effect is on the item that declares it (Improved Brutal Strike) or, in dnd5e 6.1's SRD, on Brutal
        // Strike.
        const from = brutalEffectOf(actor, option);
        const placed = from ? await placeItemEffect(from.item, from.effect, target.actor) : null;
        log(placed ? `Brutal Strike, ${name}: effect placed on ${target.name}` : `Brutal Strike, ${name}: no effect of this option on ${actor.name}'s items`);
      }
      notice(target, loc(`CoupBrutal.Option.${name}`), "loss");
    }
  }
  await marker.delete();
}

/**
 * §299 (pass C4): the abilities held by Rage (`duringRage`). The active GM brings in line, at each effect change of the actor,
 * what they carry of the Rage state:
 *  - `enable`: effects transferred from the item, active during Rage only ("Blind Rage": Immunity to Charmed and Frightened);
 *  - `post`: item effects placed on the barbarian during Rage, removed at its end (Primal Knowledge);
 *  - `copiesEnd`: the copies that the item's activities placed on them fall with Rage ("Predator's Rage": the Bear, the Wolf);
 *  - `disable`: transferred effects that the data wrongly leaves active (Rage of the Bear, always active outside Rage);
 *  - `cures`: on entering Rage, these conditions cease ("Blind Rage");
 *  - `onStart`: the item's activity played on entering Rage (Vitality of the Tree: Temporary Hit Points).
 */
const DURING_RAGE_FLAG = "duringRage";

async function syncDuringRage(actor) {
  if ( (actor?.documentName !== "Actor") || !game.users.activeGM?.isSelf ) return;
  const raging = isRaging(actor);
  const was = !!actor.getFlag(MODULE_ID, DURING_RAGE_FLAG);
  // No more abilities held by Rage (removed during a Rage): the entry mark must not survive, otherwise the next entry
  // into Rage would not be seen as such.
  if ( !actor.items.some(i => contentOf(i).entry?.duringRage) ) {
    if ( was ) await actor.unsetFlag(MODULE_ID, DURING_RAGE_FLAG);
    return;
  }
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.duringRage;
    if ( !rule ) continue;
    const toggles = [...(rule.enable ?? []).map(id => [id, !raging]), ...(rule.disable ?? []).map(id => [id, true])]
      .map(([id, disabled]) => ({ effect: item.effects.get(id), disabled }))
      // The data state (`_source`): dnd5e 6.0.6 prepares an effect carried by an activity as active (see adapter/rage.mjs).
      .filter(t => t.effect && (t.effect._source.disabled !== t.disabled));
    if ( toggles.length ) await item.updateEmbeddedDocuments("ActiveEffect", toggles.map(t => ({ _id: t.effect.id, disabled: t.disabled })));
    for ( const id of rule.post ?? [] ) {
      const source = item.effects.get(id);
      const copies = actor.effects.filter(e => source && ((e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid)));
      if ( raging && !copies.length && source ) await placeItemEffect(item, id, actor);
      if ( !raging && copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
    }
    if ( !raging && rule.copiesEnd ) {
      const copies = actor.effects.filter(e => !e.transfer && (originItemOf(e) === item)).map(e => e.id);
      if ( copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies);
    }
    if ( raging && !was ) {
      for ( const status of rule.cures ?? [] ) if ( actor.statuses?.has(status) ) await actor.toggleStatusEffect(status, { active: false });
      const start = rule.onStart ? item.system.activities?.get(rule.onStart) : null;
      if ( start ) await start.use({ [MODULE_ID]: { confirmed: true, cost: "free" } }, { configure: false }).catch(err => console.error(`${MODULE_ID} | ${item.name}`, err));
    }
    if ( toggles.length || (raging !== was) ) log(`${actor.name}: ${item.name} ${raging ? "with" : "without"} Rage`);
  }
  if ( raging !== was ) await actor.setFlag(MODULE_ID, DURING_RAGE_FLAG, raging);
}

const laterDuringRage = actor => (actor?.documentName === "Actor")
  && (actor.items.some(i => contentOf(i).entry?.duringRage) || actor.getFlag(MODULE_ID, DURING_RAGE_FLAG))
  ? enqueue(`duringRage:${actor.uuid}`, () => syncDuringRage(actor)) : null;

export function registerBarbarian() {
  // An item removed or added (an ability held by Rage): the same reconciliation.
  for ( const hook of ["createItem", "deleteItem"] ) route(hook, item => laterDuringRage(item.parent), { executor: true, label: "features held by Rage not synced" });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => laterDuringRage((effect.parent?.documentName === "Item") ? effect.parent.parent : effect.parent),
      { executor: true, label: "features held by Rage not synced" });
  }
  route("createChatMessage", message => (["usage", "attack"].includes(message.type) ? onMessage(message) : null),
    { executor: true, label: "Rage: upkeep not recorded" });
  route("combatTurnChange", onTurnEnd, { executor: true, label: "Rage: end not evaluated" });
  route("createActiveEffect", onEffectCreated, { executor: true, label: "Rage: end on condition not evaluated" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, "system.attributes.hp.value") === 0 ) return onZero(actor);
  }, { executor: true, label: "Relentless Rage not played" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, "delta.system.attributes.hp.value") === 0 ) return onZero(token.actor);
  }, { executor: true, label: "Relentless Rage not played (unlinked token)" });
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "Reckless Attack: prompt" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`brutal:${resolution?.id}`, () => onBrutalResolution(resolution)), { executor: true, label: "Brutal Strike: effects not applied" });
}
