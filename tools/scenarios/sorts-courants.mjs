/**
 * §283: work items of 2026-10-30, batch 1 (common spells), world `dnd-6`, Test Arena. The Cleric receives the spells of the
 * Player's Handbook (at will, nothing consumed) and casts them on the Zombie. Checks:
 *  - Otiluke's Freezing Sphere: its damage (with no type in the data) is rolled as cold;
 *  - Contagion: on a failed saving throw, a drain effect reduces the HP maximum by the necrotic damage taken, without
 *    taking it below 1; on a success, no drain;
 *  - Slow: the Cleric carries the effect of his own spell; each Fire Bolt (somatic component) goes through a d100 shown in the
 *    chat — failure (1 to 25): nothing is cast; otherwise the attack happens. Both outcomes seen in 30 tries at most.
 * "Enchanted Eruption" has nothing to check here: the Handbook's data already carries the exploding die (`1d8x@mod=8`,
 * dnd5e increases it with the level). Puts back HP, effects, areas.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { sphere: "phbsplOtilukesFr", harm: "phbsplHarm000000", slow: "phbsplSlow000000", bolt: "phbsplFireBolt00" };

export default {
  name: "sorts courants — Sphère glacée d'Otiluke, Contamination, Lenteur (échec des sorts somatiques)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Zombi requis : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const zhp = await ctx.hp(zombi);
    const { data: ctok } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
    const { data: ztok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const zombiTarget = ztok.actorLink ? { documentType: "Actor", id: ztok.actorId }
      : { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombi.id}.Actor.${ztok.actorId}` };
    const effects0 = new Set((await ctx.effects(zombi)).map(e => e._id ?? e.id));
    const regions = [];
    const clearZombi = async () => {
      for ( const e of await ctx.effects(zombi) ) {
        if ( !effects0.has(e._id ?? e.id) ) await ctx.call("remove-embedded-effect", { ...zombiTarget, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await clearZombi();
      await ctx.setHp(zombi, zhp);
    });
    // Le maximum en vigueur : le drain passe par `hp.tempmax` (adapter/drain.mjs).
    const maxHp = async t => { const hp = (await ctx.engine("stats", { tokenId: t.id }))?.hp; return hp ? (hp.max + (hp.tempmax ?? 0)) : null; };

    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await clearZombi(); await ctx.setHp(zombi, zhp); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Casts a Cleric spell; `roll`: the author's expected damage roll (card click). */
    const cast = async (key, { roll=false, ...extra }={}) => {
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: cleric.id, itemId: ids[key], consume: false, ...extra });
      if ( used?.regionId ) regions.push(used.regionId);
      if ( roll && used?.usageMessageId ) { await pause(800); await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null); }
      const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { used, r, msgs: await ctx.messagesSince(since) };
    };

    await part("Sphère glacée", async () => {
      const z = await ctx.position(zombi);
      const { msgs } = await cast("sphere", { roll: true, activityId: "adCBWrctRmLQmb8M",
        area: { shape: "circle", x: z.x + grid / 2, y: z.y + grid / 2, radius: grid } });
      const damage = msgs.find(m => m.type === "damage");
      const types = (damage?.rolls ?? []).map(r => r.options?.type);
      ctx.expect(!!damage && types.length && types.every(t => t === "cold"), `dégâts roulés en froid (${types.join(", ") || "aucun jet"})`);
    });

    await part("Contamination", async () => {
      const max0 = await maxHp(zombi);
      const seen = { failed: false, saved: false };
      for ( let n = 1; (n <= 15) && !(seen.failed && seen.saved); n++ ) {
        await clearZombi();
        await ctx.setHp(zombi, zhp);
        const before = await ctx.hp(zombi);
        const { r } = await cast("harm", { roll: true, targetTokenIds: [zombi.id] });
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( !t?.save ) continue;
        await pause(800);
        const drain = (await ctx.effects(zombi)).find(e => e.flags?.[MODULE_ID]?.drain?.kind === "hp");
        const taken = before - (await ctx.hp(zombi));
        const max = await maxHp(zombi);
        if ( t.save.success ) {
          if ( seen.saved ) continue;
          seen.saved = true;
          ctx.expect(!drain, `sauvegarde réussie (${t.save.total}) : pas de drain (${taken} PV perdus)`);
        } else {
          if ( seen.failed ) continue;
          seen.failed = true;
          const total = drain?.flags?.[MODULE_ID]?.drain?.total;
          ctx.expect(!!drain && (total === Math.min(taken, max0 - 1)), `sauvegarde ratée (${t.save.total}) : maximum réduit de ${total} = dégâts subis ${taken}`);
          ctx.expect(Number.isFinite(max) && (max >= 1) && (max === max0 - (total ?? 0)), `maximum de PV ${max0} → ${max} (jamais sous 1)`);
        }
      }
      ctx.expect(seen.failed && seen.saved, `les deux issues vues (ratée : ${seen.failed}, réussie : ${seen.saved})`);
    });

    await part("Lenteur", async () => {
      // L'effet de Lenteur sur le Clerc, venu de son propre sort.
      const slowUuid = `Actor.${ctok.actorId}.Item.${ids.slow}`;
      const r = await ctx.call("upsert-embedded-effect", { documentType: "Actor", id: ctok.actorId, effectData: {
        name: "Essai : Lenteur", img: "icons/svg/clockwork.svg", origin: slowUuid, transfer: false } });
      const effectId = r?.effectId ?? r?.id ?? r?.effect?._id;
      ctx.restore(() => ctx.call("remove-embedded-effect", { documentType: "Actor", id: ctok.actorId, effectId }).catch(() => {}));
      const seen = { failed: false, passed: false };
      for ( let n = 1; (n <= 30) && !(seen.failed && seen.passed); n++ ) {
        // The connector hands control back as soon as the gate suspends the use: the rest is read in the chat.
        const before = await ctx.lastMessageId();
        await ctx.use({ tokenId: cleric.id, itemId: ids.bolt, consume: false, targetTokenIds: [zombi.id] });
        let gate = null;
        for ( const until = Date.now() + 20000; (Date.now() < until) && !gate; ) {
          await pause(700);
          gate = (await ctx.messagesSince(before)).map(m => m.flags?.[MODULE_ID]?.gate ?? m.flags?.gate).find(g => g?.kind === "spellFailure") ?? null;
        }
        if ( !gate ) { ctx.expect(false, `essai ${n} : aucun d100 de Lenteur`); break; }
        await pause(3000);
        const attack = (await ctx.messagesSince(before)).some(m => m.type === "attack");
        const key = gate.failed ? "failed" : "passed";
        if ( seen[key] ) continue;
        seen[key] = true;
        ctx.expect(gate.failed === (gate.roll <= 25), `d100 ${gate.roll} : ${gate.failed ? "le sort échoue" : "le sort passe"} (échec jusqu'à ${gate.chance})`);
        ctx.expect(attack === !gate.failed, `${gate.failed ? "aucune attaque" : "l'attaque a lieu"} (${attack ? "attaque vue" : "pas d'attaque"})`);
      }
      ctx.expect(seen.failed && seen.passed, `les deux issues vues (échec : ${seen.failed}, passe : ${seen.passed})`);
    });
  }
};
