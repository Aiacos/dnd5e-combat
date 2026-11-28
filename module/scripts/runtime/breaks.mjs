/**
 * §16.47: effects that end when their bearer acts (`breaksOn`: Invisibility, PHB 2024 — "the spell ends
 * immediately after the target makes an attack roll, deals damage, or casts a spell"). On the author's
 * client, which owns its effects:
 *  - attack roll: after the roll (`dnd5e.rollAttackV2`), which benefited from the invisibility;
 *  - spell or use with damage that is not an attack: after the use (`dnd5e.postUseActivity`). The effects
 *    of the item used itself do not fall (casting Invisibility on oneself does not break it);
 *  - §23: saving throw (`save`): after the roll (`dnd5e.rollSavingThrow`, actor.mjs:1657), which suffered the effect (Mind Sliver:
 *    "subtract 1d4 from the next saving throw").
 */

import { MODULE_ID } from "../constants.mjs";
import { breakMoments, effectBreakMoments } from "../core/conditions.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originActivityIdOf, originItemOf } from "../adapter/facts.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

async function breakEffects(actor, moments, exceptItem=null, { before=null }={}) {
  if ( !actor?.isOwner || !moments.length ) return;
  const broken = actor.effects.filter(e => {
    // Only the effects that were there before the gesture: the save that PLACES the effect (Mind Sliver) does not consume it.
    if ( before && ((e._stats?.createdTime ?? 0) > before) ) return false;
    const item = originItemOf(e);
    if ( !item || (exceptItem && (item.uuid === exceptItem.uuid)) ) return false;
    // §438: `breaksOnActivity` — only the effects placed by this activity ("Evanescent Stride", not "Taunted" of the same item).
    const entry = contentOf(item).entry;
    const on = entry?.breaksOnActivity ? effectBreakMoments(entry, originActivityIdOf(e, item)) : (entry?.breaksOn ?? []);
    return moments.some(m => on.includes(m));
  });
  if ( !broken.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", broken.map(e => e.id));
  const token = tokenOnViewedScene(actor);
  for ( const e of broken ) {
    log(`${actor.name}: ${e.name} ends (${moments.join(", ")})`);
    if ( token ) notice(token, e.name, "effectOff");
  }
}

/**
 * §366: `breaksOnOrigin` — on the active GM, at each attack, damage (not healing) or save-use card: the
 * effects that the card's author placed (by another item) and whose item declares this moment fall, on any creature of the scene.
 */
async function breakOnOrigin(message) {
  let moment = null;
  // dnd5e 6: when the card's item no longer exists, `getAssociatedItem` goes through `getOriginatingMessage()`, which may
  // return `system.origin` (data, not a message) — "Receiver must be an instance of class ChatMessage5e". Safe read.
  const read = fn => { try { return fn() ?? null; } catch { return null; } };
  const activity = read(() => message.getAssociatedActivity?.());
  if ( message.type === "attack" ) moment = "attack";
  else if ( (message.type === "damage") && (activity?.type !== "heal") ) moment = "damage";
  else if ( (message.type === "usage") && (activity?.type === "save") ) moment = "forcesSave";
  if ( !moment ) return;
  const item = activity?.item ?? read(() => message.getAssociatedItem?.());
  const caster = read(() => message.getAssociatedActor?.()) ?? item?.actor ?? null;
  if ( !caster ) return;
  for ( const token of canvas.scene?.tokens ?? [] ) {
    const actor = token.actor;
    if ( !actor ) continue;
    const broken = actor.effects.filter(e => {
      const source = originItemOf(e);
      if ( !source || (source.actor?.uuid !== caster.uuid) || (item && (source.uuid === item.uuid)) ) return false;
      return (contentOf(source).entry?.breaksOnOrigin ?? []).includes(moment);
    });
    if ( !broken.length ) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", broken.map(e => e.id));
    for ( const e of broken ) {
      log(`${actor.name}: ${e.name} ends (${caster.name}: ${moment})`);
      if ( token.object ) notice(token.object, e.name, "effectOff");
    }
  }
}

export function registerBreaks() {
  route("createChatMessage", message => {
    breakOnOrigin(message).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { executor: true, label: "effect ending on the caster's action not removed" });
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    breakEffects(subject?.actor, breakMoments({ attack: true, damage: false, spell: false })).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on attack roll not removed" });
  route("dnd5e.rollSavingThrow", (rolls, { subject }={}) => {
    breakEffects(subject, ["save"], null, { before: Date.now() }).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on saving throw not removed" });
  route("dnd5e.postUseActivity", activity => {
    if ( !activity?.actor || (activity.type === "attack") ) return;
    const moments = breakMoments({ attack: false, damage: (activity.damage?.parts?.length ?? 0) > 0, spell: isSpellCast(activity.item) });
    // §299: "forcesSave" — the use imposes a saving throw ("Psychic Veil": "or force a creature to make a saving
    // throw").
    if ( activity.type === "save" ) moments.push("forcesSave");
    breakEffects(activity.actor, moments, activity.item).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on spell or damage not removed" });
}
