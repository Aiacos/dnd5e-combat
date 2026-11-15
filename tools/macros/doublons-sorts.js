/**
 * Raccourci vers le diagnostic du monde de DAS · Core (SPEC §177), ouvert sur la vérification « sorts en double » : deux copies du même
 * sort sur une fiche (même identifiant, même classe, même méthode), souvent laissées par un module de préparation des sorts qui ne
 * reconnaît pas un sort venu d'un autre compendium (SRD contre Manuel des joueurs). La logique vit dans le module
 * (runtime/diagnostic/checks.mjs, `spell-duplicates`) : analyse sans rien écrire, réparation de ce que le MJ coche, après une sauvegarde
 * vérifiée dans le compendium « DAS · Sauvegardes » (restaurable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "spell-duplicates" });
