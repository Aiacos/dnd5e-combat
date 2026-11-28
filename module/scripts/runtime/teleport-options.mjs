/**
 * §92: what a trait adds to a self-teleportation (key `afterTeleport: { spells, options }`) — the Steps of the Fey of the
 * Archfey Protector: "whenever you cast [Misty Step], you can choose one of the additional effects";
 * Misty Escape adds two. Once the teleportation is done (runtime/actions.mjs, `teleportSelf`), on the client of whoever
 * teleports: the question ("None" first), then the chosen activity, used — on the creature itself, or (`around`) on
 * the creatures within 1.50 m of the cell left (`"left"`) or of the arrival cell (`"arrival"`), it excepted.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { loc, log } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { levelHidden } from "../adapter/level-gate.mjs";

/** The options that the actor's traits add to this teleportation. */
function optionsFor(actor, spell) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.afterTeleport;
    if ( !rule?.spells?.includes(spell) ) continue;
    for ( const option of rule.options ?? [] ) {
      const activity = item.system.activities?.get(option.activity);
      // §438: an option of a level the actor does not have (Player's Handbook 3.0.0: Misty Escape, level 6 of Steps of the Fey): no
      if ( activity && !levelHidden(activity) ) out.push({ ...option, activity, item });
    }
  }
  return out;
}

/** The creatures within 1.50 m of a cell (the token being placed there by hypothesis), it excepted. */
function around(token, at) {
  const scene = token.parent;
  let reach = lengthIn(5, "ft", scene.grid.units);
  return scene.tokens.filter(t => t.actor && (t !== token) && (distanceBetween(t, token, { posB: at }).value <= (reach + 1e-6)));
}

/**
 * @param {Activity} activity   The activity that teleported (the spell).
 * @param {TokenDocument} token
 * @param {{x: number, y: number, elevation: number, level?: string}} from  The cell left.
 */
export async function afterTeleportOptions(activity, token, from) {
  const actor = token?.actor;
  const spell = identifierOf(activity?.item).id;
  const options = optionsFor(actor, spell);
  if ( !options.length ) return;
  const label = o => (o.around ? loc(o.around === "left" ? "Foulee.Depart" : "Foulee.Arrivee", { name: o.activity.name }) : o.activity.name);
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: options[0].item.name, prompt: loc("Foulee.Question", { spell: activity.item.name }),
    options: [{ id: "none", label: loc("Foulee.Aucun") }, ...options.map((o, i) => ({ id: String(i), label: label(o) }))]
  });
  const chosen = options[Number(answer?.id)];
  if ( !chosen ) return;
  const here = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  const targets = chosen.around ? around(token, chosen.around === "left" ? from : here) : [token];
  canvas.tokens.setTargets(targets.map(t => t.id));
  log(`${chosen.item.name}: ${chosen.activity.name}${chosen.around ? ` on ${targets.map(t => t.name).join(", ") || "nobody"}` : ""}`);
  if ( chosen.around && !targets.length ) return;
  // §438: the creatures are already designated (`around`) — no template to place ("Foulée narquoise" and "Foulée effroyable" of
  // Player's Handbook 3.0.0 carry a radius of 1.50 m: dnd5e was waiting for a click on the canvas).
  // The message's targets (`givenTargets`, §104): the engine does not wait for an area.
  await chosen.activity.use({ [MODULE_ID]: { confirmed: true }, ...(chosen.around ? { create: { measuredTemplate: false } } : {}) }, { configure: false },
    chosen.around ? { data: { flags: { [MODULE_ID]: { givenTargets: true } } } } : {})
    .catch(err => console.error(`${MODULE_ID} | teleport option`, err));
}
