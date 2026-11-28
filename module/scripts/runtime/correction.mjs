/**
 * §396: the GM's correction — catching up on a mistake during play (user decision, 2026-11-07): putting back an effect, damage or
 * a concentration removed by mistake, applying what was not applied. The GM "re-runs" the activity in the player's place,
 * choosing what must really happen (window: ui/correction.mjs).
 *
 * "Targets" mode (default): no dnd5e use, so no dialog, no attack or saving throw roll, no animation, no sound.
 *  - the spell level: the dnd5e scaled copy (`Item5e#scaledClone`, chat-message.mjs:695);
 *  - consumption, if requested: dnd5e's `activity.consume` (mixin.mjs:328), like a use;
 *  - concentration, if requested and if the spell requires it: `Actor5e#beginConcentrating` (actor.mjs:1091);
 *  - a "GM correction" card (`usage` message: dnd5e finds the activity, the level and the concentration there),
 *    whispered to the GM unless the box is ticked; the router skips it
 *    (`flags["dnd5e-combat"].correction`, adapter/vanilla-state.mjs);
 *  - per target: the chosen outcome — attack hit (default), critical or miss; saving throw failed (default) or succeeded;
 *  - damage: none, maximum, minimum or rolled (`getDamageConfig`, base-activity.mjs:839, then `DamageRoll#evaluate`
 *    with the core's `maximize` / `minimize`), half or nothing on a successful save according to `damage.onSave`, applied by
 *    `Actor5e#applyDamage` (Resistances included);
 *  - the activity's effects (at the chosen level, `applicableEffects`) through dnd5e's tray (`_applyEffectToActor`), which
 *    attaches them to the card's concentration: breaking it removes them, as in play.
 *    On a successful save, only the `onSave` profiles.
 * What the correction sets up becomes DAS's business again (durations, repeated saves…).
 *
 * "Zone" mode (lasting area spell): a real use (`activity.use`), without a dialog, the area to be placed by the GM, nothing
 * resolved on placement (`quietPose` on the card, runtime/engine-areas.mjs); concentration and consumption according to the window.
 */

import { MODULE_ID } from "../constants.mjs";
import { applyEffectsToToken } from "../adapter/apply-effects.mjs";
import { areaRulesOf, isInstantaneous } from "../adapter/areas.mjs";
import { route } from "./router.mjs";
import { log, loc, esc } from "./shared.mjs";

export const DAMAGE_MODES = Object.freeze(["none", "max", "min", "random"]);
export const ATTACK_OUTCOMES = Object.freeze(["hit", "critical", "miss"]);
export const SAVE_OUTCOMES = Object.freeze(["failed", "success"]);

/** Does the activity make an attack roll, impose a saving throw, have damage, effects? */
export function correctionShape(activity) {
  const parts = activity?.damage?.parts ?? (activity?.healing ? [activity.healing] : []);
  const zone = !!activity?.target?.template?.type && !isInstantaneous(activity) && !!areaRulesOf(activity);
  const item = activity?.item;
  const isSpell = item?.type === "spell";
  const base = isSpell ? (item.system.level ?? 0) : null;
  return {
    attack: activity?.type === "attack",
    save: activity?.type === "save",
    damage: (parts.length > 0) || (activity?.type === "heal"),
    effects: (activity?.effects?.length ?? 0) > 0,
    concentration: !!activity?.requiresConcentration || !!item?.requiresConcentration,
    consumption: !!(activity?.consumption?.targets?.length || activity?.requiresSpellSlot || activity?.activation?.type),
    zone,
    levels: (isSpell && base > 0 && activity?.canScale !== false) ? Array.from({ length: 10 - base }, (_, i) => base + i) : (isSpell ? [base] : []),
    level: base
  };
}

/** The targets: the GM's, or the caster for a self activity. */
export function correctionTargets(activity) {
  const mine = Array.from(game.user.targets ?? []).map(t => t.document);
  if ( mine.length ) return mine;
  const self = (activity?.target?.affects?.type === "self") || (activity?.range?.units === "self" && !activity?.target?.affects?.type);
  const token = self ? (activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
  return token ? [token] : [];
}

/** The slot key of a level: the ordinary slot if it has one, otherwise the pact slot if it is of that level. */
function slotKey(actor, level) {
  const spells = actor?.system?.spells ?? {};
  if ( (spells[`spell${level}`]?.max ?? 0) > 0 ) return `spell${level}`;
  if ( spells.pact?.level === level ) return "pact";
  return `spell${level}`;
}

/** The damage rolls, already evaluated (maximum, minimum or random). */
async function rollDamage(activity, { mode, critical }) {
  const config = activity.getDamageConfig({ isCritical: critical });
  const rolls = [];
  for ( const r of config.rolls ?? [] ) {
    const roll = CONFIG.Dice.DamageRoll.fromConfig(r, config);
    await roll.evaluate({ maximize: mode === "max", minimize: mode === "min", allowInteractive: false });
    rolls.push(roll);
  }
  return rolls;
}

/** A target's damage, from the rolls: full, half, or nothing. */
function damagesFor(rolls, factor) {
  if ( !factor ) return [];
  return rolls.map(roll => ({
    value: Math.floor(roll.total * factor),
    type: roll.options.type ?? Array.from(roll.options.types ?? [])[0] ?? "",
    properties: new Set(roll.options.properties ?? [])
  })).filter(d => d.value > 0);
}

const typeLabel = type => game.i18n.localize(CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? type);

/**
 * Applies a correction (GM). Returns `{ ok, message, lines }` or `{ ok: false, reason }`.
 * @param {object} input
 * @param {string} input.activity       uuid of the activity (on the character's sheet).
 * @param {number|null} [input.level]   Spell level.
 * @param {string[]} [input.targets]    uuids of the tokens; by default, the GM's targets or the caster.
 * @param {"none"|"max"|"min"|"random"} [input.damage="random"]
 * @param {"hit"|"critical"|"miss"} [input.attack="hit"]
 * @param {"failed"|"success"} [input.save="failed"]
 * @param {boolean} [input.concentration=true]
 * @param {boolean} [input.effects=true]
 * @param {boolean} [input.consume=false]
 * @param {"targets"|"zone"} [input.zone="targets"]
 * @param {boolean} [input.public=false]  The card seen by the whole table.
 */
export async function applyCorrection(input) {
  if ( !game.user.isGM ) return { ok: false, reason: "gm" };
  const original = fromUuidSync(input.activity ?? "", { strict: false });
  const actor = original?.actor;
  if ( !original || !actor ) return { ok: false, reason: "activity" };
  const shape = correctionShape(original);
  const level = shape.levels.includes(Number(input.level)) ? Number(input.level) : shape.level;
  const scaling = (Number.isFinite(level) && Number.isFinite(shape.level)) ? Math.max(0, level - shape.level) : 0;
  const whisper = input.public ? [] : game.users.filter(u => u.isGM).map(u => u.id);

  if ( (input.zone === "zone") && shape.zone ) return correctZone(original, { level, input, whisper });

  const item = scaling ? original.item.scaledClone(scaling) : original.item;
  const activity = item.system.activities.get(original.id);
  const lines = [];
  let deltas = null;

  // Consumption, like a use (slot of the chosen level, the activity's resources).
  if ( input.consume ) {
    const usageConfig = activity._prepareUsageConfig({ spell: Number.isFinite(level) && activity.requiresSpellSlot ? { slot: slotKey(actor, level) } : undefined, scaling });
    const consumeConfig = { data: {} };
    const updates = await activity.consume(usageConfig, consumeConfig);
    if ( updates === false ) return { ok: false, reason: "consume" };
    // What dnd5e consumed (mixin.mjs:357, `system.deltas`): "Undo" gives it back through `activity.refund` (mixin.mjs:385).
    deltas = consumeConfig.data.system?.deltas ?? null;
    lines.push(loc("Correction.Ligne.Consomme"));
  }

  // The caster's concentration, at the chosen level.
  let concentration = null;
  if ( input.concentration !== false && shape.concentration && !game.settings.get("dnd5e", "disableConcentration") ) {
    concentration = await actor.beginConcentrating(activity, { "flags.dnd5e.scaling": scaling }) ?? null;
    if ( concentration ) lines.push(loc("Correction.Ligne.Concentration"));
  }

  const tokens = (input.targets?.length ? input.targets.map(u => fromUuidSync(u, { strict: false })) : correctionTargets(original)).filter(t => t?.actor);
  const attack = ATTACK_OUTCOMES.includes(input.attack) ? input.attack : "hit";
  const save = SAVE_OUTCOMES.includes(input.save) ? input.save : "failed";
  const mode = DAMAGE_MODES.includes(input.damage) ? input.damage : "random";
  const hits = !shape.attack || (attack !== "miss");
  const saved = shape.save && (save === "success");

  // Damage: a single roll for all targets, as in play.
  const rolls = (shape.damage && hits && (mode !== "none")) ? await rollDamage(activity, { mode, critical: shape.attack && (attack === "critical") }) : [];
  const onSave = activity.damage?.onSave ?? "half";
  const factor = saved ? ({ half: 0.5, full: 1 }[onSave] ?? 0) : 1;

  // Effects at the chosen level; on a successful save, only those that apply anyway.
  const profiles = (input.effects !== false && hits) ? (activity.applicableEffects ?? []).filter(p => !saved || p.onSave) : [];
  const refs = profiles.map(p => ({ id: p._id, activity: activity.uuid }));

  const outcome = shape.attack ? loc(`Correction.Attaque.${attack}`) : (shape.save ? loc(`Correction.Sauvegarde.${save}`) : null);
  const perTarget = tokens.map(t => ({ token: t, damages: damagesFor(rolls, factor) }));
  for ( const { token, damages } of perTarget ) {
    const dmg = damages.map(d => `${d.value} ${typeLabel(d.type)}`).join(", ");
    const names = profiles.map(p => item.effects.get(p._id)?.name).filter(Boolean).join(", ");
    lines.push(loc("Correction.Ligne.Cible", { name: token.name, what: [outcome, dmg, names].filter(Boolean).join(" · ") || loc("Correction.Ligne.Rien") }));
  }
  if ( !tokens.length ) lines.push(loc("Correction.Ligne.SansCible"));

  const levelText = (Number(level) > 0) && (item.type === "spell") ? ` (${loc("Correction.Niveau", { level })})` : "";
  const content = `<div class="das-correction-card">
    <p class="das-correction-card__title"><i class="fa-solid fa-screwdriver-wrench"></i> ${esc(loc("Correction.Carte"))}</p>
    <p><strong>${esc(actor.name)}</strong> — ${esc(original.item.name)}${esc(levelText)}</p>
    <ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
  const message = await ChatMessage.implementation.create({
    type: "usage", content, whisper,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    system: { ...activity.messageSources, concentration: concentration?.id ?? null, scaling, ...(deltas ? { deltas } : {}) },
    flags: { [MODULE_ID]: { correction: { activity: original.uuid, level, attack, save, damage: mode, by: game.user.id } } }
  });

  // What "Undo" will undo: HP (as a delta, so as not to overwrite what has changed since), applied effects, concentration.
  const undo = { hp: [], effects: [], concentration: concentration?.uuid ?? null, statuses: [] };
  for ( const { token, damages } of perTarget ) {
    if ( refs.length ) undo.effects.push(...await applyEffectsToToken(message, token.uuid, refs));
    if ( !damages.length ) continue;
    const before = hpOf(token.actor);
    const had = new Set(token.actor.statuses ?? []);
    await token.actor.applyDamage(damages);
    const after = hpOf(token.actor);
    undo.hp.push({ actor: token.actor.uuid, value: before.value - after.value, temp: before.temp - after.temp });
    undo.statuses.push({ actor: token.actor.uuid, had: [...had] });
  }
  await message.setFlag(MODULE_ID, "correction", { ...message.getFlag(MODULE_ID, "correction"), undo });
  log(`correction: ${original.item.name} by ${actor.name} on ${tokens.map(t => t.name).join(", ") || "nobody"}`);
  return { ok: true, message: message?.id ?? null, lines };
}

/** "Zone" mode: a real use, without a dialog, the area placed by the GM; nothing resolves on placement. */
async function correctZone(original, { level, input, whisper }) {
  const actor = original.actor;
  const usage = {
    spell: Number.isFinite(level) && original.requiresSpellSlot ? { slot: slotKey(actor, level) } : undefined,
    concentration: { begin: input.concentration !== false },
    create: { measuredTemplate: true },
    subsequentActions: false,
    [MODULE_ID]: { confirmed: true, quietPose: true }
  };
  if ( !input.consume ) usage.consume = false;
  // dnd5e chooses its card's visibility by the message mode (mixin.mjs:787, the core's `ChatMessage.applyMode`): "gm" whispers
  // it to the GM.
  const regionsBefore = new Set(canvas.scene?.regions.map(r => r.id) ?? []);
  const effectsBefore = new Set(actor.effects.map(e => e.id));
  const results = await original.use(usage, { configure: false },
    { rollMode: whisper.length ? "gm" : "public", data: { flavor: loc("Correction.Carte") } });
  // "Undo": the area placed and the concentration taken. Not under `correction`: the card must stay the engine's
  // (the area reads it).
  const message = results?.message instanceof ChatMessage ? results.message : game.messages.get(results?.message?.id ?? "");
  if ( message ) {
    const regions = (canvas.scene?.regions ?? []).filter(r => !regionsBefore.has(r.id) && [r.getFlag("dnd5e", "item"), r.getFlag("dnd5e", "activity")]
      .some(u => [original.uuid, original.item.uuid].includes(u))).map(r => r.uuid);
    const concentration = actor.effects.find(e => !effectsBefore.has(e.id) && e.statuses?.has("concentrating"))?.uuid ?? null;
    await message.setFlag(MODULE_ID, "correctionUndo", { activity: original.uuid, regions, concentration, effects: [], hp: [], statuses: [] });
  }
  log(`correction: zone of ${original.item.name} placed again for ${actor.name}`);
  return { ok: !!results, message: results?.message?.id ?? null, lines: [loc("Correction.Ligne.Zone")] };
}

const hpOf = actor => {
  const hp = actor?.system?.attributes?.hp ?? {};
  return { value: Number(hp.value) || 0, temp: Number(hp.temp) || 0 };
};

/** What "Undo" undoes on a correction card, or null (already undone, nothing to undo). */
export function undoOf(message) {
  if ( !message || message.getFlag(MODULE_ID, "correctionUndone") ) return null;
  return message.getFlag(MODULE_ID, "correction")?.undo ?? message.getFlag(MODULE_ID, "correctionUndo") ?? null;
}

/**
 * GM: undoes a correction — HP given back as a delta (the damage comes back, a heal is taken back), Unconscious / Dead removed
 * if they came with that damage and the creature has HP again, the applied effects removed, the resumed concentration broken
 * (and what depends on it, area included), the area's regions removed, the consumption given back by dnd5e (`activity.refund`).
 */
export async function undoCorrection(messageId) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const undo = undoOf(message);
  if ( !undo ) return false;
  for ( const { actor: uuid, value, temp } of undo.hp ?? [] ) {
    const actor = fromUuidSync(uuid, { strict: false });
    if ( !actor ) continue;
    const hp = actor.system.attributes.hp;
    const max = (Number(hp.max) || 0) + (Number(hp.tempmax) || 0);
    await actor.update({ "system.attributes.hp.value": Math.clamp((Number(hp.value) || 0) + value, 0, max || Infinity),
      "system.attributes.hp.temp": Math.max(0, (Number(hp.temp) || 0) + temp) });
  }
  for ( const { actor: uuid, had } of undo.statuses ?? [] ) {
    const actor = fromUuidSync(uuid, { strict: false });
    if ( !actor || !((Number(actor.system.attributes.hp.value) || 0) > 0) ) continue;
    for ( const status of ["dead", "unconscious"] ) {
      if ( !had.includes(status) && actor.statuses.has(status) ) await actor.toggleStatusEffect(status, { active: false });
    }
  }
  // What has already gone (broken with the concentration, removed by hand) is ignored.
  const remove = async uuid => {
    const doc = fromUuidSync(uuid, { strict: false });
    if ( doc && !doc.isDeleted ) await doc.delete().catch(() => null);
  };
  for ( const uuid of undo.effects ?? [] ) await remove(uuid);
  // The area before the concentration: breaking the latter makes the engine remove it (runtime/concentration.mjs),
  // at the same time as us.
  for ( const uuid of undo.regions ?? [] ) await remove(uuid);
  if ( undo.concentration ) {
    const effect = fromUuidSync(undo.concentration, { strict: false });
    if ( effect && !effect.isDeleted ) await (effect.parent?.endConcentration ? effect.parent.endConcentration(effect) : effect.delete()).catch(() => null);
  }
  if ( message.system?.deltas ) {
    const activity = fromUuidSync(message.getFlag(MODULE_ID, "correction")?.activity ?? undo.activity ?? "", { strict: false });
    if ( activity?.refund ) {
      await activity.refund(message.system.deltas);
      await message.update({ "system.deltas": null });
    }
  }
  await message.setFlag(MODULE_ID, "correctionUndone", true);
  log(`correction undone (${message.id})`);
  return true;
}

function onPreUse(_activity, usageConfig, _dialogConfig, messageConfig) {
  if ( usageConfig?.[MODULE_ID]?.quietPose && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.quietPose`, true);
}

export const correctionApi = Object.freeze({ apply: applyCorrection, shape: correctionShape, undo: undoCorrection });

export function registerCorrection() {
  route("dnd5e.preUseActivity", onPreUse, { label: "correction: quiet zone not marked" });
}
