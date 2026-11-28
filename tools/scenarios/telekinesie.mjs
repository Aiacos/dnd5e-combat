/**
 * "Forced movement" building block (B3, written in 0.31.0, verified here): Telekinetic (`telekinetic`, PHB feat, added to the
 * Wizard for the scenario's duration) — "Telekinetic Shove": Strength saving throw, or the target is pushed 5 ft.
 * Content: `{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }`. We replay until a
 * failure: the Zombie moves back one cell, away from the Wizard.
 */
export default {
  name: "télékinésie — Poussée télékinésique repousse le Zombi de 5 ft sur un échec",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.feats.Item.phbftTelekinetic");
    const mPos = await ctx.position(mage);
    // Two cells south: the column below the Wizard's origin cell is free of walls and tokens (survey of the scenario
    // `poussee`). To the west, a wall stops the push (2026-09-25); to the east, the Warlock occupies the next cell (2026-09-28).
    const pos0 = { x: mPos.x, y: mPos.y + 2 * grid, elevation: mPos.elevation };

    for ( let i = 0; i < 20; i++ ) {
      await ctx.call("move-token", { tokenId: zombi.id, ...pos0 });
      const used = await ctx.use({ tokenId: mage.id, identifier: "telekinetic", activityId: "fRiTsQ2k0pnpD8zE", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Zombi");
      if ( !target?.save ) { ctx.expect(false, `le Zombi n'est pas la cible (${r.targets.map(t => t.name).join(", ")})`); return; }
      await new Promise(res => setTimeout(res, 1500));
      const pos = await ctx.position(zombi);
      const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
      if ( target.save.success ) { ctx.expect(moved === 0, `réussite (${target.save.total} ≥ ${r.plan.save.dc}) : pas bougé`); continue; }
      ctx.expect(moved === 1, `échec (${target.save.total}) : repoussé de ${moved} case (attendu 1 = 5 ft)`);
      ctx.expect(Math.hypot(pos.x - mPos.x, pos.y - mPos.y) > Math.hypot(pos0.x - mPos.x, pos0.y - mPos.y), "à l'opposé du Magicien");
      return;
    }
    ctx.expect(false, "aucun échec de sauvegarde en 20 essais");
  }
};
