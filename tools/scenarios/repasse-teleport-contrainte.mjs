/**
 * §465 (tri « déplacement » de l'ATLAS) : téléportations de soi à destination contrainte, lues dans le texte des créatures
 * (`teleport.destination`). Arène des sorts : le Lanceur (PNJ) reçoit les capacités prêtées depuis le Monster Manual.
 *  - Poursuite du Nalfeshnee (« sa destination doit être à 3 m de la créature qui l'a déclenchée », portée de l'activité 120 ft) : une case
 *    au contact de la Cible, acceptée ; une case loin de toute créature, refusée (et le Lanceur reste) ;
 *  - Marche des arbres de la Dryade (« à 1,50 m d'un second arbre, lui-même à 18 m du premier ») : 70 ft au plus — 13 cases (65 ft)
 *    acceptées, 15 cases (75 ft) refusées. Les arbres ne sont pas des objets de la scène : le MJ en juge (rien n'est vérifié ici).
 * Le chemin est celui du clic du joueur (`teleportTo` : validation `dnd5e.teleport`, puis « blink »).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PURSUIT = "Compendium.dnd-monster-manual.actors.Actor.mmNalfeshnee0000.Item.mmPursuit0000000";
const TREE = "Compendium.dnd-monster-manual.actors.Actor.mmDryad000000000.Item.mmTreeStride0000";

export default {
  name: "repasse-teleport-contrainte — destination contrainte : Poursuite, Marche des arbres (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = uuid;
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    ctx.restore(async () => {
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const start = { x: home.x, y: home.y + 2 * grid };
    const jumpTo = async (itemId, to) => {
      const from = await ctx.position(caster);
      const r = await ctx.engine("teleport", { tokenId: caster.id, itemId, ...to }).catch(err => ({ error: err.message }));
      await pause(1500);
      const at = await ctx.position(caster);
      return { accepted: !!r?.accepted, arrived: (at.x === to.x) && (at.y === to.y), still: (at.x === from.x) && (at.y === from.y), error: r?.error ?? null };
    };

    // Poursuite : près de la Cible, puis loin de tout le monde.
    const pursuit = await lend(PURSUIT);
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await pause(800);
    const t = await ctx.position(target);
    const near = await jumpTo(pursuit, { x: t.x, y: t.y - grid });
    ctx.expect(!near.error, `la Poursuite est reconnue comme téléportation de soi${near.error ? ` (${near.error})` : ""}`);
    ctx.expect(near.accepted && near.arrived, "au contact de la Cible : téléporté");
    // Une case à l'écart (rangée 18, colonne 20 de l'arène) : à plus de 3 m de toute créature, à moins de 120 ft.
    const lonely = await jumpTo(pursuit, { x: 20 * grid, y: 18 * grid });
    ctx.expect(!lonely.accepted && lonely.still, "loin de toute créature : refusé, reste sur place");

    // Marche des arbres : 70 ft au plus.
    const tree = await lend(TREE);
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await pause(800);
    const ok = await jumpTo(tree, { x: start.x + 13 * grid, y: start.y });
    ctx.expect(!ok.error, `la Marche des arbres est reconnue${ok.error ? ` (${ok.error})` : ""}`);
    ctx.expect(ok.accepted && ok.arrived, "13 cases (65 ft, limite 70 ft) : téléporté");
    const from = await ctx.position(caster);
    const tooFar = await jumpTo(tree, { x: from.x + 15 * grid, y: from.y });
    ctx.expect(!tooFar.accepted && tooFar.still, "15 cases (75 ft) : refusé, reste sur place");
  }
};
