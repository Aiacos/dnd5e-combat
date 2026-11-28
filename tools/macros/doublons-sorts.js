/**
 * Shortcut to the world diagnostic of DAS · Core (SPEC §177), opened on the "duplicate spells" check: two copies of the same
 * spell on a sheet (same identifier, same class, same method), often left by a spell-preparation module that does not
 * recognize a spell coming from another compendium (SRD versus Player's Handbook). The logic lives in the module
 * (runtime/diagnostic/checks.mjs, `spell-duplicates`): analysis without writing anything, repair of what the GM ticks, after a
 * backup verified in the "DAS · Sauvegardes" compendium (restorable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "spell-duplicates" });
