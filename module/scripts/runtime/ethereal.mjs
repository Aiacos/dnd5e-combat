/**
 * §225: moving creatures into the Ethereal Plane or bringing them back — dnd5e's `ethereal` condition, the one the token HUD's
 * condition menu also sets. For the "GM Tools" compendium macro and neighbors: `api.ethereal.toggle(tokens, active)`. Batch 3: the
 * "Ethereal" movement action (walls crossed).
 */

import { MODULE_ID } from "../constants.mjs";
import { isEthereal, perceivesPlane } from "../adapter/plane.mjs";
import { etherealStepCost, nearestFreeCell, shuntDamage, etherealPlaneOn, setEtherealPlaneState } from "../core/plane.mjs";
import { placementOf } from "../core/altitude.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { boundsUnder } from "../adapter/altitude.mjs";
import { occupiedAt } from "./actions.mjs";
import { fallNow } from "./altitude.mjs";
import { enqueue } from "./queue.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { isExecutor, loc, log } from "./shared.mjs";
import { NEAR_SPACE_QUERY, handleNearSpace } from "./teleport.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { queryPlayer, waitLabel } from "../adapter/player-wait.mjs";

const docOf = t => t?.document ?? t;

/**
 * Toggles the Ethereal condition of the given tokens (by default the controlled tokens). `active`: true / false forces the
 * direction; without it, each token flips from one to the other — except a mixed group, which goes entirely into the
 * Ethereal Plane.
 * @returns {Promise<Array<{name: string, ethereal: boolean}>>}
 */
export async function toggleEthereal(tokens=null, active=null) {
  const docs = (tokens ?? canvas?.tokens?.controlled ?? []).map(docOf).filter(d => d?.actor?.isOwner);
  if ( active === null ) active = !docs.every(d => isEthereal(d));
  const out = [];
  for ( const doc of docs ) {
    if ( isEthereal(doc) !== active ) await doc.actor.toggleStatusEffect("ethereal", { active });
    out.push({ name: doc.name, ethereal: active });
    log(`${doc.name}: ${active ? "enters" : "leaves"} the Ethereal Plane`);
  }
  return out;
}

export const SETTING = "etherealPlane";

export const etherealApi = Object.freeze({
  /** Is Ethereal Plane automation on (world setting `etherealPlane`)? Hook `dnd5e-combat.etherealPlane`. */
  enabled: () => etherealPlaneOn(),
  /** GM: turns Ethereal Plane automation on (`on` absent or true) or off → the written setting's promise; null for a player. */
  setEnabled: on => (game.user.isGM ? game.settings.set(MODULE_ID, SETTING, on !== false) : null),
  /** Is the creature (token, document or actor) in the Ethereal Plane (dnd5e `ethereal` condition)? */
  is: t => isEthereal(docOf(t)),
  /**
   * Can the observer perceive the target as far as the plane goes (same plane: yes; otherwise the core's rule)?
   * The rest of the view is not judged.
   */
  perceives: (observer, target) => perceivesPlane(docOf(observer), docOf(target)),
  toggle: toggleEthereal
});

/* -------------------------------------------- */
/*  §225, batch 3: moving in the Ethereal Plane  */
/* -------------------------------------------- */

const ACTION = "ethereal";
const PREVIOUS = "etherealPrevAction";

/**
 * The "Ethereal" movement action of the V14 core (`CONFIG.Token.movement.actions`, as dnd5e adds "fall" there): no wall or
 * floor stops it (`walls: null`, client/canvas/placeables/token.mjs:3005, :3218) — force walls are refused by the movement
 * check (runtime/move-gate.mjs); no Difficult Terrain; going up or down costs double. Chosen only by an Ethereal token.
 */
function registerAction() {
  const actions = CONFIG.Token?.movement?.actions;
  if ( !actions ) return;
  actions[ACTION] = {
    label: "DND5ECOMBAT.Ethere.Action",
    icon: "fa-solid fa-ghost",
    img: "systems/dnd5e/icons/svg/statuses/ethereal.svg",
    order: 10,
    walls: null,
    terrainAction: null,
    canSelect: token => isEthereal(token),
    getCostFunction: () => (cost, from, to) => {
      const vertical = Math.abs((to?.k ?? 0) - (from?.k ?? 0)) * (canvas?.scene?.grid?.distance ?? 0);
      return etherealStepCost(cost, vertical);
    }
  };
}

/** The actor's tokens, on all scenes. */
function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

/**
 * The Ethereal condition set or removed: the token takes the "Ethereal" action, then goes back to the one it had (kept in a
 * flag). Active GM. The `altitude` option: runtime/altitude.mjs does not treat this mode change as a takeoff or a landing.
 */
async function syncAction(effect) {
  if ( !etherealPlaneOn() || !effect?.statuses?.has?.("ethereal") ) return;   // off: the condition does nothing
  const actor = effect.parent?.documentName === "Actor" ? effect.parent : null;
  const blink = effect.getFlag?.(MODULE_ID, "blink") === true;
  // On the next loop iteration: an unlinked token's synthetic actor only has its new statuses after the hook (ui/ethereal.mjs).
  await new Promise(resolve => setTimeout(resolve, 0));
  for ( const token of tokensOf(actor) ) {
    const inside = isEthereal(token);
    const current = token._source.movementAction;
    if ( inside && (current !== ACTION) ) {
      await token.update({ movementAction: ACTION, [`flags.${MODULE_ID}.${PREVIOUS}`]: current ?? null }, { [MODULE_ID]: { altitude: true } });
    }
    else if ( !inside ) {
      if ( current === ACTION ) {
        const previous = token.getFlag(MODULE_ID, PREVIOUS) ?? CONFIG.Token.movement.defaultAction;
        await token.update({ movementAction: previous, [`flags.${MODULE_ID}.${PREVIOUS}`]: new foundry.data.operators.ForcedDeletion() }, { [MODULE_ID]: { altitude: true } });
      }
      // Batch 4: the return, once the previous action is restored (the fall depends on it: on foot, not "ethereal").
      if ( token.object ) await enqueue(`ethereal-return:${token.uuid}`, () => returnToken(token, { blink }));
    }
  }
}

/**
 * The switch toggled (world setting): each client re-reads the state and redraws the view; the active GM restores the
 * movement actions — off, a token on the "ethereal" action goes back to its previous one (otherwise it would still cross
 * walls); back on, a token in the Ethereal state takes it again. No return or damage either way: nobody moves.
 */
async function applied(value) {
  setEtherealPlaneState(value);
  log(`Ethereal Plane automation ${value ? "on" : "off"}`);
  // §225: on each client, when the GM turns Ethereal Plane automation on or off (world setting): `({ enabled })`. Read-only.
  Hooks.callAll(`${MODULE_ID}.etherealPlane`, { enabled: etherealPlaneOn() });
  if ( canvas?.ready ) {
    canvas.perception.update({ refreshVision: true });
    for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true, refreshVisibility: true });
  }
  if ( !isExecutor() ) return;
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    const current = token._source.movementAction;
    if ( !etherealPlaneOn() && (current === ACTION) ) {
      const previous = token.getFlag(MODULE_ID, PREVIOUS) ?? CONFIG.Token.movement.defaultAction;
      await token.update({ movementAction: previous, [`flags.${MODULE_ID}.${PREVIOUS}`]: new foundry.data.operators.ForcedDeletion() }, { [MODULE_ID]: { altitude: true } });
    }
    else if ( etherealPlaneOn() && isEthereal(token) && (current !== ACTION) ) {
      await token.update({ movementAction: ACTION, [`flags.${MODULE_ID}.${PREVIOUS}`]: current ?? null }, { [MODULE_ID]: { altitude: true } });
    }
  }
}

export function registerEtherealMovement() {
  CONFIG.queries[NEAR_SPACE_QUERY] = handleNearSpace;   // §401: on all clients — the token's player chooses
  game.settings.register(MODULE_ID, SETTING, {
    name: `DND5ECOMBAT.Reglage.${SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: value => applied(value)
  });
  route("setup", () => setEtherealPlaneState(game.settings.get(MODULE_ID, SETTING)), { always: true, label: "ethereal switch: state not read" });
  // From `init`, as dnd5e does for "fall": tokens are built before `setup`, and their `movementAction` field refuses an unknown
  // action at that point ("ethereal is not a valid choice", seen in play).
  registerAction();
  const label = { executor: true, label: "ethereal: movement action not switched" };
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"] ) route(hook, syncAction, label);
  route("dnd5e.postUseActivity", onShiftUsed, { label: "ethereal: Ethereal Jaunt / Stride not applied" });
}

/* -------------------------------------------- */
/*  §225, batch 4: the return to the material plane */
/* -------------------------------------------- */

const SHUNT_RINGS = 12;

/**
 * Batch 4: the creature has left the Ethereal Plane (condition removed, whatever the cause; called by `syncAction`) — if its
 * cell is occupied, it is pushed to the nearest free cell (forced movement, no Opportunity Attack) and takes twice the feet
 * traveled as force damage (Etherealness); not at the return from Blink ("you return to an unoccupied space … within 3 m", the
 * effect marked `blink`). In the air, on foot, it falls. Active GM.
 */
async function returnToken(token, { blink }) {
  const grid = token.parent.grid;
  // §401: Blink — "an unoccupied space of your choice within 3 m of the space you left": asked of the token's player (otherwise the
  // GM); with no answer, the space left if it is free, otherwise the nearest (lower down).
  if ( blink && await chooseBlinkSpace(token) ) return;
  if ( occupiedAt(token, token._source) ) {
    const start = cellOf(token);
    const cell = nearestFreeCell(start, c => !occupiedAt(token, grid.getTopLeftPoint(c)), SHUNT_RINGS);
    if ( !cell ) {
      log(`${token.name}: back from the Ethereal Plane on an occupied space, no free space nearby`);
      return;
    }
    const to = grid.getTopLeftPoint(cell);
    const feet = lengthIn(distanceBetween(token, token, { posB: { x: to.x, y: to.y } }).value, grid.units, "ft", readUnitFactors());
    await token.move([{ x: to.x, y: to.y, elevation: token._source.elevation, level: token._source.level, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true } });
    const damage = blink ? 0 : shuntDamage(feet);
    log(`${token.name}: back from the Ethereal Plane on an occupied space, shunted ${Math.round(feet)} ft${damage ? `, ${damage} force` : ""}`);
    if ( damage > 0 ) {
      const actor = token.actor;
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor, token }),
        content: `<p>${loc("Ethere.Repousse", { name: token.name, feet: Math.round(feet), damage })}</p>`
      });
      await actor.applyDamage([{ value: damage, type: "force" }]);
    }
  }
  // Without gravity in the Ethereal Plane, the creature may have climbed there: back in the air, on foot, it falls
  // (engine rule, system on).
  const ground = boundsUnder(token, token._source).ground;
  if ( ((token._source.elevation ?? 0) > ground + 1e-6) && (placementOf(token._source.movementAction) === "ground") ) await fallNow(token);
}

/** §401: the Blink return question, put to whoever chooses. Returns true if the token was placed on the chosen cell. */
async function chooseBlinkSpace(token) {
  const payload = { token: token.uuid, distance: 10, units: "ft", mustMove: occupiedAt(token, token._source), item: loc("EspaceProche.Titre") };
  const userId = token.actor ? rollerFor(token.actor) : null;
  try {
    const answer = (userId && (userId !== game.user.id))
      ? await queryPlayer(game.users.get(userId), NEAR_SPACE_QUERY, payload, { timeout: 60000, actor: token.actor, label: waitLabel("Choix", { item: payload.item }) })
      : await handleNearSpace(payload);
    return !!answer;
  } catch(err) {
    log(`${token.name}: Blink, no space chosen (${err.message})`);
    return false;
  }
}

/**
 * §225, batch 4: "Ethereal Jump", "Ethereal Stride" (content `etherealShift`) — the creature goes into the Ethereal Plane or comes
 * back from it; with `others`, the designated targets (except it) take the same plane as it. On the author's client, after use:
 * its activities have no effect or condition in the data ("Expend Use" only).
 */
async function onShiftUsed(activity) {
  const rule = (etherealPlaneOn() && activity?.item) ? contentOf(activity.item).entry?.etherealShift : null;
  const actor = activity?.actor;
  if ( !rule || !actor?.isOwner ) return;
  const self = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !self ) return;
  const into = !isEthereal(self);
  const others = (rule.others === true) ? Array.from(game.user.targets ?? []).map(t => t.document).filter(d => d && (d !== self)) : [];
  await toggleEthereal([self, ...others], into);
  log(`${self.name}: ${activity.item.name} — ${into ? "into" : "out of"} the Ethereal Plane${others.length ? ` with ${others.map(d => d.name).join(", ")}` : ""}`);
}
