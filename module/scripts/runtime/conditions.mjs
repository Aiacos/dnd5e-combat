import { MODULE_ID } from "../constants.mjs";
import { attackModifiers, combineTargets, manualModeOverride } from "../core/conditions.mjs";
import { alertGM } from "./gm-alert.mjs";
import { attackContext, registerTurnStatuses, setStatus, TURN_STATUSES, frightenedSourceSeen } from "../adapter/conditions.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { declaredAttackBonuses } from "../adapter/triggers.mjs";
import { readBudget, usageTokenOf as usageToken } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { takeAttackMods } from "./reactions.mjs";
import { foretoldRange } from "../core/portent.mjs";
import { log, loc } from "./shared.mjs";
import { enqueue } from "./queue.mjs";
import { normalizeTargetModes, attackModeAgainst } from "../core/target-modes.mjs";

/**
 * Before the attack roll dialog, on the attacker's client: the conditions of the two creatures
 * and the situation (long range, ranged attack in melee) set Advantage or Disadvantage by
 * default. The player sees this choice in the dialog and can change it; the reasons go with
 * the message to be displayed under the roll.
 */
function onPreRollAttack(config, dialogConfig, messageConfig) {
  const activity = config.subject;
  const roll = config.rolls?.[0];
  if ( !activity?.item || !roll || !canvas.ready ) return true;
  const origin = usageToken(activity);
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  if ( !origin || !targets.length ) return true;

  const factors = readUnitFactors();
  const attackMode = config.attackMode ?? roll.options?.attackMode ?? null;
  const contexts = targets.map(t => attackContext(origin, t, activity, attackMode, factors));
  for ( const [i, c] of contexts.entries() ) {
    if ( c.vision ) log(`vision: ${origin.name} ${c.vision.attackerSees ? "sees" : "does not see"} ${targets[i].name}, who ${c.vision.targetSees ? "sees them" : "does not see them"}`);
  }
  const perTarget = contexts.map(attackModifiers);
  // C12-e: Brutal Strike — "you forgo any Advantage on this roll", which "must not have Disadvantage": with Disadvantage,
  // Brutal Strike does not apply (the mark drops, the Advantage stays).
  const brutal = (activity.actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, "brutalStrike")?.activity === activity.uuid);
  if ( brutal ) {
    if ( perTarget.some(p => p.disadvantage.length) || roll.options?.disadvantage ) {
      log("attack: Brutal Strike not possible (Disadvantage on the roll)");
      brutal.delete().catch(err => console.warn(`${MODULE_ID} | Brutal Strike mark`, err));
    } else {
      for ( const p of perTarget ) p.advantage = [];
      roll.options ??= {};
      roll.options.advantage = false;
      log("attack: Brutal Strike, Advantage forgone");
    }
  }
  // §34: what the pre-roll reactions decided ("Shadow Evasion", "Protective Flash": Disadvantage; die removed).
  const reacted = takeAttackMods(activity.uuid);
  if ( reacted?.disadvantage ) for ( const p of perTarget ) p.disadvantage = [...p.disadvantage, { who: "reaction", key: reacted.names.join(", ") }];
  if ( reacted?.penalty ) {
    roll.parts ??= [];
    roll.parts.push(`-${reacted.penalty}`);
    log(`attack: -${reacted.penalty} (${reacted.names.join(", ")})`);
  }
  // §36: Portent — the d20 equals the noted roll (die bounds: core/portent.mjs, adapter/portent.mjs).
  if ( Number.isInteger(reacted?.foretold) ) {
    roll.options ??= {};
    Object.assign(roll.options, foretoldRange(reacted.foretold));
    log(`attack: Portent, d20 = ${reacted.foretold}`);
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.foretold`, reacted.foretold);
  }
  // §36: die added by an ally (Cosmic Omen, Fortune).
  if ( reacted?.bonus ) {
    roll.parts ??= [];
    roll.parts.push(`${reacted.bonus}`);
    log(`attack: +${reacted.bonus} (${reacted.names.join(", ")})`);
  }
  const { mode, agreed } = combineTargets(perTarget);
  const reasons = {
    agreed,
    advantage: agreed ? perTarget[0].advantage : [],
    disadvantage: agreed ? perTarget[0].disadvantage : []
  };
  if ( !agreed ) ui.notifications.warn("DND5ECOMBAT.CiblesDivergentes", { localize: true });
  else if ( reasons.advantage.length || reasons.disadvantage.length ) {
    roll.options ??= {};
    // We add our sources to the system's; it combines them itself (both = normal roll).
    if ( reasons.advantage.length ) roll.options.advantage = true;
    if ( reasons.disadvantage.length ) roll.options.disadvantage = true;
    log(`attack: ${mode === 1 ? "advantage" : mode === -1 ? "disadvantage" : "advantage and disadvantage cancel out"}`,
      [...reasons.advantage, ...reasons.disadvantage].map(r => `${r.who}.${r.key}`).join(", "));
  }
  if ( !agreed || reasons.advantage.length || reasons.disadvantage.length ) {
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.modifiers`, reasons);
  }
  // §16.46: what the declarations add to the roll ("Defensive Veil": "-1d4"), for the first target.
  const bonuses = declaredAttackBonuses(origin, targets[0], activity);
  if ( bonuses.length ) {
    roll.parts ??= [];
    for ( const b of bonuses ) roll.parts.push(b.formula);
    log(`attack: ${bonuses.map(b => `${b.formula} (${b.name})`).join(", ")}`);
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.bonuses`, bonuses);
  }
  return true;
}

/**
 * §17.3: Frightened (2024) — Disadvantage on ability checks (skills, tools, Initiative: the dnd5e hook
 * `abilityCheck`, documents/actor/actor.mjs:1403 and :1913) as long as the source of the fear is in sight.
 * dnd5e does not do it (`CONFIG.DND5E.conditionEffects`: nothing for `frightened`). Unknown source: the condition applies.
 */
function onPreRollAbilityCheck(config) {
  const actor = config.subject;
  const roll = config.rolls?.[0];
  if ( !actor?.statuses?.has("frightened") || !roll ) return true;
  if ( frightenedSourceSeen(tokenOnViewedScene(actor)) === false ) return true;
  roll.options ??= {};
  roll.options.disadvantage = true;
  log(`${actor.name}: Frightened → disadvantage on ability check`);
  return true;
}

/* -------------------------------------------- */
/*  Turn conditions visible on the token        */
/* -------------------------------------------- */

/** What a combatant's budget must show on its token. `dodging` is the system's native condition. */
function wantedStatuses(budget) {
  return {
    [TURN_STATUSES.reactionUsed.id]: !!budget && (budget.reaction < 1),
    [TURN_STATUSES.dashing.id]: !!budget?.dashed,
    [TURN_STATUSES.disengaged.id]: !!budget?.disengaged,
    [TURN_STATUSES.readied.id]: !!budget?.readied,
    dodging: !!budget?.dodging
  };
}

/**
 * Queued per actor, the budget re-read at the moment of acting: two combatant updates almost together (Step of the Wind: Dash
 * then the Flurry budget) launched two syncs, which both saw the condition missing and created it twice ("_id
 * dnd5edashing0000 already exists", scenario `moine`, 2026-10-20). `budgetOf`: the budget to show, or null (nothing left).
 */
function syncTurnStatuses(combatant, budgetOf) {
  const actor = combatant.actor;
  if ( !actor ) return Promise.resolve();
  return enqueue(`turn-statuses:${actor.uuid}`, async () => {
    for ( const [id, active] of Object.entries(wantedStatuses(budgetOf())) ) await setStatus(actor, id, active);
  });
}

/**
 * §249: the Advantage or Disadvantage given per target in the use message (`flags.dnd5e-combat.targetModes`,
 * core/target-modes.mjs), inverted on the attack roll against it. Read from the roll's origin message (`system.origin`,
 * activity/attack.mjs:69), whether the attacker has a token or not (a trap). The system combines our sources with its own
 * (both: normal roll). Targets that do not agree: nothing is placed, and the warning about diverging targets.
 */
function onGivenTargetModes(config, dialogConfig, messageConfig) {
  const roll = config.rolls?.[0];
  const originId = foundry.utils.getProperty(messageConfig ?? {}, "data.system.origin");
  const modes = normalizeTargetModes(originId ? game.messages.get(originId)?.getFlag(MODULE_ID, "targetModes") : null);
  if ( !roll || !modes ) return true;
  const targets = Array.from(game.user.targets).map(t => t.document);
  const { advantage, disadvantage, agreed } = attackModeAgainst(targets.map(t => modes[t.uuid] ?? null));
  if ( !agreed ) { ui.notifications.warn("DND5ECOMBAT.CiblesDivergentes", { localize: true }); return true; }
  if ( !advantage && !disadvantage ) return true;
  roll.options ??= {};
  if ( advantage ) roll.options.advantage = true;
  if ( disadvantage ) roll.options.disadvantage = true;
  log(`attack: ${advantage ? "advantage" : "disadvantage"} given by the user against ${targets.map(t => t.name).join(", ")}`);
  return true;
}

/**
 * §480: on the active GM, when an attack roll is created — a Disadvantage decided by the engine, removed by hand (Advantage key or
 * button of dnd5e's roll window): the rule lets the GM decide, nothing is refused, but the GM knows (GM alert, setting
 * `gmAlerts`). The card also says it to everyone (ui/chat.mjs, `modifierLines`).
 */
function onAttackMessage(message) {
  if ( message.type !== "attack" ) return;
  const manual = manualModeOverride(message.getFlag(MODULE_ID, "modifiers"), message.rolls?.[0]?.options);
  if ( !manual ) return;
  const actor = message.getAssociatedActor?.() ?? null;
  const item = message.getAssociatedItem?.() ?? null;
  log(`attack: Disadvantage set aside by hand (${manual}) — ${actor?.name ?? "?"}, ${item?.name ?? "?"}`);
  alertGM({ text: loc(`ModeManuel.Alerte.${manual}`, { actor: actor?.name ?? message.alias ?? "", item: item?.name ?? "" }), item, actor })
    .catch(err => console.error(`${MODULE_ID} | manual roll mode: GM notice`, err));
}

/* -------------------------------------------- */

export function registerConditions() {
  route("createChatMessage", onAttackMessage, { executor: true, label: "manual roll mode: GM not told" });
  registerTurnStatuses();
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "condition advantage and disadvantage" });
  route("dnd5e.preRollAttackV2", onGivenTargetModes, { cancellable: true, label: "advantage and disadvantage given per target" });
  route("dnd5e.preRollAbilityCheckV2", onPreRollAbilityCheck, { label: "Frightened: disadvantage on checks" });

  const statuses = { executor: true, label: "turn statuses not synchronized" };
  route("updateCombatant", (combatant, changes) => {
    if ( !changes.flags?.[MODULE_ID] ) return;
    return syncTurnStatuses(combatant, () => (combatant.combat?.started ? readBudget(combatant) : null));
  }, statuses);
  // End of combat, or combatant removed: nothing more to show.
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => syncTurnStatuses(c, () => null))), statuses);
  route("deleteCombatant", combatant => syncTurnStatuses(combatant, () => null), statuses);
}

