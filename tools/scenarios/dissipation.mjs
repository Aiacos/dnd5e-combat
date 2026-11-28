/**
 * Dispel Magic (SPEC §37.2), `dnd-6` world. The Cleric receives Dispel Magic and Bless (Player's Handbook, at will, nothing
 * consumed); it blesses the Fighter, then dispels on them (the effect is recognized as the only new one on the Fighter: its
 * name is translated). Checks:
 *  - Bless cast at level 1, Dispel Magic at level 3: it ends automatically, the Cleric's concentration ends with it;
 *  - Bless cast at level 4, Dispel Magic at level 3: check against DC 14 — ends ⇔ check succeeded (`dispel` card);
 *  - Bless at level 4, Dispel Magic at level 4: ends automatically.
 * Restores effects and concentration.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "dissipation de la magie — d'office, par un test, par l'emplacement",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const atWill = { system: { method: "atwill" } };
    const dispelId = await ctx.ensureItem(cleric, PHB + "phbsplDispelMagi", atWill);
    const blessId = await ctx.ensureItem(cleric, PHB + "phbsplBless00000", atWill);

    const effects0 = new Map();
    for ( const t of [cleric, fighter] ) effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura);
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
    };
    const reset = async () => { for ( const t of [fighter, cleric] ) await clearNew(t); await pause(600); };
    ctx.restore(reset);
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const slot = level => ({ spell: { slot: `spell${level}` } });
    const bless = async level => {
      const used = await ctx.use({ tokenId: cleric.id, itemId: blessId, consume: false, targetTokenIds: [fighter.id], usageConfig: slot(level) });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      const on = (await added(fighter));
      const conc = (await added(cleric)).filter(e => (e.statuses ?? []).includes("concentrating"));
      return { on, conc };
    };
    const dispel = async level => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: cleric.id, itemId: dispelId, consume: false, targetTokenIds: [fighter.id], usageConfig: slot(level) });
      let card = null;
      for ( const stop = Date.now() + 15000; !card && (Date.now() < stop); await pause(700) ) {
        card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.dispel)?.flags?.[MODULE_ID]?.dispel ?? null;
      }
      await pause(1000);
      return card;
    };

    await part("d'office", async () => {
      const cast = await bless(1);
      if ( !ctx.expect(cast.on.length === 1 && cast.conc.length === 1, `Bénédiction posée (${cast.on.length}), le Clerc se concentre (${cast.conc.length})`) ) return;
      const card = await dispel(3);
      ctx.expect(card?.ended?.length === 1 && !card.resisted.length, `carte : cesse ${JSON.stringify(card?.ended)}, résiste ${JSON.stringify(card?.resisted)}`);
      const left = (await added(fighter));
      const conc = (await added(cleric)).filter(e => (e.statuses ?? []).includes("concentrating"));
      ctx.expect(!left.length && !conc.length, `Bénédiction retirée (${left.length}), concentration du Clerc tombée (${conc.length})`);
    });

    await part("par un test", async () => {
      const seen = { ended: false, resisted: false };
      for ( let n = 1; (n <= 12) && !(seen.ended && seen.resisted); n++ ) {
        await reset();
        const cast = await bless(4);
        if ( !cast.on.length ) { ctx.expect(false, "Bénédiction au niveau 4 posée"); return; }
        const card = await dispel(3);
        const r = card?.resisted?.[0] ?? null;
        const e = card?.ended?.[0] ?? null;
        const still = (await added(fighter)).length > 0;
        if ( e ) {
          seen.ended = true;
          ctx.expect((e.level === 4) && (e.total >= 14) && !still, `niveau ${e.level}, test ${e.total} ≥ DD 14 : cesse (reste ${still})`);
        } else if ( r ) {
          seen.resisted = true;
          ctx.expect((r.level === 4) && (r.dc === 14) && (r.total < 14) && still, `niveau ${r.level}, test ${r.total} < DD ${r.dc} : résiste (reste ${still})`);
        } else ctx.expect(false, `carte de Dissipation lue (${JSON.stringify(card)})`);
      }
      ctx.log(`issues vues : cesse ${seen.ended}, résiste ${seen.resisted}`);
      ctx.expect(seen.ended || seen.resisted, "au moins une issue du test vue");
    });

    await part("par l'emplacement", async () => {
      const cast = await bless(4);
      if ( !ctx.expect(cast.on.length === 1, "Bénédiction au niveau 4 posée") ) return;
      const card = await dispel(4);
      ctx.expect(card?.slot === 4 && card?.ended?.[0]?.level === 4 && card.ended[0].total === null, `Dissipation au niveau 4 : cesse d'office (${JSON.stringify(card?.ended)})`);
    });
  }
};
