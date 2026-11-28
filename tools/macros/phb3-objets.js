/**
 * Shortcut to the world diagnostic of DAS · Core (SPEC §177), opened on the "Player's Handbook 3.0.0 features and spells
 * (preview per sheet)" check (§438). The logic lives in the module (runtime/diagnostic/checks.mjs, `phb3-items`): analysis
 * without writing anything, repair of what the GM ticks, after a backup verified in the "DAS · Sauvegardes" compendium
 * (restorable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "phb3-items" });
