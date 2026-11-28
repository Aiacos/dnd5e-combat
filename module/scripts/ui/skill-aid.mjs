/**
 * §113: the "Aids" section of the roll window of a skill or tool check (dnd5e's SkillToolRollConfigurationDialog) —
 * BG3-style. One button per possible aid (adapter/skill-aid.mjs); a click sends the request to the helper
 * (runtime/skill-aid.mjs). Once granted:
 *  - Guidance: the spell's native effect lands on the tester, then the window rebuilds — dnd5e re-reads the sheet at each
 *    rebuild (`_buildSkillToolConfig`, documents/actor/actor.mjs:1466) and the 1d4 enters the formula;
 *  - Bardic Inspiration: we wait for the "Inspired" effect on the tester; the die will be offered after the roll
 *    (runtime/roll-bonus.mjs);
 *  - Support: Advantage is set on the window's configuration (`app.config`, re-read at each rebuild,
 *    applications/dice/roll-configuration-dialog.mjs:286-312) — the Advantage button becomes the default one.
 */

import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { tokenArt } from "../adapter/token-art.mjs";
import { inspirationOf } from "../adapter/inspiration.mjs";
import { requestSkillAid } from "../runtime/skill-aid.mjs";
import { route } from "../runtime/router.mjs";
import { loc, sleep, esc } from "../runtime/shared.mjs";

/** The requests of each window (`{status: "pending"|"granted"|"refused", aid}`), kept from one render to the next. */
const states = new WeakMap();
const keyOf = aid => `${aid.kind}.${aid.token.id}`;

/** Waits for the aid's effect to be placed on the tester (resolution goes through the active GM). */
async function untilApplied(test, ms=10000) {
  for ( let waited = 0; waited < ms; waited += 250 ) {
    if ( test() ) return true;
    await sleep(250);
  }
  return false;
}

/**
 * §140: while an aid is pending, the roll buttons are blocked — Guidance takes a few seconds to arrive (the active GM's
 * resolution, animation included): a click on "Normal" in the meantime rolled the d20 without the 1d4.
 */
function lockRoll(app) {
  const pending = Array.from(states.get(app)?.values() ?? []).some(s => s.status === "pending");
  for ( const button of app.element?.querySelectorAll('[data-application-part="buttons"] button') ?? [] ) {
    button.disabled = pending;
    if ( pending ) button.dataset.tooltip = loc("AideTest.Attente");
    else if ( button.dataset.tooltip === loc("AideTest.Attente") ) delete button.dataset.tooltip;
  }
}

function grantAdvantage(app) {
  app.config.advantage = true;
  // `advantageMode`: the displayed formula shows it; the button clicked always decides in the end (_finalizeConfig).
  const mode = CONFIG.Dice.D20Roll.ADV_MODE;
  for ( const roll of app.config.rolls ?? [] ) {
    roll.options ??= {};
    roll.options.advantage = true;
    roll.options.advantageMode = roll.options.disadvantage ? mode.NORMAL : mode.ADVANTAGE;
  }
  app.rebuild();
  app.render({ parts: ["buttons"] });
}

/** Is an aid of this kind already requested (pending) or granted for this roll? Only one of each kind (§242). */
const kindTaken = (state, kind) => Array.from(state.values()).some(s => (s.aid.kind === kind) && (s.status !== "refused"));

async function onAsk(app, aid, test) {
  const state = states.get(app);
  const key = keyOf(aid);
  if ( state.get(key) || kindTaken(state, aid.kind) ) return;
  state.set(key, { status: "pending", aid });
  if ( app.rendered ) app.render({ parts: ["formulas"] });   // partial: the form's ability choice stays
  lockRoll(app);
  const granted = await requestSkillAid({ kind: aid.kind, helper: aid.helper, tester: aid.tester, ...test });
  if ( granted && (aid.kind === "guidance") ) await untilApplied(() => isGuided(app.config.subject, test.skill));
  if ( granted && (aid.kind === "inspiration") ) await untilApplied(() => !!inspirationOf(app.config.subject));
  state.set(key, { status: granted ? "granted" : "refused", aid });
  if ( !app.rendered ) return;
  if ( granted && (aid.kind === "help") ) grantAdvantage(app);
  else if ( granted && (aid.kind === "guidance") ) app.rebuild();
  await app.render({ parts: ["formulas"] });
  lockRoll(app);
}

function onRender(app, element) {
  const actor = app.config?.subject;
  const test = { skill: app.config?.skill ?? null, tool: app.config?.tool ?? null };
  if ( !(actor instanceof Actor) || !actor.isOwner || (!test.skill && !test.tool) ) return;
  if ( !states.has(app) ) states.set(app, new Map());
  const state = states.get(app);
  // A requested aid stays displayed even if it would no longer be offered (Guidance placed removes the offer).
  const offered = aidsFor(actor, test);
  const asked = Array.from(state.values(), s => s.aid).filter(a => !offered.some(o => keyOf(o) === keyOf(a)));
  const aids = [...offered, ...asked];
  if ( !aids.length ) return element.querySelector(".dnd5e-combat-aids")?.remove();
  const buttons = aids.map(aid => {
    const own = state.get(keyOf(aid))?.status ?? "";
    // Another aid of the same kind in progress or granted: this one is no longer offered.
    const status = own || (kindTaken(state, aid.kind) ? "taken" : "");
    const label = loc({ guidance: aid.self ? "AideTest.AssistanceSoi" : "AideTest.Assistance", inspiration: "AideTest.Inspiration",
      help: "AideTest.Soutien" }[aid.kind], { name: aid.helper.name });
    const gain = loc({ guidance: "AideTest.Gain1d4", inspiration: "AideTest.GainInspiration", help: "AideTest.GainAvantage" }[aid.kind],
      { formula: aid.formula ?? "" });
    const tip = status ? loc(`AideTest.Etat.${status}`) : gain;
    return `<button type="button" class="dnd5e-combat-aid" data-aid="${esc(keyOf(aid))}" data-status="${status}"
      data-tooltip="${esc(tip)}" ${status ? "disabled" : ""}>
      <img src="${esc(tokenArt(aid.token, aid.helper.img))}" alt=""><span>${esc(label)}</span><small>${esc(status ? tip : gain)}</small></button>`;
  }).join("");
  let section = element.querySelector(".dnd5e-combat-aids");
  if ( !section ) {
    section = document.createElement("fieldset");
    section.className = "dnd5e-combat-aids";
    const anchor = element.querySelector('[data-application-part="buttons"]');
    if ( anchor ) anchor.before(section);
    else (element.querySelector(".window-content") ?? element).append(section);
    section.addEventListener("click", event => {
      const button = event.target.closest("[data-aid]");
      if ( !button ) return;
      event.preventDefault();
      const aid = (section._aids ?? []).find(a => keyOf(a) === button.dataset.aid);
      if ( aid ) onAsk(app, aid, test);
    });
  }
  section._aids = aids;
  lockRoll(app);   // un rendu complet refait les boutons de jet
  section.innerHTML = `<legend>${esc(loc("AideTest.Titre"))}</legend>${buttons}`;
}

export function registerSkillAidUi() {
  // ApplicationV2 calls one hook per class of the lineage: that of the skill and tool check window.
  route("renderSkillToolRollConfigurationDialog", onRender, { label: "check aids not offered", level: "warn" });
}
