/**
 * §554: spell weapons (traces that offer an attack, §16.41: Flame Blade, Produce Flame) seen by the rest of the table.
 *  - On every client, when such a trace appears or goes, the hook `dnd5e-combat.spellWeapon` tells neighbours (an interface puts the
 *    attack in a weapon slot, then takes it back).
 *  - On the active GM, the attack's favorite that DAS added when the trace was placed (adapter/traces.mjs `leaveTrace`, flag
 *    `traceFavorite`) leaves the sheet with the trace — never a favorite the player had put there.
 *  - On the active GM, a trace whose duration ran out in combat ends (its concentration, else the trace itself): the core only
 *    marks it `duration.expired` (client/helpers/active-effect-registry.mjs:147, `CONFIG.ActiveEffect.expiryAction` "update") and
 *    dnd5e deletes it only out of combat — it would leave the blade in the menu, the favorites and the weapon slot.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { spellWeaponOfEffect, releaseFavorite, expiresByItself } from "../adapter/traces.mjs";

/**
 * Hook `dnd5e-combat.spellWeapon`. §554: on every client, when a spell weapon appears (its trace is placed) or goes (concentration
 * lost, duration over, ended by hand, cast again): `({ actor, item, activity, effect, active })` — `activity` the attack to offer,
 * `active` true when it appears. A trace replaced by a new cast of the same spell sends no `active: false` (the new one follows).
 * Read-only.
 */
const SPELL_WEAPON_HOOK = `${MODULE_ID}.spellWeapon`;

function announce(effect, active) {
  const weapon = spellWeaponOfEffect(effect);
  if ( !weapon ) return;
  Hooks.callAll(SPELL_WEAPON_HOOK, { ...weapon, effect, active });
}

export function registerSpellWeapons() {
  route("createActiveEffect", effect => announce(effect, true), { label: "spell weapon: neighbours not told" });
  route("deleteActiveEffect", (effect, options) => {
    if ( options?.[MODULE_ID]?.replaced ) return;
    announce(effect, false);
  }, { label: "spell weapon: neighbours not told" });
  route("deleteActiveEffect", async (effect, options) => {
    if ( await releaseFavorite(effect, options) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} removed from the favorites with its trace`);
  }, { executor: true, label: "spell weapon: favorite not removed" });
  route("updateActiveEffect", async (effect, changes) => {
    if ( (changes?.duration?.expired !== true) || !effect.getFlag?.(MODULE_ID, "trace") ) return;
    // Out of combat, dnd5e deletes an expired effect itself (ActiveEffect5e#_onUpdate, "If out of combat & effect expires, delete
    // it"); in combat it stays, expired.
    if ( expiresByItself(effect) ) return;
    // A concentration spell ends by its concentration (runtime/concentration.mjs then removes the trace, areas, summons).
    const concentration = fromUuidSync(effect.getFlag(MODULE_ID, "traceConcentration") ?? "", { strict: false });
    log(`${effect.parent?.name ?? "?"}: ${effect.name} expired, ${concentration ? "concentration ended" : "trace removed"}`);
    await (concentration ?? effect).delete().catch(() => {});
  }, { executor: true, label: "spell weapon: expired trace not removed" });
}
