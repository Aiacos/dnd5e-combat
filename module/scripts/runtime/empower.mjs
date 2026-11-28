/**
 * §19.9: Vampiric Bite (Dhampir, `empower` content). When the bite deals piercing damage to a creature that
 * is neither a Construct nor an Undead, and the item has a use left, the author chooses:
 *  - Drain: it regains as much HP as the piercing damage dealt;
 *  - Empowerment: a bonus equal to that damage on its next attack roll or ability check, within the minute
 *    (the item's effect, placed with that amount, removed at the first roll that benefits from it).
 * Same circuit as the monsters' drain (runtime/drain.mjs): the amount is read at damage calculation (Resistances included),
 * the question is asked once the HP are written. The question goes through `askChoice` (the player, otherwise the GM); with no
 * answer, nothing.
 */

import { MODULE_ID } from "../constants.mjs";
import { drainedAmount } from "../core/drain.mjs";
import { damageSourceItem } from "../adapter/drain.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { empowerOf, feedsOn, usesLeft, boostsOf, boostData } from "../adapter/empower.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, say, locEsc } from "./shared.mjs";
import { spendItemUses } from "../adapter/uses.mjs";

/** On the client that applies the damage: the bite's amount, kept for after the HP are written. */
function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = empowerOf(item);
  if ( !rule || !item.actor || (item.actor === actor) || !feedsOn(rule, actor) ) return;
  const n = drainedAmount(damages, rule.damageType);
  if ( n > 0 ) (options[MODULE_ID] ??= {}).empower = { n, item: item.uuid };
}

async function empower(victim, { n, item: itemUuid }) {
  const item = await fromUuid(itemUuid);
  const biter = item?.actor;
  const rule = empowerOf(item);
  if ( !biter || !rule || ((biter.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  if ( !game.user.isGM && !biter.isOwner ) return;
  if ( usesLeft(item) <= 0 ) { log(`${item.name}: ${n} damage, no uses left to empower`); return; }
  const answer = await askChoice(biter, {
    actor: biter.uuid,
    item: item.name,
    prompt: loc("Morsure.Question", { n, name: victim.name, uses: usesLeft(item) }),
    options: [
      { id: "none", label: loc("Morsure.Rien") },
      { id: "heal", label: loc("Morsure.Drain", { n }) },
      { id: "boost", label: loc("Morsure.Renfort", { n }) }
    ]
  });
  if ( !["heal", "boost"].includes(answer?.id) ) { log(`${item.name}: ${biter.name} does not empower`); return; }
  const token = tokenOf(biter);
  if ( answer.id === "heal" ) {
    await spendItemUses(item);
    await biter.applyDamage([{ value: n, type: "healing" }]);
    if ( token ) notice(token, loc("Morsure.RetourDrain", { n }), "gain");
    log(`${item.name}: ${biter.name} drains ${victim.name} and regains ${n} HP`);
  }
  else {
    const data = boostData(item, rule, n);
    if ( !data ) { log(`${item.name}: empowerment effect ${rule.effect} not found`); return; }
    await spendItemUses(item);
    // Only one Empowerment at a time: the new one replaces the one that has not yet been used.
    const old = boostsOf(biter).filter(e => e.getFlag(MODULE_ID, "boost")?.item === item.uuid).map(e => e.id);
    if ( old.length ) await biter.deleteEmbeddedDocuments("ActiveEffect", old);
    await biter.createEmbeddedDocuments("ActiveEffect", [data]);
    if ( token ) notice(token, loc("Morsure.RetourRenfort", { n }), "gain");
    log(`${item.name}: ${biter.name} is empowered (+${n} to the next attack roll or ability check)`);
  }
  await say({ actor: biter }, locEsc(answer.id === "heal" ? "Morsure.CarteDrain" : "Morsure.CarteRenfort", { item: item.name, name: biter.name, n, victim: victim.name }),
    { empower: { item: item.uuid, mode: answer.id, amount: n, victim: victim.uuid } });
}

function onApplyDamage(actor, amount, options) {
  const e = options?.[MODULE_ID]?.empower;
  if ( !e ) return;
  // Without waiting: the attack's resolution carries on while the author chooses.
  enqueue(`empower:${e.item}`, () => empower(actor, e));
}

/** Empowerment applies to the next attack roll or ability check: removed as soon as that roll is made, on this client. */
const consuming = new Set();
async function consumeBoosts(actor, kind) {
  if ( !actor?.isOwner ) return;
  const ids = boostsOf(actor).filter(e => (e.getFlag(MODULE_ID, "consumeOn") ?? []).includes(kind) && !consuming.has(e.uuid)).map(e => e.id);
  if ( !ids.length ) return;
  ids.forEach(id => consuming.add(`${actor.uuid}.ActiveEffect.${id}`));
  try { await actor.deleteEmbeddedDocuments("ActiveEffect", ids); }
  finally { ids.forEach(id => consuming.delete(`${actor.uuid}.ActiveEffect.${id}`)); }
  log(`${actor.name}: empowerment consumed (${kind === "attack" ? "attack roll" : "ability check"})`);
}

export function registerEmpower() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "bite: amount not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "bite: empowerment not offered" });
  // dnd5e 6.0.3: documents/activity/attack.mjs:212 (`subject` = the activity); documents/actor/actor.mjs:1448 (skill,
  // tool: `dnd5e.roll${name}`) and 1657 (ability check) — `subject` = the actor.
  route("dnd5e.rollAttack", (rolls, { subject }={}) => consumeBoosts(subject?.actor, "attack"), { label: "empowerment not consumed" });
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, (rolls, { subject }={}) => consumeBoosts(subject, "check"), { label: "empowerment not consumed" });
  }
}
