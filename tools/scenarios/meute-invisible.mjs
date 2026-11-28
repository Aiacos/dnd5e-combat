/**
 * §368 (issue #30), world `dnd-6`, arena. Summon Beast: "whenever the pack moves within 10 feet of a creature
 * you can see" — the caster must see the creature.
 *  - the Invisible Zombie: the pack arrives next to it → no saving throw (journal "not seen by the caster");
 *  - the Wizard under See Invisibility: same passage → the pack's saving throw (areaTick `pulse`).
 * In combat (360° vision, no cone). Restores positions, HP, effects, combat; the pack is removed.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Invocation d'animaux — la meute épargne une créature que le lanceur ne voit pas",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, zombi];
    const grid = await ctx.gridSize();
    const sceneId = (await ctx.scene()).sceneId;
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const tokens0 = new Set(tokens.map(t => t.id));
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.[MODULE_ID]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: false }).catch(() => {});
      await ctx.removeStatusEffects(zombi, "invisible").catch(() => {});
      for ( const t of all ) await clearNew(t);
      await pause(2000);
      for ( const t of await ctx.liveTokens() ) if ( !tokens0.has(t.id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const settled = async used => { if ( used?.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null); await pause(2000); };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 10 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };

    /** The pack placed 5 cells east of the Zombie, then moved next to it: did the saving throw take place? */
    const packPasses = async label => {
      const id = await lend("phbsplConjureAni");
      const z = await ctx.position(zombi);
      const s = await ctx.engine("summonAt", { tokenId: mage.id, itemId: id, x: z.x + 5 * grid, y: z.y });
      await pause(2500);
      const pack = s?.tokens?.[0];
      if ( !ctx.expect(!!pack, `${label} : meute invoquée (${pack?.name ?? "rien"})`) ) return null;
      const since = await ctx.lastMessageId();
      const logBefore = (await ctx.engineLog()).length;
      await ctx.call("move-token", { tokenId: pack.id, x: z.x + grid, y: z.y, elevation: 0 });
      await pause(5000);
      // Only the Zombie's saving throw counts: another token of the arena (the Bandit) may be within the pack's range.
      const onZombi = m => [...(m.targets ?? []), ...(m.flags?.[MODULE_ID]?.resolution?.targets ?? [])].some(t => String(t.token ?? "").endsWith(zombi.id));
      const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "pulse") && onZombi(m));
      const skipped = (await ctx.engineLog()).slice(logBefore).some(l => /Zombi not seen by the caster/.test(l));
      return { tick: !!tick, skipped };
    };

    await part("Zombi Invisible", async () => {
      if ( !ctx.expect(await fight([mage, zombi]), "Invisible : tour du Magicien") ) return;
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });
      await pause(1000);
      const r = await packPasses("Invisible");
      if ( !r ) return;
      ctx.expect(!r.tick && r.skipped, `Invisible : pas de sauvegarde (sauvegarde ${r.tick ? "jouée" : "aucune"}, journal ${r.skipped ? "« non vu »" : "muet"})`);
    });

    await part("Détection de l'invisibilité", async () => {
      if ( !ctx.expect(await fight([mage, zombi]), "Détection : tour du Magicien") ) return;
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });
      const see = await lend("phbsplSeeInvisib");
      await settled(await ctx.use({ tokenId: mage.id, itemId: see, targetTokenIds: [mage.id], consume: false }));
      const r = await packPasses("Détection");
      if ( !r ) return;
      ctx.expect(r.tick, `Détection : le lanceur voit le Zombi Invisible → la sauvegarde de la meute (${r.tick ? "jouée" : "aucune"})`);
    });
  }
};
