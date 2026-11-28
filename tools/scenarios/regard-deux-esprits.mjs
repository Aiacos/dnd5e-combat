/**
 * PR #234: Gaze of Two Minds (`castFromBearer`). Test arena (Wizard, Cleric, Zombie).
 *  1. Without the link, Poison Spray (30 ft) at the Zombie 60 ft away: out of range.
 *  2. Gaze of Two Minds is a touch; used on the adjacent Cleric, the Cleric carries the marker.
 *  3. Cleric 40 ft from the Wizard and 20 ft from the Zombie: in range (measured from the Cleric).
 *  4. Cleric 65 ft from the Wizard (beyond 60 ft), 5 ft from the Zombie: out of range again.
 *     (The Gaze activity reads as a touch; the engine does not yet check touch ranges at all, for any activity.)
 *  5. In combat (Wizard then Cleric), the marker placed on the Wizard's turn survives the end of that turn and the
 *     Cleric's turn, and falls at the end of the Wizard's next turn.
 */
const GAZE = "Compendium.dnd5e.classes24.Item.phbinvGazeofTwoM";
const SPRAY = "Compendium.dnd5e.spells24.Item.phbsplPoisonSpra";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "regard-deux-esprits — Gaze of Two Minds: spell range measured from the linked creature",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Clerc or Zombi missing: not applicable"); return; }
    const mage = await ctx.token("Magicien");
    const cleric = await ctx.token("Clerc");
    const g = await ctx.gridSize();
    const at = await ctx.position(mage);
    await ctx.stage({ tokens: { Clerc: [at.x + g, at.y], Zombi: [at.x + 12 * g, at.y] } });
    const zombi = await ctx.token("Zombi");
    const gaze = await ctx.ensureItem(mage, GAZE);
    const spray = await ctx.ensureItem(mage, SPRAY, { system: { method: "atwill" } });
    ctx.restore(() => ctx.removeEffectsFrom(cleric, "gaze-of-two-minds"));
    const check = () => ctx.engine("rangeCheck", { tokenId: mage.id, itemId: spray, targetIds: [zombi.id] });
    const out = p => p.some(x => x.issue === "outOfRange");
    const moveCleric = async cells => { await ctx.call("move-token", { tokenId: cleric.id, x: at.x + cells * g, y: at.y, elevation: 0 }); await pause(800); };
    const marks = async () => (await ctx.effectsFrom(cleric, "gaze-of-two-minds")).filter(e => !e.disabled);

    // 1. No link.
    let p = await check();
    ctx.expect(out(p), `no link, Zombi 60 ft away: out of range (${JSON.stringify(p)})`);

    // 2. The link.
    const reach = await ctx.engine("range", { tokenId: mage.id, itemId: gaze });
    ctx.expect(reach?.units === "touch", `the Gaze activity is a touch (${JSON.stringify(reach)})`);
    await ctx.use({ tokenId: mage.id, itemId: gaze, targetTokenIds: [cleric.id], consume: false });
    await pause(2000);
    if ( !ctx.expect((await marks()).length === 1, `the Clerc carries the Gaze marker (${JSON.stringify(await marks())})`) ) return;

    // 3. Measured from the Clerc.
    await moveCleric(8);
    p = await check();
    ctx.expect(!out(p), `Clerc 40 ft away, 20 ft from the Zombi: in range (${JSON.stringify(p)})`);

    // 4. Beyond 60 ft between the two.
    await moveCleric(13);
    p = await check();
    ctx.expect(out(p), `Clerc 65 ft away from the Magicien: the link no longer counts (${JSON.stringify(p)})`);
    await moveCleric(8);
    await moveCleric(1);

    // 5. Duration in combat (the Gaze used on the adjacent Clerc, then the Clerc steps 40 ft away).
    await ctx.removeEffectsFrom(cleric, "gaze-of-two-minds");
    await pause(800);
    await ctx.startCombat([mage, cleric]);
    let c = await ctx.combat();
    const by = id => c.combatants.find(x => x.tokenId === id);
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(mage.id).id, value: 20 });
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(cleric.id).id, value: 5 });
    for ( let i = 0; i < 4; i++ ) {
      c = await ctx.combat();
      if ( c.currentCombatantId === by(mage.id)?.id ) break;
      await ctx.nextTurn();
      await pause(1500);
    }
    c = await ctx.combat();
    if ( !ctx.expect(c.currentCombatantId === by(mage.id)?.id, `Magicien's turn (round ${c.round})`) ) return;
    await ctx.use({ tokenId: mage.id, itemId: gaze, targetTokenIds: [cleric.id], consume: false });
    await pause(2000);
    ctx.expect((await marks()).length === 1, "in combat: the Clerc carries the marker");
    await moveCleric(8);
    await ctx.nextTurn(); await pause(2000);
    ctx.expect((await marks()).length === 1, "end of the turn it was used: the marker holds");
    await ctx.nextTurn(); await pause(2000);
    ctx.expect((await marks()).length === 1, "Magicien's next turn: the marker holds");
    p = await check();
    ctx.expect(!out(p), `Magicien's next turn: still in range through the Clerc (${JSON.stringify(p)})`);
    await ctx.nextTurn(); await pause(2500);
    ctx.expect((await marks()).length === 0, "end of the Magicien's next turn: the marker falls");
    p = await check();
    ctx.expect(out(p), `after the link: out of range again (${JSON.stringify(p)})`);
  }
};
