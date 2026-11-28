/**
 * §225: moves the selected tokens into the Ethereal plane, or brings them back (dnd5e's "Ethereal" condition, the same as in
 * the token HUD's conditions menu). A mixed group goes entirely into the Ethereal.
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !api?.ethereal?.toggle ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
if ( !canvas.tokens.controlled.length ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Ethere.AucunToken"));
const done = await api.ethereal.toggle();
const names = list => list.map(r => r.name).join(", ");
const entered = done.filter(r => r.ethereal);
const left = done.filter(r => !r.ethereal);
if ( entered.length ) ui.notifications.info(game.i18n.format("DND5ECOMBAT.Ethere.Entre", { names: names(entered) }));
if ( left.length ) ui.notifications.info(game.i18n.format("DND5ECOMBAT.Ethere.Sort", { names: names(left) }));
