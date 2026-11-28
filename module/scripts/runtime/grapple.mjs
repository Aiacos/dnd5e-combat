/**
 * Grapples in play (SPEC §15.2, 2024 rules, glossary "Grappled" and "Unarmed Strike").
 *
 * On the active GM:
 *  - the grappler bears a visible mark "Grapples: <victim>", tied to the victim's Grappled effect:
 *    placed with it, removed with it; deleting the mark frees the victim (letting go);
 *  - "Movable": when the grappler walks (not a teleport), their victim follows, at its relative
 *    place or on the free cell nearest to their contact — never into another creature; a
 *    `displace` step, with no Opportunity Attack. The extra cost (doubled movement) is in the turn's
 *    cap (runtime/actions.mjs);
 *  - the grapple ends by itself when the grappler is Incapacitated or when the distance exceeds their
 *    reach (push, teleport, a victim that could not be placed).
 * For any grappled creature: Escape (context menu on its token, or basic action item) —
 * Athletics or Acrobatics check, the better, against the grappler's DC, for an action.
 * Speed 0: dnd5e already sets it (`noMovement`, data/actor/templates/attributes.mjs:533-537); the engine
 * also refuses a grappled creature's voluntary movement with a clear message (runtime/actions.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { grappleHolds } from "../core/conditions.mjs";
import { spendUse } from "../core/turn.mjs";
import {
  grappleEffectsOf, grappleFacts, escapeDcOf, grapplerOf, grappleSceneOf,
  grapplingMarksOf, grapplingMarkData, grappledTokenOf, victimsOf, actorOfEffect, grapplesRuleOf
} from "../adapter/grapple.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { inescapableFor } from "../adapter/grapple-rules.mjs";
import { swallowerOf } from "../adapter/swallow.mjs";
import { escapeSwallow } from "./swallow.mjs";
import { escapableRestraintsOf } from "../adapter/escape.mjs";
import { ownEndingsOf, endOwn } from "./action-end.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { dragDestination } from "../adapter/movement.mjs";
import { combatantFor, readBudget, writeBudget, isOwnTurn, committedPosition } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, rolledAndShown, tokenOfActor } from "./shared.mjs";

/* -------------------------------------------- */
/*  Tient-elle encore ?                         */
/* -------------------------------------------- */

/** Grapples whose grappler cannot be found: reported once, not at every check. */
const unknownGrapplers = new Set();

/** Removes the grapples that no longer hold, on the given scene. */
async function releaseBrokenGrapples(scene) {
  if ( !scene ) return;
  const factors = readUnitFactors();
  for ( const token of scene.tokens ) {
    for ( const effect of grappleEffectsOf(token.actor) ) {
      // Linked actor: its effects follow all its tokens; we only judge within the grapple's scene.
      const where = grappleSceneOf(effect);
      if ( where && (where !== scene.id) ) continue;
      const facts = grappleFacts(effect, token, factors);
      if ( !facts ) {
        if ( !unknownGrapplers.has(effect.uuid) ) log(`grapple: grappler of ${token.name} not found on its scene (${scene.name}), nothing to judge`);
        unknownGrapplers.add(effect.uuid);
        continue;
      }
      if ( grappleHolds(facts) ) continue;
      await effect.delete();
      log(`grapple broken: ${token.name} is no longer grappled by ${facts.grappler.name}`
        + ` — distance ${facts.distance?.value} ${facts.distance?.units} (reach ${facts.reach?.value} ${facts.reach?.units}),`
        + ` grappler's statuses [${facts.grapplerStatuses.join(", ")}], ${facts.grapplerToken.name} ${facts.grapplerToken._source.x},${facts.grapplerToken._source.y}`
        + ` / ${token.name} ${token._source.x},${token._source.y}`);
      ui.notifications.info(loc("Empoignade.Rompue", { name: token.name, by: facts.grappler.name }));
    }
  }
}

/**
 * Batched check: events arrive in bursts (movement, aura effects, turn states).
 * The scenes to check ACCUMULATE until the pass — the last request does not replace the others.
 */
const pendingScenes = new Set();
let timer = null;
function scheduleCheck(scenes) {
  for ( const scene of scenes ) if ( scene ) pendingScenes.add(scene);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const list = Array.from(pendingScenes);
    pendingScenes.clear();
    for ( const scene of list ) await releaseBrokenGrapples(scene).catch(err => console.error(`${MODULE_ID} | grapple`, err));
  }, 300);
}

/** The scenes where an actor has a token — all of them, not only the one this client displays (`Actor#getDependentTokens`). */
function scenesOf(actor) {
  if ( actor.isToken ) return [actor.token?.parent];
  return (actor.getDependentTokens?.({ concreteOnly: true }) ?? []).map(t => t.parent);
}

/* -------------------------------------------- */
/*  La marque de l'agrippeur                    */
/* -------------------------------------------- */

/** A Grappled placed with a known grappler: the mark "Grapples: <victim>" on the grappler. */
async function markGrappler(effect) {
  if ( !effect.statuses?.has("grappled") ) return;
  const grappler = grapplerOf(effect);
  const victim = grappledTokenOf(effect);
  if ( !grappler || !victim ) return;
  if ( grapplingMarksOf(grappler).some(m => m.getFlag(MODULE_ID, "grappling").effect === effect.uuid) ) return;
  await grappler.createEmbeddedDocuments("ActiveEffect", [grapplingMarkData(loc("Empoignade.Marque", { name: victim.name }), victim, effect)]);
  log(`grapple: ${grappler.name} grapples ${victim.name} (mark placed)`);
}

/**
 * §502 (B22): `grapples.one` — the item grapples only one creature at a time. A new Grappled from this item releases the
 * other creatures it held (their Grappled effect from this item is removed, the grappler's mark follows via `unlink`), with a
 * notice and a sound for the whole table.
 */
async function onlyOneGrappled(effect) {
  if ( !effect.statuses?.has("grappled") ) return;
  const item = originItemOf(effect);
  if ( !grapplesRuleOf(item)?.one ) return;
  const victim = actorOfEffect(effect);
  const victimToken = grappledTokenOf(effect);
  const scene = victimToken?.parent ?? null;
  if ( !scene ) return;
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( !actor || (actor === victim) || (actor.uuid === victim?.uuid) ) continue;
    for ( const old of grappleEffectsOf(actor).filter(e => (e !== effect) && (originItemOf(e)?.uuid === item.uuid)) ) {
      if ( old._destroyed ) continue;
      try { await old.delete(); }
      catch(err) { if ( actor.effects.has(old.id) ) throw err; }
      log(`grapple: ${item.name} holds only one creature — ${token.name} released for ${victimToken.name}`);
      notice(token, { key: "Empoignade.UneSeule", data: { name: token.name, item: item.name } }, "info",
        { all: true, action: "grappleReleased", outcome: "success" });
    }
  }
}

/** An effect deleted: the Grappled takes the mark with it; the mark (letting go) takes the Grappled with it. */
async function unlink(effect) {
  const grappling = effect.getFlag?.(MODULE_ID, "grappling");
  if ( grappling ) {
    const grappled = fromUuidSync(grappling.effect);
    if ( grappled && !grappled._destroyed ) {
      await grappled.delete();
      log(`grapple: ${effect.parent?.name} lets go`);
    }
    return;
  }
  if ( !effect.statuses?.has("grappled") ) return;
  const grappler = grapplerOf(effect);
  const marks = grapplingMarksOf(grappler).filter(m => m.getFlag(MODULE_ID, "grappling").effect === effect.uuid);
  if ( marks.length ) await grappler.deleteEmbeddedDocuments("ActiveEffect", marks.map(m => m.id));
}

/** The marks by which this token grapples this victim (empty if it does not grapple it). */
export function holdsOf(grapplerToken, victimToken) {
  return grapplingMarksOf(grapplerToken?.actor).filter(m => m.getFlag(MODULE_ID, "grappling").target === victimToken?.uuid);
}

/**
 * §18.23: releasing one's victim (2024 rules: whenever you want, without an action). The removed mark takes the victim's
 * Grappled with it (`unlink`, on the active GM): the grappler's owner needs no right on the victim.
 */
export async function releaseGrapple(grapplerToken, victimToken) {
  const marks = holdsOf(grapplerToken, victimToken);
  if ( !marks.length ) return;
  await grapplerToken.actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(m => m.id));
  ui.notifications.info(loc("Empoignade.Relache", { name: grapplerToken.name, target: victimToken.name }));
}

/* -------------------------------------------- */
/*  Dragging one's victim                       */
/* -------------------------------------------- */

/** The grappler walked: their victims follow. A teleport drags no one (the grapple ends). */
async function dragVictims(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.dragged ) return;
  const victims = victimsOf(token);
  if ( !victims.length ) return;
  const passed = movement.passed?.waypoints ?? [];
  if ( passed.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace")) ) return;
  const from = movement.origin ?? passed[0];
  const to = committedPosition(token);
  if ( !from ) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = (to.elevation ?? 0) - (from.elevation ?? 0);
  for ( const victim of victims ) {
    // §18.17: the Shambling Mound "engulfs" by grappling — its victim is IN its space, the engulfing makes it follow.
    if ( swallowerOf(victim)?.token === token ) continue;
    const pos = committedPosition(victim);
    const spot = dragDestination(victim, token, { x: pos.x + dx, y: pos.y + dy });
    if ( !spot ) { log(`grapple: ${victim.name} cannot be placed near ${token.name}`); continue; }
    await victim.move([{ x: spot.x, y: spot.y, elevation: (pos.elevation ?? 0) + dz, level: to.level, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true, dragged: true } });
    log(`grapple: ${token.name} drags ${victim.name}`);
  }
}

/* -------------------------------------------- */
/*  Escaping                                    */
/* -------------------------------------------- */

/**
 * §16.54: freeing oneself from a restraint by the check its item writes (Entangle: Strength (Athletics) against the caster's
 * spell save DC). Success removes the effect from the creature, not the spell: the others stay caught.
 */
async function escapeRestraint(actor, { effect, item, ability, skill, dc }) {
  const rolls = await rolledAndShown(() => skill
    ? actor.rollSkill({ skill, ...(ability ? { ability } : {}), target: dc }, { configure: false })
    : actor.rollAbilityCheck({ ability, target: dc }, { configure: false }));
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  const free = total >= dc;
  escapeNotice(actor, free);
  log(`${actor.name} ${free ? "breaks free of" : "does not break free of"} ${item.name} (${total} vs DC ${dc})`);
  ui.notifications.info(loc(free ? "Entrave.Libere" : "Entrave.Rate", { name: actor.name, source: item.name }));
  if ( free ) await effect.delete();
  return free;
}

/** §252: the outcome of an escape, on everyone's side (floating text and sound), after the 3D dice. */
function escapeNotice(actor, free) {
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: free ? "Retour.Action.Libere" : "Retour.Action.Retenu" }, free ? "gain" : "refused",
    { all: true, action: "escape", outcome: free ? "success" : "failure" });
}

/** Several things to escape (a grapple and a restraint…): which one? The first with no answer. */
async function pickEscape(actor, options) {
  const answer = await timedWait({
    window: { title: loc("Menu.Echapper"), icon: "fa-solid fa-person-running" },
    content: `<p>${loc("Entrave.Choisir", { name: actor.name })}</p>`,
    buttons: options.map((o, i) => ({ action: String(i), label: o.label, default: i === 0 }))
  }, { fallback: "0", awaiting: { actor, kind: "choice" } });
  return (answer === null) ? null : options[Number(answer)] ?? null;
}

/** The escape check, on the client of the one escaping. true if free. */
async function attemptEscape(actor) {
  // §18.21: swallowed by an item that carries its own escape check (Gelatinous Cube, Shambling Mound).
  const swallowed = await escapeSwallow(actor);
  if ( swallowed !== null ) return swallowed;
  const options = [
    ...grappleEffectsOf(actor).slice(0, 1).map(effect => ({ kind: "grapple", effect,
      label: loc("Entrave.Empoignade", { by: grapplerOf(effect)?.name ?? "?" }) })),
    ...escapableRestraintsOf(actor).map(r => ({ kind: "restraint", ...r, label: r.item.name })),
    // §43.2: the effects that an action of the bearer ends (content `actionEnds`) — by the item's check (like a
    // restraint), by the replayed spell save, or without a roll.
    ...ownEndingsOf(actor).map(e => e.check
      ? { kind: "restraint", effect: e.effect, item: e.item, ...e.check, label: e.item.name }
      : { kind: "ending", ending: e, label: e.item.name })
  ];
  if ( !options.length ) { ui.notifications.info(loc("Entrave.Rien", { name: actor.name })); return false; }
  const chosen = (options.length === 1) ? options[0] : await pickEscape(actor, options);
  if ( !chosen ) return false;
  if ( chosen.kind === "restraint" ) return escapeRestraint(actor, chosen);
  if ( chosen.kind === "ending" ) return endOwn(chosen.ending);
  const effect = chosen.effect;
  const dc = escapeDcOf(effect);
  if ( dc === null ) { ui.notifications.warn(loc("Empoignade.DDInconnu", { name: actor.name })); return false; }
  const skills = actor.system.skills ?? {};
  const skill = ((skills.acr?.total ?? -Infinity) > (skills.ath?.total ?? -Infinity)) ? "acr" : "ath";
  // §281: Inexorable — the grappler imposes Disadvantage on checks against their hold.
  const disadvantage = await inescapableFor(grapplerOf(effect), actor.name);
  if ( disadvantage ) log(`${actor.name}: Disadvantage on the escape check (${grapplerOf(effect)?.name})`);
  // §304 (pass C9): Goliath Powerful Build — "Advantage on checks to end the Grappled condition" (dnd5e flag set by the trait).
  const advantage = actor.flags?.dnd5e?.powerfulBuild === true;
  if ( advantage ) log(`${actor.name}: Advantage on the escape check (Powerful Build)`);
  const rolls = await rolledAndShown(() => actor.rollSkill({ skill, target: dc, ...(disadvantage ? { disadvantage: true } : {}), ...(advantage ? { advantage: true } : {}) }, { configure: false }));
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  escapeNotice(actor, total >= dc);
  if ( total >= dc ) {
    await effect.delete();
    log(`${actor.name} escapes (${total} vs DC ${dc})`);
    ui.notifications.info(loc("Empoignade.Echappe", { name: actor.name, by: grapplerOf(effect)?.name ?? "" }));
    return true;
  }
  log(`${actor.name} does not escape (${total} vs DC ${dc})`);
  ui.notifications.info(loc("Empoignade.Rate", { name: actor.name }));
  return false;
}

/**
 * Escaping, for any grappled creature (context menu): via its basic action item if it has one
 * (legality and budget like any item), otherwise — an NPC — the check directly, and the action
 * debited from the turn's budget.
 * @param {TokenDocument} token
 * @param {{event?: Event}} [options]
 */
export async function escapeGrapple(token, { event=null }={}) {
  const actor = token?.actor;
  if ( !actor ) return;
  const item = actor.items.find(i => basicActionOf(i) === "escape");
  const activity = item?.system.activities?.contents?.[0];
  if ( activity ) return activity.use({ event });
  const combatant = combatantFor(actor);
  if ( combatant ) {
    const before = readBudget(combatant);
    await writeBudget(combatant, spendUse(before, { cost: "action", weaponAttack: false, usesSpellSlot: false },
      { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  }
  await attemptEscape(actor);
}

/** Escaping via the item, on the author's client, after the use (the card and the budget are done). */
async function onPostUse(activity) {
  if ( basicActionOf(activity.item) !== "escape" ) return;
  await attemptEscape(activity.actor);
}

export function registerGrapple() {
  const check = { executor: true, label: "grapple: does it still hold?" };
  route("updateToken", (token, changes) => {
    if ( ["x", "y", "elevation", "level"].some(k => k in changes) ) scheduleCheck([token.parent]);
  }, check);
  // §502: a removed token (the summoned vine that held a grapple, `grapples.by: "summon"`) — the grapple is judged again.
  route("deleteToken", token => scheduleCheck([token.parent]), check);
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => {
      const actor = actorOfEffect(effect);   // an unlinked token: the effect is in its ActorDelta
      if ( actor ) scheduleCheck(scenesOf(actor));
    }, check);
  }
  const marks = { executor: true, label: "grapple: grappler's mark" };
  route("createActiveEffect", effect => markGrappler(effect), marks);
  // §504: a condition placed by the engine (step `status`: grapple instead of damage, "Grasping Hand") gets its origin AFTER its
  // creation (adapter/apply-effects.mjs `applyStatusToToken`, the `condition` model has none): the mark is placed at that moment.
  // The diff the hook receives does not carry the `origin` key for a `condition` effect (seen on the bench, dnd5e 6.1.1: only
  // `flags`, `_stats`): we look at every updated Grappled — `markGrappler` does nothing without a known grappler or if the mark
  // already exists.
  route("updateActiveEffect", effect => (effect.statuses?.has?.("grappled") ? markGrappler(effect) : null), marks);
  route("createActiveEffect", effect => onlyOneGrappled(effect), { executor: true, label: "grapple: only one creature at a time not enforced" });
  route("deleteActiveEffect", effect => unlink(effect), marks);
  route("moveToken", (token, movement, operation) => dragVictims(token, movement, operation),
    { executor: true, label: "grapple: the victim follows the grappler" });
  route("dnd5e.postUseActivity", activity => { onPostUse(activity).catch(err => console.error(`${MODULE_ID} | escape`, err)); },
    { label: "escape" });
}
