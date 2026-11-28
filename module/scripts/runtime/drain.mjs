/**
 * M8 (SPEC §18.16): maximum HP drops by the amount of damage taken (Life Drain…), or by a formula on a failed
 * save (Energy Drain); the vampire regains what it drains; reduced to 0, the maximum kills (2024 rules).
 * §105: the drain is an EFFECT on the target (adapter/drain.mjs); an ability score is also drained on a hit
 * (Shadow's Strength Drain: Strength −1d4, death at 0); in the 2014 format ("must succeed on … or its Hit Point maximum is
 * reduced…"), the part equal to the damage is only drained on the failed save that the hit imposes — decided AFTER
 * the attack's damage is applied (seen in play on 2026-10-07): the part is kept at calculation, and drained at resolution.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { drainedAmount, flooredDrain } from "../core/drain.mjs";
import { setDeathStatus, AFTER_ZERO_HP_MS } from "../adapter/death.mjs";
import { drainOf, damageSourceItem, damageSourceMessage, applyDrainEffect, effectiveMax } from "../adapter/drain.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { loc, log, locEsc, notice, say } from "./shared.mjs";

/** The effect's label, total included. */
function effectName(item, kind) {
  if ( kind === "hp" ) return total => loc("Drain.EffetPV", { item: item.name, n: total });
  const ability = CONFIG.DND5E.abilities[kind]?.label ?? kind;
  return total => loc("Drain.EffetCarac", { item: item.name, ability, n: total });
}

/**
 * 2014 format: the drained part waiting for the save, per use message and targeted actor. On the client that
 * applies the damage (the active GM, for an engine action), read by the resolution on the same client.
 */
const pending = new Map();
const pendingKey = (messageId, actorUuid) => `${messageId}|${actorUuid}`;

/** On the client that applies the damage: the drained part, kept for after the HP are written. */
function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = drainOf(item);
  if ( !rule?.equal ) return;
  const n = drainedAmount(damages, rule.type, damages.amount);
  if ( rule.onFailedSave ) {
    const message = damageSourceMessage(options);
    if ( message?.id ) pending.set(pendingKey(message.id, actor.uuid), n);
    return;
  }
  if ( n > 0 ) (options[MODULE_ID] ??= {}).drain = { n, item: item.uuid, source: item.actor?.uuid ?? null, regains: rule.regains, floor: rule.floor };
}

async function drain(actor, kind, n, { item, source=null, regains=false, floor=null }) {
  // §283: Contamination — the maximum does not go below its floor.
  if ( kind === "hp" ) n = flooredDrain(n, effectiveMax(actor), floor);
  if ( n <= 0 ) return;
  // §500: alive before the drain — the death it causes is announced (only once: the HP brought to 0 by the effect can also
  // set it).
  const alive = !actor.statuses?.has?.("dead");
  const left = await applyDrainEffect(actor, { kind, n, item, name: effectName(item, kind) });
  log(`${actor.name}: ${item.name} — ${kind === "hp" ? "Hit Point maximum" : kind} -${n} (${left})`);
  if ( left <= 0 ) {
    // §500: the effect has just brought HP to 0 — dnd5e sets Dead itself, with the same id (`updateDowned`, `keepId`), on the
    // client that wrote. The two creations crossed ("_id dnd5edead0000000 already exists" in the console, test bench of
    // 2026-11-20): like `ensureDowned` (adapter/death.mjs), we give it a moment and only set the condition if it is still missing.
    if ( (kind === "hp") && !actor.statuses?.has?.("dead") ) await new Promise(resolve => setTimeout(resolve, AFTER_ZERO_HP_MS));
    if ( !actor.statuses?.has?.("dead") ) await setDeathStatus(actor, "dead");
    log(`${actor.name}: ${kind === "hp" ? "Hit Point maximum" : kind} at 0 → Dead`);
    if ( alive ) await announceDrainDeath(actor, kind, item);
  }
  if ( !regains || !source ) return;
  const drinker = fromUuidSync(source, { strict: false });
  if ( !drinker?.isOwner ) return;
  await drinker.applyDamage([{ value: n, type: "healing" }]);
  log(`${drinker.name}: ${item.name} — regains ${n} HP`);
}

/**
 * §500 (B20): death by drain, seen and heard by the whole table (DAS rule: feedback for every action) — chat card
 * (flag `drainDeath`) and a notice above the token with sound, on every client.
 */
async function announceDrainDeath(actor, kind, item) {
  const what = (kind === "hp") ? loc("Drain.MaxPV") : (CONFIG.DND5E.abilities[kind]?.label ?? kind);
  await say({ actor }, locEsc("Drain.Mort", { name: actor.name, item: item.name, what }),
    { drainDeath: { actor: actor.uuid, item: item.uuid ?? null, kind } });
  const token = tokenOf(actor);
  if ( token ) notice(token, { key: "Drain.MortAvis", data: { name: actor.name } }, "info", { all: true, action: "drainDeath", outcome: "success" });
}

async function onApplyDamage(actor, amount, options) {
  const d = options?.[MODULE_ID]?.drain;
  if ( !d || !actor.isOwner ) return;
  const item = fromUuidSync(d.item, { strict: false });
  if ( item ) await drain(actor, "hp", d.n, { ...d, item });
}

/**
 * At the decided resolution, active GM: the part equal to the damage of a 2014-format sheet, on the failed save (failing
 * the part kept at calculation, the HP lost); Energy Drain ("Failure: The target's Hit Point maximum decreases by 14 (4d6)")
 * on a failed save; the drain of an ability on an attack that hits (or a failed save, for an
 * activity without an attack).
 */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const item = fromUuidSync(resolution.activity ?? "", { strict: false })?.item ?? null;
  const rule = drainOf(item);
  const later = rule?.equal && rule.onFailedSave;
  if ( !rule?.fixed && !rule?.ability && !later ) return;
  const speaker = ChatMessage.implementation.getSpeaker({ actor: item.actor });
  for ( const t of resolution.targets ) {
    if ( t.unaffected ) continue;
    const actor = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !actor ) continue;
    if ( later ) {
      const key = pendingKey(resolution.origin, actor.uuid);
      const n = pending.get(key) ?? t.damage?.applied ?? 0;
      pending.delete(key);
      if ( (t.save?.success === false) && (n > 0) ) await drain(actor, "hp", n, { item, source: item.actor?.uuid ?? null, regains: rule.regains, floor: rule.floor });
    }
    if ( rule.fixed && (t.save?.success === false) ) {
      const roll = await new Roll(rule.fixed).evaluate();
      await roll.toMessage({ speaker, flavor: `${item.name} — ${actor.name}` });
      await drain(actor, "hp", roll.total, { item });
    }
    const struck = resolution.plan?.attack ? (t.hit === true) : (t.save?.success === false);
    if ( rule.ability && struck ) {
      const roll = await new Roll(rule.ability.formula).evaluate();
      await roll.toMessage({ speaker, flavor: `${item.name} — ${actor.name}` });
      await drain(actor, rule.ability.key, roll.total, { item });
    }
  }
}

export function registerDrain() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "drain: drained portion not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "drain: Hit Point maximum not reduced" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "drain on save or on hit: effect not applied" });
}
