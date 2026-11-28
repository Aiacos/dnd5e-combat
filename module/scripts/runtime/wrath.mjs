/**
 * §356: cursed weapons that take hold of their bearer when it is wounded (content `wrath: { kind, save }`), active GM:
 *  - at `dnd5e.damageActor`, when another creature has just wounded the bearer of such an attuned weapon (the damage's author
 *    noted, runtime/triggers.mjs `recordDamager`) — and in combat for vengeance —, the saving throw is rolled; if failed, a mark
 *    is placed on the bearer ("Furious Madness" / "Vengeance", against the damage's author), seen by the whole table;
 *  - at the start of the bearer's turn, the mark falls if the wrath ends (`wrathEnds`).
 * What the mark imposes (attack the nearest creature, or the one that wounded them) stays with the player and the GM,
 * who is alerted (§364).
 */

import { MODULE_ID } from "../constants.mjs";
import { wrathSaveDue, wrathEnds } from "../core/defenses.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { requestSave } from "./neighbours.mjs";
import { alertGM } from "./gm-alert.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const FRESH_MS = 10000;
const markOf = actor => (actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, "wrath")) ?? null;

/** The attuned cursed weapon of the actor and its rule, or null. */
function wrathOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.wrath;
    if ( rule && ((item.system?.attunement !== "required") || item.system?.attuned) ) return { item, rule };
  }
  return null;
}

async function onDamaged(actor, changes) {
  if ( !(changes?.total < 0) || !actor ) return;
  const found = wrathOf(actor);
  if ( !found ) return;
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  const fresh = !!noted?.uuid && ((Date.now() - (noted.at ?? 0)) <= FRESH_MS);
  const damager = fresh ? fromUuidSync(noted.uuid, { strict: false }) : null;
  const token = tokenOf(actor);
  const inCombat = !!game.combat?.started && !!game.combat.combatants.find(c => c.actor === actor);
  if ( !wrathSaveDue({ kind: found.rule.kind, byOther: !!damager && (damager !== actor), inCombat, marked: !!markOf(actor) }) ) return;
  const saved = await requestSave(actor, { ability: found.rule.save.ability, dc: found.rule.save.dc, flavor: found.item.name });
  log(`${found.item.name}: ${actor.name} ${found.rule.save.ability} saving throw ${saved?.total ?? "?"} vs DC ${found.rule.save.dc}: ${saved?.success ? "succeeded" : "failed"}`);
  if ( saved?.success !== false ) return;
  const label = loc(found.rule.kind === "berserk" ? "Colere.Berserk" : "Colere.Vengeance", { name: damager.name });
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: label, img: found.item.img, origin: found.item.uuid,
    flags: { [MODULE_ID]: { wrath: { kind: found.rule.kind, against: damager.uuid, item: found.item.uuid } } } }]);
  log(`${found.item.name}: ${actor.name} — ${label}`);
  const shown = token?.document ?? token;
  if ( shown ) notice(shown, label, "refused", { all: true, action: "wrath" });
  // §364: what the mark imposes (attack the nearest creature, or the one that wounded them) stays with the GM — who is alerted.
  await alertGM({ text: loc(found.rule.kind === "berserk" ? "AlerteMJ.FolieFurieuse" : "AlerteMJ.Vengeance", { actor: actor.name, item: found.item.name }),
    item: found.item, actor });
}

/** At the start of the bearer's turn: does the wrath end? */
async function onTurn(combat, prior, current) {
  const actor = combat.combatants.get(current?.combatantId)?.actor;
  const mark = markOf(actor);
  if ( !mark ) return;
  const rule = mark.getFlag(MODULE_ID, "wrath");
  const foe = fromUuidSync(rule.against ?? "", { strict: false });
  const down = a => !a || ((a.system?.attributes?.hp?.value ?? 0) <= 0);
  const token = tokenOf(actor);
  const doc = token?.document ?? token;
  const limit = doc ? lengthIn(60, "ft", doc.parent.grid.units) : 0;
  const othersNear = !!doc && doc.parent.tokens.some(t => (t !== doc) && t.actor && !t.hidden && !isObjectToken(t) && !down(t.actor)
    && (distanceBetween(doc, t).value <= limit + 1e-6));
  if ( !wrathEnds({ kind: rule.kind, othersNear, foeDown: down(foe), bearerDown: down(actor) }) ) return;
  await mark.delete();
  log(`${actor.name}: ${mark.name} ends`);
}

export function registerWrath() {
  route("dnd5e.damageActor", (actor, changes) => enqueue(`wrath:${actor?.uuid}`, () => onDamaged(actor, changes)),
    { executor: true, label: "cursed weapon: wrath save not rolled" });
  route("combatTurnChange", (combat, prior, current) => enqueue("wrath:turn", () => onTurn(combat, prior, current)),
    { executor: true, label: "cursed weapon: wrath not ended" });
}
