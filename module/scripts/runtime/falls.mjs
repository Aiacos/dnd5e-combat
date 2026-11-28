/**
 * §208: automatic falling and what the jump keeps from a turn.
 *  - dnd5e sets the "Falling" condition on an airborne token that can no longer stay up (documents/token.mjs `_isFalling`:
 *    no flight, or flying but Prone or Incapacitated, and no hover), but the fall only happens when the GM clicks the icon
 *    (`plummet`). With the world setting `autoFall` ("in combat" by default), the active GM makes the token fall as soon as the
 *    condition appears; dnd5e's damage card is applied by the engine (runtime/climb.mjs, `onFallCard` — Prone if it does damage).
 *  - 2024 rules (glossary, "Flying"): a flying creature whose Speed drops to 0 also falls — dnd5e does not count that case.
 *    Grappled, Restrained (or flying and walking Speed 0), without hover and without climbing: the active GM makes it fall
 *    itself, with dnd5e's damage card (`dnd5e.rules.postFallDamage`).
 *  - Step of the Wind via a Focus Point (`jump.double`): the jump distance is doubled for the turn (`jumpDouble` budget).
 */
import { MODULE_ID } from "../constants.mjs";
import { combatantFor, readBudget, writeBudget, committedPosition } from "../adapter/turn.mjs";
import { contentOf } from "../adapter/content.mjs";
import { isFreeForm } from "../adapter/basics.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { groundUnder, levelAt } from "../adapter/altitude.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { fallLikeDnd5e, climbFallInProgress } from "./climb.mjs";
import { setFallAction } from "./altitude.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, say } from "./shared.mjs";

export const AUTO_FALL_SETTING = "autoFall";
const MODES = ["off", "combat", "always"];

const mode = () => {
  try { const m = game.settings.get(MODULE_ID, AUTO_FALL_SETTING); return MODES.includes(m) ? m : "combat"; } catch { return "combat"; }
};
const wanted = actor => (mode() === "always") || ((mode() === "combat") && !!combatantFor(actor));

/** This actor's tokens on the displayed scene (the active GM sees the combat's scene). */
const tokensOf = actor => (actor?.getActiveTokens?.(false, true) ?? []).filter(t => t.parent === canvas?.scene);

/** Un token en l'air, au-dessus de son sol. */
const aloft = token => (token._source.elevation ?? 0) > groundUnder(token, committedPosition(token)) + 1e-6;

/** A flying creature that can no longer move: Grappled or Restrained (its Speed is 0), without hover. */
function grounded(token) {
  const actor = token.actor;
  const movement = actor?.system?.attributes?.movement;
  if ( !movement || movement.hover || actor.system?.traits?.ci?.value?.has?.("falling") ) return false;
  if ( actor.statuses?.has?.("ethereal") ) return false;   // §225: no gravity in the Ethereal Plane
  // Without flight (or flight reduced to 0 by an effect): this is dnd5e's ordinary rule, which already makes it fall.
  if ( !((movement.speeds?.fly ?? movement.fly ?? 0) > 0) ) return false;
  if ( ["climb"].includes(token._source.movementAction) ) return false;      // l'escalade a ses propres chutes (runtime/climb.mjs)
  const statuses = actor.statuses ?? new Set();
  if ( statuses.has("falling") || statuses.has("prone") || statuses.has("incapacitated") ) return false;   // dnd5e s'en charge
  return statuses.has("grappled") || statuses.has("restrained");
}

/** The fall of a flying creature at Speed 0: lowered to its floor, dnd5e damage card. Active GM. */
async function dropFlier(token) {
  const pos = committedPosition(token);
  const ground = groundUnder(token, pos);
  const distance = (pos.elevation ?? 0) - ground;
  if ( distance <= 1e-6 ) return;
  await token.move({ action: "fall", elevation: ground }, { animate: false, dnd5e: { fall: { distance } } });
  await globalThis.dnd5e?.rules?.postFallDamage?.([token], distance);
  await say({ token }, loc("Chute.Vol", { name: token.name }));
  log(`${token.name}: flying with a Speed of 0, falls ${distance}`);
}

/** Active GM, on each effect change: "Falling" set by dnd5e → the fall; immobilized flying creature → the fall. */
function onEffectChange(effect) {
  const actor = actorOfEffect(effect);
  if ( !actor || !climbSystemOn() || !wanted(actor) ) return;   // §224: climbing and falling system off, no fall
  // Without waiting: the router runs a hook's listeners one after another, and the wait below would delay climbing (§192),
  // which listens to the same effect changes (seen: a climber who fails their check stayed suspended, status removed too late).
  void enqueue(`fall:${actor.uuid}`, async () => {
    for ( const token of tokensOf(actor) ) {
      if ( !aloft(token) ) continue;
      if ( actor.statuses?.has("falling") ) {
        // A climber falls via runtime/climb.mjs (on the wall, letting go, or already falling there).
        if ( (token._source.movementAction === "climb") || climbFallInProgress(token) ) continue;
        // The player who lets go of a wall makes their token fall on their side (runtime/climb.mjs):
        // we give them a moment, then check again.
        await new Promise(resolve => setTimeout(resolve, 2000));
        if ( !actor.statuses?.has("falling") || !aloft(token) || climbFallInProgress(token) ) continue;
        // Without dnd5e's fall (displayed height lagging: runtime/climb.mjs), the engine's, from the real height.
        if ( (await fallLikeDnd5e(token)) || (await dropToGround(token)) ) log(`${token.name}: falls (dnd5e's Falling status, automatic)`);
      } else if ( grounded(token) ) await dropFlier(token);
    }
  }).catch(err => console.error(`${MODULE_ID} | automatic fall`, err));
}

/** Step of the Wind via a Focus Point: the jump distance doubled for the turn. On the client that uses it. */
async function onPostUse(activity) {
  const double = contentOf(activity?.item).entry?.jump?.double;
  // The free form of an activity that has two (Step of the Wind without a Focus Point) does not double the jump.
  if ( !double?.includes(activity.id) || isFreeForm(activity) ) return;
  const combatant = combatantFor(activity.actor);
  if ( !combatant ) return;
  await writeBudget(combatant, { ...readBudget(combatant), jumpDouble: true });
  log(`${activity.actor.name}: jump distance doubled for the turn (${activity.name})`);
}

/**
 * §218: the fall of an airborne token to its floor, which dnd5e does not do — placed at the base of a level above the void
 * (on the upper floor, above the courtyard), dnd5e believes it is on that level's floor (documents/token.mjs:
 * `_findSupportingSurface`, fallback to the base of the level); the engine sees the courtyard floor. Lowered to that floor
 * and to its level, dnd5e damage card. Active GM or owner.
 */
async function dropToGround(token) {
  const pos = committedPosition(token);
  const ground = groundUnder(token, pos);
  const distance = (pos.elevation ?? 0) - ground;
  if ( distance <= 1e-6 ) return false;
  const level = levelAt(token.parent, ground, pos.level ?? token._source.level);
  await token.move([{ action: "fall", elevation: ground, ...((level !== token._source.level) ? { level } : {}) }],
    { animate: false, dnd5e: { fall: { distance } } });
  if ( token.actor?.statuses?.has("falling") ) await token.actor.toggleStatusEffect("falling", { active: false });
  await globalThis.dnd5e?.rules?.postFallDamage?.([token], distance);
  log(`${token.name}: falls ${distance} to the ground below (engine, level ${level})`);
  return true;
}

export function registerFalls() {
  setFallAction(async token => (await fallLikeDnd5e(token)) || dropToGround(token));
  game.settings.register(MODULE_ID, AUTO_FALL_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(MODES.map(m => [m, `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.${m}`])), default: "combat"
  });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, onEffectChange, { executor: true, label: "fall: not triggered automatically" });
  }
  route("dnd5e.postUseActivity", onPostUse, { label: "jump: Step of the Wind doubling not noted" });
}
