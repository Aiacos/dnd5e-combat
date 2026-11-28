/**
 * An effect that carries a condition is ALWAYS visible on the token (table rule, requested by the user on
 * 2026-09-23). In V14, an effect's icon on the token depends on its `showIcon` field
 * (client/canvas/placeables/token.mjs:1870): by default CONDITIONAL, shown only if the effect has a
 * duration. A condition ticked in the menu gets ALWAYS (`ActiveEffect.fromStatusEffect`,
 * client/documents/active-effect.mjs:136); an effect placed by an activity (Grapple, Shove, Hide,
 * most of dnd5e's spells) has no duration: its icon stayed hidden while the condition was there.
 *
 *  - on creation and update, on the client that writes: an effect with conditions gets ALWAYS;
 *  - on load, the active GM fixes the existing effects (world actors, scene tokens).
 * An effect explicitly set to NEVER by its author is left alone.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const SHOW = () => CONST.ACTIVE_EFFECT_SHOW_ICON;
const hasStatuses = statuses => (statuses instanceof Set ? statuses.size : (statuses?.length ?? 0)) > 0;

function onPreCreate(effect, data) {
  if ( !hasStatuses(effect.statuses) ) return;
  if ( (data.showIcon === SHOW().NEVER) || (effect.showIcon === SHOW().ALWAYS) ) return;
  effect.updateSource({ showIcon: SHOW().ALWAYS });
}

function onPreUpdate(effect, changes) {
  if ( !("statuses" in changes) || !hasStatuses(changes.statuses) ) return;
  if ( ("showIcon" in changes) || (effect.showIcon === SHOW().ALWAYS) || (effect.showIcon === SHOW().NEVER) ) return;
  changes.showIcon = SHOW().ALWAYS;
}

/** An actor's effects to fix: conditions, a conditional icon. */
const hiddenConditionEffects = actor => (actor?.effects ?? [])
  .filter(e => hasStatuses(e.statuses) && (e.showIcon === SHOW().CONDITIONAL));

async function fixExisting() {
  let fixed = 0;
  const fix = async actor => {
    const list = hiddenConditionEffects(actor);
    if ( !list.length ) return;
    await actor.updateEmbeddedDocuments("ActiveEffect", list.map(e => ({ _id: e.id, showIcon: SHOW().ALWAYS })));
    fixed += list.length;
  };
  for ( const actor of game.actors ) await fix(actor);
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) if ( !token.actorLink ) await fix(token.actor);
  }
  if ( fixed ) log(`status icons: ${fixed} effect(s) made visible on tokens`);
}

export function registerIcons() {
  route("preCreateActiveEffect", onPreCreate, { label: "status icon always visible" });
  route("preUpdateActiveEffect", onPreUpdate, { label: "status icon always visible" });
  route("ready", () => fixExisting().catch(err => console.error(`${MODULE_ID} | status icons`, err)),
    { executor: true, label: "status icons: existing effects" });
}
