/**
 * Spell survey, batch 3: auras and summons that act (SPEC §159), world `dnd-6`, arena. Spells lent from the Player's
 * Handbook (at will); summons placed by `api.mcp.summonAt`.
 *  - Crusader's Mantle, Aura of Purity: cast with the Fighter far away; he enters within 1.50 m of the Paladin → the aura's
 *    copy; he leaves → it goes away;
 *  - Aura of Life (combat): the Fighter at 0 HP in the aura starts his turn → 1 HP;
 *  - Find Steed, Mordenkainen's Sword: the summon enters combat right after the caster;
 *  - Guardian of Faith: the Zombie starts its turn 3 m from the guardian → its save (areaTick `pulse`);
 *  - Mordenkainen's Faithful Hound: at the start of the Wizard's turn, the hound bites the Zombie at 1.50 m (areaTick `pulse`).
 * Restores positions, HP, effects, summons, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 3 — auras et invocations",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Paladin", "Guerrier", "Clerc", "Magicien", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [pal, fighter, cleric, mage, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [pal, fighter, cleric, mage, zombi];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async (t, only=null) => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura && (!only || only(e))) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const tokens0 = new Set(tokens.map(t => t.id));
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      // §438: concentrations first — their end removes the area, and dnd5e then removes the effects of its behavior itself
      // (Handbook 3.0.0 auras); removing them at the same time caused a "does not exist" error on the GM's side.
      for ( const t of all ) await clearNew(t, e => (e.statuses ?? []).includes("concentrating") || /^Concentrat/i.test(e.name ?? ""));
      await pause(1500);
      for ( const t of all ) await clearNew(t);   // the caster's concentration takes its summons with it
      await pause(1500);
      for ( const t of await ctx.liveTokens() ) if ( !tokens0.has(t.id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
        for ( const s of ["unconscious", "prone", "dead"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
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
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3000); };
    const move = async (t, dx, dy) => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: t.id, x: p.x + dx * grid, y: p.y + dy * grid, elevation: 0 });
      await pause(2500);
    };
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1500); };
    const initiativeOf = async t => (await state()).combatants?.find(x => (x.tokenId === t.id) || (x.name === t.name))?.initiative ?? null;
    const summon = async (caster, itemId, x, y) => {
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId, x, y });
      await pause(2500);
      return s?.tokens?.[0] ?? null;
    };
    const pulseOn = async (target, turns=4) => {
      for ( let i = 0; i < turns; i++ ) {
        const since = await ctx.lastMessageId();
        await next();
        const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "pulse")
          && String(m.flags?.[MODULE_ID]?.areaTick?.token ?? "").endsWith(target.id));
        if ( tick ) return ctx.settle(tick.id, { timeoutMs: 45000 }).catch(() => null);
      }
      return null;
    };

    /**
     * §438: Handbook 3.0.0 — the aura no longer has an effect on the item: its activity carries a dnd5e area behavior
     * (`applyActiveEffect`, effect from the effects compendium), left to dnd5e (user's decision). The spell is then cast like a
     * click (`api.mcp.use`: dnd5e places the Emanation, the engine attaches it to the caster); the old form keeps the
     * connector's call.
     */
    const castAura = async (itemId, rest={}) => {
      const item = ((await ctx.call("get-actor", { actorId: pal.actorId })).items ?? []).find(i => i._id === itemId);
      const v3 = Object.values(item?.system?.activities ?? {}).some(a => (a.behaviors ?? []).some(b => b.type === "applyActiveEffect"));
      if ( !v3 ) return ctx.use({ tokenId: pal.id, itemId, targetTokenIds: [pal.id], consume: false, ...rest });
      ctx.log("forme 3.0.0 : l'aura est la zone de dnd5e");
      const used = await ctx.engine("use", { tokenId: pal.id, itemId });
      for ( const r of used?.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
      return used;
    };
    /** The aura is cast with the Fighter 10 cells away; he enters within 1.50 m of the Paladin, then leaves again. */
    const auraCase = (label, id, identifier) => part(label, async () => {
      const itemId = await lend(pal, id);
      const p = await ctx.position(pal);
      await place(fighter, p.x - 10 * grid, p.y);
      await castAura(itemId);
      await pause(2500);
      const on = async () => (await ctx.effectsFrom(fighter, identifier)).length > 0;
      ctx.expect(!(await on()), `${label} : rien sur le Guerrier hors de l'aura`);
      await place(fighter, p.x - grid, p.y);
      await pause(2000);
      ctx.expect(await on(), `${label} : le Guerrier entre dans l'aura → l'effet`);
      await place(fighter, p.x - 10 * grid, p.y);
      await pause(2000);
      ctx.expect(!(await on()), `${label} : le Guerrier en sort → l'effet part`);
    });
    await auraCase("Aura du croisé", "phbsplCrusadersM", "crusaders-mantle");
    await auraCase("Aura de pureté", "phbsplAuraofPuri", "aura-of-purity");

    await part("Aura de vie", async () => {
      const itemId = await lend(pal, "phbsplAuraofLife");
      const p = await ctx.position(pal);
      await place(fighter, p.x - grid, p.y);
      if ( !ctx.expect(await fight([pal, fighter]), "Aura de vie : tour du Paladin") ) return;
      await castAura(itemId);
      await pause(2500);
      await ctx.setHp(fighter, 0);
      await pause(1500);
      await next();
      await pause(2000);
      ctx.expect((await ctx.hp(fighter)) >= 1, `Aura de vie : le Guerrier à 0 PV commence son tour dans l'aura → ${await ctx.hp(fighter)} PV`);
    });

    await part("Appel de destrier", async () => {
      const itemId = await lend(pal, "phbsplFindSteed0");
      if ( !ctx.expect(await fight([pal, zombi]), "Appel de destrier : tour du Paladin") ) return;
      const p = await ctx.position(pal);
      const steed = await summon(pal, itemId, p.x + 2 * grid, p.y);
      if ( !ctx.expect(!!steed, `Appel de destrier : le destrier est là (${steed?.name ?? "rien"})`) ) return;
      const init = await initiativeOf(steed);
      ctx.expect((init !== null) && (init < 20) && (init > 10), `Appel de destrier : juste après le Paladin (initiative ${init})`);
    });

    await part("Épée de Mordenkainen", async () => {
      const itemId = await lend(mage, "phbswdMordenkain");
      if ( !ctx.expect(await fight([mage, zombi]), "Épée : tour du Magicien") ) return;
      const z = await ctx.position(zombi);
      const sword = await summon(mage, itemId, z.x + grid, z.y);
      if ( !ctx.expect(!!sword, `Épée : invoquée (${sword?.name ?? "rien"})`) ) return;
      const init = await initiativeOf(sword);
      ctx.expect((init !== null) && (init < 20) && (init > 10), `Épée : juste après le Magicien (initiative ${init})`);
    });

    await part("Gardien de la foi", async () => {
      const itemId = await lend(cleric, "phbsplGuardianof");
      // The Zombie (15 HP) died under the pulse: no more target on the next turn, and a Death that dnd5e and the restoration
      // each removed on their own ("ActiveEffect dnd5edead0000000 does not exist"). HP restored by `reset`.
      await ctx.setHp(zombi, 100);
      if ( !ctx.expect(await fight([cleric, zombi]), "Gardien : tour du Clerc") ) return;
      const z = await ctx.position(zombi);
      const guardian = await summon(cleric, itemId, z.x + 2 * grid, z.y);
      if ( !ctx.expect(!!guardian, `Gardien : invoqué (${guardian?.name ?? "rien"})`) ) return;
      // §259: "it disappears when it has dealt 60 damage in total" — 59 already counted, the next pulse (at least 1) finishes it.
      await ctx.call("update-scene-object", { type: "Token", objectId: guardian.id, data: { "flags.dnd5e-combat.pulseDamage": 59 } });
      const r = await pulseOn(zombi, 2);
      ctx.expect(!!r, "Gardien : le Zombi commence son tour à 3 m → sa sauvegarde");
      await new Promise(res => setTimeout(res, 2500));
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.some(t => t.id === guardian.id);
      ctx.expect(!live, "Gardien : 60 dégâts atteints, il a disparu");
    });

    await part("Chien de garde", async () => {
      const itemId = await lend(mage, "phbFaithfulHound");
      // The Zombie (15 HP) died under the pulse: no more target on the next turn, and a Death that dnd5e and the restoration
      // each removed on their own ("ActiveEffect dnd5edead0000000 does not exist"). HP restored by `reset`.
      await ctx.setHp(zombi, 100);
      if ( !ctx.expect(await fight([mage, zombi]), "Chien : tour du Magicien") ) return;
      const z = await ctx.position(zombi);
      const hound = await summon(mage, itemId, z.x + grid, z.y);
      if ( !ctx.expect(!!hound, `Chien : invoqué (${hound?.name ?? "rien"})`) ) return;
      const r = await pulseOn(zombi, 3);
      ctx.expect(!!r, "Chien : au début du tour du Magicien, il mord le Zombi");
    });
  }
};
