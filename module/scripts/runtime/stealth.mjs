/**
 * §183–§185: being hidden, in play. A single condition (the Stealth effect, runtime/hide.mjs): the Alt+C shortcut and a
 * neighbour's button take the Stealth action (out of combat, at no cost) or leave it; the player of a hidden token sees the
 * vision cones (§182) of the creatures it sees (ui/stealth.mjs).
 *
 * `bg3` rules (user decisions, 2026-10-14) — in combat and out of combat:
 *  - a hidden token walks at **half speed** (core animation, `speedMultiplier`, placeables/token.mjs:2286);
 *  - an enemy does not see it until it has **spotted** it (adapter/stealth.mjs); when the token **enters** what it sees
 *    (cone out of combat, 360° in combat; senses and light included), once per entry: in **Bright Light** (the engine's light
 *    at the token's point), spotted at once; otherwise Stealth against its passive Perception — active (check) if it already has
 *    a doubt; a first failure = doubt ("?"), a second = spotted;
 *  - attacking gives Advantage (the target does not see it), then Stealth ends (runtime/hide.mjs).
 * `2024` rules: the enemies' passive Perception against the DC of the hiding place (runtime/passive.mjs, §16.51), judged at each
 * move — which amounts to "when it enters a cone" (nothing is rolled on the dice there).
 * Hook `dnd5e-combat.stealthNoticed(observer, target, { level: "suspicious" | "spotted", point, reason })`.
 */

import { MODULE_ID } from "../constants.mjs";
import { hardToPerceive } from "../adapter/defenses.mjs";
import { route } from "./router.mjs";
import { theaterActive } from "./theater-state.mjs";
import { log, loc, isExecutor, say, esc } from "./shared.mjs";
import { isHidden, spottedBy, stealthRules, RULES_SETTING } from "../adapter/stealth.mjs";
import { canLocate } from "../adapter/vision.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { lightAt, tokenPoint } from "../adapter/illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { toggleHidden, endHiding } from "./hide.mjs";

export { isHidden };

/** The conditions of a creature that no longer watches anything (with 0 HP and Defeated): it neither spots nor sees a cone. */
export const OUT = Object.freeze(["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned", "sleeping"]);
const able = doc => {
  const actor = doc?.actor;
  if ( !actor || doc.hidden || ((actor.system?.attributes?.hp?.value ?? 1) <= 0) ) return false;
  return ![...OUT, CONFIG.specialStatusEffects.DEFEATED].some(s => actor.statuses?.has(s));
};

/** Hide or stop being hidden (`on` absent: toggle). */
export async function setHidden(token, on=undefined) {
  const doc = token?.document ?? token;
  const now = isHidden(doc);
  if ( (on !== undefined) && (!!on === now) ) return { hidden: now };
  if ( (on === false) && doc?.actor ) { await endHiding(doc.actor, "by hand"); return { hidden: false }; }
  return toggleHidden(doc);
}

/* -------------------------------------------- */
/*  §184: detection (BG3 rules)                  */
/* -------------------------------------------- */

/** Per observer | hidden pair (active GM): `{ inView, fails }`. */
const views = new Map();
let timer = null;

/** Judge the displayed scene soon (several events → a single pass). */
function schedule() {
  if ( timer || (stealthRules() !== "bg3") || !isExecutor() ) return;
  timer = setTimeout(() => { timer = null; check(canvas?.scene).catch(err => console.error(`${MODULE_ID} | stealth: check failed`, err)); }, 250);
}

let busy = false;
/** For each hidden token of the scene and each enemy in a condition to see: has it entered its view? */
export async function check(scene) {
  if ( theaterActive() || busy || !scene || (stealthRules() !== "bg3") ) return;
  busy = true;
  try {
    for ( const target of scene.tokens.filter(t => isHidden(t) && able(t)) ) {
      for ( const obs of scene.tokens ) {
        if ( (obs === target) || !able(obs) || !areEnemies(target, obs) ) continue;
        if ( !isHidden(target) ) break;
        if ( spottedBy(target).includes(obs.id) ) continue;
        const key = `${obs.id}|${target.id}`;
        const state = views.get(key) ?? { inView: false, fails: 0 };
        const sees = canLocate(obs, target, { ignoreHidden: true }) === true;
        if ( sees && !state.inView ) {
          state.inView = true;
          views.set(key, state);
          await entered(obs, target, state);
        }
        else if ( !sees && state.inView ) { state.inView = false; views.set(key, state); }
      }
    }
  } finally { busy = false; }
}

/** The hidden token enters what the enemy sees. */
async function entered(obs, target, state) {
  const point = tokenPoint(target);
  if ( lightAt(point)?.level === LIGHT.BRIGHT ) return spot(obs, target, point, "bright");
  const stealth = (await target.actor.rollSkill({ skill: "ste" }, { configure: false }))?.[0];
  if ( !stealth ) return;
  let dc;
  // O9g (§361): against a bearer of an Elven Cloak, Perception with Disadvantage (passive: −5).
  const cloaked = hardToPerceive(target.actor);
  if ( state.fails > 0 ) dc = (await obs.actor.rollSkill({ skill: "prc", ...(cloaked ? { disadvantage: true } : {}) }, { configure: false }))?.[0]?.total ?? 10;
  else dc = (Number(obs.actor.system?.skills?.prc?.passive) || 10) - (cloaked ? 5 : 0);
  if ( stealth.total >= dc ) { log(`stealth: ${target.name} ${stealth.total} vs ${obs.name} ${dc} — unseen`); return; }
  state.fails += 1;
  if ( state.fails >= 2 ) return spot(obs, target, point, "failed");
  log(`stealth: ${target.name} ${stealth.total} vs ${obs.name} ${dc} — ${obs.name} suspects something`);
  // §184: on the active GM, `bg3` rules, when an enemy notices a hidden token: `(observer, target, { level, point, reason })` —
  // TokenDocuments; `level` "suspicious" (a doubt) or "spotted"; `reason` "failed", "bright"… Read-only.
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, target, { level: "suspicious", point, reason: "failed" });
  await whisper(loc("Furtif.Doute", { observer: obs.name, target: target.name }), false, target);
}

/** Spotted: this enemy now sees it (as long as it stays hidden). */
async function spot(obs, target, point, reason) {
  await target.update({ [`flags.${MODULE_ID}.stealth`]: { spottedBy: [...new Set([...spottedBy(target), obs.id])] } });
  log(`stealth: ${obs.name} spots ${target.name} (${reason})`);
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, target, { level: "spotted", point, reason });
  await whisper(loc(reason === "bright" ? "Furtif.ReperePleineLumiere" : "Furtif.Repere", { observer: obs.name, target: target.name }), true, target);
}

/** A message to the GM (and to the token's players if it is spotted). */
async function whisper(content, toOwner, target) {
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const owners = toOwner ? game.users.filter(u => !u.isGM && target.actor?.testUserPermission?.(u, "OWNER")).map(u => u.id) : [];
  await say({ alias: loc("Furtif.Titre") }, esc(content), null, { whisper: [...gms, ...owners] });
}

/** BG3: hidden, the move animation goes at half speed. */
function onPreMove(token, movement, options) {
  if ( (stealthRules() !== "bg3") || !isHidden(token) ) return true;
  options.animation = { ...(options.animation ?? {}), speedMultiplier: 0.5 * (options.animation?.speedMultiplier ?? 1) };
  return true;
}

/** For the scenarios: the detection of the pairs in which this token appears. */
export function stealthViews(id) {
  return Object.fromEntries([...views].filter(([k]) => k.endsWith(`|${id}`)).map(([k, v]) => [k.split("|")[0], { ...v }]));
}

/** `api.sneak`: `is`, `set`, `toggle` (the Stealth action out of combat), `spottedBy`, `rules`, `check`. */
export const stealthApi = Object.freeze({
  is: isHidden, set: setHidden,
  /** Toggles the token's Stealth action (hidden ↔ visible), like the Alt+C shortcut → `{ hidden, … }` (the result of `set`). */
  toggle: token => setHidden(token),
  spottedBy,
  /** The world's stealth rules (setting `stealthRules`): `"2024"`, `"bg3"` or `"off"` (not handled, issue #65). */
  rules: () => stealthRules(),
  /**
   * `bg3` rules: judge the displayed scene right away (who enters whose view, Stealth checks, spotting). To be run on the
   * active GM.
   */
  check: () => check(canvas?.scene)
});

export function registerStealthMode() {
  game.settings.register(MODULE_ID, RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${RULES_SETTING}.2024`, bg3: `DND5ECOMBAT.Reglage.${RULES_SETTING}.bg3`,
      off: `DND5ECOMBAT.Reglage.${RULES_SETTING}.off` }, default: "2024",
    onChange: () => { views.clear(); schedule(); }
  });
  route("preMoveToken", onPreMove, { label: "hidden: half speed" });
  // What can make a hidden token enter a view: it moves, an enemy moves or turns, a condition, a light, the scene.
  const watch = { label: "stealth: detection not scheduled" };
  route("updateToken", (doc, changes) => {
    if ( ["x", "y", "rotation", "hidden", "elevation"].some(k => k in changes) || changes.flags?.[MODULE_ID] ) schedule();
  }, watch);
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateAmbientLight", "createAmbientLight", "deleteAmbientLight",
    "canvasReady", "combatStart", "deleteCombat", `${MODULE_ID}.sneak`] ) route(hook, schedule, watch);
  // No longer hidden: its pairs start again from zero.
  route("deleteActiveEffect", effect => {
    if ( !effect.getFlag?.(MODULE_ID, "hidden") || !(effect.parent instanceof Actor) ) return;
    for ( const t of effect.parent.getActiveTokens(false, true) ) for ( const k of [...views.keys()] ) if ( k.endsWith(`|${t.id}`) ) views.delete(k);
  }, watch);
}
