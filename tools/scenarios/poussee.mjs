/**
 * "Forced movement" brick (SPEC §16), push on a failed saving throw: the Wizard's Thunderwave,
 * area placed on the Zombie. `thunderwave` content: `{ on: "failedSave", do: [{ type: "move", mode: "push",
 * distance: 10, units: "ft" }] }`. On a failure, the Zombie moves back two cells (10 ft) away from the
 * Wizard; on a success, it does not move. The dice are random: we replay until we see a failure.
 */
export default {
  name: "poussée — Vague tonnante repousse le Zombi de 10 ft sur un échec",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    // Two cells south of the Wizard: the only row of the Restored Keep courtyard where four cells are free of walls and
    // tokens (surveyed on 2026-09-25) — elsewhere, a wall stops the push after one cell.
    const pos0 = { x: magePos.x, y: magePos.y + 2 * grid, elevation: magePos.elevation };

    let failed = null;
    for ( let i = 0; i < 20 && !failed; i++ ) {
      await ctx.setHp(zombi, hp0);
      await ctx.call("move-token", { tokenId: zombi.id, x: pos0.x, y: pos0.y, elevation: pos0.elevation });
      const box = await ctx.box(zombi);
      const used = await ctx.use({ tokenId: mage.id, identifier: "thunderwave", activityType: "save", area: { shape: "rectangle", ...box } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Zombi");
      if ( !target?.save ) { ctx.expect(false, `le Zombi n'est pas une cible de la zone (${r.targets.map(t => t.name).join(", ")})`); return; }
      ctx.expect(r.plan.steps.length === 1 && r.plan.steps[0].type === "move", `le plan porte l'étape de poussée (${JSON.stringify(r.plan.steps)})`);
      await new Promise(res => setTimeout(res, 1500));   // the movement follows the application
      const pos = await ctx.position(zombi);
      const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
      if ( target.save.success ) {
        ctx.expect(moved === 0, `sauvegarde réussie (${target.save.total} ≥ ${r.plan.save.dc}) : le Zombi n'a pas bougé (${moved} case)`);
        continue;
      }
      failed = { target, pos, moved };
    }
    if ( !failed ) { ctx.expect(false, "aucun échec de sauvegarde en 20 essais"); return; }
    const { target, pos, moved } = failed;
    ctx.expect(moved === 2, `sauvegarde ratée (${target.save.total}) : le Zombi a reculé de ${moved} case(s) (attendu 2 = 10 ft)`);
    // Opposite the Wizard: the distance to the Wizard has grown.
    const before = Math.hypot(pos0.x - magePos.x, pos0.y - magePos.y);
    const after = Math.hypot(pos.x - magePos.x, pos.y - magePos.y);
    ctx.expect(after > before, `repoussé loin du Magicien (${Math.round(before)} → ${Math.round(after)} px)`);
    ctx.expect((target.damage?.applied ?? 0) > 0, `dégâts pleins appliqués (${target.damage?.applied})`);
  }
};
