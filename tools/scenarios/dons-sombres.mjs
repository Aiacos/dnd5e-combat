/**
 * §93 — Ravenloft dark feats (premium module `dnd-ravenloft-horrors-within`): "just after making a D20 Test and getting a
 * 1 on the d20". The Fighter receives the feats, lent from the `options` pack.
 *  - Aberrant Anatomy: Athletics checks until a natural 1 (the real roll) — the Constitution save goes off, Stunned ⇔
 *    failed.
 *  - Watchers (triggered by `api.mcp.naturalOne`): Wisdom until a failure; Paranoia: a check at Disadvantage, an attack at
 *    Disadvantage; at the end of the Fighter's turn, the save replayed.
 *  - Symbiotic Being: Charisma until a failure; Charmed; wounded, the save replayed.
 */
const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Dons sombres — 1 naturel (Anatomie aberrante, Guetteurs, Être symbiotique)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const lend = async id => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {});
      ctx.restore(remove);
      await pause(1000);
      return remove;
    };
    const clear = async () => {
      for ( const s of ["stunned", "charmed", "incapacitated"] ) await ctx.removeStatusEffects(fighter, s);
      await ctx.removeEffectsNamed(fighter, /Warping|Chair|Parano|Symbiot|Dessein/i);
    };
    ctx.restore(clear);
    const saveOf = async since => {
      const msg = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resolution);
      return msg ? await ctx.settle(msg.id, { timeoutMs: 45000 }).catch(() => null) : null;
    };
    const has = async re => (await ctx.effects(fighter)).some(e => !e.disabled && re.test(e.name ?? ""));
    const hasStatus = async s => (await ctx.effects(fighter)).some(e => !e.disabled && (e.statuses ?? []).includes(s));

    // 1. Anatomie aberrante, par un vrai 1 naturel.
    const dropAberrant = await lend("rhwAberrantAnato");
    let one = null;
    for ( let n = 0; (n < 150) && !one; n++ ) {
      const since = await ctx.lastMessageId();
      const r = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
      if ( r?.d20 === 1 ) one = { since, r };
    }
    if ( ctx.expect(!!one, "un 1 naturel au test d'Athlétisme (150 jets au plus)") ) {
      await pause(2500);
      const res = await saveOf(one.since);
      const t = res?.targets?.find(x => x.name === "Guerrier");
      await pause(1200);
      ctx.expect(res?.plan?.save?.ability === "con" && !!t?.save, `Chair déformante : Constitution du Guerrier (${t?.save?.total} contre DD ${res?.plan?.save?.dc})`);
      ctx.expect((await hasStatus("stunned")) === (t?.save?.success === false), `Étourdi ⇔ ratée (${t?.save?.success ? "réussie" : "ratée"})`);
    }
    // Pas de 1 : rien.
    await clear();
    let other = null;
    for ( let n = 0; (n < 10) && !other; n++ ) {
      const since = await ctx.lastMessageId();
      const r = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
      if ( (r?.d20 ?? 1) > 1 ) other = since;
      // Another 1: its save (and its chain) arrives later — awaited before the next roll, so as not to attribute it to that one.
      else { await pause(5000); await clear(); }
    }
    await pause(2000);
    ctx.expect(!!other && !(await saveOf(other)), "un autre résultat : aucune sauvegarde");
    await clear();
    await dropAberrant();

    // 2. Guetteurs.
    const dropWatchers = await lend("rhwWatchersGH8OL");
    let paranoid = false;
    for ( let n = 0; (n < 15) && !paranoid; n++ ) {
      await clear();
      const since = await ctx.lastMessageId();
      await ctx.engine("naturalOne", { tokenId: fighter.id });
      await pause(2500);
      const res = await saveOf(since);
      await pause(1200);
      paranoid = await has(/Parano/i);
      if ( n === 0 ) ctx.expect(res?.plan?.save?.ability === "wis", `Guetteurs : sauvegarde de Sagesse (DD ${res?.plan?.save?.dc})`);
    }
    if ( ctx.expect(paranoid, "Paranoïa (15 essais au plus)") ) {
      const check = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
      ctx.expect(/dis|kl/.test(check?.formula ?? ""), `test au Désavantage (${check?.formula})`);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "greatsword"), activityType: "attack", targetTokenIds: [bandit.id] });
      await pause(4000);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      ctx.expect(attack?.rolls?.[0]?.options?.advantageMode === -1, `attaque au Désavantage (mode ${attack?.rolls?.[0]?.options?.advantageMode})`);
      await ctx.startCombat([fighter, bandit]);
      const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
      const combat = await state();
      for ( const [t, v] of [[fighter, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
      for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      const s2 = await ctx.lastMessageId();
      await ctx.nextTurn(); await pause(4000);
      const resave = (await ctx.messagesSince(s2)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);
      ctx.expect(!!resave, "fin du tour du Guerrier : la sauvegarde rejouée");
      if ( resave ) {
        const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Guerrier");
        await pause(1500);
        ctx.expect((await has(/Parano/i)) === (t?.save?.success !== true), `Paranoïa ${t?.save?.success ? "levée" : "maintenue"} (${t?.save?.total})`);
      }
    }
    await clear();
    await dropWatchers();

    // 3. Symbiotic Being.
    await lend("rhwSymbioticBein");
    let charmed = false;
    for ( let n = 0; (n < 15) && !charmed; n++ ) {
      await clear();
      const since = await ctx.lastMessageId();
      await ctx.engine("naturalOne", { tokenId: fighter.id });
      await pause(2500);
      await saveOf(since);
      await pause(1200);
      charmed = await hasStatus("charmed");
    }
    if ( ctx.expect(charmed, "Dessein symbiotique : Charmé (15 essais au plus)") ) {
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: fighter.id, amount: 2 });
      await pause(4000);
      const resave = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);
      ctx.expect(!!resave, "blessé : la sauvegarde rejouée");
    }
  }
};
