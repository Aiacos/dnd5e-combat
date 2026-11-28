import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { opportunityAttackers, opportunityMisses, entersAt, reachStrikers } from "../core/reaction.mjs";
import { alertGM } from "./gm-alert.mjs";
import {
  REACTION_QUERY, handleReactionQuery, setReactionApproach, reactionOptions, reactionState, meleeAttacksOf, reactiveStrikesOf, reactiveSpellsOf, askReaction, currentAc, opportunityBlocked
} from "../adapter/reactions.mjs";
import { combatantFor, readBudget, distanceBetween, positionOf as position, turnKeyAt } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { canSee } from "../adapter/vision.mjs";
import { victimsOf } from "../adapter/grapple.mjs";
import { pilotOf } from "../adapter/pilot.mjs";
import { avoidsOpportunity } from "../adapter/opportunity.mjs";
import { current } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, tokenOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { duplicatesAgainst } from "../adapter/duplicates.mjs";
import { announce, matching } from "./triggers.mjs";
import { route } from "./router.mjs";
import { log, loc, sleep, notice, say } from "./shared.mjs";
import { levelAtLeast } from "./levels.mjs";
import { reactionApproach } from "./actions.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { poolsOf } from "../adapter/absorb.mjs";
import { takeReactionDamage, noteReactionAttack } from "../adapter/marks.mjs";
import { areEnemies, areSworn, sideOf } from "../adapter/factions.mjs";
import { readyPlanOf, readyTriggered } from "../core/ready.mjs";
import { readyOption } from "../adapter/ready.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { offerCombatInspirationDefense, hasCombatInspiration } from "../adapter/inspiration.mjs";
import { targetDescriptorsOf } from "../adapter/pick-targets.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { resaveChosen } from "./resave-choice.mjs";
import { forceReroll } from "./forced-reroll.mjs";
import { settledResolution } from "../adapter/messages.mjs";
import { areaShapeOf, sparedFromArea } from "../core/area-shield.mjs";
import { turnResistanceChanges } from "../core/turn-resistance.mjs";
import { attackDamageTypes } from "../adapter/smite.mjs";

/** §134: Mobile — the name of the item that gives Disadvantage to Opportunity Attacks against this actor, or null. */
export function hamperedBy(actor) {
  return Array.from(actor?.items ?? []).find(i => {
    const rule = contentOf(i).entry?.opportunityDisadvantage;
    if ( rule === true ) return true;
    // O9g (§362): Boots of Speed — as long as the "clicked heels" effect applied by the item's activity is on the bearer.
    return !!rule?.whileEffect && (actor.effects ?? []).some(e => !e.disabled && (originItemOf(e) === i) && comesFromItemEffect(e, rule.whileEffect));
  })?.name ?? null;
}

/** The Reactions an actor can offer in a window, according to the registry. `publish`: the moment really takes place. */
function reactionsOf(actor, window, context={}, { publish=false }={}) {
  const full = { actor, ...context };
  if ( publish ) announce(window, full);
  return reactionOptions(actor, window, matching(window, full));
}

/** Does this creature have anything to react with if hit? Consulted before opening a window: with no candidate, no waiting. */
export async function canReactToHit(tokenUuid, { activity=null, source=null }={}) {
  const token = await fromUuid(tokenUuid);
  const actor = token?.actor;
  // §74: with the attack when it is known — without it, a condition on the attack ("in melee") never held, and the
  // window did not open (Parry from the Monster Manual, seen on 2026-10-04).
  const context = activity ? { activity, source, target: actor, targetToken: token } : {};
  // §133: the guardians with the attacker — without it, a condition on its position (Sentinel: "a creature within 5 feet of you")
  // never held, and the window did not open when the target itself had no Reaction.
  // Survey of the gaps: the Combat Inspiration of a Bard of Valor (adapter/inspiration.mjs) also opens the window.
  return !!actor && ((reactionsOf(actor, "isHit", context).length > 0) || (guardiansOf(token, tokenOf(source), activity).length > 0)
    || hasCombatInspiration(actor));
}

/**
 * §19.9: who can react for ANOTHER creature that is hit (Sentinel at the threshold of death: oneself, or a Bloodied creature
 * visible within 60 feet at most). Among the scene's creatures, living, not hostile to it, other than the attacker.
 * @returns {Array<{token: TokenDocument, options: object[]}>}
 */
function guardiansOf(hitToken, attackerToken, activity, { publish=false, resolution=null }={}) {
  const target = hitToken?.actor;
  if ( !target || !hitToken.parent ) return [];
  const out = [];
  for ( const other of hitToken.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === hitToken) || (other === attackerToken) || isObjectToken(other) ) continue;
    if ( areEnemies(other, hitToken) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const options = reactionsOf(actor, "allyIsHit", { source: attackerToken?.actor ?? null, target, activity, resolution,
      self: actor, selfToken: other, sourceToken: attackerToken, targetToken: hitToken }, { publish });
    if ( options.length ) out.push({ token: other, options });
  }
  return out;
}

/** C12-f: the save against the Reaction failed by the attacker, under a `retort` rule of its item — the retort is noted on the bearer. */
async function noteRetort(actor, resolution, messageId, source) {
  const message = game.messages.get(messageId);
  const item = message?.getAssociatedActivity?.()?.item;
  const rule = item ? contentOf(item).entry?.retort : null;
  if ( !rule ) return;
  // The Reaction's resolution may be returned before the save is rolled: we wait for its result (10 s at most).
  const saves = () => (game.messages.get(messageId)?.getFlag(MODULE_ID, "resolution")?.targets ?? []).filter(t => typeof t.save?.success === "boolean");
  for ( let n = 0; (n < 40) && !saves().length; n++ ) await sleep(250);
  if ( !saves().length ) { log(`${item.name}: the attacker's saving throw was not read, no damage back`); return; }
  const failed = saves().some(t => t.save.success === false);
  if ( !failed ) { log(`${item.name}: the attacker made its saving throw, no damage back`); return; }
  await actor.setFlag(MODULE_ID, "retort", { resolution: resolution.id, source: tokenOf(source)?.uuid ?? null, type: rule.damageType, item: item.name });
  log(`${item.name}: the attacker failed its saving throw, it will take the damage ${actor.name} takes`);
}

/**
 * `resist` step: an effect on the reactor, which gives it Resistance to the damage types of the blow it just received "and to
 * any other damage of the same type until the end of the current turn" — removed on turn change (`untilTurnChange` flag,
 * runtime/feats.mjs). Applied during the "hit" window, hence before the damage roll: dnd5e applies it by itself.
 */
async function grantTurnResistance(actor, activity, answer) {
  const traits = actor.system?.traits ?? {};
  const changes = turnResistanceChanges(attackDamageTypes(activity),
    { resisted: traits.dr?.value ?? [], immune: traits.di?.value ?? [] });
  if ( !changes.length ) return;
  const item = answer.used ? (await fromUuid(answer.used))?.item : null;
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: answer.name, img: item?.img ?? "icons/svg/shield.svg",
    origin: item?.uuid ?? null, transfer: false, disabled: false, system: { changes },
    flags: { [MODULE_ID]: { untilTurnChange: true } } }]);
  log(`${actor.name}: ${answer.name}, Resistance to ${changes.map(c => c.value).join(", ")} until the end of this turn`);
}

/**
 * `askReactions` command of the action machine, "hit" window: each hit target that has
 * something to react with (Shield) is consulted, one after the other. The resolution is already written
 * (`awaitingReaction` step): we can wait. If it reacts, we let ITS own action
 * resolve (its effects on itself are the plan of its use message), then we read its
 * new AC; it is the core that re-judges.
 * @param {object} resolution
 * @param {string[]} tokens
 * @param {(carrierId: string) => Promise} drained  Waits for the end of another bearer's resolution.
 * @returns {Promise<object[]>}  One `reactionResolved` event per consulted target.
 */
export async function askHitReactions(resolution, tokens, drained, { auto=null }={}) {
  const events = [];
  const source = await fromUuid(resolution.source ?? "");
  const attacker = source?.name ?? "";
  const activity = await fromUuid(resolution.activity ?? "");
  for ( const tokenUuid of tokens ) {
    const target = resolution.targets.find(t => t.token === tokenUuid);
    const actor = (await fromUuid(tokenUuid))?.actor;
    // `auto` (scenarios: the attack's `autoReact`): "none" = nobody reacts; "first" = the first Reaction, with no window.
    const options = (actor && (auto !== "none")) ? reactionsOf(actor, "isHit", { source, target: actor, activity, resolution }, { publish: true }) : [];
    let answer = null;
    let reactor = actor;   // §489: the one who reacted (the target, or the ally who did it for it)
    if ( options.length ) {
      log(`${target?.name} is hit: reaction window (${options.map(o => o.name).join(", ")})`);
      answer = await askReaction(actor, {
        actor: actor.uuid,
        prompt: { key: "ReactionTouche", data: { attacker, total: resolution.attack.roll.total } },
        options,
        // §29: a Reaction that targets the attacker (Beguiling Defenses: its Wisdom saving throw).
        target: options.some(o => o.targetSource) ? (tokenOf(source)?.uuid ?? null) : null,
        auto: auto === "first"
      });
    }
    if ( answer?.message ) await drained(answer.message);
    // C12-f: Beguiling Defenses (`retort`) — the attacker who failed the Reaction's save will take, on application, damage equal
    // to what the bearer will have taken (after halving): noted on the bearer for this resolution (runtime/engine-commands.mjs).
    if ( answer?.message && actor ) await noteRetort(actor, resolution, answer.message, source);
    // §19.9: if it did not reduce the damage itself, an ally can do it for it (Sentinel at the threshold of death) —
    // the first who accepts; its Reaction, its uses.
    if ( !answer?.halve && !answer?.reduce && (auto !== "none") ) {
      const hitToken = await fromUuid(tokenUuid);
      const attackerToken = tokenOf(source);
      for ( const guardian of guardiansOf(hitToken, attackerToken, activity, { publish: true, resolution }) ) {
        log(`${target?.name} is hit: ${guardian.token.name} can react for them (${guardian.options.map(o => o.name).join(", ")})`);
        const help = await askReaction(guardian.token.actor, {
          actor: guardian.token.actor.uuid,
          prompt: { key: "ReactionAllieTouche", data: { name: target?.name ?? "", attacker, total: resolution.attack.roll.total } },
          options: guardian.options,
          // §133: a retort against the attacker (Sentinel) targets the source; else the creature hit (Sentinel at death's door).
          target: guardian.options.some(o => o.targetSource) ? (attackerToken?.uuid ?? tokenUuid) : tokenUuid,
          auto: auto === "first"
        });
        if ( help?.message ) await drained(help.message);
        // §301: or reduced (Interception, Protective Field).
        if ( !help?.halve && !help?.penalty && !help?.reduce && !help?.reroll ) continue;
        answer = help;
        reactor = guardian.token.actor;
        break;
      }
    }
    // Survey of the gaps: Combat Inspiration, Defense — if nothing else reacted, the Bard of Valor's die added to the AC.
    const inspired = (!answer && (auto !== "none")) ? await offerCombatInspirationDefense(actor, { total: resolution.attack?.roll?.total,
      ac: await currentAc(tokenUuid) + (target?.cover?.bonus ?? 0), critical: target?.critical === true, auto: auto === "first" }) : 0;
    if ( inspired ) { answer = { name: game.i18n.localize("DND5ECOMBAT.Inspiration.Nom"), penalty: inspired }; log(`${target?.name}: Combat Inspiration, +${inspired} AC`); }
    // §33: Cutting Words — the die subtracted from the roll is worth as much AC for this re-judging.
    const ac = await currentAc(tokenUuid) + (target?.cover?.bonus ?? 0) + (Number(answer?.penalty) || 0);   // l'abri du verdict reste acquis
    if ( answer?.penalty ) log(`${target?.name}: ${answer.name}, -${answer.penalty} to the attack roll`);
    // §19.6: Parry — +5 to AC against ONE attack only: the AC re-read, the item's effects drop (`forOneAttack`).
    if ( answer?.used ) await dropOneAttackEffects(actor, answer.used);
    if ( answer ) log(`${target?.name} reacts (${answer.name}): AC ${target?.ac} -> ${ac}`);
    if ( answer?.halve ) log(`${target?.name}: ${answer.name}, the attack's damage is halved`);
    // Hunter's Superior Defense: the Resistance to this blow's types, applied before the damage, until the turn changes.
    if ( answer?.resist && actor ) await grantTurnResistance(actor, activity, answer);
    // §19: the replicas the Reaction may have created (Spectral Shadows) count for this blow.
    const duplicates = answer ? duplicatesAgainst(actor, source) : null;
    if ( answer?.uncrit && target?.critical ) log(`${target?.name}: ${answer.name}, the Critical Hit becomes a normal hit`);
    if ( answer?.reduce ) log(`${target?.name}: ${answer.name}, the attack's damage is reduced by ${answer.reduce}`);
    if ( answer?.miss ) log(`${target?.name}: ${answer.name}, the attack automatically misses`);
    // §489: a monster's Parry — the attacker rerolls its roll and keeps the new one; the core re-judges this blow with it.
    const roll = (answer?.reroll && !answer?.miss) ? await forceReroll(resolution, target, reactor, answer.name, ac) : null;
    events.push({ type: "reactionResolved", token: tokenUuid, used: answer?.name ?? null, ac, halve: answer?.halve === true,
      miss: answer?.miss === true,
      reduce: Number(answer?.reduce) || 0,
      uncrit: answer?.uncrit === true, duplicates, ...(roll ? { roll } : {}) });
  }
  return events;
}

/**
 * §38: "an ally is about to take damage" window (Projected Aegis) — before application, for a creature about to lose HP: the
 * scene's creatures not hostile to it, other than it and the author, living, whose pool (`absorb`) is created and
 * not empty, and one of whose Reactions absorbs. The first who accepts wins: the uuid of its pool's item, which the
 * application passes to dnd5e (adapter/absorb.mjs). Active GM; `auto`: the `autoReact` scenario tool.
 * @returns {Promise<{item: string, reactor: string}|null>}
 */
export async function askDamageGuardians(targetUuid, sourceUuid, activity, { auto=null }={}) {
  if ( auto === "none" ) return null;
  const hurtToken = await fromUuid(targetUuid ?? "");
  const target = hurtToken?.actor;
  if ( !target || !hurtToken.parent ) return null;
  const attacker = sourceUuid ? await fromUuid(sourceUuid) : null;
  for ( const other of hurtToken.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === hurtToken) || (other === attacker) || isObjectToken(other) ) continue;
    if ( areEnemies(other, hurtToken) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const pool = poolsOf(actor).find(p => p.pool > 0);   // cheapest first: without a full aegis, no absorption
    // §78: an Interposition does not require a pool.
    const options = reactionsOf(actor, "allyIsDamaged", { source: attacker?.actor ?? null, target, activity, self: actor, selfToken: other,
      sourceToken: attacker, targetToken: hurtToken }, { publish: true }).filter(o => (o.absorb && pool) || o.interpose);
    if ( !options.length ) continue;
    log(`${hurtToken.name} is about to take damage: ${other.name} can react (${options.map(o => o.name).join(", ")}${pool ? `, pool ${pool.pool}` : ""})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionAllieBlesse", data: { name: hurtToken.name, attacker: attacker?.name ?? "" } },
      options,
      target: targetUuid,
      auto: auto === "first"
    });
    if ( answer?.absorb && pool ) return { item: pool.item.uuid, reactor: other.name };
    if ( answer?.interpose ) return { interpose: other.uuid, reactor: other.name };
  }
  return null;
}

/**
 * §493 (B13): "caught in an area" window (`inArea`, Insect Shield) — before application, for a creature about to lose
 * HP from an ANOTHER creature's area activity (`activity.areaShape`). The creature itself reacts (once, living); a
 * `cancelForSelf` Reaction spares only it: outright, or (`ifSourceFails`) when the author fails the save the Reaction imposes
 * on it — the Reaction's resolution is awaited, like that of Counterspell (runtime/gates.mjs). The chat card tells
 * everyone the outcome; a floating feedback and a sound accompany it. Active GM; `auto`: the `autoReact` scenario tool.
 * @returns {Promise<{spared: boolean, by: string}|null>}  null: no Reaction.
 */
export async function askAreaReactions(targetUuid, sourceUuid, activity, { auto=null }={}) {
  if ( (auto === "none") || !areaShapeOf(activity) ) return null;
  const caught = await fromUuid(targetUuid ?? "");
  const target = caught?.actor;
  if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) return null;
  const author = sourceUuid ? await fromUuid(sourceUuid) : null;
  const authorActor = author?.actor ?? activity?.actor ?? null;
  if ( !authorActor || (authorActor === target) ) return null;
  const options = reactionsOf(target, "inArea", { source: authorActor, target, activity, self: target, selfToken: caught,
    sourceToken: author, targetToken: caught }, { publish: true }).filter(o => o.cancelForSelf);
  if ( !options.length ) return null;
  const spell = activity?.item?.name ?? "";
  log(`${caught.name} is caught in ${authorActor.name}'s ${spell}: reaction window (${options.map(o => o.name).join(", ")})`);
  const answer = await askReaction(target, {
    actor: target.uuid,
    prompt: { key: "ReactionZone", data: { caster: author?.name ?? authorActor.name, spell } },
    options,
    target: author?.uuid ?? null,
    auto: auto === "first"
  });
  if ( !answer?.cancelForSelf ) return null;
  const ifSourceFails = answer.cancelForSelf.ifSourceFails === true;
  let sourceSave = null;
  if ( ifSourceFails ) {
    const reaction = answer.message ? await settledResolution(answer.message) : null;
    const entry = reaction?.targets?.find(t => t.token === author?.uuid) ?? reaction?.targets?.[0] ?? null;
    sourceSave = entry?.save ?? null;
  }
  const spared = sparedFromArea({ taken: true, ifSourceFails, sourceSave });
  const data = { name: caught.name, item: answer.name ?? "", caster: author?.name ?? authorActor.name, spell,
    total: sourceSave?.total ?? "—", dc: (await fromUuid(answer.used ?? ""))?.save?.dc?.value ?? "—" };
  log(`${caught.name} reacts (${answer.name}): ${ifSourceFails ? `${data.caster}'s saving throw ${data.total} vs DC ${data.dc} -> ` : ""}`
    + `${spared ? "no damage from the area" : "the area deals its damage"}`);
  await say({ token: caught }, loc(spared ? (ifSourceFails ? "ZoneEpargneSauvegarde" : "ZoneEpargne") : "ZoneSubie", data), {
    areaShield: { item: answer.name ?? null, reactor: caught.uuid, source: author?.uuid ?? null, activity: activity?.uuid ?? null,
      reaction: answer.message ?? null, ifSourceFails, save: sourceSave ? { total: sourceSave.total ?? null, success: sourceSave.success ?? null } : null, spared }
  });
  notice(caught, spared ? { key: "Retour.ZoneEpargne", data: { item: answer.name ?? "" } } : { key: "Retour.ZoneSubie", data: { item: answer.name ?? "" } },
    spared ? "gain" : "refused", { all: true, action: "areaShield", outcome: spared ? "success" : "failure" });
  return { spared, by: answer.name ?? "" };
}

/**
 * §301: fall windows, before damage is applied (dnd5e fall card, runtime/climb.mjs) — first the creature that falls
 * (`falls`: Slow Fall reduces the damage of its activity's roll), then the scene's creatures not hostile to it, other than
 * it, living (`allyFalls`: Feather Fall, which cancels it). The first that cancels wins; the reductions add up.
 * Active GM.
 * @returns {Promise<{reduce: number, cancel: boolean, by: string[]}>}
 */
export async function askFallReactions(fallToken, damage) {
  const out = { reduce: 0, cancel: false, by: [] };
  const target = fallToken?.actor;
  if ( !target || !fallToken.parent || !(damage > 0) ) return out;
  const asked = async (actor, window, context, prompt) => {
    const options = reactionsOf(actor, window, context, { publish: true });
    if ( !options.length ) return null;
    log(`${fallToken.name} is about to take ${damage} falling damage: ${actor.name} can react (${options.map(o => o.name).join(", ")})`);
    return askReaction(actor, { actor: actor.uuid, prompt, options, target: fallToken.uuid });
  };
  const own = await asked(target, "falls", { target, self: target, selfToken: fallToken, targetToken: fallToken },
    { key: "ReactionChute", data: { damage } });
  if ( own?.cancel ) return { ...out, cancel: true, by: [own.name] };
  if ( own?.reduce ) { out.reduce += Number(own.reduce) || 0; out.by.push(own.name); }
  for ( const other of fallToken.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === fallToken) || isObjectToken(other) || areEnemies(other, fallToken) ) continue;
    if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
    const help = await asked(actor, "allyFalls", { target, self: actor, selfToken: other, targetToken: fallToken },
      { key: "ReactionAllieChute", data: { name: fallToken.name, damage } });
    if ( help?.cancel ) return { ...out, cancel: true, by: [...out.by, help.name] };
    if ( help?.reduce ) { out.reduce += Number(help.reduce) || 0; out.by.push(help.name); }
  }
  return out;
}

/**
 * "Hurt" window: no effect on the resolution in progress, hence no waiting. The chosen
 * Reaction (Hellish Rebuke) targets the damage's author and follows its own course.
 * @param {string[]} tokenUuids  Targets that just lost HP.
 * @param {string|null} sourceToken
 * @param {string} sourceName
 * @param {{activity?: string|null, damageTypes?: string[], auto?: string|null}} [hurt]  What hurt: activity uuid,
 *   damage types; `auto`: the use's `autoReact` scenario tool, as for the "hit" window.
 */
export function windowIsDamaged(tokenUuids, sourceToken, sourceName, { activity=null, damageTypes=[], auto=null }={}) {
  fireTargetWindow("isDamaged", tokenUuids, sourceToken, sourceName,
    { activity, auto, extra: { damageTypes }, promptKey: "ReactionBlesse", what: "damaged" });
}

/**
 * A window opened for each target of a blow ("hurt", "missed"): without waiting, each on its own; a creature at 0 HP does not
 * react. `extra`: what the window adds to the facts (the damage types); `what`: the log's word.
 */
function fireTargetWindow(window, tokenUuids, sourceToken, sourceName, { activity=null, auto=null, extra={}, promptKey, what, hostile=false }) {
  if ( auto === "none" ) return;
  for ( const uuid of tokenUuids ) (async () => {
    const tokenDocument = await fromUuid(uuid);
    const actor = tokenDocument?.actor;
    if ( !actor || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const attackerToken = await fromUuid(sourceToken ?? "");
    // §487: `hostile` — only against another creature hostile to it (the save imposed by an ally opens nothing).
    if ( hostile && (!attackerToken || (attackerToken === tokenDocument) || !areEnemies(tokenDocument, attackerToken)) ) return;
    const used = activity ? await fromUuid(activity) : null;
    const options = reactionsOf(actor, window,
      { source: attackerToken?.actor ?? null, target: actor, activity: used, sourceToken: attackerToken, targetToken: tokenDocument, ...extra },
      { publish: true });
    if ( !options.length ) return;
    log(`${actor.name} is ${what}: reaction window (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: promptKey, data: { attacker: sourceName } },
      options,
      target: options.some(o => o.targetSource) ? sourceToken : null,
      auto: auto === "first"
    });
    if ( answer?.redirect ) await redirectAttack(used, attackerToken, tokenDocument);
  })().catch(err => console.error(`${MODULE_ID} | "${what}" window interrupted`, err));
}

/**
 * §375: Flesh Shield — "the creature makes the same attack again, with a new roll, against a creature you are grappling". The same
 * activity, used by the active GM for the attacker, consuming nothing and costing no action; the roll carries its target (like a
 * Reaction attack, §67 bis). Several grappled creatures: the reactor chooses (with no answer, the first).
 */
async function redirectAttack(activity, attacker, reactor) {
  if ( (activity?.type !== "attack") || !attacker?.actor || !reactor ) return;
  const victims = victimsOf(reactor).filter(t => (t !== attacker) && ((t.actor?.system.attributes?.hp?.value ?? 0) > 0));
  if ( !victims.length ) return;
  let victim = victims[0];
  if ( victims.length > 1 ) {
    const answer = await askChoice(reactor.actor, { actor: reactor.actor.uuid, item: activity.item?.name ?? "",
      prompt: loc("Detournement.Question", { attacker: attacker.name }), options: victims.map((t, i) => ({ id: `v${i}`, label: t.name })) });
    victim = victims[Number(String(answer?.id ?? "v0").slice(1))] ?? victims[0];
  }
  log(`${attacker.name}: same attack redirected against ${victim.name} (${reactor.name})`);
  const results = await activity.use({ [MODULE_ID]: { confirmed: true }, consume: false, subsequentActions: false, create: { measuredTemplate: false } },
    { configure: false }, { data: { flags: { [MODULE_ID]: { cost: "free", redirected: reactor.uuid } } } });
  if ( results ) await activity.rollAttack({}, { configure: false }, { data: { system: { origin: results.message?.id, targets: targetDescriptorsOf([victim]) } } });
}

/**
 * §19.8: "suffers a condition" window (struck by one of these conditions, the creature turns into a
 * Beast and the condition ends). Without waiting, like "hurt". Once the Reaction is taken, the condition ends (`endCondition`
 * step): the effects that carry it are removed. Active GM.
 */
async function windowGainsCondition(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || effect.disabled || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  for ( const condition of Array.from(effect.statuses ?? []) ) {
    const options = reactionsOf(actor, "gainsCondition", { target: actor, targetToken: token, condition }, { publish: true });
    if ( !options.length ) continue;
    const label = game.i18n.localize(CONFIG.DND5E.conditionTypes[condition]?.name ?? condition);
    log(`${actor.name} suffers ${label}: reaction window (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, { actor: actor.uuid, prompt: { key: "ReactionEtat", data: { condition: label } }, options });
    if ( !answer?.endCondition ) continue;
    const ids = actor.effects.filter(e => e.statuses?.has(condition)).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${actor.name}: ${answer.name}, ${label} ends (${ids.length} effect(s))`);
  }
}

/** The effects a `forOneAttack` Reaction applied to its bearer: removed, the attack judged. */
async function dropOneAttackEffects(actor, activityUuid) {
  const item = (await fromUuid(activityUuid))?.item;
  if ( !actor || !item || (contentOf(item).entry?.forOneAttack !== true) ) return;
  const ids = actor.effects.filter(e => originItemOf(e) === item).map(e => e.id);
  if ( ids.length ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${item.name}: effect removed, it only applied to this attack`);
  }
}

/**
 * §19.6: "missed" window — the attack just missed these creatures (retort, disarm, misty step). Without
 * waiting, like "hurt": the Reaction targets the attacker and follows its own course.
 */
/* -------------------------------------------- */
/*  §34 : avant le jet d'attaque                */
/* -------------------------------------------- */

/**
 * What the pre-roll Reactions (and Portent, §36) decided for this activity's next attack (the attacker's
 * client). Each pass through the gate replaces what was left (`mods` null: nothing more); a roll that did not follow (roll window
 * closed) bequeaths nothing to an attack much later: beyond `ATTACK_MODS_TTL`, it is forgotten.
 */
const attackMods = new Map();
const ATTACK_MODS_TTL = 120000;
export function rememberAttackMods(activityUuid, mods) {
  if ( mods ) attackMods.set(activityUuid, { mods, at: Date.now() });
  else attackMods.delete(activityUuid);
}
export function takeAttackMods(activityUuid) {
  const kept = attackMods.get(activityUuid) ?? null;
  attackMods.delete(activityUuid);
  return (kept && ((Date.now() - kept.at) <= ATTACK_MODS_TTL)) ? kept.mods : null;
}

/**
 * Who can react before this attack roll, and with what: the target itself (`isAttacked`: Shadow Dodge), and every creature
 * in the scene allied with the target and hostile to the attacker, the target included (`enemyAttacks`: Protective Flare). Living.
 * @returns {Array<{token: TokenDocument, target: TokenDocument, options: object[]}>}
 */
export function attackReactors(activity, origin, targets) {
  const out = [];
  const alive = t => t?.actor && !isObjectToken(t) && ((t.actor.system.attributes?.hp?.value ?? 1) > 0);
  for ( const target of targets ) {
    if ( !alive(target) ) continue;
    const own = reactionsOf(target.actor, "isAttacked", { source: origin.actor, target: target.actor, activity, sourceToken: origin, targetToken: target }, { publish: true });
    if ( own.length ) out.push({ token: target, target, options: own });
    for ( const other of target.parent?.tokens ?? [] ) {
      if ( (other === origin) || !alive(other) || other.hidden ) continue;
      if ( areEnemies(other, target) || !areEnemies(other, origin) ) continue;
      const options = reactionsOf(other.actor, "enemyAttacks", { source: origin.actor, target: target.actor, activity, self: other.actor,
        selfToken: other, sourceToken: origin, targetToken: target }, { publish: true });
      if ( options.length && !out.some(o => o.token === other) ) out.push({ token: other, target, options });
    }
  }
  // §36: the counterpart — every creature in the scene on the attacker's side (other than it) and hostile to a target
  // (`allyAttacks`: Cosmic Omen, Fortune). One window per reactor, against the first target hostile to it. A neutral has no allies.
  for ( const other of origin.parent?.tokens ?? [] ) {
    if ( (other === origin) || !alive(other) || other.hidden || out.some(o => o.token === other) ) continue;
    if ( !areSworn(other, origin) ) continue;   // §181: factions, otherwise same non-neutral disposition
    const target = targets.find(t => alive(t) && areEnemies(other, t));
    if ( !target ) continue;
    const options = reactionsOf(other.actor, "allyAttacks", { source: origin.actor, target: target.actor, activity, self: other.actor,
      selfToken: other, sourceToken: origin, targetToken: target }, { publish: true });
    if ( options.length ) out.push({ token: other, target, options });
  }
  return out;
}

/**
 * The window, reactor after reactor (each its own Reaction, its resources): returns what applies to the roll — Disadvantage, dice
 * subtracted (`penalty`), dice added (`bonus`, §36) and the names —, or null if nobody reacted.
 */
export async function askAttackReactions(activity, origin, reactors, { auto=null }={}) {
  const mods = { disadvantage: false, penalty: 0, bonus: 0, names: [] };
  for ( const { token, target, options } of reactors ) {
    const answer = await askReaction(token.actor, {
      actor: token.actor.uuid,
      prompt: { key: (token === target) ? "ReactionAvantAttaque" : "ReactionAvantAttaqueAllie", data: { attacker: origin.name, name: target.name } },
      options,
      // §133: a Reaction that targets the attacked creature (Protection: the "Protected" effect on the ally).
      target: options.some(o => o.targetSource) ? origin.uuid : (options.some(o => o.targetTarget) ? target.uuid : null),
      auto: auto === "first"
    });
    if ( !answer ) continue;
    // O8d (§347): the reactor becomes the target (Missile Shield); the gate changes the targets before the relaunch.
    if ( answer.intercept && (token !== target) && !mods.intercepts?.some(i => i.from === target.id) ) {
      mods.intercepts = [...(mods.intercepts ?? []), { from: target.id, to: token.id }];
      log(`${token.name} reacts before ${origin.name}'s attack: ${answer.name}, becomes the target instead of ${target.name}`);
      mods.names.push(answer.name);
      continue;
    }
    if ( answer.disadvantage ) mods.disadvantage = true;
    mods.penalty += Number(answer.penalty) || 0;
    mods.bonus += Number(answer.bonus) || 0;
    mods.names.push(answer.name);
    log(`${token.name} reacts before ${origin.name}'s attack: ${answer.name}${answer.disadvantage ? " (Disadvantage)" : ""}${answer.penalty ? ` (-${answer.penalty})` : ""}${answer.bonus ? ` (+${answer.bonus})` : ""}`);
  }
  return mods.names.length ? mods : null;
}

/**
 * §133: "disengages" window — a creature just took the Disengage action: every creature in the scene hostile to it
 * and alive can react (Sentinel: "right after a creature within 5 feet of you takes the Disengage action, you can
 * make an Opportunity Attack against it" — the distance is the condition of the declaration). Without waiting, like
 * "hurt". Active GM.
 */
export function windowDisengaged(tokenDocument) {
  const mover = tokenDocument?.actor;
  if ( !mover || !tokenDocument.parent ) return;
  for ( const other of tokenDocument.parent.tokens ) (async () => {
    const actor = other.actor;
    if ( !actor || (other === tokenDocument) || other.hidden || isObjectToken(other) ) return;
    if ( !areEnemies(other, tokenDocument) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const options = reactionsOf(actor, "enemyDisengages", { source: mover, self: actor, selfToken: other, sourceToken: tokenDocument,
      target: mover, targetToken: tokenDocument }, { publish: true });
    if ( !options.length ) return;
    log(`${tokenDocument.name} disengages: ${other.name} can react (${options.map(o => o.name).join(", ")})`);
    await askReaction(actor, { actor: actor.uuid, prompt: { key: "ReactionDesengage", data: { mover: tokenDocument.name } }, options,
      target: tokenDocument.uuid });
  })().catch(err => console.error(`${MODULE_ID} | "disengages" window interrupted`, err));
}

/**
 * §236: "a hostile creature just attacked" window — every creature in the scene hostile to the attacker, hit or not, targeted or
 * not (Soul of Vengeance: the creature under the Vow of Enmity attacks). Without waiting.
 */
export function windowEnemyAttacked(sourceToken, sourceName, { activity=null, auto=null }={}) {
  const attacker = fromUuidSync(sourceToken ?? "", { strict: false });
  if ( !attacker?.parent ) return;
  const reactors = attacker.parent.tokens.filter(t => (t !== attacker) && t.actor && !isObjectToken(t) && areEnemies(t, attacker)).map(t => t.uuid);
  fireTargetWindow("enemyAttacked", reactors, sourceToken, sourceName, { activity, auto, promptKey: "ReactionEnnemiAttaque", what: "seeing an enemy attack" });
}

/**
 * §487: "succeeds on a save against" window — every creature that just succeeded on the save imposed by the activity of a
 * hostile creature (Mage's retaliation; "against a spell": `activity.isSpell`). Without waiting, like "missed".
 */
export function windowSavesAgainst(tokenUuids, sourceToken, sourceName, { activity=null, auto=null }={}) {
  fireTargetWindow("savesAgainst", tokenUuids, sourceToken, sourceName, { activity, auto, promptKey: "ReactionSauvegarde", what: "saving against", hostile: true });
}

export function windowIsMissed(tokenUuids, sourceToken, sourceName, { activity=null, auto=null, resolution=null }={}) {
  // §489: with the resolution — the facts `attack.fumble` / `attack.rerolled` (retort of a Parry on a Critical Miss) read it.
  fireTargetWindow("isMissed", tokenUuids, sourceToken, sourceName, { activity, auto, promptKey: "ReactionRate", what: "missed",
    extra: resolution ? { resolution } : {} });
}

/**
 * §19.6: "an enemy ends its turn" window — every creature hostile to the one whose turn ends can react against it
 * (an enemy that ends its turn within 5 feet of the creature). Active GM, without waiting.
 */
function onEnemyTurnEnd(combat, prior) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  if ( !ended?.actor || !ended.parent ) return;
  // §492: the "this turn" facts (`source.attackedSelfThisTurn`) speak of the turn that just ended, not the one that begins.
  const endedKey = turnKeyAt(combat, prior);
  for ( const other of ended.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === ended) || isObjectToken(other) || !areEnemies(other, ended) ) continue;
    if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
    // §485: `self` — the reactor, for what it carries (`self.hasSavableEffect`: Indomitable).
    const options = reactionsOf(actor, "enemyTurnEnd",
      { source: ended.actor, target: actor, sourceToken: ended, targetToken: other, self: actor, selfToken: other, turnKey: endedKey },
      { publish: true });
    if ( !options.length ) continue;
    log(`${ended.name} ends their turn: ${actor.name} can react (${options.map(o => o.name).join(", ")})`);
    askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionFinDeTour", data: { attacker: ended.name } },
      options,
      target: options.some(o => o.targetSource) ? ended.uuid : null
    }).then(result => {
      // §485: the Reaction taken replays the save of a carried effect — the rule re-read in the options sent, not in the response.
      const taken = result ? options.find(o => o.resave && (o.activity === result.used)) : null;
      return taken ? resaveChosen(actor, other, taken.resave, taken.name) : null;
    }).catch(err => console.error(`${MODULE_ID} | "enemy's end of turn" window interrupted`, err));
  }
}

/* -------------------------------------------- */
/*  Opportunity Attack                          */
/* -------------------------------------------- */

/**
 * Who threatens a PLANNED move with an Opportunity Attack. Synchronous: called from
 * `preMoveToken`, on the mover's client. The path is followed cell by cell: leaving a
 * reach along the way counts, not only between the start and the end.
 * @param {TokenDocument} token
 * @param {object[]} waypoints  The planned path, start excluded.
 * §136: also the Reactive Strikes (Polearm Master) against a creature that ENTERS the reach, returned as
 * `{ token, enters: true }`; the set is sorted in path order (enter then leave: the Reactive Strike first).
 * §479: `explain` (a real move, not a preview or a scenario that queries) — each creature whose path leaves the reach
 * without an Opportunity Attack is reported in the debugger log, and a surprising reason is reported to the GM (`explainMisses`).
 * @returns {Array<string|{token: string, enters: true}>}  UUIDs of the tokens that can react.
 */
export function opportunityThreats(token, waypoints, { explain=false }={}) {
  // §117, §416: general rule — Assisted level and above. At the Essential level, no path judges it (neither `preMoveToken`,
  // nor the click-to-walk of runtime/actions.mjs, which still went through here).
  if ( !levelAtLeast("assisted") ) return [];
  if ( !game.combat?.started || !token.actor || !waypoints.length ) return [];
  const mover = combatantFor(token.actor);
  if ( !mover ) return [];
  // §16.15: a piloted object (Spiritual Weapon) is not a creature that leaves a reach.
  if ( pilotOf(token) ) return [];
  const teleported = waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace"));
  const factors = readUnitFactors();
  const gridUnits = token.parent.grid.units;
  const origin = position(token._source);
  const path = token.getCompleteMovementPath([origin, ...waypoints]).map(position);

  const others = [];
  const strikers = [];
  const readied = [];
  const dragged = victimsOf(token);
  for ( const combatant of game.combat.combatants ) {
    const other = combatant.token;
    if ( !other?.actor || (other === token) || combatant.isDefeated || (other.parent !== token.parent) ) continue;
    // A victim dragged by this grappler follows it: it does not see the one carrying it off "leave".
    if ( dragged.includes(other) ) continue;
    if ( pilotOf(other) ) continue;   // nor does it threaten an Opportunity Attack
    if ( !samePlane(other, token) ) continue;   // §225: no Opportunity Attack nor readied action from one plane to another
    if ( opportunityBlocked(other.actor) ) continue;   // §23: Shocking Grasp
    // §136: Reactive Strike — the reach of the held polearm weapon, not that of the Opportunity Attack.
    const strike = reactiveStrikesOf(other.actor);
    if ( strike.options.length ) {
      let strikeReach = lengthIn(strike.reach, strike.units, gridUnits, factors);
      const enters = entersAt(path.map(pos => distanceBetween(other, token, { posB: pos }).value), strikeReach);
      strikers.push({ ...sideOf(other), token: other.uuid, enters,
        hasLineOfEffect: (enters >= 0) ? hasLineOfEffect(other, token, { posB: path[enters] }) : null, ...reactionState(other.actor) });
    }
    // §211: a readied action "when an enemy comes within range" — the reach or range of the readied action.
    const plan = readyPlanOf(readBudget(combatant));
    if ( plan?.reach && (plan.trigger === "enters") && !teleported ) {
      const enters = entersAt(path.map(pos => distanceBetween(other, token, { posB: pos }).value), lengthIn(plan.reach.value, plan.reach.units, gridUnits, factors));
      const state = { enemies: areEnemies(other, token), sees: canSee(other, token) ?? true, ...reactionState(other.actor) };
      if ( (enters >= 0) && readyTriggered(plan, { kind: "enters", source: token.uuid }, state)
        && (hasLineOfEffect(other, token, { posB: path[enters] }) !== false) ) readied.push({ token: other.uuid, ready: true, at: enters });
    }
    const melee = meleeAttacksOf(other.actor);
    let reach = lengthIn(melee.reach, melee.units, gridUnits, factors);
    const distances = path.map(pos => distanceBetween(other, token, { posB: pos }).value);
    let leaves = -1;
    for ( let n = 0; n < distances.length - 1; n++ ) {
      if ( (distances[n] <= reach + 1e-6) && (distances[n + 1] > reach + 1e-6) ) { leaves = n; break; }
    }
    others.push({
      ...sideOf(other), token: other.uuid, reach,
      before: leaves >= 0 ? distances[leaves] : distances[0],
      after: leaves >= 0 ? distances[leaves + 1] : distances.at(-1),
      leaves, hasMeleeAttack: melee.options.length > 0,
      // P2: can it strike the mover, where it leaves its reach (floor, trapdoor, solid wall)?
      hasLineOfEffect: ((leaves >= 0) || (distances[0] <= reach + 1e-6)) ? hasLineOfEffect(other, token, { posB: path[Math.max(leaves, 0)] }) : null,
      seesMover: canSee(other, token) ?? true,   // P1: "a creature that you can see" (position before the move)
      ...reactionState(other.actor)
    });
  }
  const moverSide = {
    // §18.15: Nimble, Skimming Flight — like a Disengage, for this move.
    ...sideOf(token), teleported,
    disengaged: (readBudget(mover).disengaged === true) || avoidsOpportunity(token.actor, token, waypoints)
  };
  const attacks = opportunityAttackers(moverSide, others).map(uuid => ({ uuid, at: others.find(o => o.token === uuid)?.leaves ?? 0 }));
  lastMisses = opportunityMisses(moverSide, others);
  if ( explain ) explainMisses(token, lastMisses);
  const strikes = reachStrikers({ ...sideOf(token), teleported }, strikers)
    .map(uuid => ({ uuid, enters: true, at: strikers.find(o => o.token === uuid).enters - 1 }));
  if ( !strikes.length && !readied.length ) return attacks.map(a => a.uuid);
  // §211: a readied action plays when the creature has arrived (`at`: the first cell in range) — the move is cut there
  // (`splitForReady`); it goes after what comes before it on the path.
  return [...strikes, ...attacks, ...readied.map(r => ({ ...r, uuid: r.token, at: r.at - 0.5 }))].sort((a, b) => a.at - b.at)
    .map(a => (a.ready ? { token: a.uuid, ready: true, at: a.at + 0.5 } : a.enters ? { token: a.uuid, enters: true } : a.uuid));
}

/** §479: the reasons for the last path judged (scenarios: `api.mcp.missedOpportunities`). */
let lastMisses = [];
export function lastOpportunityMisses() { return lastMisses; }

/** §479: what was already told to the GM — once per combat, per creature and per reason (not at every step). */
const missesTold = new Set();

/**
 * §479: say why a creature carries no Opportunity Attack when this move leaves its reach — in the
 * debugger log always, to the GM (GM alert, `gmAlerts` setting) when the reason is surprising: a monster left Neutral, a
 * creature with no usable melee attack, or that does not see the one leaving (Discord, 2026-11-19: "Opportunity Attacks
 * don't fire").
 */
function explainMisses(token, misses) {
  for ( const { token: uuid, reason, notice } of misses ) {
    const other = fromUuidSync(uuid, { strict: false });
    if ( !other ) continue;
    log(`${token.name} leaves ${other.name}'s reach: no Opportunity Attack (${reason})`);
    if ( !notice ) continue;
    const key = `${game.combat?.id ?? ""}|${uuid}|${reason}`;
    if ( missesTold.has(key) ) continue;
    missesTold.add(key);
    alertGM({ text: loc(`OpportuniteRatee.${reason}`, { mover: token.name, attacker: other.name }), actor: other.actor })
      .catch(err => console.error(`${MODULE_ID} | opportunity attack: GM notice`, err));
  }
}

/**
 * §211: the first readied action this trip triggers, and where to cut it — `first`: up to the cell where the creature comes
 * within range, `rest`: the remainder, to replay separately (its own threats will be reviewed there), `before`: the earlier
 * threats on the path. The points are those of the core's complete path, cell by cell (`getCompleteMovementPath`). Null without a
 * readied action.
 */
export function splitForReady(token, waypoints, threats) {
  const at = threats.findIndex(t => t?.ready);
  if ( at < 0 ) return null;
  const ready = threats[at];
  const complete = token.getCompleteMovementPath([position(token._source), ...waypoints]);
  const clean = ({ x, y, elevation, width, height, depth, shape, level, action, snapped }) =>
    ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit: true, checkpoint: true });
  return { before: threats.slice(0, at), ready, first: complete.slice(1, ready.at + 1).map(clean), rest: complete.slice(ready.at + 1).map(clean) };
}

export const OPPORTUNITY_QUERY = `${MODULE_ID}.opportunity`;
const RESOLUTION_WAIT = 20000;

/** Waits until the attack born of a use message is judged, damage applied included. */
async function attackSettled(usageId) {
  const over = () => game.messages.contents.some(m => {
    const r = current(m.getFlag(MODULE_ID, "resolution"));
    return ((r?.carrier === usageId) || (r?.origin === usageId)) && ["done", "missed", "undone"].includes(r.step);
  });
  const until = Date.now() + RESOLUTION_WAIT;
  while ( !over() && (Date.now() < until) ) await sleep(250);
}

/** Active GM side: offers each Opportunity Attack, one after the other, and waits for its outcome. */
async function handleOpportunityQuery({ token: tokenUuid, attackers }, { user=null }={}) {
  const token = await fromUuid(tokenUuid);
  // §472: from a player, only for their own moving token, and attackers of the same scene.
  if ( needsCheck(user) ) {
    if ( !actsFor(user, token?.actor) || !Array.isArray(attackers) ) { console.warn(`${MODULE_ID} | opportunity query from ${user.name} refused: ${token?.name ?? tokenUuid} is not theirs`); return false; }
    attackers = attackers.filter(e => fromUuidSync((typeof e === "string") ? e : (e?.token ?? ""), { strict: false })?.parent === token.parent);
  }
  let asked = false;
  for ( const entry of attackers ) {
    const { token: uuid, enters=false } = (typeof entry === "string") ? { token: entry } : entry;
    const attacker = await fromUuid(uuid);
    if ( !attacker?.actor || !token ) continue;
    // Only one Reaction: the one taken by a previous window of this move is no longer there.
    if ( asked && !reactionState(attacker.actor).reactionAvailable ) continue;
    asked = true;
    if ( (typeof entry === "object") && entry.ready ) {
      await releaseReady(attacker, token, "enters");
      continue;
    }
    if ( enters ) {
      // §136: Polearm Master — settled before the move, like the Opportunity Attack (the blow lands when the creature arrives).
      log(`${token.name} is about to enter ${attacker.name}'s reach: Reactive Strike offered before the move`);
      const answer = await askReaction(attacker.actor, {
        actor: attacker.actor.uuid,
        prompt: { key: "ReactionAllonge", data: { mover: token.name } },
        options: reactiveStrikesOf(attacker.actor).options,
        target: token.uuid
      });
      if ( answer?.message ) await attackSettled(answer.message);
      continue;
    }
    log(`${token.name} is about to leave ${attacker.name}'s reach: Opportunity Attack offered before the move`);
    announce("leavesReach", { actor: attacker.actor, source: token.actor, target: attacker.actor, mover: token.uuid });
    const answer = await askReaction(attacker.actor, {
      actor: attacker.actor.uuid,
      prompt: { key: "ReactionOpportunite", data: { mover: token.name } },
      // §16.26: War Mage — a spell targeting only the creature that leaves, instead of the attack.
      // §134: Mobile — "Opportunity Attacks against you have Disadvantage": marked on the chosen attack.
      options: [...meleeAttacksOf(attacker.actor).options, ...reactiveSpellsOf(attacker.actor)].map(o => (hamperedBy(token.actor) ? { ...o, hampered: hamperedBy(token.actor) } : o)),
      target: token.uuid
    });
    if ( answer?.message ) await attackSettled(answer.message);
  }
  return true;
}

/**
 * §211: offers the one who held ready to release their action, against the creature that triggered it (active GM or the one who
 * requests it). The plan is re-read in its budget: served, or expired in the meantime, there is nothing to offer.
 */
export async function releaseReady(readier, trigger, kind) {
  const combatant = combatantFor(readier?.actor);
  const plan = combatant ? readyPlanOf(readBudget(combatant)) : null;
  if ( !plan || !trigger?.actor ) return null;
  log(`${trigger.name} triggers ${readier.name}'s readied action (${plan.name}, ${kind})`);
  const answer = await askReaction(readier.actor, {
    actor: readier.actor.uuid,
    prompt: { key: `PretDeclenche.${kind}`, data: { mover: trigger.name, action: plan.name } },
    options: [readyOption(plan)],
    target: trigger.uuid
  });
  if ( answer?.message ) await attackSettled(answer.message);
  return answer;
}

/**
 * Settles the Opportunity Attacks BEFORE the move. Returns false if the mover is no
 * longer able to do it (dropped to 0 HP).
 */
export async function resolveOpportunity(token, attackers) {
  if ( !attackers.length ) return true;
  const gm = game.users.activeGM;
  try {
    if ( gm?.isSelf ) await handleOpportunityQuery({ token: token.uuid, attackers });
    else if ( gm ) await gm.query(OPPORTUNITY_QUERY, { token: token.uuid, attackers }, { timeout: 120000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | Opportunity Attacks: no answer from the GM`, err);
  }
  return (token.actor?.system.attributes?.hp?.value ?? 1) > 0;
}

/* -------------------------------------------- */

/**
 * §88: Riposte — the superiority die promised to the damage roll of the weapon that ripostes (adapter/reactions.mjs,
 * `handleReactionQuery`), on the client that reacts; of the type of the first roll (the weapon's).
 */
function onReactionDamage(config) {
  const activity = config?.subject;
  const mark = activity?.uuid ? takeReactionDamage(activity.uuid) : null;
  if ( !mark || !config.rolls?.length ) return true;
  const type = config.rolls[0]?.options?.type ?? null;
  config.rolls.push({ data: activity.getRollData(), parts: [mark.formula], options: { type, types: type ? [type] : [], properties: [] } });
  log(`${mark.name}: +${mark.formula} ${type ?? ""}`);
  return true;
}

export function registerReactions() {
  route("dnd5e.preRollDamageV2", onReactionDamage, { cancellable: true, label: "riposte: superiority die" });
  // §438 continued: a missed Riposte does not leave its die to the next blow of the same weapon (not at the missed roll:
  // a reroll may change it).
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    if ( subject?.uuid && noteReactionAttack(subject.uuid) ) log(`riposte: ${subject.item?.name ?? subject.name} — the promised die drops (a new attack)`);
  }, { label: "riposte: die not dropped after a miss" });
  route("combatTurnChange", (combat, prior) => onEnemyTurnEnd(combat, prior), { executor: true, label: "\"enemy's end of turn\" window not opened" });
  // On every client: the one that reacts is the one that answers the query.
  CONFIG.queries[REACTION_QUERY] = handleReactionQuery;
  setReactionApproach(reactionApproach);   // §67: the Reaction that first joins its source

  // Opportunity Attacks are settled before the move (runtime/actions.mjs, preMoveToken).
  CONFIG.queries[OPPORTUNITY_QUERY] = handleOpportunityQuery;
  // §19.8: "suffers a condition" — an effect carrying a condition was just applied to a creature.
  route("createActiveEffect", effect => (effect.statuses?.size ? windowGainsCondition(effect) : null),
    { executor: true, label: "\"suffers a condition\" window not opened" });
}
