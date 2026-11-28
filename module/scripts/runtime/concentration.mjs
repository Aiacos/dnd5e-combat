import {
  rollerFor, readConcentrationPrompt, concentrationKeptBy, rollConcentration, readConcentrationSave, breakConcentration, removeRegionsOf,
  isConcentrationEffect, concentrationDisabled, CONCENTRATION_QUERY, CONCENTRATION_TIMEOUT, handleConcentrationQuery,
  concentrationRuleFor, loseRemainingConcentration, concentrationLabel
} from "../adapter/concentration.mjs";
import { tieSummonToConcentration, removeSummonsOf, joinSummonerCombat, summonItemOf, makeSummonHostile } from "../adapter/summons.mjs";

import { MODULE_ID } from "../constants.mjs";
import { expiresByItself } from "../adapter/traces.mjs";
import { route } from "./router.mjs";
import { log, notice, tokenOfActor, waitForDice } from "./shared.mjs";
import { queryPlayer, waitLabel } from "../adapter/player-wait.mjs";

/**
 * §494 (brick B14): Concentration is lost (failed roll, Incapacitated). dnd5e ends all of them (`endConcentration()`); a creature
 * that declares `concentration.loseAll` keeps none, even if a module refused the end of one of them. When several spells fall
 * together, the whole table sees and hears it (notice above the token, "spell end" sound). Returns the removed effects.
 */
async function loseConcentration(actor, saveMessage=null) {
  const ended = [...await breakConcentration(actor, saveMessage)];
  if ( concentrationRuleFor(actor)?.loseAll ) {
    const rest = await loseRemainingConcentration(actor);
    if ( rest.length ) log(`${actor.name}: loses all concentration, ${rest.length} more removed`);
    ended.push(...rest);
  }
  if ( ended.length > 1 ) {
    const spells = ended.map(concentrationLabel).join(", ");
    log(`${actor.name}: all ${ended.length} concentrations lost (${spells})`);
    const token = tokenOfActor(actor);
    if ( token ) notice(token, { key: "ConcentrationsPerdues", data: { name: actor.name, count: ended.length, spells } }, "refused",
      { all: true, action: "concentrationLost", outcome: "failure" });
  }
  return ended;
}

/**
 * The system has just asked for a Concentration saving throw, or offered to end it.
 * For a PC whose player is connected: §141, the roll window opens on their screen (request), their dice; without a response,
 * the native card stays, to be clicked. For all the others, the engine does what the GM's click would do.
 */
async function onPrompt(message) {
  const prompt = readConcentrationPrompt(message);
  if ( !prompt ) return;
  if ( prompt.kind === "end" ) {
    // Dead or Incapacitated: the rule provides no roll, Concentration drops.
    const ended = await loseConcentration(prompt.actor);
    if ( ended.length ) log(`${prompt.actor.name}: Incapacitated, concentration ended`);
    await message.delete();
    return;
  }
  // §303: damage that drops to 0 HP also asks for a saving throw; Concentration drops anyway (Unconscious, Dead) —
  // no roll, which would break it a second time.
  const hp = prompt.actor.system?.attributes?.hp?.value;
  if ( (Number.isFinite(hp) && (hp <= 0)) || prompt.actor.statuses?.has("dead") ) {
    log(`${prompt.actor.name}: at 0 HP, no concentration saving throw (it ends anyway)`);
    await message.delete();
    return;
  }
  // Survey of the gaps: "taking damage can't break your Concentration on Hunter's Mark" (Relentless Hunter).
  const kept = concentrationKeptBy(prompt.actor);
  if ( kept ) {
    log(`${prompt.actor.name}: ${kept.name}, concentration kept without a saving throw`);
    await message.delete();
    return;
  }
  const userId = rollerFor(prompt.actor);
  if ( userId ) {
    log(`${prompt.actor.name}: concentration saving throw DC ${prompt.dc}, asked to the player`);
    try {
      await queryPlayer(game.users.get(userId), CONCENTRATION_QUERY, { actor: prompt.actor.uuid, dc: prompt.dc, ability: prompt.ability ?? null,
        prompt: message.id }, { timeout: CONCENTRATION_TIMEOUT, actor: prompt.actor, label: waitLabel("Concentration", { dc: prompt.dc }) });
    } catch(err) {
      console.warn(`${MODULE_ID} | concentration of ${prompt.actor.name}: no answer from the player, the card stays`, err);
    }
    return;
  }
  log(`${prompt.actor.name}: concentration saving throw DC ${prompt.dc}`);
  await rollConcentration(prompt, message.id);
}

/** A failed Concentration saving throw breaks Concentration, whoever rolled it. */
async function onSave(message) {
  const save = readConcentrationSave(message);
  if ( !save ) return;
  await waitForDice(message);
  if ( save.failed ) {
    const ended = await loseConcentration(save.actor, message);
    log(`${save.actor.name}: concentration saving throw failed${ended.length ? `, ${ended.map(e => e.name).join(", ")} ended` : ""}`);
  } else log(`${save.actor.name}: concentration maintained`);
  // The request card that the engine served itself has no further purpose.
  if ( save.prompt ) await game.messages.get(save.prompt)?.delete();
}

export function registerConcentration() {
  CONFIG.queries[CONCENTRATION_QUERY] = handleConcentrationQuery;   // on all clients: the player answers
  route("createChatMessage", message => {
    if ( message.type === "prompt" ) return onPrompt(message);
    if ( message.type === "save" ) return onSave(message);
  }, { executor: true, label: "concentration: processing interrupted" });

  // End of Concentration, whatever the cause (player's button, new Concentration spell,
  // failed saving throw, death, effect deleted by hand): the effect's deletion is seen by all
  // clients, the active GM removes the areas. Not `dnd5e.endConcentration`: a hook local to the client that ended it.
  route("deleteActiveEffect", async effect => {
    if ( !isConcentrationEffect(effect) ) return;
    const removed = await removeRegionsOf(effect.uuid);
    if ( removed ) log(`${effect.parent?.name ?? "?"}: ${removed} area(s) removed with concentration`);
    // §16.13: the summoned creatures that Concentration was maintaining vanish with it.
    const gone = await removeSummonsOf(effect.uuid);
    if ( gone ) log(`${effect.parent?.name ?? "?"}: ${gone} summoned creature(s) removed with concentration`);
    // §16.41: the trace of a Concentration spell (Flame Blade).
    const actor = effect.parent;
    // §554: an expired trace out of combat is being deleted by dnd5e at the same moment.
    const traces = (actor?.effects ?? []).filter(e => (e.getFlag("dnd5e-combat", "traceConcentration") === effect.uuid) && !expiresByItself(e)).map(e => e.id);
    if ( traces.length ) {
      // Already removed elsewhere in the meantime (by hand, by a scenario): nothing to say.
      const still = traces.filter(id => actor.effects.has(id));
      if ( still.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", still).catch(() => {});
      log(`${actor.name}: trace removed with concentration`);
    }
  }, { executor: true, label: "concentration: areas not removed" });
  // Deactivating Concentration means ending it: the effect is deleted, the route above does the rest (and dnd5e
  // removes the dependent effects). `endConcentration` would no longer find it: it only sees active effects.
  route("updateActiveEffect", async (effect, changes) => {
    if ( !concentrationDisabled(effect, changes) ) return;
    log(`${effect.parent?.name ?? "?"}: concentration disabled (${effect.name}), ending it`);
    await effect.delete();
  }, { executor: true, label: "concentration disabled: not ended" });
  // §16.13: a summoned creature (dnd5e "summon" activity) is attached to its summoner's Concentration,
  // and enters combat according to the item's content.
  route("createToken", async tokenDoc => {
    const item = summonItemOf(tokenDoc);
    if ( !item ) return;
    // O8f (§349): a hostile summon ("The Skull", "Titan Summoning Scroll").
    if ( await makeSummonHostile(tokenDoc) ) log(`${tokenDoc.name}: summoned by ${item.name}, hostile to everyone`);
    const effect = await tieSummonToConcentration(tokenDoc);
    if ( effect ) log(`${tokenDoc.name}: sustained by ${item.actor?.name}'s concentration (${item.name})`);
    const combatant = await joinSummonerCombat(tokenDoc);
    if ( combatant ) log(`${tokenDoc.name}: in combat (initiative ${combatant.initiative ?? "to roll"})`);
  }, { executor: true, label: "summon: creature not attached" });
}
