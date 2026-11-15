/**
 * Raccourci vers le diagnostic du monde de DAS · Core (SPEC §177), ouvert sur la vérification « enchantements des aptitudes » (§453) :
 * une aptitude du Manuel des joueurs 3.0.0 qui améliore un autre objet de la fiche (progression « ModifyItem » de dnd5e 6.1 : Frappes
 * renforcées, Armes empoisonnées, Main de mage subtile…) ne le fait qu'une fois, quand elle est acquise, sur les objets déjà là. La
 * logique vit dans le module (runtime/diagnostic/checks.mjs, `modify-item`) : analyse sans rien écrire, réparation de ce que le MJ coche,
 * après une sauvegarde vérifiée dans le compendium « DAS · Sauvegardes » (restaurable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "modify-item" });
