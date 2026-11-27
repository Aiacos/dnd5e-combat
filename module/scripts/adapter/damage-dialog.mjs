/**
 * #173 (§556): dnd5e's own damage roll configuration dialog for the damage the engine rolls (situational bonus, Critical / Normal,
 * roll mode, damage type), instead of DAS's "Roll damage" button. The engine still rolls on the author's client, the GM still applies.
 *
 * Passed to `activity.rollDamage` as `dialog.applicationClass` (dnd5e's `BasicRoll.build`, dice/basic-roll.mjs:116): a subclass of
 * `DamageRollConfigurationDialog` — no prototype is replaced. What it adds:
 *  - closing the dialog (header X, Escape, the combat window delay) rolls with what the form holds and the default button, instead of
 *    rolling nothing: the `dnd5e.preRollDamageV2` handlers already ran (once-per-turn marks, a coating's charge, a promised die), a hit
 *    has damage (§419), and the resolution would wait for a roll forever;
 *  - the combat window delay and the table's hourglass (`closeRollDialogAfter`, §290 / §381), armed when the dialog first shows, with
 *    its countdown bar (`showCountdown`, §557);
 *  - no "Critical Hit" button when the engine settled the critical otherwise (`core/flow.mjs`, `criticalButtonLocked`).
 */
import { MODULE_ID } from "../constants.mjs";
import { criticalButtonLocked } from "../core/flow.mjs";
import { closeRollDialogAfter, showCountdown } from "./dialogs.mjs";

let EngineDamageDialog = null;

/** The dialog class, built once dnd5e is loaded. */
export function engineDamageDialog() {
  if ( EngineDamageDialog ) return EngineDamageDialog;
  const Base = globalThis.dnd5e?.applications?.dice?.DamageRollConfigurationDialog;
  if ( !Base ) return null;
  EngineDamageDialog = class extends Base {
    /** The rolls kept when the dialog closed without a button. */
    #fallback = null;
    #disarm = () => {};

    get #locked() {
      return criticalButtonLocked(this.config?.[MODULE_ID] ?? {});
    }

    /** The button a closed dialog stands for: dnd5e's default one (damage-configuration-dialog.mjs, `_prepareButtonsContext`). */
    #defaultAction() {
      if ( this.#locked || (this.config?.critical?.allow === false) ) return "normal";
      const critical = this.config?.isCritical || (super.rolls ?? []).some(roll => roll.options?.isCritical);
      return critical ? "critical" : "normal";
    }

    /** @override dnd5e reads the rolls on "close" (roll-configuration-dialog.mjs, `configure`). */
    get rolls() {
      const rolls = super.rolls;
      return (rolls?.length || !this.#fallback) ? rolls : this.#fallback;
    }

    /** @inheritDoc */
    async _prepareButtonsContext(context, options) {
      context = await super._prepareButtonsContext(context, options);
      if ( this.#locked && context.buttons?.critical ) {
        delete context.buttons.critical;
        if ( context.buttons.normal ) context.buttons.normal.default = true;
      }
      return context;
    }

    /** @inheritDoc */
    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      const actor = this.config?.subject?.actor;
      if ( !actor ) return;
      const close = closeRollDialogAfter(actor, () => {}, null, { awaiting: "roll" });
      // §557: the countdown bar the old "Roll damage" window had, above dnd5e's buttons.
      const stop = showCountdown(this, { before: ".dialog-buttons" });
      this.#disarm = () => { close(); stop(); };
    }

    /** @inheritDoc */
    async _preClose(options={}) {
      await super._preClose(options);
      this.#disarm();
      if ( options.dnd5e?.submitted || !this.form ) return;
      // Built while the form is still there: dnd5e clears its rolls once closed (`_onClose`).
      this.#fallback = [...(this._finalizeRolls(this.#defaultAction()) ?? [])];
    }
  };
  return EngineDamageDialog;
}

/**
 * The `dialog` argument of `activity.rollDamage` for a roll the engine makes. `mode` (`core/flow.mjs`, `damageDialog`): "required" —
 * the dialog shows; "offered" — it shows unless this client keeps "Rolls without dialog" (ui/pointer-offers.mjs); null — never.
 * @param {string|null} mode
 */
export function damageDialogConfig(mode) {
  const applicationClass = mode ? engineDamageDialog() : null;
  return applicationClass ? { configure: true, applicationClass } : { configure: false };
}
