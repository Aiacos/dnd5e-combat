/**
 * §164: spells that change a creature's elevation.
 *  - Levitate (`levitate: { effect, height, units }`): the effect's bearer rises by `height` on placement; while it levitates, its
 *    effect carries dnd5e's Immunity to "Falling" (content/spell-rules.mjs, `effectChanges`). §195: once the effect ends, it
 *    "floats gently down to the ground" — the ground under it (`groundUnder`), by a `fall` move (no cost, no damage), then dnd5e
 *    re-evaluates its fall (`updateFalling`, which removes "Falling" if it had set it in the meantime).
 *  - Reverse Gravity (`lift` step on a failed save, runtime/engine.mjs): the target rises to the top of the area; when the
 *    area falls (concentration, duration), it falls — §195: dnd5e's fall (`fallLikeDnd5e`, runtime/climb.mjs: `updateFalling` then
 *    `plummet`, 1d6 bludgeoning per 3 m, 20d6 at most, Prone if it takes damage).
 * The token rises by `displace` (no path, no cost, no Opportunity Attack, like `move-token`). Active GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { groundUnder } from "../adapter/altitude.mjs";
import { fallLikeDnd5e } from "./climb.mjs";

/** A height in the unit of the scene's grid. */
const toGrid = (scene, value, units) => lengthIn(value, units, scene.grid.units);

/** Moves the token to this elevation, in place. */
async function setElevation(token, elevation) {
  const { x, y, level } = token._source;
  await token.move([{ x, y, elevation, level, action: "displace" }], { [MODULE_ID]: { cleared: true } });
}

/** The `levitate` rule of the item this effect comes from, if it is its effect. */
function levitationOf(effect) {
  const rule = contentOf(originItemOf(effect)).entry?.levitate;
  return (rule && comesFromItemEffect(effect, rule.effect)) ? rule : null;
}

async function onCreateEffect(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const rule = levitationOf(effect);
  if ( !rule ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    const from = token._source.elevation ?? 0;
    await setElevation(token, from + toGrid(token.parent, rule.height, rule.units));
    await effect.setFlag(MODULE_ID, "levitate", { [token.id]: from });
    log(`${token.name}: levitates (${from} → ${token._source.elevation})`);
  }
}

/**
 * Levitation ended: the token settles on the ground under it (not at the elevation it had: it may have passed over a ditch or a
 * roof), gently — a `fall` move (dnd5e: no cost; no damage card, that one only comes from `plummet`) —, then dnd5e
 * re-evaluates its fall.
 */
async function onDeleteEffect(effect) {
  const actor = effect.parent;
  const from = effect.getFlag?.(MODULE_ID, "levitate");
  if ( (actor?.documentName !== "Actor") || !from ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    if ( !(token.id in from) ) continue;
    const ground = groundUnder(token);
    const elevation = token._source.elevation ?? 0;
    if ( elevation > ground + 1e-6 ) {
      const { x, y, level } = token._source;
      await token.move([{ x, y, elevation: ground, level, action: "fall" }], { animate: false, [MODULE_ID]: { cleared: true } });
    }
    if ( typeof token.updateFalling === "function" ) await token.updateFalling();
    log(`${token.name}: Levitate ends, floats down to the ground (${elevation} → ${token._source.elevation})`);
  }
}

/** `lift` step (runtime/engine.mjs): the target rises; the area that lifted it is noted on its token. */
export async function liftToken(token, step, region) {
  if ( !token ) return;
  const from = token._source.elevation ?? 0;
  const to = toGrid(token.parent, step.height, step.units);
  if ( to <= from ) return;
  await setElevation(token, to);
  await token.setFlag(MODULE_ID, "lifted", { region: region?.id ?? null, from });
  log(`${token.name}: lifted to ${to} (${region?.name ?? "area"})`);
}

/**
 * The area has fallen: each of those it lifted falls — dnd5e's fall (§195), down to the surface under it; dnd5e's damage card
 * is applied by the engine (runtime/climb.mjs, `onFallCard`), which makes it Prone if the fall hurts.
 */
async function onDeleteRegion(region) {
  for ( const token of region.parent?.tokens ?? [] ) {
    const lifted = token.getFlag(MODULE_ID, "lifted");
    if ( !lifted || (lifted.region !== region.id) ) continue;
    await token.unsetFlag(MODULE_ID, "lifted");
    const from = token._source.elevation ?? 0;
    const fell = await fallLikeDnd5e(token);
    log(`${token.name}: ${region.name} ends, ${fell ? `falls ${from} → ${token._source.elevation}` : "does not fall (supported or flying)"}`);
  }
}

export function registerElevationSpells() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "Levitate: not lifted" });
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "Levitate: not brought down" });
  route("deleteRegion", onDeleteRegion, { executor: true, label: "Reverse Gravity: fall not applied" });
}
