/**
 * §198 (issue #8): a summon without Concentration disappears at the end of its spell's duration. The Wizard summons Mage Hand
 * (1 minute): an end time is noted; 30 seconds later it is there, 61 seconds later it is gone. The Paladin summons their mount
 * (Find Steed, instantaneous duration): no end time, it stays.
 * Restores the world clock, removes the summoned tokens and the lent item.
 */
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "invocations — la Main du mage disparaît à la fin de sa durée, la monture reste",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Paladin"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Paladin requis : non applicable"); return; }
    const [mage, paladin] = await Promise.all(["Magicien", "Paladin"].map(n => ctx.token(n)));
    const hand = await ctx.ensureItem(mage, SPELLS + "phbsplMageHand00");
    const steed = await ctx.itemId(paladin.id, "find-steed").catch(() => null);
    const t0 = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
    const summoned = [];
    ctx.restore(async () => {
      const now = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      if ( now !== t0 ) await ctx.engine("advanceTime", { seconds: t0 - now });
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
    });
    const expiresAt = async id => (await ctx.call("get-scene-object", { type: "Token", objectId: id })).data?.flags?.["dnd5e-combat"]?.expiresAt ?? null;
    const present = async id => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.some(t => t.id === id);
    const grid = await ctx.gridSize();
    const pos = await ctx.position(mage);

    const h = await ctx.engine("summonAt", { tokenId: mage.id, itemId: hand, x: pos.x + grid, y: pos.y + grid });
    const ht = h.tokens?.[0];
    if ( !ctx.expect(!!ht, "la Main du mage est invoquée") ) return;
    summoned.push(ht.id);
    await pause(1500);
    const at = await expiresAt(ht.id);
    ctx.expect(at === t0 + 60, `heure de fin notée : dans ${at === null ? "—" : at - t0} s (attendu 60)`);
    await ctx.engine("advanceTime", { seconds: 30 });
    await pause(1500);
    ctx.expect(await present(ht.id), "30 secondes plus tard, elle est là");
    await ctx.engine("advanceTime", { seconds: 31 });
    await pause(2500);
    ctx.expect(!(await present(ht.id)), "61 secondes plus tard, elle est partie");

    if ( !steed ) { ctx.log("Paladin sans Appel de destrier : partie monture sautée"); return; }
    const ppos = await ctx.position(paladin);
    const s = await ctx.engine("summonAt", { tokenId: paladin.id, itemId: steed, x: ppos.x + (2 * grid), y: ppos.y });
    const st = s.tokens?.[0];
    if ( !ctx.expect(!!st, "la monture est invoquée") ) return;
    summoned.push(st.id);
    await pause(1500);
    ctx.expect((await expiresAt(st.id)) === null, "la monture (durée instantanée) n'a pas d'heure de fin");
  }
};
