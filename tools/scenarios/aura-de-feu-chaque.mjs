/**
 * "Each creature" Fire Aura (DF #254 of 2026-11-23): under the shared identifier `fire-aura` ("each creature of its choice":
 * Azers, Salamanders), the Fire Elemental and the SRD 5.2 Balor burn EVERY creature in the Emanation, their allies included;
 * the Balor over 1.50 m (its data said 3 m). Test arena: each creature is placed for the scenario (Monster Manual 2024 or
 * SRD 2024), hostile, with the Zombie (hostile: its ally) and the Fighter (its enemy) in contact with it. In combat, at the
 * end of its turn, the Emanation card targets both. The effective entry of its Fire Aura carries the new identifier.
 * Restored: positions, HP, combat, placed creatures.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const CREATURES = [
  { name: "Balor (essai)", id: "mmBalor000000000", identifier: "mm-balor-fire-aura" },
  { name: "Élémentaire du feu (essai)", id: "mmFireElemental0", identifier: "mm-fire-aura-each" }
];

export default {
  name: "Aura de feu du Balor et de l'Élémentaire du feu — chaque créature, alliés compris (#254)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    const warrior = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [warrior, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    const auraEntry = tokenId => script(`
      const actor = canvas.tokens.get(args.id)?.actor;
      const item = actor?.items.find(i => i.system.identifier === "fire-aura" || i.id === "mmFireAura000000");
      const of = item ? game.modules.get("dnd5e-combat").api.content.of(item) : null;
      return { found: !!item, identifier: of?.identifier ?? null };`, { id: tokenId });
    const emanations = async since => (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.areaTick?.event === "emanation"
      && m.flags[MODULE_ID].areaTick.moment === "ownTurnEnd");
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const wHome = await ctx.position(warrior);

    for ( const c of CREATURES ) {
      const cast = await ctx.cast({ [c.name]: c.id }, { near: "Guerrier", disposition: -1 });
      const beast = cast[c.name];
      if ( !beast ) { ctx.log(`${c.name} : aucune fiche, non applicable`); continue; }
      const e = await auraEntry(beast.id);
      ctx.expect(e?.found && (e.identifier === c.identifier), `${c.name} : son Aura de feu est lue comme ${c.identifier} (${e?.identifier})`);

      // The creature in the middle, the Fighter on its left, the Zombie on its right (in contact with its edge, whatever its size).
      const x0 = wHome.x + (4 * grid), y0 = wHome.y;
      // The token's width in cells, read from the scene (the Balor is Huge: the 1.50 m Emanation starts from its edge).
      const width = Math.max(1, Math.round((await ctx.call("get-scene-object", { type: "Token", objectId: beast.id }))?.data?.width ?? 1));
      await ctx.call("move-token", { tokenId: beast.id, x: x0, y: y0, elevation: 0 });
      await ctx.call("move-token", { tokenId: warrior.id, x: x0 - grid, y: y0, elevation: 0 });
      await ctx.call("move-token", { tokenId: zombi.id, x: x0 + (width * grid), y: y0, elevation: 0 });
      for ( const t of [warrior, zombi] ) await ctx.setHp(t, 200);
      await pause(1000);

      await ctx.startCombat([beast, warrior]);
      const combat = await state();
      for ( const [t, v] of [[beast, 30], [warrior, 10]] ) {
        await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 3) && ((await current()) !== beast.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      if ( !ctx.expect((await current()) === beast.id, `${c.name} : son tour`) ) continue;
      const mark = await ctx.lastMessageId();
      await ctx.nextTurn();
      let card = null;
      for ( let w = 0; (w < 16) && !card; w++ ) { await pause(500); card = (await emanations(mark))[0] ?? null; }
      if ( ctx.expect(!!card, `${c.name} : fin de son tour, une carte d'Aura de feu`) ) {
        const on = ((await ctx.settle(card.id).catch(() => null))?.targets ?? []).map(t => String(t.token ?? ""));
        ctx.expect(on.some(u => u.endsWith(warrior.id)), `${c.name} : le Guerrier (ennemi, au contact) est visé`);
        ctx.expect(on.some(u => u.endsWith(zombi.id)), `${c.name} : le Zombi (allié, au contact) aussi — « chaque créature » (${on.length} cible(s))`);
      }
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await pause(800);
    }
  }
};
