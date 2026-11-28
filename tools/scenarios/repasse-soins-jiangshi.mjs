/**
 * §460 (sort of the ATLAS healing): Jiangshi's Drain Energy (Ravenloft) — the `lifesteal` brick on a creature ability
 * with a saving throw. Spell arena: the Caster (NPC) receives the ability lent from the compendium sheet, casts it on the Target
 * (999 HP); on a failure as on a success, it regains as much HP as the necrotic damage the Target took.
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

    // 3 cells from the Target (range 30 ft), the Caster at 1 HP so that the healing shows.
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
