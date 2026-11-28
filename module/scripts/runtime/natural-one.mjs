/**
 * §93: "just after making a D20 Test and getting a 1 on the d20" (Ravenloft Dark Gifts: "Aberrant Anatomy", "Echo Soul",
 * "Living Shadow", "Symbiotic Being", "Watchers") — key `onNatural1: { activity }`. An attack roll, a saving throw (death save
 * included), an ability check, skill check or tool check whose kept d20 is 1: on the client that rolled it, the creature
 * uses the activity of each of its items that declare it (its saving throw, on itself: "DC 13 + your proficiency bonus"),
 * the usual saving throw resolution applies the condition on a failure. Initiative is not read (its roll does not go through
 * these hooks).
 * A 1 on that saving throw is itself a D20 Test: it restarts the chain, as the text wants.
 */

import { MODULE_ID } from "../constants.mjs";
import { rolledNaturalOne } from "../core/natural-one.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

async function afterRoll(rolls, actor, what) {
  if ( !actor?.isOwner || !rolledNaturalOne(rolls) ) return;
  await naturalOneFor(actor, what);
}

/** What the creature's items do with a natural 1 (exported for test tools, `api.mcp.naturalOne`). */
export async function naturalOneFor(actor, what) {
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.onNatural1;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity ) continue;
    log(`${actor.name}: natural 1 (${what}) — ${item.name}`);
    await activity.use({ [MODULE_ID]: { confirmed: true }, consume: false }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | natural 1: ${item.name}`, err));
  }
}

export function registerNaturalOne() {
  // dnd5e 6.0: documents/activity/attack.mjs (`subject` = the activity); documents/actor/actor.mjs (`subject` = the actor);
  // the death saving throw: `dnd5e.rollDeathSave` (Hooks.call, the returned value is not read here).
  route("dnd5e.rollAttack", (rolls, { subject }={}) => afterRoll(rolls, subject?.actor, "attack"), { label: "natural 1: attack not read" });
  for ( const [hook, what] of [["dnd5e.rollSavingThrow", "saving throw"], ["dnd5e.rollAbilityCheck", "check"], ["dnd5e.rollSkill", "check"],
    ["dnd5e.rollToolCheck", "check"], ["dnd5e.rollDeathSave", "death saving throw"]] ) {
    route(hook, (rolls, { subject }={}) => afterRoll(rolls, subject, what), { label: `natural 1: ${what} not read` });
  }
}
