import { MODULE_ID } from "../constants.mjs";
import { auraRecipients, wantedAuraEffects, planAuraChanges } from "../core/aura.mjs";
import {
  aurasOf, auraValue, auraCopiesOn, createAuraCopy, updateAuraCopy, removeAuraCopy, showAuraIcon, carriesOriginal
} from "../adapter/auras.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, isExecutor } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { sideOf } from "../adapter/factions.mjs";
import { samePlane } from "../adapter/plane.mjs";

const isInactive = actor => actor.statuses.has("incapacitated") || actor.statuses.has("dead")
  || actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED);

/**
 * "Auras in combat only" setting: out of combat, no aura is held and the existing copies
 * are removed. The computation is light, but it runs at every token move;
 * in exploration, on a large scene, that is work for a bonus that only serves the rare
 * saves out of combat — which the GM can then count by hand.
 */
/** §403: the tokens of whoever summoned this token (`flags.dnd5e.summon.origin`: the summoner's item). */
function summonerTokens(token) {
  const origin = token.actor?.getFlag?.("dnd5e", "summon")?.origin;
  const actor = origin ? fromUuidSync(origin, { strict: false })?.actor : null;
  if ( !actor ) return [];
  return (actor.token ? [actor.token] : actor.getActiveTokens(false, true)).map(t => t.uuid);
}

function aurasActiveOn(scene) {
  if ( !game.settings.get(MODULE_ID, "aurasOnlyInCombat") ) return true;
  return game.combats.some(c => c.started && (!c.scene || (c.scene.id === scene.id)));
}

/**
 * Puts the auras of the displayed scene back in order: who stands in which aura, and so which
 * effect copies to create, fix or remove. Everything is recomputed each time — combat scenes
 * have a few dozen tokens — and only the difference is written.
 */
async function refreshScene(scene) {
  const tokens = scene.tokens.filter(t => t.actor && !t.hidden && !isObjectToken(t));
  // §403: a summon held as an object (the pack of Conjure Animals: driven, no space) can carry an aura; it does not
  // receive any.
  const sources = scene.tokens.filter(t => t.actor && !t.hidden);
  const active = aurasActiveOn(scene);
  const factors = readUnitFactors();
  const gridUnits = scene.grid.units;
  const byUuid = new Map(tokens.map(t => [t.uuid, t]));
  const auraBySlot = new Map();   // `${source}|${key}` -> { aura, sourceToken }

  const auras = [];
  for ( const sourceToken of (active ? sources : []) ) for ( const aura of aurasOf(sourceToken.actor) ) {
    let radius = lengthIn(aura.radius, aura.units, gridUnits, factors);
    const source = {
      ...sideOf(sourceToken), token: sourceToken.uuid, key: aura.key,
      inactive: isInactive(sourceToken.actor), radius, affects: aura.affects,
      includeSelf: aura.includeSelf === true, value: auraValue(aura, sourceToken.actor), types: aura.types ?? null,
      ...(aura.affects === "summoner" ? { summoners: summonerTokens(sourceToken) } : {})
    };
    // P2: 3D distance; an Emanation is stopped by Total Cover (floor, solid wall) — tested
    // only for whoever is in range, line of effect costs rays.
    const candidates = tokens.map(t => {
      // §16.47: whoever already carries the spell's original effect gets no copy of it.
      // §225: nor from one plane to another.
      const distance = (carriesOriginal(t.actor, aura) || !samePlane(sourceToken, t)) ? Infinity
        : (t === sourceToken ? 0 : distanceBetween(sourceToken, t).value);
      const lineOfEffect = ((t === sourceToken) || (distance > radius + 1e-6)) ? null : hasLineOfEffect(sourceToken, t);
      return { ...sideOf(t), token: t.uuid, distance, lineOfEffect, type: t.actor.system.details?.type?.value ?? null };
    });
    auras.push({ source, recipients: auraRecipients(source, candidates) });
    auraBySlot.set(`${source.token}|${source.key}`, { aura, sourceToken });
  }

  const existing = tokens.flatMap(auraCopiesOn);
  const { create, update, remove } = planAuraChanges(existing, wantedAuraEffects(auras));
  const removed = new Set(remove.map(e => e.id));
  for ( const e of existing ) if ( !e.iconShown && !removed.has(e.id) ) await showAuraIcon(byUuid.get(e.target), e.id);
  for ( const e of remove ) {
    await removeAuraCopy(byUuid.get(e.target), e.id);
    log(`aura ${e.key}: removed from ${byUuid.get(e.target)?.name}`);
  }
  for ( const w of update ) {
    const { aura, sourceToken } = auraBySlot.get(`${w.source}|${w.key}`);
    await updateAuraCopy(byUuid.get(w.target), w.id, aura, sourceToken, w.value);
    log(`aura ${w.key}: updated on ${byUuid.get(w.target)?.name} (${w.value})`);
  }
  for ( const w of create ) {
    const { aura, sourceToken } = auraBySlot.get(`${w.source}|${w.key}`);
    await createAuraCopy(byUuid.get(w.target), aura, sourceToken, w.value);
    log(`aura ${w.key}: ${byUuid.get(w.target)?.name} enters ${sourceToken.name}'s aura (${w.value})`);
  }
}

export function registerAuras() {
  game.settings.register(MODULE_ID, "aurasOnlyInCombat", {
    name: "DND5ECOMBAT.Reglage.aurasOnlyInCombat.nom",
    hint: "DND5ECOMBAT.Reglage.aurasOnlyInCombat.aide",
    scope: "world", config: true, type: Boolean, default: false,
    // On each client, when the `aurasOnlyInCombat` setting changes (no argument): the auras are recomputed. A neighbor may emit it
    // for the same effect.
    onChange: () => Hooks.callAll(`${MODULE_ID}.refreshAuras`)
  });

  // A single recomputation at a time, and bursts (group move) are grouped.
  const refresh = foundry.utils.debounce(() => {
    if ( !isExecutor() || !canvas?.scene ) return;
    enqueue("auras", () => refreshScene(canvas.scene))
      .catch(err => console.error(`${MODULE_ID} | auras: recalculation interrupted`, err));
  }, 200);

  const auras = { label: "auras: recalculation requested" };
  const always = () => refresh();
  // Start and end of combat: with the "in combat only" setting, the auras turn on and off.
  for ( const hook of ["canvasReady", `${MODULE_ID}.refreshAuras`, "combatStart", "deleteCombat", "moveToken",
    "createToken", "deleteToken", "createItem", "deleteItem", `${MODULE_ID}.factionsChanged`] ) route(hook, always, auras);
  route("updateToken", (token, changes) => {
    // §181: a faction or a disposition that changes moves the sides.
    const flags = changes.flags?.[MODULE_ID] ?? {};
    if ( ("hidden" in changes) || ("disposition" in changes) || ("faction" in flags) || ("-=faction" in flags) || ("stance" in flags) || ("-=stance" in flags) ) refresh();
  }, auras);
  // A condition that turns the aura off (Incapacitated), a Charisma that changes, an aura item added or removed.
  // Our own copies relaunch nothing: they change neither the bearers nor the distances.
  const onEffect = effect => { if ( !effect.getFlag(MODULE_ID, "aura") ) refresh(); };
  route("createActiveEffect", onEffect, auras);
  route("deleteActiveEffect", onEffect, auras);
  route("updateActor", (actor, changes) => { if ( changes.system?.abilities ) refresh(); }, auras);
}
