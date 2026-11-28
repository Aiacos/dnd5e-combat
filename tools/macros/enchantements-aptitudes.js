/**
 * Shortcut to the world diagnostic of DAS · Core (SPEC §177), opened on the "feature enchantments" check (§453):
 * a Player's Handbook 3.0.0 feature that upgrades another item of the sheet (dnd5e 6.1 "ModifyItem" progression: Enhanced
 * Strikes, Poisoned Weapons, Subtle Mage Hand…) only does so once, when it is acquired, on the items already there. The
 * logic lives in the module (runtime/diagnostic/checks.mjs, `modify-item`): analysis without writing anything, repair of what
 * the GM ticks, after a backup verified in the "DAS · Sauvegardes" compendium (restorable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "modify-item" });
