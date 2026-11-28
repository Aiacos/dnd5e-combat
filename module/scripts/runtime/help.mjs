/**
 * Help (SPEC §15.2, 2024 rules), attack part, on the active GM:
 *  - the Help item used on an enemy: a mark is placed on it;
 *  - an attack by an ally of the helper against it: Advantage is given to the roll (adapter/conditions.mjs),
 *    then the mark is consumed;
 *  - at the start of the helper's next turn, or at the end of combat, the remaining marks drop.
 * The "ability check" part of Help: runtime/skill-aid.mjs (§113, out of combat).
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOfActivity } from "../adapter/basics.mjs";
import { helpMarksOn, helpMarksUsedBy, markHelped } from "../adapter/help.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { speakerTokenOf } from "../adapter/turn.mjs";

async function onUsage(message) {
  const activity = message.getAssociatedActivity?.();
  // §72: the Help item, or an activity that declares it (`basicActions`: Tactical Master, at 9 m).
  if ( basicActionOfActivity(activity) !== "help" ) return;
  const helper = speakerTokenOf(message);
  if ( !helper ) return;
  const targets = (message.system?.targets ?? []).map(t => fromUuidSync(t.token)).filter(t => t && (t !== helper));
  const target = targets[0];
  if ( !target ) return ui.notifications.info(loc("Soutien.SansCible", { name: helper.name }));
  await markHelped(target, helper, { name: loc("Soutien.Marque", { name: helper.name }), img: "icons/svg/aura.svg" });
  log(`help: ${helper.name} distracts ${target.name}`);
}

async function onAttack(message) {
  const attacker = speakerTokenOf(message);
  if ( !attacker ) return;
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token);
    const used = helpMarksUsedBy(attacker, target);
    if ( !used.length ) continue;
    await target.actor.deleteEmbeddedDocuments("ActiveEffect", used.map(e => e.id));
    log(`help used: ${attacker.name} against ${target.name}`);
  }
}

/** Removes the marks placed by this helper (all the combat's tokens), or all of them if `helper` is null. */
async function dropMarks(combat, helper=null) {
  for ( const combatant of combat.combatants ) {
    const actor = combatant.token?.actor;
    const marks = helpMarksOn(actor).filter(e => !helper || (e.getFlag(MODULE_ID, "help").helper === helper.uuid));
    if ( marks.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(e => e.id));
  }
}

export function registerHelp() {
  const executor = { executor: true, label: "help" };
  route("createChatMessage", message => (message.type === "usage") ? onUsage(message)
    : (message.type === "attack") ? onAttack(message) : null, executor);
  // "Before the start of your next turn": on the helper's turn, their marks drop.
  route("combatTurnChange", (combat, prior, current) => dropMarks(combat, combat.combatants.get(current.combatantId)?.token ?? null),
    { executor: true, label: "help: ends on the helper's turn" });
  route("deleteCombat", combat => dropMarks(combat), { executor: true, label: "help: end of combat" });
}
