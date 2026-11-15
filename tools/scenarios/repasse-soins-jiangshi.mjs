/**
 * §460 (tri des soins de l'ATLAS) : Absorption d'énergie du Jiangshi (Ravenloft) — la brique `lifesteal` sur une capacité de créature
 * à sauvegarde. Arène des sorts : le Lanceur (PNJ) reçoit la capacité prêtée depuis la fiche du compendium, la lance sur la Cible
 * (999 PV) ; sur un échec comme sur une réussite, il regagne autant de PV que les dégâts nécrotiques que la Cible a subis.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const UUID = "Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwJiangshi00000.Item.EBwI0WJR4ZA02Kwa";
const SAVE = "vqUPNibCkXperEoA";

export default {
  name: "repasse-soins — Absorption d'énergie du Jiangshi : soin égal aux dégâts nécrotiques (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Ravenloft absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const home = await ctx.position(caster);
    const casterHp = await ctx.hp(caster);
    const max = (await ctx.call("get-actor", { actorId: caster.actorId })).system?.attributes?.hp?.max ?? casterHp;

    const { data } = await ctx.call("get-compendium-entry", { uuid: UUID });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = UUID;
    const lent = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: UUID } });
    ctx.restore(async () => {
      await ctx.setHp(caster, casterHp).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: lent.id }).catch(() => {});
    });

    // À 3 cases de la Cible (portée 30 ft), le Lanceur à 1 PV pour que le soin se voie.
    const t = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t.x - 3 * ARENE_SORTS.grid, y: t.y, elevation: 0 });
    await ctx.setHp(target, 999);
    await ctx.setHp(caster, 1);
    await pause(800);

    const u = await ctx.use({ tokenId: caster.id, itemId: lent.id, activityId: SAVE, activityType: "save", targetTokenIds: [target.id], consume: false });
    if ( !ctx.expect(u.used, "Absorption d'énergie utilisée") ) return;
    await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(2000);
    const dealt = 999 - await ctx.hp(target);
    const healed = await ctx.hp(caster) - 1;
    ctx.expect(dealt > 0, `la Cible subit des dégâts nécrotiques (${dealt})`);
    ctx.expect(healed === Math.min(dealt, max - 1), `le Lanceur regagne autant de PV que les dégâts subis (+${healed} pour ${dealt}, maximum ${max})`);
  }
};
