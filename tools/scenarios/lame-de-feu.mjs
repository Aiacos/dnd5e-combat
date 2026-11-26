/**
 * §554: Flame Blade ready to use — on the « Arène de test » of `dnd-6`, Sylaene (druid 5, a character with level 3 slots) against the
 * Zombi.
 *  1. Casting « Evoke Blade » opens the slot level window (§106: the level is a real choice), with « roll without dialog » on and off.
 *  2. Cast at level 2: trace, the attack in the sheet's favorites (marked as DAS's), `api.ui.spellWeapons` and the hook
 *     `dnd5e-combat.spellWeapon`; the attack rolls 3d6.
 *  3. Cast again at level 4: one trace, one favorite, the attack rolls 5d6 (§405).
 *  4. Concentration lost: trace and favorite gone, hook `active: false`.
 *  5. A favorite the player had put there stays when the blade goes.
 *  6. Duration over (world time + 11 minutes): the expired trace is deleted, its favorite with it.
 */
const MODULE_ID = "dnd5e-combat";
const FLAME_BLADE = "Compendium.dnd-players-handbook.spells.Item.phbsplFlameBlade";
const EVOKE = "OIU1htXAoSF0cU3U";
const ATTACK = "dnd5eactivity000";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Flame Blade ready to use: slot level window, favorite, damage at the cast level, removal (§554)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Sylaene", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Sylaene or Zombi missing: not applicable"); return; }
    const druid = await ctx.token("Sylaene");
    const zombie = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombie);
    const itemId = await ctx.ensureItem(druid, FLAME_BLADE);
    const favoriteId = `.Item.${itemId}.Activity.${ATTACK}`;
    const script = async (code, args={}) => (await ctx.call("run-script", { code: `const A = ${JSON.stringify(args)};\n${code}` }))?.result;
    const actorJs = `const actor = canvas.tokens.get(${JSON.stringify(druid.id)})?.actor;`;
    const state = () => script(`${actorJs}
      return { favorites: actor.system.favorites.map(f => f.id),
        traces: actor.effects.filter(e => e.getFlag("${MODULE_ID}", "trace")).map(e => ({ id: e.id, mark: e.getFlag("${MODULE_ID}", "traceFavorite") ?? null })),
        weapons: game.modules.get("${MODULE_ID}").api.ui.spellWeapons(actor), seen: window.__dasSpellWeapon ?? [] };`);
    const favorites0 = (await state()).favorites;
    const dropConcentration = () => script(`${actorJs}
      const ids = actor.effects.filter(e => e.statuses.has("concentrating")).map(e => e.id);
      if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;`);
    const clearTraces = () => script(`${actorJs}
      const ids = actor.effects.filter(e => e.getFlag("${MODULE_ID}", "trace")).map(e => e.id);
      if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;`);
    const autoUsage0 = await script(`return game.settings.get("${MODULE_ID}", "autoUsage");`);
    ctx.restore(async () => {
      await dropConcentration();
      await pause(2500);   // the engine removes the trace with the concentration: deleting it at the same time would fail
      await clearTraces();
      await pause(1000);
      await script(`${actorJs} await actor.update({ "system.favorites": A.favorites });
        game.settings.set("${MODULE_ID}", "autoUsage", A.auto);
        if ( window.__dasSpellWeaponHook ) Hooks.off("${MODULE_ID}.spellWeapon", window.__dasSpellWeaponHook);
        delete window.__dasSpellWeapon; delete window.__dasSpellWeaponHook;`, { favorites: favorites0, auto: autoUsage0 });
      await ctx.setHp(zombie, hp0);
    });
    await dropConcentration();
    await pause(2500);
    await clearTraces();
    await pause(1000);

    // ---- 1. The slot level window opens when casting « Evoke Blade » ----
    const levelWindow = auto => script(`${actorJs}
      await game.settings.set("${MODULE_ID}", "autoUsage", A.auto);
      const activity = actor.items.get(A.itemId).system.activities.get(A.evoke);
      const seen = [];
      const id = Hooks.on("renderActivityUsageDialog", app => { seen.push(app.element?.querySelector?.("[name='spell.slot']") ? "slot" : "no-slot"); app.close(); });
      try { await Promise.race([activity.use(), new Promise(r => setTimeout(r, 6000))]); }
      finally { Hooks.off("renderActivityUsageDialog", id); }
      return seen;`, { auto, itemId, evoke: EVOKE });
    for ( const auto of [true, false] ) {
      const seen = await levelWindow(auto);
      ctx.expect(seen.length === 1, `Evoke Blade, rolls without dialog ${auto ? "on" : "off"}: the slot level window opens (${JSON.stringify(seen)})`);
      ctx.expect(seen[0] === "slot", `… with the slot choice (${seen[0] ?? "no window"})`);
    }
    await script(`game.settings.set("${MODULE_ID}", "autoUsage", A.auto);`, { auto: autoUsage0 });
    await pause(500);
    const afterWindow = await state();
    ctx.expect(!afterWindow.traces.length, `window closed without casting: no blade (${afterWindow.traces.length})`);

    // ---- 2. Cast at level 2 ----
    await script(`window.__dasSpellWeapon = [];
      window.__dasSpellWeaponHook = Hooks.on("${MODULE_ID}.spellWeapon", d => window.__dasSpellWeapon.push({ active: d.active, activity: d.activity?.id, actor: d.actor?.name }));`);
    const evoke = level => ctx.use({ tokenId: druid.id, identifier: "flame-blade", activityId: EVOKE, consume: false,
      usageConfig: { scaling: level - 2, spell: { slot: `spell${level}` } } });
    await evoke(2);
    await pause(2500);
    let s = await state();
    ctx.expect(s.traces.length === 1, `level 2: the blade is there (${s.traces.length} trace)`);
    ctx.expect(s.favorites.filter(f => f === favoriteId).length === 1, `level 2: the attack is in the sheet's favorites (${s.favorites.join(", ")})`);
    ctx.expect(s.traces[0]?.mark === favoriteId, `the favorite is marked as DAS's (${s.traces[0]?.mark})`);
    ctx.expect((s.weapons.length === 1) && (s.weapons[0].activityId === ATTACK) && (Number(s.weapons[0].level) === 2),
      `api.ui.spellWeapons: ${JSON.stringify(s.weapons.map(w => ({ a: w.activityId, level: w.level })))}`);
    ctx.expect(s.seen.some(e => e.active && (e.activity === ATTACK)), `spellWeapon hook (active): ${JSON.stringify(s.seen)}`);

    /** The damage formula of the first attack of the blade that hits the Zombi. */
    const formulaOf = async id => {
      const m = (await ctx.call("list-chat-messages", { limit: 60 })).messages?.find(x => x.id === id);
      const raw = m?.rolls?.[0];
      return ((typeof raw === "string") ? JSON.parse(raw) : raw)?.formula ?? null;
    };
    const hitFormula = async () => {
      for ( let n = 1; n <= 20; n++ ) {
        await ctx.setHp(zombie, 999);
        const used = await ctx.use({ tokenId: druid.id, identifier: "flame-blade", activityId: ATTACK, consume: false, targetTokenIds: [zombie.id] });
        const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 60000 }).catch(() => null) : null;
        if ( r?.targets?.[0]?.hit && r.damageRoll?.messageId ) return formulaOf(r.damageRoll.messageId);
      }
      return null;
    };
    const dice = formula => Number(/^(\d+)d6/.exec(formula ?? "")?.[1] ?? 0);
    let hit = await hitFormula();
    ctx.expect([3, 6].includes(dice(hit)), `blade attack at level 2: ${hit} (expected 3d6 + mod)`);

    // ---- 3. Cast again at level 4 ----
    await evoke(4);
    await pause(2500);
    s = await state();
    ctx.expect(s.traces.length === 1, `cast again at level 4: a single blade (${s.traces.length})`);
    ctx.expect(s.favorites.filter(f => f === favoriteId).length === 1, `cast again: the favorite is still there, once (${s.favorites.filter(f => f === favoriteId).length})`);
    ctx.expect(s.traces[0]?.mark === favoriteId, `cast again: the new blade keeps the favorite's mark (${s.traces[0]?.mark})`);
    ctx.expect(Number(s.weapons[0]?.level) === 4, `api.ui.spellWeapons: level ${s.weapons[0]?.level}`);
    hit = await hitFormula();
    ctx.expect([5, 10].includes(dice(hit)), `blade attack at level 4: ${hit} (expected 5d6 + mod)`);

    // ---- 4. Concentration lost ----
    await script(`window.__dasSpellWeapon = [];`);
    await dropConcentration();
    await pause(2500);
    s = await state();
    ctx.expect(!s.traces.length, `concentration lost: the blade goes (${s.traces.length})`);
    ctx.expect(!s.favorites.includes(favoriteId), `concentration lost: the favorite goes with it (${s.favorites.join(", ")})`);
    ctx.expect(s.seen.some(e => !e.active && (e.activity === ATTACK)), `spellWeapon hook (end): ${JSON.stringify(s.seen)}`);
    ctx.expect(!s.weapons.length, `api.ui.spellWeapons empty (${s.weapons.length})`);

    // ---- 5. A favorite the player had put there stays ----
    await script(`${actorJs} await actor.system.addFavorite({ type: "activity", id: A.id });`, { id: favoriteId });
    await evoke(2);
    await pause(2500);
    s = await state();
    ctx.expect(s.traces.length === 1 && !s.traces[0].mark, `player's favorite: the blade does not mark it (${s.traces[0]?.mark ?? "no mark"})`);
    await dropConcentration();
    await pause(2500);
    s = await state();
    ctx.expect(s.favorites.includes(favoriteId), "player's favorite: it stays when the blade goes");
    await script(`${actorJs} await actor.system.removeFavorite(A.id);`, { id: favoriteId });

    // ---- 6. Duration over ----
    await evoke(2);
    await pause(2500);
    ctx.restore(() => script(`await game.time.advance(-660);`));
    await script(`await game.time.advance(660);`);
    await pause(3500);
    s = await state();
    ctx.expect(!s.traces.length, `11 minutes later: the expired blade is removed (${s.traces.length})`);
    ctx.expect(!s.favorites.includes(favoriteId), "… and its favorite with it");
  }
};
