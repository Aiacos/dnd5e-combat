/**
 * §261: Ice Storm — "the area becomes Difficult Terrain until the end of your next turn". In combat, the Wizard casts it on the
 * Zombie: the spell's area leaves after the resolution, a Difficult Terrain region replaces it; it stays during the Zombie's
 * turn, and leaves when the Wizard's next turn ends.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Tempête de grêle — le terrain difficile reste jusqu'à la fin du prochain tour du lanceur",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp));
    await ctx.setHp(zombi, 100);
    const storm = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplIceStorm00");
    // The connector's list does not return the flags: each region is read again.
    const lingering = async () => {
      const out = [];
      for ( const r of (await ctx.call("list-scene-objects", { type: "Region" })).objects?.Region ?? [] ) {
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: r.id });
        if ( data?.flags?.[MODULE_ID]?.lingering ) out.push({ ...data, id: r.id });
      }
      return out;
    };
    ctx.restore(async () => { for ( const r of await lingering() ) await ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}); });

    await ctx.startCombat([mage, zombi]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    let combat = await state();
    for ( const [t, v] of [[mage, 20], [zombi, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    ctx.expect((await current()) === mage.id, "tour du Magicien");

    const b = await ctx.box(zombi);
    const used = await ctx.use({ tokenId: mage.id, itemId: storm, activityType: "save", area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: 2 * grid } });
    ctx.expect(used.used, "Tempête de grêle lancée");
    await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(6000);   // the instant area leaves after the resolution (and the animation delay)
    let left = await lingering();
    ctx.expect(left.length === 1, `une région de terrain difficile reste (${left.length})`);
    ctx.expect(JSON.stringify(left[0] ?? {}).includes("dnd5e.difficultTerrain"), "avec le comportement « terrain difficile » de dnd5e");

    await ctx.nextTurn(); await pause(2500);   // end of the Wizard's turn (round of placement) → the Zombie's turn
    ctx.expect((await lingering()).length === 1, "au tour du Zombi, le terrain est toujours là");
    await ctx.nextTurn(); await pause(2500);   // tour suivant du Magicien
    ctx.expect((await lingering()).length === 1, "au prochain tour du Magicien, toujours là");
    await ctx.nextTurn(); await pause(2500);   // fin du prochain tour du Magicien
    ctx.expect((await lingering()).length === 0, "à la fin de ce tour, le terrain part");
  }
};
