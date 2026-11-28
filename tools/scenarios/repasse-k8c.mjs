/**
 * §466: the pushes and pulls that K8 (§329) did not read, read in the monsters' text. Spell arena: the Caster (NPC) and the
 * Target, abilities borrowed from the compendia.
 *  - Giant Squid's Tentacle (MM): on a hit, "can pull the target up to 10 feet toward it" — the author chooses the distance; we
 *    answer 5 ft: the Target moves forward one cell;
 *  - Bulette's Deadly Leap (MM): on a SUCCESSFUL saving throw, "pushed 5 feet": the Target moves back one cell;
 *  - Tome Inquisitor's Implosion (Ravenloft): on a failure, "pulled up to 20 feet toward the center of the Sphere": the Target,
 *    3 cells from the center, ends on the center cell.
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
    // Two rows below their place: the Caster, the Target `gap` cells to the east.
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
    // The author's "how far?" question: we take the second option (5 ft; the first is the whole distance).
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

    // Tentacle: on a hit, pulled "up to" 10 ft — we choose 5 ft.
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

    // Deadly Leap: the push of the success.
    const leap = await lend(LEAP);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      const t0 = await place(1);
      // The activity has an area (the leap's Line, no placement asked): placed on the Target's cell — the Bulette's arrival space.
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

    // Implosion: toward the center of the Sphere.
    if ( !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Ravenloft absent : Implosion non jouée"); return; }
    const implode = await lend(IMPLODE);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      // 15 columns further east (an empty part of the arena: the Sphere only takes the Target — another creature pulled toward the
      // center would get there first and stop it). The Target 2 cells from the Caster; the Sphere's center 3 cells further
      // east (radius 4 cells).
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

