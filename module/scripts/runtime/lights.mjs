/**
 * Light and Darkness of running spells (SPEC §16.31): when dnd5e places the area, creates the effect or summons the object,
 * the engine puts on it the source that the V14 core can render (adapter/lights.mjs). Simulated vision reads Darkness through
 * the content (adapter/vision.mjs, `blockingRegions`), not through these sources.
 */

import { MODULE_ID } from "../constants.mjs";
import { lightUpRegion, followRegion, extinguishRegion, addEffectLight, placeLightObject, lightRuleOf, lightChoiceOf,
  summonSizeOf, lightCaster, lightCasterFor, colorSummonedToken, extinguishLights, carriedLightOf, carriedLightEffect, setCarriedLight, setHood, hoodedDown,
  dropCarriedLight, carriedSourceOf, remainingOf, burnOut, rememberBurn } from "../adapter/lights.mjs";
import { burnParts } from "../core/light.mjs";
import { concentrationEffectOf } from "../adapter/concentration.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { invalidateVision } from "../adapter/vision.mjs";
import { veilOnCreate, veilExisting, unveil, isRevealEffect } from "../adapter/reveal.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, viaActiveGM, say, locEsc } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

export const EXTINGUISH_QUERY = `${MODULE_ID}.extinguish`;

/** Active GM side: turn off an item's lights, for a player who owns its caster. */
async function handleExtinguish({ item: itemUuid }, { user }={}) {
  const item = await fromUuid(itemUuid);
  if ( !item || (user && !item.actor?.testUserPermission(user, "OWNER")) ) return 0;
  return extinguishLights(item);
}

/** Turn off an item's previous lights: by the active GM, who can remove tokens. */
function extinguishBefore(item) {
  return viaActiveGM(EXTINGUISH_QUERY, handleExtinguish, { item: item.uuid }, { fallback: 0 });
}

/** §16.35: intent "turn off" (button of the choice window) — the item's lights go out, nothing is cast. */
export async function putOutLight(activity) {
  const n = await extinguishBefore(activity.item);
  log(`${activity.item.name}: ${n} light(s) extinguished`);
  return n;
}

/**
 * §16.35: intent "cast the light" (choice window, ui/light.mjs) — `where`: "ground" (the object is placed, in the chosen
 * color) or "self" (the caster holds it and glows); `color`: color of the light. Recasting a `single` spell (Light) turns off
 * the previous one first. No size window: the object is Tiny; a level 1+ spell (Continual Flame) keeps the dnd5e window for
 * the spell slot.
 * @param {Activity} activity
 * @param {[object, object, object]} usage   Suspended configurations (use, window, message).
 * @param {{where: "ground"|"self", color: string|null}} choice
 */
export async function castLight(activity, [config, dialog, message], { where, color }) {
  const rule = lightChoiceOf(activity);
  if ( !rule ) return null;
  if ( rule.single ) {
    const n = await extinguishBefore(activity.item);
    if ( n ) log(`${activity.item.name}: ${n} previous light(s) extinguished`);
  }
  const summons = { ...(config?.summons ?? {}), creatureSize: summonSizeOf(activity), [MODULE_ID]: { lightColor: color } };
  const use = { ...config, summons, create: { ...(config?.create ?? {}), summons: where === "ground" },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), lightChoice: where, lightColor: color } };
  const cantrip = (activity.item.system.level ?? 0) === 0;
  // "On me": the caster glows once the use is done (`dnd5e.postUseActivity`, below) — even if legality suspended it then
  // relaunched it.
  return relaunchUse(activity, use, cantrip ? { ...(dialog ?? {}), configure: false } : dialog, message);
}

/** §121: a readable remaining time ("5 h 20", "45 min"). */
export function burnLabel(seconds) {
  if ( !Number.isFinite(seconds) ) return "";
  const { h, m } = burnParts(seconds);
  return h ? loc("Lumiere.DureeH", { h, m: String(m).padStart(2, "0") }) : loc("Lumiere.DureeM", { m });
}

/**
 * §121: turn a carried source on or off (`on` absent: the inverse of its state), on the bearer's client — source activity,
 * tinderbox, inventory menu, HUD. The bearer sees what happened above their token.
 * @returns {Promise<{changed: boolean, lit?: boolean, left?: number|null, refilled?: string|null, reason?: string}>}
 */
export async function toggleCarriedLight(item, on=null) {
  if ( !item?.actor?.isOwner || !carriedLightOf(item) ) return { changed: false, reason: "notLight" };
  const want = (on === null) ? !carriedLightEffect(item) : on;
  const result = await setCarriedLight(item, want);
  const token = tokenOf(item.actor);
  if ( result.reason === "noFuel" ) {
    notice(token, loc("Lumiere.PasDeCombustible", { item: item.name }));
    ui.notifications?.warn(loc("Lumiere.PasDeCombustible", { item: item.name }));
  }
  if ( result.reason === "noHand" ) {
    const text = loc("Lumiere.PasDeMain", { item: item.name, held: result.held.join(", ") });
    notice(token, loc("Lumiere.PasDeMainCourt"));
    ui.notifications?.warn(text);
  }
  if ( !result.changed ) return result;
  const left = burnLabel(result.left);
  if ( result.refilled ) notice(token, loc("Lumiere.Recharge", { item: item.name, fuel: result.refilled }), "gain");
  notice(token, loc(result.lit ? "Lumiere.Allumee" : "Lumiere.Eteinte", { item: item.name, left }), result.lit ? "gain" : "ended");
  log(`${item.actor.name}: ${item.name} ${result.lit ? "lit" : "put out"}${Number.isFinite(result.left) ? ` (${Math.round(result.left / 60)} min left)` : ""}${result.refilled ? `, refilled with ${result.refilled}` : ""}`);
  return result;
}

/**
 * §346: lowers or raises the hood of the lit source (Hooded Lantern), on the bearer's client. No action cost, like lighting
 * (the Bonus Action is left to the table).
 */
export async function toggleHood(item, down=null) {
  if ( !item?.actor?.isOwner ) return { changed: false, reason: "notOwner" };
  const result = await setHood(item, (down === null) ? !hoodedDown(item) : down);
  if ( !result.changed ) return result;
  notice(tokenOf(item.actor), loc(result.down ? "Lumiere.CapuchonBaisse" : "Lumiere.CapuchonLeve", { item: item.name }), result.down ? "ended" : "gain");
  log(`${item.actor.name}: ${item.name} hood ${result.down ? "lowered" : "raised"}`);
  return result;
}

/**
 * §346: the light of a weapon that follows an enchantment (`carriedLight.whileEnchanted`: Flame Tongue ablaze, flames of the
 * "Scintillating Helm") — lit when this profile's enchantment arrives on the item, put out when it leaves. Active GM.
 */
async function followEnchantment(effect) {
  const item = effect?.parent;
  if ( (item?.documentName !== "Item") || !item.actor ) return;
  const profile = effect.getFlag?.("dnd5e", "enchantmentProfile");
  const rule = profile ? carriedLightOf(item) : null;
  if ( !rule?.whileEnchanted || (rule.whileEnchanted !== profile) ) return;
  const on = item.effects.some(e => !e.disabled && (e.getFlag("dnd5e", "enchantmentProfile") === profile));
  const result = await setCarriedLight(item, on);
  if ( result.changed ) log(`${item.actor.name}: ${item.name} ${on ? "sheds light" : "no longer sheds light"} (${effect.name})`);
}

/**
 * §121: the source has burned out — the effect goes, the torch too; the bearer and the GM are told. Active GM. Only once
 * per effect: the core marks it expired (`updateActiveEffect`) and the engine removes expired effects (`deleteActiveEffect`
 * that follows).
 */
const burning = new Set();
async function onBurnOut(effect) {
  const actor = effect.parent;
  if ( burning.has(effect.uuid) ) return;
  burning.add(effect.uuid);
  setTimeout(() => burning.delete(effect.uuid), 10000);
  const done = await burnOut(effect);
  if ( !done ) return;
  const text = loc(done.empty ? "Lumiere.Vide" : "Lumiere.Consumee", { item: done.item, name: actor?.name ?? "" });
  notice(tokenOf(actor), text, "ended");
  const owners = game.users.filter(u => u.isGM || (actor && actor.testUserPermission(u, "OWNER"))).map(u => u.id);
  await say({ actor }, locEsc(done.empty ? "Lumiere.Vide" : "Lumiere.Consumee", { item: done.item, name: actor?.name ?? "" }),
    { burnOut: { item: done.item, consumed: done.consumed } }, { whisper: owners });
  log(`${actor?.name}: ${done.item} burnt out${done.consumed ? (done.gone ? " (last one, removed)" : " (one fewer)") : " (empty)"}`);
}

/**
 * §287: Darkness dispelled spell lights — everyone sees it above the token that was glowing, hears it (spell-end sound), and
 * the chat card says so. Active GM.
 */
async function tellDispelled(region, dispelled) {
  const darkness = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  const origin = fromUuidSync(region.getFlag("dnd5e", "origin") ?? "", { strict: false });
  for ( const { item, token } of dispelled ) {
    if ( token ) notice(token, item, "effectOff", { all: true, action: "spellEnds", outcome: "success" });
  }
  await say(origin ? { token: origin } : { alias: darkness?.name ?? "" },
    dispelled.map(({ item }) => locEsc("Lumiere.Dissipee", { item, by: darkness?.name ?? "" })),
    { lightDispelled: { by: darkness?.uuid ?? null, items: dispelled.map(d => d.item) } });
}

export function registerLights() {
  // §346: the light of an enchanted weapon follows its enchantment.
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => enqueue(`enchantLight:${effect?.parent?.uuid}`, () => followEnchantment(effect)),
      { executor: true, label: "enchanted weapon: light not updated" });
  }
  // Queued per region: the creation and a redraw right after (the Wall of Fire ring, §170) do not place twice.
  const queued = (region, task) => enqueue(`light:${region.id}`, task);
  route("createRegion", region => queued(region, async () => {
    const done = await lightUpRegion(region);
    if ( !done ) return;
    const { light, dispelled, lightsDispelled=[] } = done;
    log(`zone: ${light.config.negative ? `darkness (${light.config.dim} ${region.parent.grid.units})`
      : `light ${light.config.bright}/${light.config.dim} ${region.parent.grid.units}`}${dispelled ? `, ${dispelled} ${light.config.negative ? "light spell(s)" : "darkness zone(s)"} dispelled` : ""}`);
    if ( lightsDispelled.length ) await tellDispelled(region, lightsDispelled);
  }), { executor: true, label: "zone light not placed" });

  route("updateRegion", (region, changes) => {
    if ( !("shapes" in changes) && !("elevation" in changes) ) return;
    return queued(region, async () => { if ( await followRegion(region) ) log("zone moved: its light follows"); });
  }, { executor: true, label: "zone light not moved" });

  route("deleteRegion", region => queued(region, async () => {
    const n = await extinguishRegion(region);
    if ( n ) log(`zone removed: ${n} light(s) extinguished`);
  }), { executor: true, label: "zone light not extinguished" });

  // Any region can carry Darkness: simulated vision must be redone when one appears, moves or disappears.
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion"] ) route(hook, () => invalidateVision(), { label: "vision: sources to rebuild" });

  // §16.36: "can't benefit from the Invisible condition" down to the display — the invisibility of a revealed creature
  // is suspended, and resumes when the revelation ends (adapter/reveal.mjs).
  route("preCreateActiveEffect", effect => {
    if ( veilOnCreate(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} suspended (revealed)`);
  }, { label: "invisibility: not suspended" });
  route("createActiveEffect", async effect => {
    if ( (effect.parent?.documentName !== "Actor") || !isRevealEffect(effect) ) return;
    const n = await veilExisting(effect.parent);
    if ( n ) log(`${effect.parent.name}: revealed by ${effect.name}, invisibility suspended`);
  }, { executor: true, label: "invisibility: not suspended" });
  const lifted = async (effect, gone) => {
    const n = await unveil(effect.parent, gone);
    if ( n ) log(`${effect.parent.name}: no longer revealed, invisibility restored`);
  };
  route("deleteActiveEffect", effect => (effect.parent?.documentName === "Actor") && isRevealEffect(effect) ? lifted(effect, effect) : null,
    { executor: true, label: "invisibility: not restored" });
  route("updateActiveEffect", (effect, changes) => {
    if ( (effect.parent?.documentName !== "Actor") || !("disabled" in changes) || !isRevealEffect(effect) ) return null;
    return changes.disabled ? lifted(effect, effect) : veilExisting(effect.parent);
  }, { executor: true, label: "invisibility: not restored" });

  route("preCreateActiveEffect", effect => {
    if ( addEffectLight(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} makes it shed light`);
  }, { label: "light effect not completed" });

  // Light, Continual Flame: the PHB gives them `summon.prompt: false` — dnd5e then places nothing on casting, you have to
  // click "Summon" on the card (documents/activity/summon.mjs:68). Seen in play: "nothing happens, just a chat message". The
  // luminous object is placed on casting. After legality and the gates (last registered): nothing is ever cancelled here.
  route("dnd5e.preUseActivity", (activity, usageConfig) => {
    if ( (activity?.type !== "summon") || (lightRuleOf(activity.item)?.on !== "summon") ) return;
    if ( (usageConfig.create === false) || !activity.canSummon || !canvas?.scene ) return;
    // §16.35: "on me" — nothing to place, the caster glows (castLight).
    if ( usageConfig[MODULE_ID]?.lightChoice === "self" ) return;
    usageConfig.create ??= {};
    usageConfig.create.summons = true;
    usageConfig.summons ??= {};
    usageConfig.summons.creatureSize = summonSizeOf(activity) ?? usageConfig.summons.creatureSize;
  }, { cancellable: true, label: "light object: placed on cast" });

  // §16.35: the chosen color goes on the object's token, on the client that summons it.
  route("dnd5e.summonToken", (activity, profile, tokenData, options) => {
    if ( colorSummonedToken(activity, tokenData, options) ) log(`${activity.item.name}: light ${tokenData.light?.color}`);
  }, { label: "light object: color not applied" });

  route("dnd5e.postUseActivity", async (activity, usageConfig) => {
    const ours = usageConfig?.[MODULE_ID];
    if ( (ours?.lightChoice !== "self") || !lightChoiceOf(activity) ) return;
    if ( await lightCaster(activity, ours.lightColor ?? null) ) log(`${activity.actor.name} holds ${activity.item.name}: it sheds light`);
  }, { label: "light object: the caster does not shed light" });

  // §287: Sunbeam — the caster glows as long as their Concentration lasts (on the casting client: their character is theirs).
  route("dnd5e.postUseActivity", async (activity, usageConfig, results) => {
    const effect = await lightCasterFor(activity, concentrationEffectOf(results?.message));
    if ( effect ) log(`${activity.actor.name}: ${activity.item.name} shines above them`);
  }, { label: "caster light: not lit" });

  CONFIG.queries[EXTINGUISH_QUERY] = handleExtinguish;

  // §121: the engine keeps the duration and the fuel — dnd5e spends nothing on the source's activity (otherwise the Candle,
  // "autoDestroy", disappeared on lighting and went out at once, and the Lamp, its only use spent, no longer went out).
  route("dnd5e.preUseActivity", (activity, usageConfig) => {
    if ( (activity?.type !== "utility") || !carriedLightOf(activity.item) ) return;
    usageConfig.consume = false;
  }, { label: "light source: dnd5e consumption not skipped" });
  // §52: a carried light source — its utility activity lights it, or puts it out if it is already burning.
  route("dnd5e.postUseActivity", async activity => {
    const item = activity?.item;
    if ( (activity?.type !== "utility") || !carriedLightOf(item) || !item.actor?.isOwner ) return;
    await toggleCarriedLight(item);
  }, { label: "light source: not lit" });
  // §121: at the end of its duration, the V14 core marks the effect expired (`CONFIG.ActiveEffect.expiryAction` "update",
  // client/helpers/active-effect-registry.mjs:146) — or deletes it ("delete"). Removed by hand beforehand: the remaining time
  // is noted. Out of combat, dnd5e deletes the expired effect at once (documents/active-effect.mjs:803-806): it is the following
  // `deleteActiveEffect` that consumes it. In combat it stays, suspended: it is consumed here, if still there a second later.
  route("updateActiveEffect", (effect, changes) => {
    if ( !carriedSourceOf(effect) || (changes?.duration?.expired !== true) ) return;
    setTimeout(() => { if ( effect.parent?.effects?.has(effect.id) ) onBurnOut(effect); }, 1000);
  }, { executor: true, label: "light source: not burnt out" });
  route("deleteActiveEffect", async (effect, options) => {
    if ( !carriedSourceOf(effect) || options?.[MODULE_ID]?.putOut ) return;
    const left = remainingOf(effect);
    if ( Number.isFinite(left) && (left <= 0) ) return onBurnOut(effect);
    const kept = await rememberBurn(effect);
    if ( kept !== null ) log(`${effect.parent?.name}: ${effect.name} put out by hand, ${Math.round(kept / 60)} min left`);
  }, { executor: true, label: "light source: remaining time not kept" });
  // It leaves the sheet (dropped, thrown, given): it goes out on its former bearer.
  route("deleteItem", async item => {
    const n = carriedLightOf(item) ? await dropCarriedLight(item) : 0;
    if ( n ) log(`${item.parent?.name ?? "?"}: ${item.name} no longer carried, its light goes out`);
  }, { executor: true, label: "light source: not extinguished" });

  route("createToken", async tokenDoc => {
    const done = await placeLightObject(tokenDoc);
    if ( !done ) return;
    if ( done.extinguished ) log(`light: ${done.extinguished} light(s) from the previous cast extinguished`);
  }, { executor: true, label: "light object not handled" });
}
