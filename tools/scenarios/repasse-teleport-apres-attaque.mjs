/**
 * §464 (tri « déplacement » de l'ATLAS) : téléportation de soi offerte une fois l'attaque jugée, touchée ou ratée (`teleport.after:
 * "attack"`, lue dans le texte). Arène des sorts : le Lanceur (PNJ) reçoit les Griffes de l'Esprit yugoloth (Manuel des joueurs,
 * invocation d'esprit fiélon : « aussitôt après que l'attaque touche ou rate, l'esprit peut se téléporter jusqu'à 9 m »).
 *  - l'utilisation de l'attaque ne téléporte pas (pas de visée à l'utilisation) ;
 *  - l'attaque jugée, la visée de la téléportation s'ouvre pour le Lanceur ;
 *  - un clic sur une case à 5 cases (25 ft) l'y téléporte.
 * C'est le geste du joueur : visée du moteur, clic (`teleportPick`), validation `dnd5e.teleport`.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const CLAWS = "Compendium.dnd-players-handbook.actors.Actor.phbfisYugolothSp.Item.phbaoiClawsYugol";

export default {
  name: "repasse-teleport-apres-attaque — Griffes de l'Esprit yugoloth : téléportation offerte après l'attaque (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-players-handbook.actors") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target] ) homes.set(t.id, await ctx.position(t));
    const lent = [];
    ctx.restore(async () => {
      for ( const t of [caster, target] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
    });

    const { data } = await ctx.call("get-compendium-entry", { uuid: CLAWS });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = CLAWS;
    const claws = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: CLAWS } })).id;
    lent.push(claws);

    // Deux rangées sous leur place : la Cible au contact du Lanceur.
    const start = { x: homes.get(caster.id).x, y: homes.get(caster.id).y + 2 * grid };
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: target.id, x: start.x + grid, y: start.y, elevation: 0 });
    await ctx.setHp(target, 999);
    await pause(1000);

    const u = await ctx.use({ tokenId: caster.id, itemId: claws, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
    if ( !ctx.expect(u.used, "les Griffes sont utilisées") ) return;
    const before = await ctx.position(caster);
    ctx.expect((before.x === start.x) && (before.y === start.y), "l'utilisation de l'attaque ne téléporte pas le Lanceur");
    if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    let state = null;
    for ( let i = 0; (i < 20) && (state?.teleporting !== caster.name); i++ ) { await pause(500); state = await ctx.engine("planning", {}).catch(() => null); }
    ctx.expect(state?.teleporting === caster.name, `l'attaque jugée, la visée de la téléportation s'ouvre pour le Lanceur (${JSON.stringify(state)})`);

    const goal = { x: start.x, y: start.y + 5 * grid };
    const picked = await ctx.engine("teleportPick", { x: goal.x + grid / 2, y: goal.y + grid / 2 }).catch(err => ({ error: err.message }));
    ctx.expect(picked?.picked === true, `la case est choisie d'un clic (${JSON.stringify(picked)})`);
    await pause(2500);
    const pos = await ctx.position(caster);
    ctx.expect((pos.x === goal.x) && (pos.y === goal.y), `5 cases (25 ft, limite 30 ft) : téléporté (${pos.x},${pos.y} ; attendu ${goal.x},${goal.y})`);
  }
};
