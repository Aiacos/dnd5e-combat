/**
 * Legendary Resistance (SPEC §18.9, M6): "if the creature fails a saving throw, it can choose to succeed instead". dnd5e 6
 * handles it natively: the NPC's `resources.legres`, a "Resist" button on the card of a failed save
 * (`SaveMessageData#canResist`, data/chat-message/save-message-data.mjs:77-81) and `actor.system.resistSave(message)`
 * (data/actor/npc.mjs:572-600), which spends a resistance and marks the save `resisted` (successful). The engine, which
 * applies the outcome from the roll, asks the question BEFORE applying, then calls the system's method.
 */

import { timedWait } from "./dialogs.mjs";

/** Remaining Legendary Resistances, or 0. */
export const legendaryLeft = actor => actor?.system?.resources?.legres?.value ?? 0;

/** Does the system allow resisting this save (NPC, failed, not already resisted, resistance left)? */
export const canResistSave = message => message?.system?.canResist === true;

/**
 * Asks the GM whether to spend a Legendary Resistance. With no answer within the combat windows' timeout: no.
 * @returns {Promise<boolean>}
 */
export async function askLegendary(actor, { total, dc, item }) {
  const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Legendaire.${key}`, data ?? {});
  const answer = await timedWait({
    window: { title: t("Titre") },
    content: `<p>${t("Question", { name: actor.name, total, dc, item: item ?? "", left: legendaryLeft(actor) })}</p>`,
    buttons: [
      { action: "yes", label: t("Oui"), icon: "fa-solid fa-shield", default: true },
      { action: "no", label: t("Non"), icon: "fa-solid fa-xmark" }
    ]
  }, { fallback: "no", awaiting: { actor, kind: "choice" } });
  return answer === "yes";
}

/** Spends a Legendary Resistance on this save: the system's method (counter, card marked "resisted"). */
export async function resistSave(message) {
  await message.getAssociatedActor()?.system?.resistSave?.(message);
}
