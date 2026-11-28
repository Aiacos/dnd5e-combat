/**
 * §397: opens the "Start Combat" window of DAS · Core (GM) — the game pauses, the participants and the surprised are chosen,
 * then the combat starts and everyone rolls Initiative. The same as the toolbar's "Start Combat" button.
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !api?.combatLaunch?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Lancement.MJ"));
await api.combatLaunch.open();
