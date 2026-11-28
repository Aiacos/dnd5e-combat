/**
 * Shortcut to the DAS · Core world diagnostic (SPEC §177), opened on the "spell scrolls" check.
 * This macro's logic now lives in the module (runtime/diagnostic/checks.mjs, `scrolls`): analysis writes nothing,
 * repair of what the GM ticks, after a verified backup in the "DAS · Sauvegardes" compendium (restorable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "scrolls" });
