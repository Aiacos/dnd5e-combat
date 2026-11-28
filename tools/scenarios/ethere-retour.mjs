/**
 * §225, batch 4: the return from the Ethereal plane and the Bestiary traits. Arena.
 *  1. The Ethereal Fighter stands on the Zombie's cell; the condition removed, he is pushed to a free neighboring cell and takes
 *     10 force damage (2 × 5 ft).
 *  2. The Ethereal Fighter raised to 15 ft; the condition removed, he no longer floats: he falls to the ground.
 *  3. Ethereal Jaunt (Phase Spider trait, lent to the Zombie): it goes into the Ethereal, then comes back.
 * Restores positions, HP, conditions, lent items.
 */
const MM = "Compendium.dnd-monster-manual.features.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "plan Éthéré — retour sur une case occupée (repoussé, dégâts de force), chute au retour, Saut éthéré",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Zombi requis : non applicable"); return; }
    const [fighter, zombi] = await Promise.all(["Guerrier", "Zombi"].map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    const home = { fighter: await ctx.position(fighter), zombi: await ctx.position(zombi) };
    const hp0 = { fighter: await ctx.hp(fighter), zombi: await ctx.hp(zombi) };
    const ethereal = (t, active) => ctx.call("set-status", { tokenId: t.id, statusId: "ethereal", active });
    ctx.restore(async () => {
      for ( const t of [fighter, zombi] ) {
        await ethereal(t, false).catch(() => {});
        for ( const s of ["prone", "falling"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
      }
      await pause(1500);
      await ctx.call("move-token", { tokenId: fighter.id, ...home.fighter }).catch(() => {});
      await ctx.call("move-token", { tokenId: zombi.id, ...home.zombi }).catch(() => {});
      await ctx.setHp(fighter, hp0.fighter);
      await ctx.setHp(zombi, hp0.zombi);
    });

    // 1. Return onto an occupied cell.
    await ethereal(fighter, true);
    await pause(1200);
    await ctx.call("move-token", { tokenId: fighter.id, x: home.zombi.x, y: home.zombi.y });
    await pause(800);
    const on = await ctx.position(fighter);
    ctx.expect((on.x === home.zombi.x) && (on.y === home.zombi.y), `Éthéré, le Guerrier se tient sur la case du Zombi (${on.x}, ${on.y})`);
    // HP at the computed maximum: left low in the world (8 HP on 2026-10-26), the Fighter could not lose the expected 10.
    await ctx.setHp(fighter, (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max ?? hp0.fighter);
    const hpBefore = await ctx.hp(fighter);
    await ethereal(fighter, false);
    await pause(3000);
    const after = await ctx.position(fighter);
    const moved = Math.max(Math.abs(after.x - home.zombi.x), Math.abs(after.y - home.zombi.y)) / grid;
    ctx.expect(moved === 1, `revenu sur une case occupée : repoussé d'une case (${after.x}, ${after.y} ; ${moved} case)`);
    const lost = hpBefore - (await ctx.hp(fighter));
    ctx.expect(lost === 10, `10 dégâts de force (2 × 5 ft) : ${lost} PV perdus`);
    await ctx.setHp(fighter, hp0.fighter);
    await ctx.call("move-token", { tokenId: fighter.id, ...home.fighter });
    await pause(800);

    // 2. Retour en l'air.
    await ethereal(fighter, true);
    await pause(1200);
    const up = await ctx.engine("rawMove", { tokenId: fighter.id, elevation: 15 });
    ctx.expect(up.after.elevation === 15, `Éthéré, le Guerrier monte à 15 ft (${up.after.elevation} ft)`);
    await ethereal(fighter, false);
    // Foundry window in the background, the rise has not finished its animation: the engine waits 5 s for it before falling by
    // itself (§237).
    let landed = await ctx.position(fighter);
    for ( let i = 0; (i < 12) && (landed.elevation !== 0); i++ ) { await pause(1000); landed = await ctx.position(fighter); }
    ctx.expect(landed.elevation === 0, `revenu en l'air, il tombe au sol (${landed.elevation} ft)`);
    await ctx.setHp(fighter, hp0.fighter);

    // 3. Ethereal Jaunt, lent to the Zombie.
    const jaunt = await ctx.ensureItem(zombi, MM + "mmEtherealJaunt0");
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);
    const use = () => ctx.use({ tokenId: zombi.id, itemId: jaunt, targetTokenIds: [], consume: false });
    await use();
    await pause(2000);
    ctx.expect((await statuses(zombi)).includes("ethereal"), "Saut éthéré : le Zombi passe dans l'Éthéré");
    await use();
    await pause(2000);
    ctx.expect(!(await statuses(zombi)).includes("ethereal"), "Saut éthéré de nouveau : il en revient");
  }
};
