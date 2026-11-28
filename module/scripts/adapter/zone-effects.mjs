/**
 * §37.4: effects borne while one is in a spell's area (content key `zoneEffects`, Silence: Deafened, `silenced`, thunder
 * immunity). The V14 core does this alone, once its `applyActiveEffect` region behavior is placed: copying the effects
 * onto the actor of a token that enters, removing them on exit (client/data/region-behaviors/apply-active-effect.mjs,
 * `origin` = the behavior's uuid). Seen in play on 2026-09-29: the creatures already in the area at its birth also "enter",
 * and the deleted area removes its copies — the engine only adds the behavior. Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { fromPulseReached } from "../core/area.mjs";

/** The activity that placed the region (`flags.dnd5e.activity`), or null. */
const activityOf = region => {
  const uuid = region.getFlag?.("dnd5e", "activity");
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
};

/**
 * §69: the area of a `difficultTerrain` spell has just been born without a Difficult Terrain behavior (the premium Player's
 * Handbook data lost it; those of dnd5e's SRD have it: spells24/1st-level/entangle.yml, `behaviors`) — we place it, magical
 * (it is a spell), with its types (data/region-behavior/difficult-terrain.mjs: `magical`, `types`). Nothing if the region has one.
 * @returns {Promise<RegionBehavior|null>}
 */
export async function holdDifficultTerrain(region) {
  const activity = activityOf(region);
  const rule = contentOf(activity?.item).entry?.difficultTerrain;
  if ( !rule ) return null;
  const own = region.behaviors.filter(b => ["dnd5e.difficultTerrain", "modifyMovementCost"].includes(b.type));
  // `fromPulse` (Storm of Vengeance: "turns 5 to 10"): not yet — the behavior the data would already carry is suspended;
  // when the time comes (runtime/areas.mjs, on the caster's replay), it is restored, or placed below.
  if ( rule.fromPulse ) {
    const due = fromPulseReached(rule, region.getFlag?.(MODULE_ID, "area")?.pulses);
    for ( const behavior of own ) if ( behavior.disabled === due ) await behavior.update({ disabled: !due });
    if ( !due ) return null;
  }
  if ( own.length ) return null;
  // §172: a multiplier other than ×2 (Wall of Thorns: ×4) — the V14 core's "movement cost" behavior
  // (client/data/region-behaviors/increase-movement-cost.mjs, `difficulties`). All modes: the schema keeps only its own (it
  // is built before dnd5e touches up `CONFIG.Token.movement.actions` — filtering like it left none).
  if ( rule.cost ) {
    const difficulties = Object.fromEntries(Object.keys(CONFIG.Token.movement.actions).map(action => [action, rule.cost]));
    const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{ type: "modifyMovementCost", name: activity.item.name, system: { difficulties } }]);
    return behavior;
  }
  // §403: `enemiesOnly` — "Difficult Terrain for your enemies" (Conjure Minor Elementals): the caster's disposition
  // passes at no cost (`ignoredDispositions` of dnd5e's behavior, data/region-behavior/difficult-terrain.mjs:27).
  const caster = rule.enemiesOnly ? (activity.actor?.token ?? activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
  const ignoredDispositions = caster ? [caster.disposition] : [];
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{
    type: "dnd5e.difficultTerrain", name: activity.item.name, system: { magical: true, types: rule.types ?? [], ignoredDispositions }
  }]);
  return behavior;
}

/**
 * The area of a `zoneEffects` spell has just been born: the core behavior, with the activity's effects.
 * @returns {Promise<{behavior: RegionBehavior, effects: string[]}|null>}
 */
export async function holdZoneEffects(region) {
  const activity = activityOf(region);
  const item = activity?.item;
  if ( contentOf(item).entry?.zoneEffects !== true ) return null;
  if ( region.behaviors.some(b => b.type === "applyActiveEffect") ) return null;
  // §126: `getEffect()` of dnd5e 6 (the `effect` getter is deprecated); asynchronous for a profile that carries a `uuid`.
  const effects = (await Promise.all((activity.effects ?? []).map(e => e.getEffect?.() ?? item.effects.get(e._id)))).filter(Boolean);
  if ( !effects.length ) return null;
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{
    type: "applyActiveEffect", name: item.name, system: { effects: effects.map(e => e.uuid) }
  }]);
  return { behavior, effects: effects.map(e => e.name) };
}

/**
 * §191: the effects borne by the area, brought back in line with the token's position. The core behavior only removes them
 * on an exit it sees: a token teleported (`blink`, Misty Step) or forcibly moved (`displace`) out of Jallarzi's Storm of
 * Radiance stayed Blinded, and on coming back received a second copy (seen on 2026-10-18). For each engine `zoneEffects`
 * area: outside the area, its copies (origin = the behavior) go; inside, there must be one per effect — duplicates go, the
 * missing ones are recreated as the core creates them (apply-active-effect.mjs, `#getEffectsToCreate`). Active GM.
 * @param {TokenDocument} token
 * @returns {Promise<number>}  The number of areas corrected.
 */
export async function syncZoneEffects(token) {
  const actor = token?.actor;
  if ( !actor || !token.parent ) return 0;
  let fixed = 0;
  for ( const region of token.parent.regions ) {
    if ( contentOf(activityOf(region)?.item).entry?.zoneEffects !== true ) continue;
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "applyActiveEffect") || behavior.disabled ) continue;
      const mine = actor.effects.filter(e => e.origin === behavior.uuid);
      const inside = token.testInsideRegion(region, { x: token._source.x, y: token._source.y, elevation: token._source.elevation,
        width: token._source.width, height: token._source.height, shape: token._source.shape, level: token._source.level });
      const sources = (await Promise.all(Array.from(behavior.system.effects ?? []).map(uuid => fromUuid(uuid)))).filter(Boolean);
      if ( !inside ) {
        if ( !mine.length ) continue;
        await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map(e => e.id));
        fixed++;
        continue;
      }
      const extra = [];
      const missing = [];
      for ( const source of sources ) {
        const copies = mine.filter(e => (e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid) || (e.name === source.name));
        extra.push(...copies.slice(1).map(e => e.id));
        if ( !copies.length ) missing.push(source);
      }
      if ( extra.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", extra);
      if ( missing.length ) {
        await actor.createEmbeddedDocuments("ActiveEffect", missing.map(effect => {
          const data = effect.toObject();
          delete data._id;
          data._stats = { ...(data._stats ?? {}), duplicateSource: effect.compendium ? null : effect.uuid,
            compendiumSource: effect.compendium ? effect.uuid : null, exportSource: null };
          data.origin = behavior.uuid;
          return data;
        }));
      }
      if ( extra.length || missing.length ) fixed++;
    }
  }
  return fixed;
}

/**
 * §261: an instantaneous area that leaves Difficult Terrain behind it (`difficultTerrain.lingers`, Ice Storm: "the area
 * becomes Difficult Terrain until the end of your next turn") — a copy of its shape, without dnd5e's flags (the engine does
 * not take it for a spell area), with the Difficult Terrain behavior, visible to all, marked to be removed at the end of the
 * caster's next turn (runtime/lingering.mjs). In combat only. Active GM.
 * @returns {Promise<RegionDocument|null>}
 */
export async function leaveDifficultTerrain(region, activity, { caster, combat }) {
  const rule = contentOf(activity?.item).entry?.difficultTerrain;
  if ( !rule?.lingers || !caster || !combat?.started ) return null;
  const data = region.toObject();
  delete data._id;
  data.name = activity.item.name;
  data.visibility = CONST.REGION_VISIBILITY.ALWAYS;
  data.behaviors = [{ type: "dnd5e.difficultTerrain", name: activity.item.name, system: { magical: true, types: rule.types ?? [] } }];
  data.flags = { [MODULE_ID]: { lingering: { item: activity.item.uuid, caster: caster.uuid, combat: combat.id, round: combat.round, until: rule.lingers } } };
  const [created] = await region.parent.createEmbeddedDocuments("Region", [data]);
  return created ?? null;
}
