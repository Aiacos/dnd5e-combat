/**
 * §466 : les poussées et tractions que K8 (§329) ne lisait pas, lues dans le texte des monstres. Arène des sorts : le Lanceur (PNJ) et la
 * Cible, capacités prêtées depuis les compendiums.
 *  - Tentacule du Calmar géant (MM) : au toucher, « peut tirer la cible jusqu'à 3 m vers lui » — l'auteur choisit la distance ; on répond
 *    1,50 m : la Cible avance d'une case ;
 *  - Saut mortel de la Bulette (MM) : sur une sauvegarde RÉUSSIE, « repoussée de 1,50 m » : la Cible recule d'une case ;
 *  - Implosion de l'Inquisiteur du Tome (Ravenloft) : sur un échec, « tirée jusqu'à 6 m vers le centre de la Sphère » : la Cible, à 3 cases
 *    du centre, finit sur la case du centre.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const TENTACLE = "Compendium.dnd-monster-manual.actors.Actor.mmGiantSquid0000.Item.mmTentacle000000";
const LEAP = "Compendium.dnd-monster-manual.actors.Actor.mmBulette0000000.Item.mmDeadlyLeap0000";
const IMPLODE = "Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwTomeInquisito.Item.wLtBYXWmm2gZnzn4";

export default {
  name: "repasse-k8c — poussées que K8 ne lisait pas : Tentacule, Saut mortel, Implosion (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target] ) homes.set(t.id, await ctx.position(t));
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = uuid;
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const clear = async () => {
      for ( const s of ["grappled", "prone"] ) await ctx.call("set-status", { tokenId: target.id, statusId: s, active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      for ( const t of [caster, target] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
    });
    // Deux rangées sous leur place : le Lanceur, la Cible à `gap` cases à l'est.
    const base = { x: homes.get(caster.id).x, y: homes.get(caster.id).y + 2 * grid };
    const place = async (gap, shift=0) => {
      await clear();
      const x0 = base.x + shift * grid;
      await ctx.call("move-token", { tokenId: caster.id, x: x0, y: base.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: target.id, x: x0 + gap * grid, y: base.y, elevation: 0 });
      await ctx.setHp(target, 999);
      await pause(800);
      return { x: x0 + gap * grid, y: base.y };
    };
    const column = async t0 => Math.round(((await ctx.position(target)).x - t0.x) / grid);
    // La question « jusqu'où ? » de l'auteur : on prend la deuxième option (1,50 m ; la première est la distance entière).
    const answering = async (settle) => {
      let done = false;
      const p = settle.finally(() => { done = true; });
      const seen = [];
      for ( let after = 0; after < 3; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          if ( seen.includes(d.id) || !(d.buttons ?? []).some(b => b.action === "pick1") ) continue;
          seen.push(d.id);
          await ctx.call("answer-dialog", { id: d.id, button: "pick1" }).catch(() => {});
        }
        if ( done ) after++;
      }
      return { result: await p, asked: seen.length };
    };

    // Tentacule : au toucher, tirée « jusqu'à » 10 ft — on choisit 5 ft.
    const tentacle = await lend(TENTACLE);
    let checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      const t0 = await place(3);
      const u = await ctx.use({ tokenId: caster.id, itemId: tentacle, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      const { result: r, asked } = await answering(ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null));
      if ( r?.targets?.find(x => x.name === "Cible")?.hit !== true ) continue;
      await pause(2500);
      ctx.expect(asked > 0, "la distance de la traction est demandée à l'auteur");
      const n = await column(t0);
      ctx.expect(n === -1, `Tentacule, touché, 1,50 m choisi : la Cible avance d'une case vers le Lanceur (${n})`);
      checked = true;
    }
    ctx.expect(checked, "le Tentacule touche (20 essais au plus)");

    // Saut mortel : la poussée de la réussite.
    const leap = await lend(LEAP);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      const t0 = await place(1);
      // L'activité a une zone (la ligne du saut, sans pose demandée) : posée sur la case de la Cible — l'espace d'arrivée de la Bulette.
      const u = await ctx.use({ tokenId: caster.id, itemId: leap, activityType: "save", consume: false,
        area: { shape: "circle", x: t0.x + grid / 2, y: t0.y + grid / 2, radius: grid / 2 } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const save = r?.targets?.find(x => x.name === "Cible")?.save;
      await pause(2500);
      const n = await column(t0);
      if ( save?.success === false ) { ctx.expect(n === 0, `Saut mortel, échec : pas de poussée (${n})`); continue; }
      if ( save?.success !== true ) continue;
      ctx.expect(n === 1, `Saut mortel, réussite : la Cible est repoussée d'une case (${n})`);
      checked = true;
    }
    ctx.expect(checked, "la Cible réussit la sauvegarde du Saut mortel (20 essais au plus)");

    // Implosion : vers le centre de la Sphère.
    if ( !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Ravenloft absent : Implosion non jouée"); return; }
    const implode = await lend(IMPLODE);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      // 15 colonnes plus à l'est (une partie vide de l'arène : la Sphère ne prend que la Cible — une autre créature tirée vers le centre
      // l'y précéderait et l'arrêterait). La Cible à 2 cases du Lanceur ; le centre de la Sphère 3 cases plus à l'est (rayon 4 cases).
      const t0 = await place(2, 15);
      const center = { x: t0.x + 3 * grid + grid / 2, y: t0.y + grid / 2 };
      const u = await ctx.use({ tokenId: caster.id, itemId: implode, activityType: "save", consume: false,
        area: { shape: "circle", x: center.x, y: center.y, radius: 4 * grid } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
      await pause(2500);
      const n = await column(t0);
      ctx.expect(n === 3, `Implosion, échec : la Cible est tirée jusqu'au centre de la Sphère (${n} case(s), 3 attendues)`);
      checked = true;
    }
    ctx.expect(checked, "la Cible rate la sauvegarde de l'Implosion (20 essais au plus)");
  }
};

