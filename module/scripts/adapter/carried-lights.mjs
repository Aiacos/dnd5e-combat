/**
 * Carried light sources (SPEC §52, §121): torches, candles, lamps and lanterns — lighting, extinguishing, duration and
 * fuel, free hands, consumed source. Extracted from adapter/lights.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { tokenLightChanges, burnSeconds, lightPlan, burnoutPlan, handsOf } from "../core/light.mjs";
import { toGridUnits } from "./lights.mjs";

/* -------------------------------------------- */
/*  Carried light sources (§52, §121)           */
/* -------------------------------------------- */

const CARRIED_FLAG = "carriedLightOf";
/** §121: on the item, the time that remained (seconds) when it was extinguished; absent: new (torch) or filled (lamp). */
const BURN_FLAG = "burnLeft";
/** §346: on the light effect, the hood lowered. */
const HOOD_FLAG = "hooded";

/** The light of a carried source (lamp, lantern, torch, candle), or null. */
export const carriedLightOf = item => contentOf(item).entry?.carriedLight ?? null;

/** The effect that makes this source's bearer shine, or null (extinguished). */
export const carriedLightEffect = item => (item?.actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid) ?? null;

/** The light sources an actor carries. */
export const carriedLightsOf = actor => (actor?.items ?? []).filter(i => carriedLightOf(i));

/** Is this the effect of a carried source? Returns the source's uuid, or null. */
export const carriedSourceOf = effect => effect?.getFlag?.(MODULE_ID, CARRIED_FLAG) ?? null;

/** The time left on the lit effect (seconds), from the duration the V14 core keeps up to date; null without duration. */
export function remainingOf(effect) {
  const d = effect?.duration;
  if ( !d || !Number.isFinite(d.value) ) return null;
  if ( Number.isFinite(d.secondsRemaining) ) return Math.max(0, d.secondsRemaining);
  const start = effect.start?.time ?? effect._source?.start?.time;
  return Number.isFinite(start) ? Math.max(0, start + d.value - game.time.worldTime) : d.value;
}

/** The time left on a source: lit, that of its effect; extinguished, the one noted on the item; new, a whole unit. */
export function burnLeftOf(item) {
  const rule = carriedLightOf(item);
  const full = burnSeconds(rule?.burn);
  if ( full === null ) return null;
  const lit = carriedLightEffect(item);
  if ( lit ) return remainingOf(lit);
  const stored = item.getFlag(MODULE_ID, BURN_FLAG);
  return Number.isFinite(stored) ? stored : full;
}

/** §121: on the source, "lighting it is what equipped it" — extinguishing it then stows it. */
const EQUIPPED_FLAG = "equippedToLight";

/**
 * §121: what the creature holds in hand, from what is equipped (the HUD of darsh-dnd-ui equips the weapon set in hand):
 * weapons (two hands for dnd5e's "two" property, config.mjs:2015), shields (`system.type.value` "shield"), lit light
 * sources. Natural weapons and bare hands take no hand. `except`: the source being lit.
 * @returns {Array<{name: string, hands: number}>}
 */
export function heldItems(actor, except=null) {
  const held = [];
  for ( const item of actor?.items ?? [] ) {
    if ( (item === except) || !item.system?.equipped ) continue;
    if ( item.type === "weapon" ) {
      if ( (item.system.type?.value === "natural") || (identifierOf(item).id === "unarmed-strike") ) continue;
      held.push({ name: item.name, hands: item.system.properties?.has?.("two") ? 2 : 1 });
    }
    else if ( (item.type === "equipment") && (item.system.type?.value === "shield") ) held.push({ name: item.name, hands: 1 });
    else if ( carriedLightOf(item) && carriedLightEffect(item) ) held.push({ name: item.name, hands: 1 });
  }
  return held;
}

/** The fuel the actor carries (a flask of Oil, by its identifier), or null. */
export function fuelOf(actor, identifier) {
  return (actor?.items ?? []).find(i => (identifierOf(i).id === identifier) && ((i.system.quantity ?? 1) > 0)) ?? null;
}

/** One unit less: the quantity goes down, the item goes at the last one. Returns true if it was removed. */
async function spendOne(item) {
  const quantity = Number(item.system.quantity ?? 1);
  if ( quantity > 1 ) { await item.update({ "system.quantity": quantity - 1 }); return false; }
  await item.delete();
  return true;
}

/** A source's state for the interface: lit or not, time left, fuel. */
export function carriedLightState(item) {
  const rule = carriedLightOf(item);
  if ( !rule ) return null;
  const fuel = rule.fuel ? fuelOf(item.actor, rule.fuel) : null;
  return { uuid: item.uuid, name: item.name, img: item.img, lit: !!carriedLightEffect(item), left: burnLeftOf(item),
    full: burnSeconds(rule.burn), fuel: rule.fuel ? { identifier: rule.fuel, name: fuel?.name ?? null, quantity: Number(fuel?.system.quantity ?? 0) } : null };
}

/**
 * Lights (`on: true`) or extinguishes the source, on the bearer's client. Lighting places an effect with the item's name and image,
 * which carries its `token.light.*` changes (radii converted to the scene's unit) and, §121, the duration it has left: the V14 core
 * marks it expired when world time reaches it (runtime/lights.mjs then consumes it). An empty lamp first takes a flask
 * of oil from the bearer. Extinguishing notes the remaining time on the item, which relighting resumes.
 * @returns {Promise<{changed: boolean, lit?: boolean, left?: number|null, refilled?: string|null, reason?: string}>}
 */
export async function setCarriedLight(item, on) {
  const rule = carriedLightOf(item);
  const actor = item?.actor;
  if ( !rule || !actor ) return { changed: false, reason: "notLight" };
  const lit = carriedLightEffect(item);
  if ( !on ) {
    if ( !lit ) return { changed: false, reason: "alreadyOut" };
    const left = remainingOf(lit);
    if ( Number.isFinite(left) ) await item.setFlag(MODULE_ID, BURN_FLAG, left);
    await lit.delete({ [MODULE_ID]: { putOut: true } });
    await stowIfLit(item);
    return { changed: true, lit: false, left };
  }
  if ( lit ) return { changed: false, reason: "alreadyLit" };
  // §121: a lit source is held in hand — a free one is needed, unless it is already equipped (torch of a weapon set).
  const wasEquipped = !!item.system.equipped;
  if ( !wasEquipped ) {
    const held = heldItems(actor, item);
    if ( handsOf(held).free < 1 ) return { changed: false, reason: "noHand", held: held.map(h => h.name) };
  }
  const full = burnSeconds(rule.burn);
  const fuel = rule.fuel ? fuelOf(actor, rule.fuel) : null;
  const plan = lightPlan({ stored: item.getFlag(MODULE_ID, BURN_FLAG), full, fuel: !!rule.fuel, hasFuel: !!fuel });
  if ( !plan.ok ) return { changed: false, reason: plan.reason, fuel: rule.fuel };
  let refilled = null;
  if ( plan.refill ) { refilled = fuel.name; await spendOne(fuel); }
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (grid ? toGridUnits(v, rule.units, grid) : v);
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base",
    ...(Number.isFinite(plan.left) ? { duration: { value: plan.left, units: "seconds" } } : {}),
    system: { changes: tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim), angle: rule.angle ?? null,
      animation: rule.animation ?? null }) },
    flags: { [MODULE_ID]: { [CARRIED_FLAG]: item.uuid } }
  }]);
  if ( item.getFlag(MODULE_ID, BURN_FLAG) !== undefined ) await item.unsetFlag(MODULE_ID, BURN_FLAG);
  if ( !wasEquipped ) await item.update({ "system.equipped": true, [`flags.${MODULE_ID}.${EQUIPPED_FLAG}`]: true });
  return { changed: true, lit: true, left: plan.left, refilled, equipped: !wasEquipped };
}

/** §346: is the lit source's hood lowered? */
export const hoodedDown = item => !!carriedLightEffect(item)?.getFlag(MODULE_ID, HOOD_FLAG);

/**
 * §346: lowers (`down: true`) or raises the hood of a lit source that has one (`carriedLight.hooded`) — the light effect takes
 * the hooded radii, or resumes its own. Nothing if the source is extinguished (relit, it restarts hood raised).
 * @returns {Promise<{changed: boolean, down?: boolean, reason?: string}>}
 */
export async function setHood(item, down) {
  const rule = carriedLightOf(item);
  const lit = carriedLightEffect(item);
  if ( !rule?.hooded ) return { changed: false, reason: "noHood" };
  if ( !lit ) return { changed: false, reason: "notLit" };
  if ( !!lit.getFlag(MODULE_ID, HOOD_FLAG) === !!down ) return { changed: false, reason: down ? "alreadyDown" : "alreadyUp" };
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (grid ? toGridUnits(v, rule.units, grid) : v);
  const radii = down ? rule.hooded : rule;
  await lit.update({ "system.changes": tokenLightChanges({ bright: radius(radii.bright), dim: radius(radii.dim), angle: rule.angle ?? null,
    animation: rule.animation ?? null }), [`flags.${MODULE_ID}.${HOOD_FLAG}`]: !!down });
  return { changed: true, down: !!down };
}

/** §121: extinguished, the source that lighting had equipped goes back in the bag (the hand is free). */
async function stowIfLit(item) {
  if ( !item?.getFlag?.(MODULE_ID, EQUIPPED_FLAG) ) return;
  await item.update({ "system.equipped": false });
  await item.unsetFlag(MODULE_ID, EQUIPPED_FLAG);
}

/**
 * §121: the source has burned out (its effect reached the end). Active GM. The effect goes; a torch or candle loses the burned
 * unit (the next will be new), a lamp stays empty. Returns what happened, or null.
 * @returns {Promise<{item: string, consumed: boolean, gone: boolean, empty: boolean}|null>}
 */
export async function burnOut(effect) {
  const uuid = carriedSourceOf(effect);
  if ( !uuid ) return null;
  const item = fromUuidSync(uuid, { strict: false });
  // Already removed in the meantime (the engine removes expired effects, runtime/durations): nothing to delete.
  if ( effect.parent?.effects?.has(effect.id) ) await effect.delete({ [MODULE_ID]: { putOut: true } }).catch(() => null);
  const rule = carriedLightOf(item);
  if ( !item || !rule ) return null;
  const plan = burnoutPlan({ fuel: !!rule.fuel });
  const name = item.name;
  if ( !plan.consume ) { await item.setFlag(MODULE_ID, BURN_FLAG, 0); await stowIfLit(item); return { item: name, consumed: false, gone: false, empty: true }; }
  const gone = await spendOne(item);
  if ( !gone ) await stowIfLit(item);
  if ( !gone && (item.getFlag(MODULE_ID, BURN_FLAG) !== undefined) ) await item.unsetFlag(MODULE_ID, BURN_FLAG);
  return { item: name, consumed: true, gone, empty: false };
}

/** §121: the effect was removed by hand (sheet, HUD) before the end: the remaining time is noted on the source. Active GM. */
export async function rememberBurn(effect) {
  const item = fromUuidSync(carriedSourceOf(effect) ?? "", { strict: false });
  const left = remainingOf(effect);
  if ( !item || !Number.isFinite(left) ) return null;
  await item.setFlag(MODULE_ID, BURN_FLAG, left);
  await stowIfLit(item);
  return left;
}

/** A source that leaves the sheet (dropped, thrown, given, destroyed) goes out: its light effects are removed. */
export async function dropCarriedLight(item) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" ) return 0;
  const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { [MODULE_ID]: { putOut: true } });
  return ids.length;
}
