/**
 * Shortcut to the world diagnostic of DAS · Core (SPEC §177), opened on the "creature sheets" check.
 * The logic of this macro now lives in the module (runtime/diagnostic/checks.mjs, `creatures`): analysis without writing anything,
 * repair of what the GM ticks, after a backup verified in the "DAS · Sauvegardes" compendium (restorable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "creatures" });
