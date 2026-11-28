/**
 * Passive Perception against Stealth (SPEC §16.51), on the active GM. 2024 rule: "the GM uses passive Perception
 * to determine whether a creature notices something without consciously making a Wisdom (Perception) check". An
 * enemy whose passive Perception reaches the DC of the hiding place (−5 if it sees it in a lightly obscured area, nothing if it
 * cannot see it) spots it (core/search.mjs, `passiveNotice`).
 *
 * Judged when a creature hides (Stealth effect created) and at each validated movement — of the hidden creature, or of one
 * of its enemies —, on the scene displayed by the active GM. World setting:
 *  - "auto": the Stealth is removed; the GM and the creature's owners are notified (private message);
 *  - "gm":   only the GM is notified (once per hiding place and per observer), they decide;
 *  - "off":  nothing.
 */

import { MODULE_ID } from "../constants.mjs";
import { hiddenEffectsOf } from "../adapter/hide.mjs";
import { hiddenDcOf, passiveObservers } from "../adapter/search.mjs";
import { passiveNotice } from "../core/search.mjs";
import { stealthRules } from "../adapter/stealth.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, say, locEsc } from "./shared.mjs";

const SETTING = "passivePerception";
/** Mode "gm": the (Stealth effect, observer) pairs already reported, so as not to repeat the message at each step. */
const told = new Set();

function recipients(actor, withOwners) {
  return game.users.filter(u => u.isGM || (withOwners && actor.testUserPermission(u, "OWNER"))).map(u => u.id);
}

/** Judges a hidden creature; returns the observers that spot it. */
async function judge(hidden) {
  const mode = game.settings.get(MODULE_ID, SETTING);
  const actor = hidden?.actor;
  // §185: in BG3 rules, detection is that of runtime/stealth.mjs (a check on each entry into a field of view); Stealth
  // not handled (issue #65): nobody is hidden, nothing to judge.
  if ( (mode === "off") || !actor || (stealthRules() !== "2024") ) return [];
  const dc = hiddenDcOf(actor);
  if ( dc === null ) return [];
  const effects = hiddenEffectsOf(actor);
  const spotted = passiveObservers(hidden)
    .map(o => ({ ...o, ...passiveNotice(o, dc) }))
    .filter(o => o.notices && ((mode === "auto") || !told.has(`${effects[0]?.uuid}|${o.token.uuid}`)));
  if ( !spotted.length ) return [];
  const observers = spotted.map(o => (o.score === null) ? `${o.token.name} (${loc("PerceptionPassive.Sens")})` : `${o.token.name} (${o.score})`).join(", ");
  log(`passive perception: ${hidden.name} (DC ${dc}) spotted by ${observers} — mode ${mode}`);
  if ( mode === "auto" ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
    notice(hidden, loc("PerceptionPassive.Court"), "ended");
  } else for ( const o of spotted ) told.add(`${effects[0]?.uuid}|${o.token.uuid}`);
  await say({ token: hidden }, locEsc(`PerceptionPassive.${mode === "auto" ? "Repere" : "RepereMJ"}`, { name: hidden.name, observers, dc }),
    { passivePerception: { hidden: hidden.uuid, dc, mode, by: spotted.map(o => o.token.uuid) } }, { whisper: recipients(actor, mode === "auto") });
  return spotted;
}

/** The scene's hidden creatures to rejudge when this token moved: it if it is hidden, otherwise those whose enemy it is. */
function affectedBy(token) {
  if ( hiddenDcOf(token.actor) !== null ) return [token];
  return token.parent.tokens.filter(t => (t !== token) && (hiddenDcOf(t.actor) !== null));
}

function run(tokens) {
  for ( const t of tokens ) judge(t).catch(err => console.error(`${MODULE_ID} | passive perception`, err));
}

export function registerPassivePerception() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "DND5ECOMBAT.Reglage.passivePerception.Nom", hint: "DND5ECOMBAT.Reglage.passivePerception.Aide",
    scope: "world", config: true, type: String, default: "auto",
    choices: {
      auto: "DND5ECOMBAT.Reglage.passivePerception.auto",
      gm: "DND5ECOMBAT.Reglage.passivePerception.gm",
      off: "DND5ECOMBAT.Reglage.passivePerception.off"
    }
  });
  const opts = { executor: true, label: "passive perception" };
  route("createActiveEffect", effect => {
    if ( !effect.getFlag?.(MODULE_ID, "hidden") || !(effect.parent instanceof Actor) ) return;
    run(effect.parent.getActiveTokens(false, true).filter(t => t.parent === canvas.scene));
  }, opts);
  route("updateToken", (token, changes) => {
    if ( !["x", "y", "elevation", "level"].some(k => k in changes) || (token.parent !== canvas.scene) ) return;
    run(affectedBy(token));
  }, opts);
  route("deleteActiveEffect", effect => { if ( effect.getFlag?.(MODULE_ID, "hidden") ) for ( const k of told ) if ( k.startsWith(`${effect.uuid}|`) ) told.delete(k); }, opts);
}
