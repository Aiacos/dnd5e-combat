/**
 * Piloted objects (SPEC §16.15, B19), read and written in Foundry: Spiritual Weapon, Flaming Sphere, Bigby's Hand.
 *
 * Verified in dnd5e 6.0.3 and PHB 2.2.0:
 *  - the spell has a "summon" activity; the summoned actor carries `flags.dnd5e.summon.origin` = uuid of the caster's item
 *    (documents/activity/summon.mjs:145, 261); the player imports it and places the token: they own it;
 *  - its command activities have the "bonus" activation (the Spiritual Weapon's "Move and Attack": melee spell attack at
 *    5 ft, attack bonus copied from the caster by `match.attacks`, summon.mjs:408; damage
 *    `(@flags.dnd5e.summon.level - 1)d8 + @flags.dnd5e.summon.mod`);
 *  - the Spiritual Weapon has no speed and a "secret" disposition (-2): a command's distance comes from the
 *    content, hostility is judged from the caster.
 *
 * The state of the turn's command lives on the CASTER's combatant (`flags["dnd5e-combat"].commands.<id du token>`),
 * written by the active GM; a state from another turn does not count (core/pilot.mjs, `currentCommand`).
 */

import { MODULE_ID } from "../constants.mjs";
import { planCommand, currentCommand, canTranspose } from "../core/pilot.mjs";
import { summonItemOf } from "./summons.mjs";
import { contentOf, identifierOf, summonRuleOf } from "./content.mjs";
import { combatantFor, isOwnTurn } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { isObjectToken } from "./bodies.mjs";

/**
 * The piloted object that this token represents, or null.
 * @param {TokenDocument} tokenDoc
 * @returns {{token: TokenDocument, item: Item, summoner: Actor, rule: object, endsSpell: boolean}|null}
 */
export function pilotOf(tokenDoc) {
  if ( !tokenDoc?.actor ) return null;
  const item = summonItemOf(tokenDoc);
  const summon = summonRuleOf(item);
  if ( !summon?.pilot || !item.actor ) return null;
  return { token: tokenDoc, item, summoner: item.actor, rule: summon.pilot, summon, endsSpell: summon.endsSpell === true };
}

/** The piloted object of a summoned actor (its token on the scene), or null. */
export function pilotOfActor(actor) {
  if ( !actor?.getFlag?.("dnd5e", "summon.origin") ) return null;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  return token ? pilotOf(token) : null;
}

/** The caster's combatant (the one who pays for the commands), or null outside combat. */
export function summonerCombatant(pilot) {
  return pilot ? combatantFor(pilot.summoner) : null;
}

/** The caster's token (TokenDocument) on the object's scene, or null. */
export function summonerToken(pilot) {
  const tokens = pilot?.summoner?.getActiveTokens?.(false, true) ?? [];
  return tokens.find(t => t.parent === pilot.token.parent) ?? tokens[0] ?? null;
}

/** Key of a combat's current turn. */
export function turnKey(combat) {
  return combat ? `${combat.id}.${combat.round}.${combat.turn}` : "";
}

/**
 * Under which key the command is held: the token, or for a shared command (`shared`, Dancing Lights) the spell —
 * the Concentration effect that holds the objects, failing that the item. A key without a dot: it is a flag path.
 */
export function commandKey(pilot) {
  if ( !pilot.rule.shared ) return pilot.token.id;
  const effect = pilot.token.getFlag(MODULE_ID, "summonedBy")?.split(".").at(-1);
  return effect ? `fx${effect}` : `it${pilot.item.id}`;
}

/** The objects of the same spell on its scene (itself included). */
export function groupTokens(pilot) {
  const origin = pilot.item.uuid;
  return pilot.token.parent.tokens.filter(t => t.actor?.getFlag("dnd5e", "summon.origin") === origin);
}

/** The command state of this object, as written (may date from another turn). */
export function readCommand(combatant, pilot) {
  return combatant?.getFlag(MODULE_ID, `commands.${commandKey(pilot)}`) ?? null;
}

export async function writeCommand(combatant, pilot, state) {
  await combatant.setFlag(MODULE_ID, `commands.${commandKey(pilot)}`, state);
}

/**
 * What this gesture would cost now, and the state that would result.
 * @param {object} pilot
 * @param {"move"|"use"} gesture
 * @returns {{combatant: Combatant|null, ownTurn: boolean, pay: string|null, next: object|null}}
 */
export function commandPlan(pilot, gesture) {
  const combatant = summonerCombatant(pilot);
  if ( !combatant ) return { combatant: null, ownTurn: true, pay: null, next: null };
  const key = turnKey(combatant.combat);
  const { pay, next } = planCommand(readCommand(combatant, pilot), gesture, pilot.rule.cost, key);
  // `free` (Conjure Animals: "when you move on your turn, you can also move the pack"): nothing to pay.
  return { combatant, ownTurn: isOwnTurn(combatant), pay: (pay === "free") ? null : pay, next };
}

/** Distance of a command, in grid units. */
export function commandDistance(pilot, factors) {
  const units = pilot.token.parent?.grid.units ?? pilot.rule.units;
  return lengthIn(pilot.rule.distance, pilot.rule.units, units, factors);
}

/**
 * The activities a command makes the object play: those of its items whose activation is that of a command
 * (the Bonus Action), which target something other than the object itself.
 * @returns {Activity[]}
 */
export function commandActivities(pilot, { self=false }={}) {
  const out = [];
  for ( const item of pilot.token.actor?.items ?? [] ) {
    for ( const activity of item.system.activities ?? [] ) {
      if ( activity.activation?.type !== pilot.rule.cost ) continue;
      if ( !["attack", "save", "damage", "heal", "utility"].includes(activity.type) ) continue;
      if ( (activity.range?.units === "self") !== self ) continue;
      // A utility that targets elsewhere (the Arcane Eye's "Move") is not an action against a creature: the
      // object's movement is done by clicking.
      if ( !self && (activity.type === "utility") ) continue;
      out.push(activity);
    }
  }
  return out;
}

/** Label of a command: the item, and the activity if it has several ("Grasping Hand (Crush)"). */
export function commandLabel(activity) {
  const item = activity.item;
  return ((item.system.activities?.size ?? 0) > 1) && activity.name ? `${item.name} (${activity.name})` : item.name;
}

/** What the object does around itself (`summon.pulse`): the rule and the activity of its item, or null. */
export function pulseOf(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = summonRuleOf(item)?.pulse ?? null;
  if ( !rule ) return null;
  // §164: several possible identifiers (Conjure Elemental: one item per element).
  const own = tokenDoc.actor?.items.find(i => [rule.item].flat().includes(identifierOf(i).id));
  const activity = own?.system.activities?.find(a => ["save", "attack", "damage"].includes(a.type)) ?? null;
  return activity ? { rule, activity } : null;
}

/** L'objet n'occupe-t-il pas son espace (Main de Bigby) ? */
export function isIntangible(tokenDoc) {
  const pilot = pilotOf(tokenDoc);
  if ( pilot ) return pilot.rule.occupies === false;
  // §255: an object without a pilot (placed trap, `flags.dnd5e-combat.object`) does not occupy its space —
  // it neither hinders nor is hindered.
  return isObjectToken(tokenDoc);
}

/**
 * The activity of the SPELL that commands its objects (Dancing Lights' "Move Lights": a utility at Bonus Action): its
 * use opens the turn's command instead of being a separate expense. Returns the pilot of one of the objects on the
 * caster's scene, or null.
 */
export function spellCommandOf(activity) {
  const item = activity?.item;
  const summon = summonRuleOf(item);
  if ( !summon?.pilot || (activity.type !== "utility") || (activity.activation?.type !== summon.pilot.cost) ) return null;
  for ( const scene of game.scenes ) {
    const token = scene.tokens.find(t => t.actor?.getFlag("dnd5e", "summon.origin") === item.uuid);
    if ( token ) return pilotOf(token);
  }
  return null;
}

/**
 * §502 (B22): the token of a summon of `actor` on the scene `scene`, to pull toward (`move { toward: "summon" }`) or that holds
 * a grapple (`grapples.by: "summon"`): preferably a summon of this item (`flags.dnd5e.summon.origin` = its uuid), otherwise
 * any of the actor's (a monster's Grasping Vine is cast by the spell copy, the attack comes from another item); the
 * nearest to `near` if there are several. null without a summon.
 */
export function summonTokenFor(actor, item, scene, near=null) {
  if ( !actor || !scene ) return null;
  const mine = scene.tokens.filter(t => {
    const origin = t.actor?.getFlag?.("dnd5e", "summon.origin");
    if ( !origin ) return false;
    const from = fromUuidSync(origin, { strict: false });
    return (from?.actor === actor) || (from?.actor?.uuid === actor.uuid) || String(origin).startsWith(`${actor.uuid}.`);
  });
  const own = item ? mine.filter(t => t.actor?.getFlag?.("dnd5e", "summon.origin") === item.uuid) : [];
  const pool = own.length ? own : mine;
  if ( (pool.length < 2) || !near ) return pool[0] ?? null;
  const at = t => ({ x: t._source.x, y: t._source.y });
  const d = t => Math.hypot(at(t).x - near._source.x, at(t).y - near._source.y);
  return pool.slice().sort((a, b) => d(a) - d(b))[0];
}

/** The tokens of this actor's summons whose rule says `key` (`castFrom`, `endsIfIncapacitated`…), all scenes. */
export function summonsOfWith(actor, key) {
  const out = [];
  if ( !actor ) return out;
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      const origin = token.actor?.getFlag("dnd5e", "summon.origin");
      if ( !origin ) continue;
      const item = fromUuidSync(origin, { strict: false });
      if ( (item?.actor !== actor) || !summonRuleOf(item)?.[key] ) continue;
      out.push(token);
    }
  }
  return out;
}

/** Does a piloted object's combatant play? No: it acts during its caster's turn. */
export function isPilotedCombatant(combatant) {
  return !!combatant?.token && !!pilotOf(combatant.token);
}

/**
 * §38.2: "Trickster's Swap" — from the illusion or from its caster, the pair that can swap places now: the caster carries a
 * `transpose` item that targets the summon's item (identifier), and the turn's rule allows it (core/pilot.mjs, `canTranspose`).
 * `createdTurn` / `transposedTurn`: the illusion's flags (turn of its creation, turn of the last swap). null otherwise.
 * @param {TokenDocument} token  The illusion, or the caster.
 * @returns {{caster: TokenDocument, illusion: TokenDocument, pilot: object, turnKey: string|null}|null}
 */
export function transposeOf(token) {
  if ( !token?.actor || !token.parent ) return null;
  const own = pilotOf(token);
  const pairs = own ? [own] : token.parent.tokens.map(t => pilotOf(t)).filter(p => p && (p.summoner === token.actor));
  for ( const pilot of pairs ) {
    const casterItem = (pilot.summoner?.items ?? []).find(i => contentOf(i).entry?.transpose?.summon === identifierOf(pilot.item).id);
    if ( !casterItem ) continue;
    const caster = own ? summonerToken(pilot) : token;
    if ( !caster || (caster.parent !== pilot.token.parent) ) continue;
    const combatant = summonerCombatant(pilot);
    const combat = combatant?.combat ?? null;
    const key = combat?.started ? turnKey(combat) : null;
    const allowed = canTranspose({
      inCombat: !!combat?.started, ownTurn: !!combatant && isOwnTurn(combatant), turnKey: key,
      command: combatant ? currentCommand(readCommand(combatant, pilot), key) : null,
      createdTurn: pilot.token.getFlag(MODULE_ID, "createdTurn") ?? null,
      usedTurn: pilot.token.getFlag(MODULE_ID, "transposedTurn") ?? null
    });
    if ( allowed ) return { caster, illusion: pilot.token, pilot, turnKey: key };
  }
  return null;
}