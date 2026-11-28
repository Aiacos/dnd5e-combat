/**
 * §210: non-lethal blows and surprise (batch 2 of the survey `prive/RELEVE_REGLES.md`).
 *  - Knock out: the "non-lethal blows" switch (adapter/knockout.mjs) is read when damage is applied (adapter/death.mjs); here,
 *    the waking — the knocked-out creature that regains HP is no longer Unconscious (it stays Prone, as the rule has it) —, and
 *    the first aid: a creature in contact, Wisdom (Medicine) check DC 10 on the client of the one healing, then the waking by
 *    the owner or the active GM.
 *  - Surprise: dnd5e's "Surprised" condition already gives Disadvantage on Initiative
 *    (config.mjs `conditionEffects.initiativeDisadvantage`); the engine removes it once the creature's Initiative is rolled (it
 *    only applies to that roll), and, with the setting `surpriseFromStealth` (on by default), a creature that does not perceive a
 *    hidden enemy on the scene (engine Hide, `hiddenFrom`) rolls its Initiative with Disadvantage — "a hidden ambusher who starts
 *    the combat surprises whoever suspects nothing".
 */
import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { KNOCKED_OUT_FLAG, FIRST_AID_DC, isKnockedOut } from "../adapter/knockout.mjs";
import { hiddenFrom } from "../adapter/stealth.mjs";
import { route } from "./router.mjs";
import { log, loc, locEsc, notice, say, viaOwnerOrGM, rolledAndShown } from "./shared.mjs";

export const SURPRISE_SETTING = "surpriseFromStealth";
export const WAKE_QUERY = `${MODULE_ID}.wake`;

/* -------------------------------------------- */
/*  Assommer                                    */
/* -------------------------------------------- */

/** Wakes a knocked-out creature: no longer Unconscious, flag removed. Returns false if it was not. Owner or GM. */
async function wake(actor, { reason="hp", by="" }={}) {
  if ( !isKnockedOut(actor) ) return false;
  await actor.unsetFlag(MODULE_ID, KNOCKED_OUT_FLAG);
  if ( actor.statuses.has("unconscious") ) await actor.toggleStatusEffect("unconscious", { active: false });
  await say({ actor }, locEsc(reason === "aid" ? "Assomme.SoinsReveil" : "Assomme.Reveil", { name: actor.name, by }));
  log(`${actor.name}: no longer knocked out (${reason})`);
  return true;
}

/** Active GM (or owner): wake the creature targeted by successful first aid. The rule is re-read here. */
async function handleWake({ target, by="", helper=null }, { user=null }={}) {
  const token = await fromUuid(target ?? "");
  // §472: from a player, the helper is theirs and stands on the same scene; its name comes from its sheet, not from the data.
  if ( needsCheck(user) ) {
    const aid = helper ? await fromUuid(helper) : null;
    if ( !aid?.actor || !actsFor(user, aid.actor) || (aid.parent !== token?.parent) ) { console.warn(`${MODULE_ID} | wake query from ${user.name} refused: no helper of theirs next to ${token?.name ?? target}`); return false; }
    by = aid.name;
  }
  return token?.actor ? wake(token.actor, { reason: "aid", by }) : false;
}

/** Active GM: HP regained → woken; dropped to 0 anyway (new damage) → no longer "knocked out", the ordinary rules resume. */
function onActorUpdate(actor, changes) {
  if ( !isKnockedOut(actor) ) return;
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if ( !Number.isFinite(hp) ) return;
  if ( hp <= 0 ) return actor.unsetFlag(MODULE_ID, KNOCKED_OUT_FLAG);
  if ( hp > 1 ) return wake(actor, { reason: "hp" });
}

/** First aid to a knocked-out creature in contact: Medicine check DC 10 on this client, then the waking. */
export async function firstAid(token, target) {
  const actor = token?.actor;
  if ( !actor || !isKnockedOut(target?.actor) ) return false;
  // §252: the verdict waits for the 3D dice to finish, then is seen and heard by all.
  const rolls = await rolledAndShown(() => actor.rollSkill({ skill: "med", ability: "wis", target: FIRST_AID_DC }, { configure: true }));
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  if ( total < FIRST_AID_DC ) {
    notice(target, { key: "Assomme.SoinsRates" }, "refused", { all: true, action: "firstAid", outcome: "failure" });
    return false;
  }
  notice(target, { key: "Retour.Action.SoinsReussis" }, "gain", { all: true, action: "firstAid", outcome: "success" });
  return viaOwnerOrGM(!!target.actor.isOwner, WAKE_QUERY, handleWake, { target: target.uuid, by: actor.name, helper: token.uuid }, { fallback: false });
}

/* -------------------------------------------- */
/*  Surprise                                    */
/* -------------------------------------------- */

const surpriseFromStealth = () => {
  try { return game.settings.get(MODULE_ID, SURPRISE_SETTING) !== false; } catch { return true; }
};

/** A hidden enemy on the scene that this token does not perceive? (the first, or null) */
function hiddenEnemyOf(token) {
  for ( const other of token?.parent?.tokens ?? [] ) if ( (other !== token) && hiddenFrom(token, other) ) return other;
  return null;
}

/**
 * `dnd5e.preConfigureInitiative` (on the client that rolls): surprised by a hidden enemy → Disadvantage. The token is the one of
 * the scene of the current combat, otherwise of the displayed scene.
 */
function onConfigureInitiative(actor, rollConfig) {
  if ( !surpriseFromStealth() || !rollConfig?.options ) return;
  const scene = game.combat?.scene ?? canvas?.scene;
  const token = actor?.getActiveTokens?.(false, true)?.find(t => t.parent === scene) ?? null;
  const hidden = token ? hiddenEnemyOf(token) : null;
  if ( !hidden ) return;
  rollConfig.options.disadvantage = true;
  rollConfig.options.flavor = `${rollConfig.options.flavor ?? ""} (${loc("Surprise.Raison")})`.trim();
  log(`${actor.name}: surprised (${hidden.name} is hidden from them), initiative with Disadvantage`);
}

/** Active GM: the initiative of a Surprised creature is rolled — the condition has served, it is removed. */
function onCombatantUpdate(combatant, changes) {
  if ( !("initiative" in changes) || (changes.initiative === null) ) return;
  const actor = combatant.actor;
  if ( !actor?.statuses?.has("surprised") ) return;
  return actor.toggleStatusEffect("surprised", { active: false }).then(() => log(`${actor.name}: Surprised removed after rolling initiative`));
}

export function registerKnockout() {
  game.settings.register(MODULE_ID, SURPRISE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SURPRISE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SURPRISE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  CONFIG.queries[WAKE_QUERY] = handleWake;
  route("updateActor", onActorUpdate, { executor: true, label: "knocked out: not woken up" });
  route("dnd5e.preConfigureInitiative", onConfigureInitiative, { label: "surprise: initiative Disadvantage" });
  route("updateCombatant", onCombatantUpdate, { executor: true, label: "surprise: Surprised not removed" });
}
