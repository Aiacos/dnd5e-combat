/**
 * The action machine's commands (SPEC §5): what the dispatcher (runtime/dispatcher.mjs) has executed for a
 * resolution — request the saves and Reactions, roll damage, apply, move, set conditions. Extracted from
 * runtime/engine.mjs.
 */

import { deathWardOf } from "../adapter/ward.mjs";
import { banishToken } from "./banish.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { MODULE_ID } from "../constants.mjs";
import { STEPS, damageFor } from "../core/action.mjs";
import { retaliationsFor, retaliate, inflict, saveRetaliation } from "../adapter/retaliation.mjs";
import { applyDamageToToken, maximizedHealing } from "../adapter/messages.mjs";
import { requestSaves, applyEffectsToToken, applyStatusToToken, applyMarkToToken, splitPushes } from "../adapter/saves.mjs";
import { holds } from "../core/triggers.mjs";
import { creatureTypeOf, factsFor, originItemOf } from "../adapter/facts.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { removeTransientRegions, zoneCenter } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { askAllocation } from "../adapter/projectiles.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween, speedOf, tokenCenter } from "../adapter/turn.mjs";
import { summonTokenFor } from "../adapter/pilot.mjs";
import { randomDirection, randomDie } from "../core/control.mjs";
import { MOVE_DIRECTIONS } from "../core/content.mjs";
import { rangeIssue } from "../core/range.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { dodge as takeDodge } from "../core/turn.mjs";
import { tallyAfter, stageAfter } from "../core/tally.mjs";
import { noteAttack } from "../adapter/attacked-this-turn.mjs";
import { askHitReactions, windowIsDamaged, windowIsMissed, windowEnemyAttacked, windowSavesAgainst, askDamageGuardians, askAreaReactions } from "./reactions.mjs";
import { markConcentrationBreaker, resistanceIgnoredBy, fortifiedExtra } from "./feats.mjs";
import { liftToken } from "./elevation-spells.mjs";
import { requestSave } from "./neighbours.mjs";
import { duplicateEffectsOf } from "../adapter/duplicates.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { log, loc, waitForDice, notice } from "./shared.mjs";
import { damageFlow } from "./flow.mjs";
import { promptWait } from "../adapter/dialogs.mjs";

/**
 * §419: the GM's window before application — who, what, how much (the roll, before Resistances and saves), on whom. No delay: it is
 * the GM who asked to validate. Closed with no choice: nothing is applied.
 */
async function confirmApplication(command, resolution, activity, source) {
  const damages = deserializeDamages(resolution.damageRoll?.damages ?? []);
  const total = damages.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const types = [...new Set(damages.map(d => d.type).filter(Boolean))]
    .map(t => CONFIG.DND5E.damageTypes[t]?.label ?? CONFIG.DND5E.healingTypes[t]?.label ?? t).join(", ");
  const part = m => ((m === 1) ? "" : (m === 0.5) ? " (½)" : (m === 0) ? " (0)" : ` (×${m})`);
  const targets = command.entries.map(e => {
    const t = resolution.targets.find(x => x.token === e.token);
    return `${t?.name ?? "?"}${part(e.multiplier)}`;
  }).join(", ");
  const heal = !!resolution.plan?.heal;
  // §421: the table sees that the GM is deciding (banner "The GM decides…", without naming a creature: no actor). §422: followed —
  // the GM can answer from their Queue.
  const choice = await promptWait({
    window: { title: loc("Degats.ValiderTitre", { item: activity?.item?.name ?? "" }) },
    classes: ["dnd5e-combat-damage-validate"],
    content: `<p>${loc(heal ? "Degats.ValiderSoins" : "Degats.ValiderTexte", { source: source?.name ?? activity?.actor?.name ?? "", total, types, targets })}</p>`,
    buttons: [{ action: "apply", label: loc("Degats.Appliquer"), icon: "fa-solid fa-check", default: true },
      { action: "refuse", label: loc("Degats.NePasAppliquer"), icon: "fa-solid fa-xmark" }]
  }, { awaiting: { actor: null, kind: "choice" } });
  return choice === "apply";
}
import { holdForAtCost } from "./success-at-cost.mjs";
import { waitForAnimations } from "./animations.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { TRANSIENT_LINGER_MS, deserializeDamages, dispatcher, healsDownedToMax, healsMax, hpTierFor, prismaticFor, slotHealBonus, speakerTokenUuid } from "./engine.mjs";
import { healingTotal, withMaxRaise } from "../core/heal-raises-max.mjs";
import { budgetIssues, spendBudget } from "./neighbours.mjs";
import { braceCut } from "../core/forced-move.mjs";

/* -------------------------------------------- */
/*  Commandes de la machine d'action            */
/* -------------------------------------------- */

/**
 * §37: the creature takes the Dodge action (Curse, "Cursed Actions": "must succeed on a Wisdom saving throw at the
 * start of each of its turns, or be forced to take the Dodge action") — its turn's action spent, the Dodge condition
 * placed (runtime/conditions.mjs shows it on the token). Out of combat, nothing.
 */
async function forceDodge(tokenUuid) {
  const token = await fromUuid(tokenUuid);
  const combatant = token?.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return;
  const before = readBudget(combatant);
  const after = takeDodge(before);
  if ( after === before ) { log(`${token.name}: Dodge forced, but the turn's action is already used`); return; }
  await writeBudget(combatant, after);
  log(`${token.name}: saving throw failed, Dodge action forced`);
}

/** The scenario tool `autoReact` of the use ("none": nobody reacts; "first": the first, without a window). */
const autoReactOf = (carrier, resolution) =>
  game.messages.get(resolution?.origin ?? carrier.id)?.getFlag(MODULE_ID, "autoReact") ?? carrier.getFlag(MODULE_ID, "autoReact") ?? null;

/**
 * K2 (§323): does the `killsAtZero` rule apply here? `true`; or reserved to creature types ("a Humanoid reduced to 0 HP…"),
 * to a size at most ("a Medium or smaller creature"), to activities of the item (the disintegrating ray).
 */
const SIZE_ORDER = ["tiny", "sm", "med", "lg", "huge", "grg"];
function killsHere(rule, activity, actor) {
  if ( !rule || !actor ) return false;
  if ( rule === true ) return true;
  if ( rule.activities && !(activity && rule.activities.includes(activity.id)) ) return false;
  if ( rule.types && !rule.types.includes(creatureTypeOf(actor)) ) return false;
  if ( rule.sizeAtMost && (SIZE_ORDER.indexOf(actor.system?.traits?.size ?? "med") > SIZE_ORDER.indexOf(rule.sizeAtMost)) ) return false;
  return true;
}

export const COMMANDS = {
  /**
   * Issue #32: success at a cost — the attack misses at least one target by 1 or 2 (final AC): the GM's pause. Accepted: those
   * targets are hit; otherwise the failure stands. Nothing has been applied yet.
   */
  async atCostPause(command, carrier, resolution) {
    const tokenDoc = await fromUuid(speakerTokenUuid(carrier) ?? "");
    const actor = tokenDoc?.actor ?? await fromUuid(resolution.source ?? "");
    const by = Math.min(...command.targets.map(t => t.by));
    const answer = await holdForAtCost({ actor, token: tokenDoc ?? null, what: loc("Inspiration.Attaque"), total: command.total, needed: command.total + by, kind: "attack" });
    return [{ type: "atCostDecided", accepted: !!answer?.accepted, cost: answer?.cost ?? null }];
  },

  askReactions: (command, carrier, resolution) => askHitReactions(resolution, command.tokens, id => dispatcher.drained(id), {
    auto: autoReactOf(carrier, resolution)
  }),

  /**
   * Mirror Image (§16.25): a d6 per duplicate, rolled by the engine, visible to all; a hit duplicate is destroyed
   * (its effect removed — the last one removed ends the spell).
   */
  async rollDuplicates(command, carrier, resolution) {
    const events = [];
    for ( const tokenUuid of command.tokens ) {
      const token = await fromUuid(tokenUuid);
      const effects = duplicateEffectsOf(token?.actor);
      if ( !effects.length ) { events.push({ type: "duplicatesRolled", token: tokenUuid, dice: [] }); continue; }
      const roll = await new Roll(`${effects.length}d6`).evaluate();
      const dice = roll.dice.flatMap(d => d.results.map(r => r.result));
      const taken = dice.some(d => d >= 3);
      const message = await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ token }),
        flavor: loc(taken ? "Repliques.Touchee" : "Repliques.Ratee", { name: token.name, count: effects.length })
      });
      await waitForDice(message);
      if ( taken ) await effects.at(-1).delete();
      log(`${token.name}: duplicates ${dice.join(", ")} → ${taken ? `a duplicate takes the hit (${effects.length - 1} left)` : "the hit lands"}`);
      events.push({ type: "duplicatesRolled", token: tokenUuid, dice, messageId: message?.id ?? null });
    }
    return events;
  },

  /** §16.27: the author distributes their missiles (Magic Missile); with no answer, the core distributes as best it can. */
  async askAllocation(command, carrier, resolution) {
    const actor = await fromUuid(resolution.source ?? "");
    const activity = carrier.getAssociatedActivity?.();
    log(`${activity?.item?.name ?? "projectiles"}: ${command.count} projectile(s) to split among ${command.targets.map(t => t.name).join(", ")}`);
    const answer = actor ? await askAllocation(actor, { item: activity?.item?.name ?? "", count: command.count, targets: command.targets }) : null;
    return [{ type: "allocated", counts: answer?.counts ?? {} }];
  },

  async requestSaves(command, carrier, resolution) {
    const { save } = resolution.plan;
    log(`${(save.abilities ?? [save.ability]).join("/")} saving throw DC ${save.dc} requested from`, command.targets.map(t => t.name).join(", "));
    // Several abilities at the target's choice: the player chooses; for the GM, per the setting.
    // An intention can impose it (`saveChoice: "best"` on the card: scenarios, no click).
    const forced = game.messages.get(resolution.origin ?? carrier.id)?.getFlag(MODULE_ID, "saveChoice") ?? carrier.getFlag(MODULE_ID, "saveChoice");
    const ask = forced !== "best";
    await requestSaves(carrier, save, command.targets,
      { askPlayers: ask, askGM: ask && (game.settings.get(MODULE_ID, "npcSaveChoice") === "ask"), auto: autoReactOf(carrier, resolution) });
  },

  async apply(command, carrier, resolution) {
    const damageMessage = game.messages.get(resolution.damageRoll?.messageId);
    const activity = carrier.getAssociatedActivity?.({ scaled: true }) ?? null;
    const source = await fromUuid(speakerTokenUuid(carrier) ?? "");
    // §419: "Damage" setting, validated by the GM — nothing is applied (neither HP nor effects) without their agreement; refused,
    // the resolution closes without touching anything. Only when there is a roll to apply: an effect alone goes as before.
    if ( resolution.damageRoll && damageFlow().validate && !(await confirmApplication(command, resolution, activity, source)) ) {
      log(`${activity?.item?.name ?? "action"}: application refused by the GM`);
      return [{ type: "applied", entries: [], extra: [] }];
    }
    // §112: HP drop when the animation (BLFX, by Sequencer) arrives, not at its start.
    await waitForAnimations([source?.uuid, ...command.entries.map(e => e.token)]);
    const resave = carrier.getFlag(MODULE_ID, "resave");
    const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? null;
    const entries = [];
    const extra = [];
    const slotHeal = resolution.plan.heal ? slotHealBonus(source?.actor ?? activity?.actor, activity) : null;
    let healedOther = false;
    for ( let entry of command.entries ) {
      // Riposte (§16.9): judged at the moment of the blow, before its damage ("as long as you have these Temporary Hit Points").
      const struck = resolution.plan.attack ? await fromUuid(entry.token) : null;
      const retaliations = struck ? retaliationsFor({ bearerToken: struck, attackerToken: source, activity, attackMode }) : [];
      // §16.24: a target under Beacon of Hope (`healMax`) regains the maximum of the healing.
      const patient = (await fromUuid(entry.token))?.actor;
      // §160: HP tiers (`hpTiers`) — the outcome is chosen from the target's HP BEFORE the damage (Power Word Kill, Power Word
      // Stun, Divine Word): the first tier that holds; none, no effect.
      const tier = hpTierFor(activity?.item, patient, entry, resolution.plan, activity,
        (resolution.targets ?? []).find(t => t.token === entry.token)?.save?.success === false);
      if ( tier ) entry = tier.entry;
      const prism = await prismaticFor(activity?.item, entry, activity, resolution.plan);
      if ( prism ) {
        entry = prism.entry;
        const names = prism.colors.map(c => loc(`Prisme.${c}`)).join(", ");
        log(`${activity.item.name}: ${(await fromUuid(entry.token))?.name} — ${prism.colors.join(" + ")} (${names})`);
        const struckToken = await fromUuid(entry.token);
        if ( struckToken ) notice(struckToken, loc("Prisme.Rayons", { colors: names }), "gain");
      }
      const healed = (resolution.plan.heal && (entry.multiplier > 0)
        && (healsMax(patient) || healsDownedToMax(source?.actor ?? activity?.actor, activity, patient)))
        ? await maximizedHealing(damageMessage) : null;
      if ( healed ) log(`maximum healing for ${entry.token} (${healed.map(d => d.value).join(" + ")})`);
      // Nothing to read without a roll (save or effect alone: `multiplier` 0, no `damageRoll`).
      // #269 (§545): the critical dice rolled apart go to the Critical Hit targets only (`damageFor`).
      const struckCritical = !!(resolution.plan.attack && (resolution.targets ?? []).find(t => t.token === entry.token && t.hit && t.critical));
      let rolled = (entry.multiplier > 0) ? (healed ?? deserializeDamages(damageFor(resolution, entry.token))) : [];
      // §355: Iggwilv's Demonomicon — the damage of a bearer's spell against a Fiend is maximized.
      if ( rolled.length && !resolution.plan.heal && spellDamageMaxed(source?.actor ?? activity?.actor, activity, patient) ) {
        rolled = (await maximizedHealing(damageMessage, { critical: struckCritical })) ?? rolled;
        log(`${activity.item.name}: maximum damage against ${patient?.name}`);
      }
      // §164: the type of each Prismatic Spray ray; two damage rays, double damage.
      if ( prism?.types.length ) rolled = prism.types.flatMap(type => rolled.map(d => ({ ...d, type })));
      // §27: Disciple of Life — extra HP on the healing of a spell cast with a spell slot.
      if ( slotHeal?.disciple && (entry.multiplier > 0) && rolled.some(d => d.type === "healing") ) {
        rolled = [...rolled, { type: "healing", value: slotHeal.disciple, properties: new Set() }];
        log(`Disciple of Life: +${slotHeal.disciple} HP for ${entry.token}`);
      }
      // §135: Boon of Fortitude — "when you regain HP, you can regain as many as your Constitution modifier in addition",
      // once per turn.
      if ( (entry.multiplier > 0) && rolled.some(d => d.type === "healing") ) {
        const extra = await fortifiedExtra(patient);
        if ( extra ) rolled = [...rolled, { type: "healing", value: extra, properties: new Set() }];
      }
      if ( resolution.plan.heal && (entry.multiplier > 0) && patient && (patient !== (source?.actor ?? activity?.actor)) ) healedOther = true;
      // §38: Projected Ward — before application, an ally can have their pool absorb this damage.
      const hurting = (entry.multiplier > 0) && !resolution.plan.heal && rolled.some(d => !["healing", "temphp"].includes(d.type) && (d.value > 0));
      // §493 (B13): caught in an area, the creature can react ("Insect Shield") — spared, it alone does not take the damage.
      const shielded = hurting ? await askAreaReactions(entry.token, source?.uuid ?? null, activity, { auto: autoReactOf(carrier, resolution) }) : null;
      if ( shielded?.spared ) rolled = [];
      const ward = (hurting && !shielded?.spared) ? await askDamageGuardians(entry.token, source?.uuid ?? null, activity, { auto: autoReactOf(carrier, resolution) }) : null;
      if ( ward?.item ) log(`${ward.reactor}: Projected Ward, their Arcane Ward takes ${entry.token}'s damage`);
      // §78: "Interposition" — the damage passes to the reactor; the effects stay with the target.
      if ( ward?.interpose ) log(`${ward.reactor} interposes: takes ${entry.token}'s damage`);
      // §303 (pass C8): Aid — the effect (raised maximum HP) goes before the healing, otherwise dnd5e caps the healing at the
      // previous maximum HP and a target at full HP gained nothing (`effectsFirst`). Unconditional effects only.
      const first = (entry.multiplier > 0) && (contentOf(activity?.item).entry?.effectsFirst === true) && (entry.effects ?? []).some(e => !e.if);
      const early = first ? await applyEffectsToToken(carrier, entry.token, entry.effects.filter(e => !e.if)) : [];
      // Heroes' Feast: "its HP maximum increases by 2d10, and it gains the same number of HP" (`healRaisesMax`) — the rolled
      // healing first raises the maximum, in the effect just placed; so it drops with it.
      const raise = (early.length && (contentOf(activity?.item).entry?.healRaisesMax === true)) ? healingTotal(rolled) : 0;
      if ( raise > 0 ) {
        for ( const uuid of early ) {
          const effect = await fromUuid(uuid);
          if ( effect ) await effect.update({ "system.changes": withMaxRaise(effect.toObject().system?.changes ?? [], raise) });
        }
        log(`${activity?.item?.name}: hit point maximum raised by ${raise}`);
      }
      // §133, §523: Mage Slayer — the concentrating creature that the author hurts has Disadvantage on its Concentration save. The
      // mark is placed BEFORE the damage: dnd5e asks for the save as soon as it is applied, and the engine rolls it right away
      // (runtime/concentration.mjs) — placed after, it fell on the next save. Nothing on a spared or interposed target.
      const breaking = hurting && !shielded?.spared && !ward?.interpose
        && await markConcentrationBreaker(source?.actor ?? activity?.actor, patient, activity);
      const hp = ((entry.multiplier > 0) && !shielded?.spared)
        ? await applyDamageToToken(ward?.interpose ?? entry.token, rolled, damageMessage, { multiplier: entry.multiplier, reduction: entry.reduction ?? 0, absorbInto: ward?.item ?? null,
          ignoreResistance: resistanceIgnoredBy(source?.actor ?? activity?.actor, activity),   // §134
          rangedWeapon: !!resolution.plan.attack && isRangedWeaponAttack(activity, attackMode),   // O8d (§347)
          ...(resolution.plan.attack ? { critical: struckCritical } : {}) })   // #269: THIS target's critical (death saves, regeneration)
        : null;
      // §523: no damage applied in the end — no save, the mark must not wait for the next one. (Not from the re-read HP: the actor
      // of an unlinked token is recreated by its update, its "after" HP stayed those of before — seen on the test bench.)
      if ( breaking && !hp ) await patient.unsetFlag(MODULE_ID, "concentrationBreaker").catch(() => null);
      // C12-f: Beguiling Defenses — the attacker who failed the save takes the damage the bearer just took.
      const retort = hp ? patient?.getFlag?.(MODULE_ID, "retort") : null;
      if ( retort && (retort.resolution === resolution.id) ) {
        await patient.unsetFlag(MODULE_ID, "retort");
        const dealt = (hp.before.value + (hp.before.temp ?? 0)) - (hp.after.value + (hp.after.temp ?? 0));
        if ( (dealt > 0) && retort.source ) {
          const logged = await inflict({ step: { formula: String(dealt), damageType: retort.type }, targetUuid: retort.source,
            speaker: ChatMessage.implementation.getSpeaker({ actor: patient }),
            flavor: loc("DegatsRenvoyes", { item: retort.item, name: patient.name }), flags: { retort: { item: retort.item } } });
          if ( logged ) { extra.push({ ...logged, name: retort.item }); log(`${retort.item}: ${dealt} ${retort.type} damage back to the attacker`); }
        }
      }
      // C12-f: Disintegrate — "a creature reduced to 0 HP by this spell is disintegrated": dead, no death saves (`killsAtZero`).
      if ( hp && hurting && (hp.after.value <= 0) && killsHere(contentOf(activity?.item).entry?.killsAtZero, activity, patient) && patient && !patient.statuses?.has("dead") ) {
        await applyStatusToToken(carrier, entry.token, "dead");
        log(`${activity.item.name}: ${patient.name} reduced to 0 HP — disintegrated`);
      }
      const target = await fromUuid(entry.token);
      // §16.46: what a defense (Resistance) removed from the damage.
      for ( const s of hp?.shields ?? [] ) {
        log(`${target?.name ?? entry.token}: ${s.name} reduces the damage by ${s.reduced} (${s.formula ?? "1d4"} = ${s.rolled})`);
        if ( target ) notice(target, loc("Retour.Reduit", { item: s.name, n: s.reduced }), "gain");
      }
      // A conditional effect (M3, §18.4: "if the target is Large or smaller") only goes through if it holds.
      // The resolution accompanies the facts: `hit.critical` is read there (Mace of Smiting: "on a 20 […] after this damage").
      const facts = factsFor({ source: source?.actor ?? null, target: target?.actor ?? null, activity, sourceToken: source,
        targetToken: target, resolution });
      const allowed = (entry.effects ?? []).filter(e => {
        if ( !e.if ) return !first;
        const ok = holds((typeof e.if === "string") ? JSON.parse(e.if) : e.if, facts);
        if ( !ok ) log(`effect ${e.id}: condition not met for ${target?.name ?? entry.token}, not applied`);
        return ok;
      });
      // "Pushed" (Shove) is not an effect: it is a forced move, away from the author.
      const { effects: toApply, pushes } = await splitPushes(carrier, allowed);
      for ( const push of pushes ) await forcedMove(source, target, { mode: "push", ...push });
      const effects = [...early, ...await applyEffectsToToken(carrier, entry.token, toApply)];
      if ( toApply.length > effects.length - early.length ) log(`${target?.name ?? entry.token}: ${toApply.length - effects.length} planned effect(s) not applied (${toApply.map(e => e.id).join(", ")})`);
      else if ( (entry.effects ?? []).length && !toApply.length && !pushes.length && !early.length ) log(`${target?.name ?? entry.token}: no effect to apply (${(entry.effects ?? []).length} planned)`);
      // Content outcome steps (SPEC §16): push, pull, condition — if their condition holds for this target.
      for ( const step of entry.steps ?? [] ) {
        const condition = (typeof step.if === "string") ? JSON.parse(step.if) : step.if;   // JSON in the plan (adapter/usage.mjs)
        if ( !holds(condition, facts) ) {
          log(`${step.name ?? step.type}: condition not met for ${target?.name ?? entry.token}, step "${step.type}" skipped`);
          continue;
        }
        if ( step.type === "move" ) await forcedMove(source, target, { ...step, activity });
        else if ( step.type === "disarm" ) {
          // §19.6: "the enemy drops the item" — their equipped melee weapon (the first), unequipped.
          // §304: "Occult Bond" — "you cannot be disarmed of the bonded weapon while you are not Incapacitated".
          const incapacitated = target?.actor?.statuses?.has("incapacitated");
          const bonded = i => !incapacitated && i.effects.some(e => !e.disabled && (identifierOf(originItemOf(e) ?? {}).id === "war-bond"));
          const weapon = target?.actor?.items.find(i => (i.type === "weapon") && i.system.equipped && !bonded(i)
            && Array.from(i.system.activities ?? []).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
          if ( weapon ) {
            await weapon.update({ "system.equipped": false });
            notice(target, loc("Retour.Desarme", { item: weapon.name }), "ended");
            log(`${step.name ?? "disarm"}: ${target.name} drops ${weapon.name}`);
          } else if ( step.elseEffect && target?.actor && activity?.item ) {
            // C12-b: nothing to drop (Heat Metal on worn armor) — the item's effect instead (Disadvantage).
            await placeItemEffect(activity.item, step.elseEffect, target.actor);
            log(`${step.name ?? "disarm"}: ${target.name} has nothing to drop, "${step.elseEffect}" placed`);
          }
        }
        else if ( step.type === "damage" ) {
          // §19: outcome damage ("if it fails the saving throw, or half as much on a success").
          const part = step.saved ? ((step.onSave === "half") ? 0.5 : 0) : 1;
          const logged = await inflict({
            step, item: activity?.item ?? null, multiplier: part, targetUuid: entry.token,
            speaker: ChatMessage.implementation.getSpeaker({ token: source ?? undefined }),
            flavor: loc("DegatsIssue", { item: step.name ?? activity?.item?.name ?? "", name: target?.name ?? "" }),
            flags: { outcomeDamage: { item: step.name ?? null, target: entry.token } }
          });
          if ( logged ) { extra.push({ ...logged, name: step.name }); log(`${step.name}: ${target?.name} takes ${step.formula} ${step.damageType}${part < 1 ? " (half)" : ""}`); }
        }
        else if ( step.type === "mark" ) {
          const uuid = await applyMarkToToken(carrier, entry.token, step, loc(step.label));
          if ( uuid ) { effects.push(uuid); log(`${step.name ?? "mark"}: ${target?.name} receives "${step.mark}"`); }
        }
        else if ( step.type === "revertForm" ) {
          // §402: "a polymorphed creature that fails the save reverts to its true form" (Moonbeam) — the dnd5e transformation
          // (Wild Shape, Polymorph) undone through its API.
          if ( target?.actor?.isPolymorphed ) {
            await target.actor.revertOriginalForm({ renderSheet: false });
            log(`${step.name ?? "revert"}: ${target.name} reverts to its true form`);
          }
        }
        else if ( step.type === "banish" ) {
          // §402: sent back to its plane of origin (Divine Word) — removed from the scene and the combat (runtime/banish.mjs).
          if ( target && await banishToken(target) ) log(`${step.name ?? "banish"}: ${target.name} sent back to its plane`);
        }
        else if ( step.type === "breakConcentration" ) {
          // §91: "its Concentration is broken" (Earthquake).
          if ( target?.actor?.concentration?.effects?.size ) {
            await target.actor.endConcentration();
            log(`${step.name ?? "concentration"}: ${target.name}'s is broken`);
          }
        }
        else if ( step.type === "lift" ) {
          // §164: Reverse Gravity — the area of this use (the most recent of the activity) falls with it.
          const region = target?.parent?.regions?.filter(r => r.getFlag("dnd5e", "activity") === activity?.uuid).at(-1) ?? null;
          await liftToken(target, step, region);
        }
        else if ( step.type === "status" ) {
          // §352: `around` — the target and each creature within this distance of it, the author excepted
          // ("Thunder Hammer": "the target and each creature within 9 m of it other than you"), each with its own save.
          const struck = target ? [target, ...(step.around ? creaturesAround(target, step.around, source) : [])] : [];
          for ( const victim of struck ) {
            // §345: the condition only on a failed save (Giant Slayer), rolled here, without a window.
            if ( step.save && victim.actor ) {
              const saved = await requestSave(victim.actor, { ability: step.save.ability, dc: step.save.dc, flavor: step.name ?? null });
              log(`${step.name ?? "condition"}: ${victim.name} ${step.save.ability} saving throw ${saved?.total ?? "?"} vs DC ${step.save.dc}: ${saved?.success ? "succeeded" : "failed"}`);
              if ( saved?.success !== false ) continue;
            }
            const uuid = await applyStatusToToken(carrier, victim.uuid, step.status, { escapeDc: step.escapeDc ?? null });
            if ( uuid ) { effects.push(uuid); log(`${step.name ?? "condition"}: ${victim.name} receives "${step.status}"`); }
            // O9a (§354): "destroyed", "killed outright" — Dead, and HP at 0 (like the HP tiers, further down).
            if ( uuid && (step.status === "dead") ) await victim.actor?.update({ "system.attributes.hp.value": 0 });
          }
        }
      }
      for ( const status of tier?.statuses ?? [] ) {
        // §303 (pass C8): Death Ward — "an effect that would kill it outright without dealing damage is negated": the
        // ward drops in place of the death (Power Word Kill, Divine Word).
        const ward = (status === "dead") ? deathWardOf(target?.actor) : null;
        if ( ward ) { await ward.delete(); log(`${activity?.item?.name}: ${target?.name} is not killed, ${ward.name} ends instead`); continue; }
        // The condition first, the HP afterwards: at 0 HP, dnd5e and the engine themselves place Dead (same id,
        // `dnd5edead0000000`) — two crossed creations made the resolution fail (seen on 2026-10-12, Divine Word).
        const uuid = await applyStatusToToken(carrier, entry.token, status);
        if ( uuid ) { effects.push(uuid); log(`${activity?.item?.name}: ${target?.name} at ${tier.hp} HP receives "${status}"`); }
        if ( status === "dead" ) await target?.actor?.update({ "system.attributes.hp.value": 0 });
      }
      // K2 (§323): "it drops to 0 HP" ("Deadly Gaze", "Ominous Wail") — damage equal to its HP, by dnd5e: Death Ward and
      // the engine's 0 HP rule (Dead for an NPC, Unconscious for a character) decide as for any blow.
      if ( tier?.zero && target?.actor ) {
        const hpNow = target.actor.system?.attributes?.hp ?? {};
        const total = Number(hpNow.value ?? 0) + Number(hpNow.temp ?? 0);
        if ( total > 0 ) { await target.actor.applyDamage(total); log(`${activity?.item?.name}: ${target.name} at ${tier.hp} HP drops to 0 HP`); }
      }
      entries.push({ token: entry.token, actor: entry.actor, before: hp?.before ?? null, after: hp?.after ?? null, effects });
      for ( const r of retaliations ) {
        // §86: a retaliation by a save of the attacker (Holy Aura) — its own resolution, apart.
        if ( r.step.type === "save" ) {
          const asked = await saveRetaliation(r, { bearerToken: struck, attackerToken: source });
          if ( asked ) log(`${r.declaration.name}: ${source?.name} makes its saving throw for hitting ${struck.name}`);
          continue;
        }
        const logged = await retaliate(r, { bearerToken: struck, attackerToken: source });
        if ( logged ) { extra.push(logged); log(`${r.declaration.name}: ${source?.name} takes ${(logged.before.value + logged.before.temp) - (logged.after.value + logged.after.temp)} damage for hitting ${struck.name}`); }
      }
    }
    // §27: Blessed Healer — "immediately after casting with a spell slot a spell that restores HP to another creature".
    if ( slotHeal?.healer && healedOther && source?.uuid ) {
      const logged = await applyDamageToToken(source.uuid, [{ type: "healing", value: slotHeal.healer, properties: new Set() }], damageMessage);
      if ( logged ) { extra.push({ ...logged, name: "blessed-healer" }); log(`Blessed Healer: ${source.name} regains ${slotHeal.healer} HP`); }
    }
    // Repeated save ("resave" building block): succeeded, the effect drops; failed, nothing changes — except the damage it
    // carries (§19.6, `onFail`: the bleeding of "Thorn").
    if ( resave?.effect ) {
      /** §19.6: the bearer's damage that only applies if the save fails (bleeding of "Thorn", Othur's Fumes). */
      const failDamage = async t => {
        if ( !resave.onFail || !t.save || (t.save.success === true) ) return;
        const item = await fromUuid(resave.onFail.item ?? "");
        for ( const step of resave.onFail.steps ?? [] ) {
          const logged = await inflict({ step, item, scaling: resave.onFail.scaling ?? 0, targetUuid: t.token,
            speaker: ChatMessage.implementation.getSpeaker({ token: (await fromUuid(t.token)) ?? undefined }),
            flavor: loc("DegatsPorteur", { item: resave.onFail.name ?? item?.name ?? "", name: t.name }),
            flags: { bearerDamage: { item: resave.onFail.identifier ?? null, effect: resave.effect, moment: resave.moment } } });
          if ( logged ) { extra.push({ ...logged, name: resave.onFail.name }); log(`${resave.onFail.name}: saving throw failed, ${t.name} takes its damage`); }
        }
      };
      for ( const t of resolution.targets ) {
        // §495 (block B15): condition ladder — a failure goes up a step, a success goes down one; at step 0, the effect drops.
        if ( resave.stages && t.save ) {
          const effect = await fromUuid(resave.effect);
          if ( !effect ) continue;
          const rule = resave.stages;
          const prior = effect.getFlag(MODULE_ID, "stage") ?? {};
          const natural20 = isNatural20(t.save);
          const after = stageAfter(prior.level, t.save.success === true, { count: rule.stages.length, onSuccess: rule.onSuccess, natural20, critEnds: rule.critEnds });
          if ( after.outcome === "ended" ) {
            // The step effects depend on the effect (`dependentOn`): dnd5e removes them with it.
            log(`stages: ${t.name} ${(natural20 && rule.critEnds) ? "rolls a natural 20" : "succeeds"}, "${effect.name}" removed`);
            notice(t.token, effect.name, "effectOff", { all: true, action: "stage", outcome: "success" });
            await effect.delete();
            continue;
          }
          if ( after.outcome !== "same" ) await moveStage(effect, prior, after.level, rule);
          const label = await stageLabel(effect, after.level, rule);
          const key = (after.outcome === "down") ? "Palier.Recule" : ((after.outcome === "up") ? "Palier.Monte" : "Palier.Reste");
          log(`stages: ${t.name} — "${effect.name}" ${after.outcome} to stage ${after.level}/${rule.stages.length} (${label})`);
          notice(t.token, { key: `DND5ECOMBAT.${key}`, data: { item: effect.name, stage: label } }, (after.outcome === "down") ? "prompt" : "refused",
            { all: true, action: "stage", outcome: (after.outcome === "down") ? "success" : "failure" });
          await failDamage(t);
          continue;
        }
        // §43.1: counter — the effect only drops at the success threshold; at the failure threshold, it stays, no more replays.
        if ( resave.tally && t.save ) {
          const effect = await fromUuid(resave.effect);
          if ( !effect ) continue;
          const after = tallyAfter(effect.getFlag(MODULE_ID, "tally"), t.save.success === true, resave.tally);
          const said = loc("Compteur.Etat", { successes: after.successes, successesMax: resave.tally.successes, failures: after.failures, failuresMax: resave.tally.failures });
          if ( after.outcome === "ended" ) {
            log(`tally: ${t.name} reaches ${after.successes} success(es), "${effect.name}" removed`);
            notice(t.token, effect.name, "effectOff");
            await effect.delete();
            continue;
          }
          const update = { [`flags.${MODULE_ID}.tally`]: { successes: after.successes, failures: after.failures, settled: after.settled } };
          if ( (after.outcome === "settled") && resave.tally.status ) update.statuses = [...new Set([...(effect.statuses ?? []), resave.tally.status])];
          await effect.update(update);
          log(`tally: ${t.name} — ${said}${after.settled ? `; settled, "${effect.name}" remains${resave.tally.status ? ` (${resave.tally.status})` : ""}` : ""}`);
          notice(t.token, after.settled ? loc("Compteur.Clos", { item: effect.name }) : said, after.settled ? "refused" : "prompt");
          // O9h (§363): a counter with failure damage (Othur's Fumes: "at each new failure, 1d6 poison damage").
          await failDamage(t);
          continue;
        }
        if ( t.save?.success !== true ) {
          // §37: Curse, "Cursed Actions" — failed, the creature takes the Dodge action this turn.
          if ( resave.dodge && t.save ) await forceDodge(t.token);
          await failDamage(t);
          continue;
        }
        if ( resave.keep ) { log(`repeated saving throw succeeded: ${t.name} keeps the effect (it does not end on a success)`); continue; }
        const effect = await fromUuid(resave.effect);
        if ( effect ) { await effect.delete(); log(`repeated saving throw succeeded: "${effect.name}" removed from ${t.name}`); }
      }
    }
    return [{ type: "applied", entries, extra }];
  },

  /** Exclusive effects: the author chooses (adapter/choices.mjs). No answer: the resolution stays pending, the question is re-asked at `ready`. */
  async askChoice(command, carrier, resolution) {
    const actor = await fromUuid(resolution.source ?? "");
    const activity = await fromUuid(resolution.activity ?? "");
    const item = activity?.item?.name ?? "";
    if ( !actor ) return [];
    // K3 (§324): an effect rolled on a die ("Chaos Blade": 1d4) — a roll visible to all, one face per option, no question.
    if ( command.roll ) {
      const roll = await new Roll(`1d${command.options.length}`).evaluate();
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: loc("EffetTire", { item }) });
      const picked = command.options[roll.total - 1];
      log(`${item}: d${command.options.length} = ${roll.total} → ${picked?.label ?? "?"}`);
      return picked ? [{ type: "choiceMade", id: picked.id }] : [];
    }
    // §401: one choice per target — one question per creature, named.
    if ( command.perTarget?.length ) {
      const choices = {};
      for ( const t of command.perTarget ) {
        const prompt = loc("ChoixParCible", { name: t.name });
        const answer = await askChoice(actor, { actor: actor.uuid, item, prompt, options: command.options });
        if ( answer ) choices[t.token] = answer.id;
        log(`${item}: ${actor.name} chooses ${command.options.find(o => o.id === answer?.id)?.label ?? "(first option)"} for ${t.name}`);
      }
      return [{ type: "choiceMade", choices }];
    }
    log(`${item}: ${actor.name} must choose an effect (${command.options.map(o => o.label).join(", ")})`);
    const answer = await askChoice(actor, { actor: actor.uuid, item, prompt: command.prompt, options: command.options });
    if ( !answer ) { log(`${item}: no effect chosen, waiting`); return []; }
    log(`${item}: ${actor.name} chooses ${command.options.find(o => o.id === answer.id)?.label ?? answer.id}`);
    return [{ type: "choiceMade", id: answer.id }];
  },

  /** The essentials repeated where they are read: the verdict under the attack roll, the HP under the damage roll. */
  async echo(command, carrier, resolution) {
    if ( command.on === "attack" ) {
      log(`attack ${resolution.attack.roll.total} →`, resolution.targets.map(t =>
        `${t.name}: ${t.hit ? (t.critical ? "critical" : "hit") : "miss"}${t.reaction ? ` (${t.reaction})` : ""}`).join(", "));
      const attackMessage = game.messages.get(resolution.attack.messageId);
      if ( attackMessage && (attackMessage.id !== carrier.id) ) await attackMessage.setFlag(MODULE_ID, "verdict", { carrier: carrier.id });
      // §19.6: "miss" window (Riposte, Disarm) — for each target the attack did not hit.
      const missed = resolution.targets.filter(t => (t.hit === false) && !t.unaffected).map(t => t.token);
      if ( missed.length ) windowIsMissed(missed, speakerTokenUuid(carrier), carrier.speaker?.alias ?? "",
        { activity: resolution.activity, auto: autoReactOf(carrier, resolution), resolution });
      // §236: "a hostile creature has just attacked" (Soul of Vengeance), hit or miss.
      windowEnemyAttacked(speakerTokenUuid(carrier), carrier.speaker?.alias ?? "", { activity: resolution.activity, auto: autoReactOf(carrier, resolution) });
      // §492: who attacked whom this turn (fact `source.attackedSelfThisTurn`), hit or miss.
      const attacker = fromUuidSync(resolution.source ?? "", { strict: false });
      const attacked = resolution.targets.filter(t => !t.unaffected).map(t => fromUuidSync(t.token, { strict: false })?.actor).filter(Boolean);
      const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
      await noteAttack(attacker, attacked, activity, { attackMode: attackMessage?.rolls?.[0]?.options?.attackMode ?? null });
      return;
    }
    const damageMessage = game.messages.get(resolution.damageRoll?.messageId);
    if ( !damageMessage || (damageMessage.id === carrier.id) ) return;
    await damageMessage.setFlag(MODULE_ID, "applied", {
      carrier: carrier.id,
      lines: resolution.targets.filter(t => t.damage).map(t => ({ name: t.name, token: t.token, applied: t.damage.applied })),
      undone: resolution.step === STEPS.UNDONE
    });
  },

  /** "Hurt" window: no bearing on this resolution, so no waiting. */
  window(command, carrier, resolution) {
    // §19: what hurt — the activity (Defenses: "a melee attack") and the damage types (Absorb Elements).
    const damageTypes = [...new Set((resolution?.damageRoll?.damages ?? []).map(d => d.type).filter(Boolean))];
    if ( command.window === "isDamaged" ) windowIsDamaged(command.tokens, speakerTokenUuid(carrier), carrier.speaker?.alias ?? "",
      { activity: resolution?.activity ?? null, damageTypes, auto: autoReactOf(carrier, resolution) });
    // §487: "succeeds on a saving throw against" ("Mage's Retaliation").
    if ( command.window === "savesAgainst" ) windowSavesAgainst(command.tokens, speakerTokenUuid(carrier), carrier.speaker?.alias ?? "",
      { activity: resolution?.activity ?? null, auto: autoReactOf(carrier, resolution) });
  },

  /**
   * Instant area removed a little after the resolution, not right away: an animation module
   * (BLFX, `boss-loot-assets-premium`) plays its effect on the region, writes to it, then deletes it
   * itself (`BlfxMacroExecutor.deleteTemplate`, 1 s after the animation). Removing it at the same time
   * made that module write to a vanished region ("id … does not exist", seen on 2026-09-23).
   * If it already did so, there is nothing left to remove.
   */
  cleanup(command, carrier) {
    setTimeout(() => removeTransientRegions(carrier.id)
      .then(removed => { if ( removed ) log(`${removed} instantaneous area(s) removed`); })
      .catch(err => log("instantaneous area: removal failed", err?.message)), TRANSIENT_LINGER_MS);
  }
};

/** Forced movement of a target relative to the author (`move` step, and "pushed" from Shove). */
async function forcedMove(source, target, { mode, distance, units, follow=false, upTo=false, toward=null, activity=null, directions=null, ifBlocked="stop", minSpeed=null }) {
  if ( !source || !target ) return;
  if ( mode === "random" ) return randomMove(source, target, { distance, units, directions, ifBlocked, minSpeed, activity });
  // §466: toward the center of the activity's area (Implosion) — the last region placed by it on the target's scene.
  let point = null;
  if ( toward === "area" ) {
    const regions = (target.parent?.regions ?? []).filter(r => activity && (r.getFlag("dnd5e", "activity") === activity.uuid));
    point = regions.length ? zoneCenter(regions.at(-1)) : null;
    if ( !point ) return log(`pull: no area of ${activity?.item?.name ?? "the activity"} on the scene, ${target.name} not moved`);
  }
  // §502 (B22): toward the author's summon (the vine of "Greedy Vine"), not toward the author.
  if ( toward === "summon" ) {
    const anchor = summonTokenFor(source.actor, activity?.item ?? null, target.parent, target);
    if ( !anchor ) return log(`pull: no creature summoned by ${source.name} on the scene, ${target.name} not moved`);
    point = tokenCenter(anchor);
    log(`pull: toward ${anchor.name} (summoned by ${source.name})`);
  }
  // §401: "up to" — the author chooses, by cells, from 0 to the permitted distance.
  if ( upTo && Number.isFinite(distance) ) {
    const chosen = await askDistance(source, target, { mode, distance, units });
    if ( chosen === null ) return;
    distance = chosen;
    if ( !(distance > 0) ) return log(`${mode}: ${target.name} not moved (the author's choice)`);
  }
  const towards = mode === "pull";
  // A distance as a formula is read on the source ("Powerful Hand": "5 + 5 * @flags.dnd5e.summon.mod", §16.15).
  let value = distance;
  if ( typeof distance === "string" ) {
    try { value = new Roll(distance, source.actor?.getRollData() ?? {}).evaluateSync({ strict: false }).total; }
    catch(err) { return log(`push: distance "${distance}" unreadable (${err.message})`); }
    if ( !(value > 0) ) return log(`push: distance "${distance}" = ${value}, nothing`);
  }
  // Dwarven Plate: "if an effect moves you against your will along the ground, you can use your Reaction to reduce the
  // distance by up to 3 m" (`reducesForcedMove`) — asked of the bearer, who keeps their Reaction if they do not answer.
  value = await bracedDistance(target, value, units, towards ? "pull" : "push");
  if ( !(value > 0) ) return log(`${towards ? "pull" : "push"}: ${target.name} not moved (braced)`);
  const { cells, wanted } = await pushAway(source, target, { distance: value, units }, readUnitFactors(), { towards, follow, point });
  log(`${towards ? "pull" : "push"}: ${target.name} ${towards ? "pulled" : "pushed"} ${cells} square(s) out of ${wanted}${cells < wanted ? " (stopped)" : ""}`);
}

/** `reducesForcedMove`: what remains of a forced move, once the bearer's Reaction is taken — or the distance unchanged. */
async function bracedDistance(target, value, units, mode) {
  const actor = target?.actor;
  if ( !actor || !Number.isFinite(value) ) return value;
  const item = Array.from(actor.items ?? []).find(i => (i.system?.equipped !== false) && contentOf(i).entry?.reducesForcedMove);
  const cut = item ? braceCut(contentOf(item).entry.reducesForcedMove, value, units) : 0;
  if ( !(cut > 0) || budgetIssues(actor, "reaction").length ) return value;
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Ancrage.Question", { n: cut, units }),
    options: [{ id: "keep", label: loc("Ancrage.Non") }, { id: "brace", label: loc("Ancrage.Oui", { n: cut, units }) }] });
  if ( answer?.id !== "brace" ) return value;
  await spendBudget(actor, "reaction");
  log(`${item.name}: ${actor.name} takes a Reaction, the ${mode} is reduced by ${cut} ${units}`);
  return value - cut;
}

/**
 * §497: random move (`move` step, `random` mode: Infestation, "the target moves 1.50 m in a random
 * direction"). Nothing if the target's walking Speed is below `minSpeed`; otherwise a visible 1dN (N = number of `directions`),
 * awaited until the 3D dice end, chooses the direction; the move is suffered (`pushAway`, a `displace` step: no Opportunity
 * Attack nor cost); `ifBlocked: "stay"`: all or nothing. The result is noted on the roll's message
 * (`flags.dnd5e-combat.randomMove`: token, face, direction, cells, blocked) and told to the whole table (text and sound).
 */
async function randomMove(source, target, { distance, units, directions, ifBlocked, minSpeed, activity }) {
  const actor = target.actor;
  if ( !actor ) return;
  const factors = readUnitFactors();
  const itemName = activity?.item?.name ?? "";
  if ( Number.isFinite(minSpeed) ) {
    const speed = speedOf(actor, factors, null, target.parent);
    const needed = speed ? lengthIn(minSpeed, units, speed.units, factors) : Infinity;
    if ( !speed || ((speed.speed + 1e-6) < needed) ) {
      notice(target, { key: "Retour.AleatoireLent" }, "refused", { all: true, action: "control", outcome: "failure" });
      return log(`random: ${target.name} not moved — speed ${speed?.speed ?? 0} ${speed?.units ?? ""} under ${minSpeed} ${units} (${itemName})`);
    }
  }
  let value = distance;
  if ( typeof distance === "string" ) {
    try { value = new Roll(distance, source.actor?.getRollData() ?? {}).evaluateSync({ strict: false }).total; }
    catch(err) { return log(`random: distance "${distance}" unreadable (${err.message})`); }
    if ( !(value > 0) ) return log(`random: distance "${distance}" = ${value}, nothing`);
  }
  const faces = randomDie(directions);
  const keys = (Array.isArray(directions) && directions.length) ? directions : MOVE_DIRECTIONS;
  const legend = keys.map((k, i) => `${i + 1} ${loc(`Deplacement.Direction.${k}`)}`).join(", ");
  const roll = await new Roll(`1d${faces}`).evaluate();
  const message = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: target }),
    flavor: loc("Deplacement.AleatoireJet", { name: target.name, item: itemName, legend }) });
  await waitForDice(message);
  const direction = randomDirection(directions, roll.total);
  if ( !direction ) return log(`random: face ${roll.total} has no direction (${keys.join(", ")})`);
  const { cells, wanted, blocked = false } = await pushAway(source, target, { distance: value, units }, factors, { direction, whole: ifBlocked === "stay" });
  const label = loc(`Deplacement.Direction.${direction.key}`);
  if ( cells ) notice(target, { key: "Retour.Aleatoire", data: { direction: label } }, "gain", { all: true, action: "control", outcome: "success" });
  else notice(target, { key: "Retour.AleatoireBloque" }, "refused", { all: true, action: "control", outcome: "failure" });
  await message?.setFlag?.(MODULE_ID, "randomMove", { token: target.uuid, face: roll.total, direction: direction.key, cells, wanted, blocked: !cells });
  log(`random: ${target.name} rolls ${roll.total} (${direction.key}) — ${cells} square(s) out of ${wanted}${blocked || !cells ? " (blocked, stays)" : (cells < wanted ? " (stopped)" : "")}`);
}

/**
 * §401: the distance of an "up to" forced move — asked of the author (their player, otherwise the GM), by cells of the scene.
 * Returns the distance in `units`, or null if the author has no actor.
 */
async function askDistance(source, target, { mode, distance, units }) {
  const actor = source.actor;
  if ( !actor ) return null;
  const scene = source.parent;
  const sceneUnits = scene?.grid?.units || units;
  const step = Number(scene?.grid?.distance) || 5;
  const max = lengthIn(distance, units, sceneUnits);
  const options = [];
  for ( let n = 0; (n * step) <= max + 1e-6; n++ ) {
    const value = Math.round(n * step * 100) / 100;
    options.push({ id: String(n), label: n ? `${value} ${sceneUnits}` : loc("DistanceAucune"), value: n ? lengthIn(value, sceneUnits, units) : 0 });
  }
  options.reverse();   // farthest first: the default rule
  const answer = await askChoice(actor, { actor: actor.uuid, item: loc(mode === "pull" ? "Tirer" : "Repousser"),
    prompt: loc("DistanceQuestion", { name: target.name }), options: options.map(({ id, label }) => ({ id, label })) });
  const picked = options.find(o => o.id === answer?.id) ?? options[0];
  return picked.value;
}

/**
 * §352: the living creatures within `around.radius` (in `around.units`) of a token, on the same scene, it and the author excepted
 * (no object, no hidden token).
 */
function creaturesAround(center, around, source) {
  const factors = readUnitFactors();
  return (center.parent?.tokens ?? []).filter(t => (t !== center) && (t !== source) && t.actor && !t.hidden && !isObjectToken(t)
    && !t.actor.statuses?.has?.("dead") && (rangeIssue(distanceBetween(center, t), { value: around.radius, units: around.units }, factors) === null));
}

/** §355: does the author carry an item that maximizes their spells' damage against this creature's type (`maxSpellDamageVs`)? */
function spellDamageMaxed(actor, activity, target) {
  if ( !actor || !target || !isSpellCast(activity?.item) ) return false;
  const type = creatureTypeOf(target);
  return !!type && Array.from(actor.items ?? []).some(i => (contentOf(i).entry?.maxSpellDamageVs ?? []).includes(type));
}

/** §495: is the save a natural 20? Read on its roll message (`D20Roll#isCritical`, at the roll's critical threshold). */
function isNatural20(save) {
  const roll = game.messages.get(save?.messageId ?? "")?.rolls?.[0];
  return roll?.isCritical === true;
}

/**
 * §495: the effect moves from one step to another. The step left is undone — its effect (placed apart) removed, its condition
 * removed from the effect if it had added it there —, then the new one is placed: its item effect, dependent on the effect (dnd5e
 * removes it with it), and its condition added to the effect's conditions. The step reached is noted on the effect
 * (`flags.dnd5e-combat.stage`).
 */
async function moveStage(effect, prior, level, rule) {
  const statuses = new Set(effect.statuses ?? []);
  if ( prior.effect ) {
    const old = await fromUuid(prior.effect);
    if ( old && old.parent?.effects?.has(old.id) ) await old.delete();
  }
  if ( prior.status ) statuses.delete(prior.status);
  const stage = rule.stages[level - 1] ?? null;
  let placed = null;
  let added = null;
  if ( stage?.effect ) {
    const item = await fromUuid(rule.item ?? "");
    placed = item ? await placeItemEffect(item, stage.effect, effect.parent, { dependentOn: effect.uuid }) : null;
    if ( !placed ) log(`stages: effect ${stage.effect} not found on ${item?.name ?? rule.item}, stage ${level} without its effect`);
  }
  if ( stage?.status && !statuses.has(stage.status) ) { statuses.add(stage.status); added = stage.status; }
  await effect.update({ statuses: Array.from(statuses),
    [`flags.${MODULE_ID}.stage`]: { level, effect: placed?.uuid ?? null, status: added } });
}

/** §495: a step's name, for the notice — the effect alone at step 0, otherwise the placed step effect or the condition's name. */
async function stageLabel(effect, level, rule) {
  if ( !level ) return effect.name;
  const stage = rule.stages[level - 1] ?? {};
  const placed = await fromUuid(effect.getFlag(MODULE_ID, "stage")?.effect ?? "");
  if ( placed?.name ) return placed.name;
  const status = CONFIG.statusEffects.find(s => s.id === stage.status);
  return status ? game.i18n.localize(status.name) : (stage.status ?? String(level));
}
