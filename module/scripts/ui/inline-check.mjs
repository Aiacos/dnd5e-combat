/**
 * §536: inline checks of a journal (`[[/check wis prc 11]]`, `[[/skill …]]`, `[[/save …]]`, `[[/tool …]]`) open the engine's
 * requested-roll flow instead of dnd5e's roll dialog — world setting `inlineChecksEngine`, off by default.
 *
 *  - **Entry point**: dnd5e's public pre-roll hooks (`dnd5e.preRollSkillV2`…), which receive the click as `config.event` before any
 *    dialog opens; returning `false` stops dnd5e's roll. No patch of dnd5e. The link must be a dnd5e roll link inside a journal
 *    (adapter/inline-check.mjs); every other roll goes on untouched.
 *  - **Who rolls**: the actors dnd5e chose for the link (controlled tokens, else the user's character), gathered per click (dnd5e
 *    rolls them one after the other).
 *  - **GM**: the request window (ui/group-roll.mjs) opens filled with the link's test, ability, DC and those actors; the GM may
 *    hide the DC, add a label, then "Request".
 *  - **Player**: the request card for their own characters, then the roll window (runtime/group-roll.mjs `requestOwnRoll`). Without
 *    an active GM nobody would link the rolls to the card: dnd5e's dialog opens as before.
 */

import { MODULE_ID } from "../constants.mjs";
import { INLINE_CHECK_SETTING, INLINE_HOOKS, inlineRequestOf, windowValuesOf } from "../core/inline-check.mjs";
import { inlineLinkOf } from "../adapter/inline-check.mjs";
import { requestOwnRoll } from "../runtime/group-roll.mjs";
import { route } from "../runtime/router.mjs";
import { log } from "../runtime/shared.mjs";
import { openGroupRoll } from "./group-roll.mjs";

/** The click being handled → `{ request, actors }`: dnd5e rolls each actor of a link in turn, the engine asks once. */
const batches = new WeakMap();

function enabled() {
  try { return !!game.settings.get(MODULE_ID, INLINE_CHECK_SETTING); }
  catch { return false; }
}

const onPreRoll = kind => config => {
  if ( !enabled() || !config?.event ) return;
  const actor = config.subject;
  if ( !(actor instanceof Actor) ) return;
  const request = inlineRequestOf(kind, config, inlineLinkOf(config.event));
  if ( !request ) return;
  // A player's rolls are linked to the card by the active GM: without one, dnd5e's roll as before.
  if ( !game.user.isGM && !game.users.activeGM ) return;
  let batch = batches.get(config.event);
  if ( !batch ) {
    batch = { request, actors: [] };
    batches.set(config.event, batch);
    // dnd5e awaits each actor's roll before the next one: all of this click's actors are in once the current task ends.
    setTimeout(() => start(batch).catch(err => console.error(`${MODULE_ID} | inline check: not started`, err)), 0);
  }
  if ( !batch.actors.includes(actor) ) batch.actors.push(actor);
  return false;
};

async function start({ request, actors }) {
  log(`inline check: ${request.type} ${request.key}${request.dc !== null ? ` DC ${request.dc}` : ""} — ${actors.map(a => a.name).join(", ")}`);
  if ( game.user.isGM ) {
    openGroupRoll({ actors, values: windowValuesOf(request) });
    return;
  }
  await requestOwnRoll({ actors, ...request });
}

export function registerInlineChecks() {
  game.settings.register(MODULE_ID, INLINE_CHECK_SETTING, {
    name: `DND5ECOMBAT.Reglage.${INLINE_CHECK_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${INLINE_CHECK_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false
  });
  // Before every other listener of these hooks: a roll handed to the engine must not get their changes (Disadvantage, Indomitable
  // Might) twice — they run again on the engine's own roll.
  for ( const [hook, kind] of Object.entries(INLINE_HOOKS) ) {
    route(hook, onPreRoll(kind), { cancellable: true, always: true, label: `inline check: ${kind} link` });
  }
}
