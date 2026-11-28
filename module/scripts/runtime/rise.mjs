/**
 * §95: rise at 0 HP (`atZero` key, adapter/rise.mjs), on the active GM. The HP just dropped to 0 without killing: the question to
 * the creature ("rise?", yes first); the save if the rule asks for one (Grave Strength: Charisma, DC 5 + the damage
 * taken, read at `dnd5e.applyDamage`); then the activity, used on it — its consumptions or its healing raise it. Refused or
 * failed: it drops as usual (`ensureDowned`). Like Relentless Rage (runtime/barbarian.mjs), the "prone" condition is not
 * applied until the decision is made (adapter/death.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { riseAtZeroOf, settleRise, resetRise, beginRise, endRise } from "../adapter/rise.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { ensureDowned, AFTER_ZERO_HP_MS } from "../adapter/death.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, sleep } from "./shared.mjs";

const lastDamage = new Map();

function onZero(actor) {
  if ( !riseAtZeroOf(actor) ) return;
  return enqueue(`rise:${actor.uuid}`, async () => {
    await sleep(AFTER_ZERO_HP_MS);
    const found = riseAtZeroOf(actor);
    if ( !found ) return;
    const { item, rule, activity } = found;
    settleRise(actor);
    beginRise(actor);
    let down = false;
    try { down = await decide(actor, item, rule, activity); }
    finally { endRise(actor); }
    if ( down ) await ensureDowned(actor);
  });
}

/** The decision and what follows; returns true if the creature must fall (refused, failed save, still at 0 HP). */
async function decide(actor, item, rule, activity) {
  {
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Relever.Question", { item: item.name, name: actor.name }),
      options: [{ id: "yes", label: loc("Relever.Oui", { item: activity.name || item.name }) }, { id: "no", label: loc("Relever.Non") }]
    });
    if ( answer?.id !== "yes" ) { log(`${item.name}: ${actor.name} doesn't rise`); return true; }
    if ( rule.save ) {
      let dc = 10;
      try { dc = Math.max(1, Math.round(Roll.safeEval(Roll.replaceFormulaData(rule.save.dc, { ...actor.getRollData(), damage: lastDamage.get(actor.uuid) ?? 0 })))); } catch { /* DD 10 */ }
      const rolls = await actor.rollSavingThrow({ ability: rule.save.ability, target: dc }, { configure: false },
        { data: { flavor: loc("Relever.Carte", { item: item.name, name: actor.name, dc }) } });
      const total = rolls?.[0]?.total;
      if ( !(Number.isFinite(total) && (total >= dc)) ) {
        log(`${item.name}: ${actor.name} fails (${total} vs DC ${dc})`);
        return true;
      }
      log(`${item.name}: ${actor.name} succeeds (${total} vs DC ${dc})`);
    }
    const token = tokenOf(actor);
    if ( token?.object ) canvas.tokens.setTargets([token.id]);
    await activity.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: true } }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | ${item.name}: rise`, err));
    await sleep(2500);
    const hp = actor.system.attributes?.hp?.value ?? 0;
    if ( token ) notice(token, loc("Relever.Fait", { name: actor.name, hp }), "gain");
    log(`${item.name}: ${actor.name} rises with ${hp} Hit Points`);
    return hp <= 0;
  }
}

function onHp(actor, value) {
  if ( value === 0 ) return onZero(actor);
  if ( value > 0 ) resetRise(actor);
}

export function registerRise() {
  // The damage taken (Grave Strength: DC 5 + the damage), on the client that applies it.
  route("dnd5e.applyDamage", (actor, amount) => { if ( actor && (amount > 0) ) lastDamage.set(actor.uuid, amount); }, { label: "rise: damage not recorded" });
  route("updateActor", (actor, changed) => {
    const v = foundry.utils.getProperty(changed, "system.attributes.hp.value");
    if ( v !== undefined ) return onHp(actor, v);
  }, { executor: true, label: "rise at 0 Hit Points not played" });
  route("updateToken", (token, changed) => {
    const v = foundry.utils.getProperty(changed, "delta.system.attributes.hp.value");
    if ( v !== undefined ) return onHp(token.actor, v);
  }, { executor: true, label: "rise at 0 Hit Points not played (unlinked token)" });
}
