/**
 * Bestiary, SPEC §18.4 — what a monster attack carries on a hit, read in the item's shape, without declared content.
 * World `ravenloft` (the Wolves and the Brown Bear of the Monster Manual, translated by Babele: the reading goes through French).
 *  - M3, size gate: the Wolf's Bite knocks Prone "a creature of Medium size or smaller". On a hit, the Zombie (M)
 *    falls; the Brown Bear (L) stays standing.
 *  - M2, sister saving throw: the Ghoul's Claws (lent to the Wolf for the scenario) impose a Constitution
 *    saving throw on a hit; failed → Paralyzed, succeeded → nothing.
 * The rolls are random: replayed until a hit (20 attempts at most).
 */
const GHOUL = "Compendium.dnd-monster-manual.actors.Actor.mmGhoul000000000";

export default {
  name: "attaques de monstre — porte de taille (M3) et sauvegarde sœur (M2)",

  async run(ctx) {
    // Absent from `dnd-6`: placed for the scenario from their sheet (Monster Manual 2024, otherwise dnd5e's 2024 SRD).
    await ctx.cast({ "Loup": "mmWolf0000000000", "Ours brun": "mmBrownBear00000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi", "Ours brun"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup, Zombi ou Ours brun absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const bear = await ctx.token("Ours brun");
    const grid = await ctx.gridSize();
    const at = await ctx.position(wolf);
    for ( const t of [zombi, bear] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => ctx.removeStatusEffects(t, "prone"));
      ctx.restore(() => ctx.removeStatusEffects(t, "paralyzed"));
      await ctx.removeStatusEffects(t, "prone");
      await ctx.removeStatusEffects(t, "paralyzed");
    }
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: bear.id, x: at.x - 2 * grid, y: at.y, elevation: at.elevation });
    const statuses = async t => new Set((await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []));

    /** Attacks until a hit; returns the hit resolution. */
    const hitWith = async (itemId, target, label) => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(target, 100);
        const used = await ctx.use({ tokenId: wolf.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { "dnd5e-combat": { saveChoice: "best" } } });
        const r = await ctx.settle(used.usageMessageId);
        const t = r.targets.find(x => x.token?.endsWith(target.id));
        if ( t?.hit ) return { r, t };
        await new Promise(res => setTimeout(res, 300));
      }
      ctx.expect(false, `${label} : aucun toucher en 20 essais`);
      return null;
    };

    // M3 — Morsure du Loup.
    const bite = await ctx.itemId(wolf.id, "bite");
    const onZombi = await hitWith(bite, zombi, "Morsure → Zombi");
    if ( onZombi ) {
      const gate = onZombi.r.plan.effects.find(e => e.if)?.if ?? null;
      ctx.expect(/"target\.sizeAtMost":"med"/.test(gate ?? ""), `le plan porte la porte de taille « M ou inférieure » (${gate})`);
      await new Promise(res => setTimeout(res, 800));
      ctx.expect((await statuses(zombi)).has("prone"), "Zombi (M) mordu : À terre");
    }
    const onBear = await hitWith(bite, bear, "Morsure → Ours brun");
    if ( onBear ) {
      await new Promise(res => setTimeout(res, 800));
      ctx.expect(!(await statuses(bear)).has("prone"), "Ours brun (G) mordu : reste debout");
    }

    // M2 — Ghoul's Claws, lent to the Wolf.
    const { data: ghoul } = await ctx.call("get-compendium-entry", { uuid: GHOUL });
    const claw = ghoul.items.find(i => i.system?.identifier === "claw");
    const { _id, folder, ownership, _stats, ...itemData } = claw;
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const r = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "claw" } });
    const clawId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(wolf.id, "claw"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: clawId }).catch(() => {}));

    let seen = { failed: false, saved: false };
    for ( let i = 0; (i < 8) && !(seen.failed && seen.saved); i++ ) {
      await ctx.removeStatusEffects(bear, "paralyzed");
      const got = await hitWith(clawId, bear, "Griffe de Goule → Ours brun");
      if ( !got ) break;
      const { r: res, t } = got;
      if ( i === 0 ) ctx.expect(res.plan.save?.chained === true, `la Griffe enchaîne sa sauvegarde (${res.plan.save?.abilities?.join("/")} DD ${res.plan.save?.dc})`);
      await new Promise(res => setTimeout(res, 800));
      const paralyzed = (await statuses(bear)).has("paralyzed");
      if ( t.save?.success === false ) {
        if ( !seen.failed ) ctx.expect(paralyzed, `sauvegarde ratée (${t.save.total}) : l'Ours brun est Paralysé`);
        seen.failed = true;
      } else if ( t.save?.success === true ) {
        if ( !seen.saved ) ctx.expect(!paralyzed, `sauvegarde réussie (${t.save.total}) : pas de Paralysie`);
        seen.saved = true;
      } else ctx.expect(false, `sauvegarde absente de la résolution (${JSON.stringify(t.save)})`);
    }
  }
};
