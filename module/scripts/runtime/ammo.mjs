/**
 * §274: the choice of ammunition when the attack roll goes out without dnd5e's window (issue #23).
 *
 * `dnd5e.preRollAttackV2` (registered after legality, registerTurn: the attack mode and the confirmation are already set), on the
 * client that rolls:
 *  - an imposed ammunition (use configuration `{ "dnd5e-combat": { ammunition } }`, carried by the card like the attack
 *    mode §150, or `rollAttack({ ammunition })` other than dnd5e's memory) is drawn as is;
 *  - otherwise, the last ammunition retained if it is still usable, the only usable one if there is just one;
 *  - several usable and no dnd5e window: a small window asks, the last one preselected — the roll is
 *    suspended (the hook is synchronous) then relaunched with the choice, remembered on the weapon (`setAmmo`).
 * A GM creature without a player keeps its choice without asking; `ammoPrompt` client setting to never ask.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { esc, loc } from "./shared.mjs";
import { ammoState, announceAmmoChange, setAmmo } from "../adapter/ammo.mjs";

export const AMMO_PROMPT_SETTING = "ammoPrompt";
const AMMO_CLASS = "dnd5e-combat-ammo";

/** The ammunition imposed by the caller, or null. */
function explicitAmmo(activity, config, message) {
  const own = config[MODULE_ID]?.ammunition;
  if ( own ) return own;
  const usageId = message?.data?.system?.origin ?? null;
  const carried = usageId ? game.messages.get(usageId)?.getFlag(MODULE_ID, "ammunition") : null;
  if ( carried ) return carried;
  // `rollAttack` merges dnd5e's memory into its configuration, or failing that the first ammunition (activity/attack.mjs:92-108):
  // only another value is asked.
  const remembered = activity.item.getFlag("dnd5e", `last.${activity.id}.ammunition`);
  const byDefault = (remembered === undefined) ? (activity.item.system.ammunitionOptions?.[0]?.value ?? null) : remembered;
  return (config.ammunition && (config.ammunition !== byDefault)) ? config.ammunition : null;
}

/** Puts the ammunition into the roll configuration: `_buildAttackConfig` reads it (attack.mjs:247), the message too (options). */
function applyAmmo(config, id) {
  config.ammunition = id;
  if ( config.rolls?.[0]?.options ) config.rolls[0].options.ammunition = id;
}

/** Ask here? Not for a GM creature without a player, nor if this client turned it off. */
function shouldAsk(actor) {
  if ( !game.settings.get(MODULE_ID, AMMO_PROMPT_SETTING) ) return false;
  return !game.user.isGM || !!actor?.hasPlayerOwner;
}

function onPreRollAttack(config, dialog, message) {
  const activity = config.subject;
  if ( !activity?.item || config[MODULE_ID]?.ammoChosen ) return true;
  const state = ammoState(activity.item, activity, { explicit: explicitAmmo(activity, config, message) });
  if ( !state?.options.length ) return true;
  // dnd5e's window will open: its "Ammunition" list preselects our choice, the player keeps control there.
  const fast = dialog?.configure === false;
  if ( !state.ask || !fast || !shouldAsk(activity.actor) ) {
    if ( state.current ) applyAmmo(config, state.current);
    return true;
  }
  askAmmo(activity, state).then(async id => {
    if ( !id ) return;
    if ( id !== activity.item.getFlag("dnd5e", `last.${activity.id}.ammunition`) ) await setAmmo(activity.item, id);
    const { event, ability, attackMode, mastery, advantage, disadvantage } = config;
    activity.rollAttack({
      event, ability, attackMode, mastery, advantage, disadvantage, ammunition: id,
      // The mode is the one legality already decided (throw, two hands): it is taken as is.
      [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), ammoChosen: true, ...(attackMode ? { modeChosen: true } : {}) }
    }, { configure: false }, message);
  });
  return false;
}

/** The window: one row per ammunition (icon, name, remaining), the preselection checked; Enter confirms, double-click too. */
async function askAmmo(activity, state) {
  const lines = state.options.map(o => `
    <label class="${AMMO_CLASS}-line${o.quantity > 0 ? "" : " empty"}">
      <input type="radio" name="ammo" value="${esc(o.id)}"${o.id === state.current ? " checked" : ""}${o.quantity > 0 ? "" : " disabled"}>
      ${o.img ? `<img src="${esc(o.img)}" alt="">` : ""}
      <span class="name">${esc(o.name)}</span>
      <span class="qty">× ${o.quantity}</span>
    </label>`).join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: loc("Munitions.Titre", { name: activity.item.name }), icon: "fa-solid fa-bullseye" },
    classes: [AMMO_CLASS],
    position: { width: 340 },
    content: `<p>${loc("Munitions.Question")}</p><div class="${AMMO_CLASS}-list">${lines}</div>`,
    buttons: [
      { action: "fire", label: loc("Munitions.Tirer"), icon: "fa-solid fa-crosshairs", default: true,
        callback: (event, button) => button.form.elements.ammo?.value ?? null },
      { action: "cancel", label: loc("Renoncer") }
    ],
    render: (event, dialog) => {
      dialog.element.querySelectorAll(`.${AMMO_CLASS}-line:not(.empty)`).forEach(line => line.addEventListener("dblclick", () => {
        dialog.element.querySelector('button[data-action="fire"]')?.click();
      }));
    },
    rejectClose: false
  }).then(result => ((result && (result !== "cancel")) ? result : null));
}

export function registerAmmo() {
  game.settings.register(MODULE_ID, AMMO_PROMPT_SETTING, { scope: "client", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${AMMO_PROMPT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AMMO_PROMPT_SETTING}.Aide` });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "ammunition chosen" });
  route("updateItem", announceAmmoChange, { label: "ammunition choice announced" });
}
