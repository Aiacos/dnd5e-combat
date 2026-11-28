/**
 * M8 (SPEC §18.16, §105): drain seen from Foundry — the item (its original English text, or the text of a sheet without
 * an original, states the drain: "bite" and "slam" are shared identifiers, and a hand-made sheet has no
 * identifier), and the EFFECT that carries it on the target.
 *
 * The effect (§105, request of 2026-10-07): one Active Effect per source and per quantity, visible on the token, whose total
 * grows with each drain — `hp.tempmax` added to the maximum by dnd5e (data/actor/templates/attributes.mjs:468), or the ability
 * score. It expires on rest through dnd5e's native expiration (`duration.expiry` "longRest",
 * config.mjs:4750, removed by `Actor5e#rest`, documents/actor/actor.mjs:2378). Before §105, the maximum went down through
 * the damage type `maximum` (actor.mjs:877, 940-950), invisible on the sheet outside the "temporary max HP" field.
 */

import { MODULE_ID } from "../constants.mjs";
import { readDrain, drains, drainEffectShape } from "../core/drain.mjs";
import { englishDescription } from "./multiattack.mjs";

/** @returns {ReturnType<typeof readDrain>|null} */
export function drainOf(item) {
  if ( !item ) return null;
  const rule = readDrain(englishDescription(item));
  return drains(rule) ? rule : null;
}

/** The item damage comes from: the origin message (`originatingMessage` of card buttons, `origin` of the engine). */
export function damageSourceItem(options) {
  return damageSourceMessage(options)?.getAssociatedActivity?.()?.item ?? damageSourceMessage(options)?.getAssociatedItem?.() ?? null;
}

/** The origin message of the damage. */
export function damageSourceMessage(options) {
  return options?.originatingMessage ?? options?.origin ?? null;
}

/** Le maximum de PV en vigueur : `hp.effectiveMax` = `max` + `tempmax` (attributes.mjs:468) — `hp.max` reste celui de base. */
export function effectiveMax(actor) {
  const hp = actor.system.attributes.hp;
  return hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
}

/**
 * Places (or grows) the drain effect on the actor. `kind`: "hp", or the key of an ability.
 * HP follow the maximum: dnd5e caps them for display (attributes.mjs:469) but keeps the written value, which
 * would come back when the effect expires; so the capped value is written.
 * @param {Actor5e} actor
 * @param {{kind: string, n: number, item: Item5e|{name: string, img?: string, uuid?: string},
 *   name: (total: number) => string}} drain
 * @returns {Promise<number>}   What remains of the drained quantity (current HP maximum, or ability score).
 */
export async function applyDrainEffect(actor, { kind, n, item, name }) {
  if ( n > 0 ) {
    const source = item?.uuid ?? item?.name ?? "";
    const existing = actor.effects.find(e => (e.flags?.[MODULE_ID]?.drain?.kind === kind) && (e.flags[MODULE_ID].drain.source === source));
    const total = (existing?.flags[MODULE_ID].drain.total ?? 0) + n;
    const shape = drainEffectShape({ kind, total });
    const data = {
      name: name(total),
      img: item?.img ?? "icons/magic/unholy/hand-claw-glow-orange.webp",
      origin: item?.uuid ?? null,
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
      duration: { expiry: shape.expiry },
      system: { changes: [{ key: shape.key, type: "add", value: shape.change, phase: "initial" }] },
      flags: { [MODULE_ID]: { drain: { kind, source, total } } }
    };
    if ( existing ) await existing.update(data);
    else await ActiveEffect.implementation.create(data, { parent: actor });
  }
  if ( kind !== "hp" ) return actor.system.abilities?.[kind]?.value ?? 0;
  const max = effectiveMax(actor);
  const value = actor._source.system?.attributes?.hp?.value ?? actor.system.attributes.hp.value;
  if ( value > max ) await actor.update({ "system.attributes.hp.value": Math.max(0, max) });
  return max;
}
