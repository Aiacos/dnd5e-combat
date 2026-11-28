/**
 * Basic actions (SPEC §15.2): the active GM puts on ALL characters ("character" actors, whether they
 * have a player or not — a character played by the GM needs them too) the items they lack, on
 * a permanent basis: at world load, at character creation, at the start of a combat and when a
 * character joins a combat in progress. Nothing is removed, nothing is placed on an NPC — except a familiar (§107: Find
 * Familiar, Wild Companion, Pact of the Chain), which receives on summoning those that do not attack ("a familiar can't
 * attack, but it can take other actions as normal"): on the actor of its token (the delta of an unlinked token, as dnd5e
 * creates it). World setting.
 * (First version, 0.23.0: only players' characters, only at the start of a combat —
 * not findable out of combat, absent from a character played by the GM; fixed on 2026-09-23.)
 *
 * And the off-hand attack on the damage side: dnd5e already removes the positive modifier in `offhand`
 * mode (data/activity/attack-data.mjs:426); the Two-Weapon Fighting style gives it back.
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionData, missingBasicActions } from "../adapter/basics.mjs";
import { rangedFeatsOf } from "../adapter/conditions.mjs";
import { isFamiliarActor, isFamiliarToken } from "../adapter/familiar.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { identifierOf } from "../adapter/content.mjs";

const SETTING = "provideBasicActions";

async function provide(actors) {
  if ( !game.settings.get(MODULE_ID, SETTING) ) return;
  const seen = new Set();
  for ( const actor of actors ) {
    if ( !actor || seen.has(actor.uuid) ) continue;
    // The base actor of an unlinked familiar (the one in the actors directory) is not touched: only that of its token.
    const familiar = (actor.type !== "character") && (actor.isToken || actor.prototypeToken?.actorLink === true) && isFamiliarActor(actor);
    if ( (actor.type !== "character") && !familiar ) continue;
    seen.add(actor.uuid);
    // Read what is missing then create it, serialized per actor: two overlapping passes (two combatants of the same
    // character, the combat start while a combatant is added) both read "missing" and created the items
    // twice.
    await enqueue(`basics:${actor.uuid}`, async () => {
      const missing = missingBasicActions(actor, { familiar });
      if ( !missing.length ) return;
      await actor.createEmbeddedDocuments("Item", missing.map(basicActionData));
      log(`basic actions added to ${actor.name}: ${missing.join(", ")}`);
    });
  }
}

/** §107: the actors of familiars placed on scenes (summoned before this version). */
function familiarActorsOnScenes() {
  const out = [];
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) if ( isFamiliarToken(token) && token.actor ) out.push(token.actor);
  return out;
}

/** Two-Weapon Fighting: the modifier returns to the off-hand damage (on the author's client). */
function onPreRollDamage(config) {
  const actor = config.subject?.actor;
  const roll = config.rolls?.[0];
  if ( !config.attackMode?.endsWith?.("offhand") || !roll || !actor ) return true;
  // §131: Crossbow Expert — "the extra attack of the Light property with a Light crossbow".
  const crossbow = rangedFeatsOf(actor, config.subject, config.attackMode).offhandModifier;
  if ( !crossbow && !actor.items.some(i => identifierOf(i).id === "two-weapon-fighting") ) return true;
  if ( !((roll.data?.mod ?? 0) > 0) || roll.parts?.includes("@mod") ) return true;
  roll.parts = [...(roll.parts ?? []), "@mod"];
  log("off hand: Two-Weapon Fighting, modifier restored to damage");
  return true;
}

export function registerBasics() {
  // Combat windows (reaction, choice, save): resolved on their own after this delay (adapter/dialogs.mjs).
  game.settings.register(MODULE_ID, "combatWindowSeconds", {
    name: "DND5ECOMBAT.Reglage.combatWindowSeconds.Nom", hint: "DND5ECOMBAT.Reglage.combatWindowSeconds.Aide",
    scope: "world", config: true, type: Number, default: 10, range: { min: 3, max: 60, step: 1 }
  });
  // Save with several abilities at the target's choice (Grapple, Shove): for a target rolled
  // by the GM, ask (window on the GM) or take the best. A player always chooses.
  game.settings.register(MODULE_ID, "npcSaveChoice", {
    name: "DND5ECOMBAT.Reglage.npcSaveChoice.Nom", hint: "DND5ECOMBAT.Reglage.npcSaveChoice.Aide",
    scope: "world", config: true, type: String, default: "ask",
    choices: { ask: "DND5ECOMBAT.Reglage.npcSaveChoice.ask", best: "DND5ECOMBAT.Reglage.npcSaveChoice.best" }
  });
  // §18.9: Legendary Resistance of an NPC that fails a save — ask the GM, always spend it, or never.
  game.settings.register(MODULE_ID, "legendaryResistance", {
    name: "DND5ECOMBAT.Reglage.legendaryResistance.Nom", hint: "DND5ECOMBAT.Reglage.legendaryResistance.Aide",
    scope: "world", config: true, type: String, default: "ask",
    choices: { ask: "DND5ECOMBAT.Reglage.legendaryResistance.ask", always: "DND5ECOMBAT.Reglage.legendaryResistance.always",
      never: "DND5ECOMBAT.Reglage.legendaryResistance.never" }
  });
  game.settings.register(MODULE_ID, SETTING, {
    name: `DND5ECOMBAT.Reglage.${SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  const placed = { executor: true, label: "basic actions added" };
  route("ready", () => provide([...game.actors, ...familiarActorsOnScenes()]).catch(err => console.error(`${MODULE_ID} | basic actions`, err)), placed);
  route("createActor", actor => provide([actor]), placed);
  // §107: a familiar summoned (or recalled from its pocket) — the actor of its token.
  route("createToken", tokenDoc => (isFamiliarToken(tokenDoc) ? provide([tokenDoc.actor]) : null), placed);
  route("combatStart", combat => provide(combat.combatants.map(c => c.actor)), placed);
  route("createCombatant", combatant => provide([combatant.actor]), placed);
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "off hand: Two-Weapon Fighting" });
}
