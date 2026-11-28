/**
 * "Conditional Advantage" brick (SPEC §16, B6), `preAttackRoll` moment: the reasons declared by the content
 * join those of the conditions, under the roll (flag `modifiers`, reason `content.<nom de l'item>`).
 *  1. Pack Tactics (MM feature, added to the Wizard for the scenario): the Fighter (the Wizard's ally) is brought into melee
 *     contact with the Zombie, the Wizard attacks it at range (Ray of Frost) → Advantage "Pack Tactics".
 *     The Fighter brought back to his place → no more Advantage.
 *  2. Faerie Fire (added to the Wizard) on the Zombie until a failure ("Outlined" effect), then Ray of
 *     Frost → Advantage "Faerie Fire" (carried by the target's effect), and Concentration removed → nothing left.
 */
export default {
  name: "avantage déclaré — Tactique de meute (allié au contact), Lueurs féeriques (effet sur la cible)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const barbare = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const barbHome = await ctx.position(barbare);
    ctx.restore(() => ctx.call("move-token", { tokenId: barbare.id, x: barbHome.x, y: barbHome.y, elevation: barbHome.elevation }).catch(() => {}));
    // The Zombie on an isolated cell: at its usual place, the Fighter is diagonal at 5 ft, and Pack Tactics
    // applies even without the ally (seen on 2026-09-24: the engine was right, not the scenario).
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    // Three cells below the Wizard (free column of Restored Keep): with four, the cell touches the Paladin's cell diagonally
    // (3220 × 5460), whose Pack Tactics rightly holds (seen on 2026-09-28).
    const zPos = { x: magePos.x, y: magePos.y + 3 * grid, elevation: zHome.elevation };
    await ctx.call("move-token", { tokenId: zombi.id, ...zPos });
    await new Promise(r => setTimeout(r, 800));

    /** Wizard's attack on the Zombie; returns the reasons recorded under the roll. */
    const attack = async () => {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      const messages = await ctx.messagesSince(used.usageMessageId);
      const attackMessage = messages.find(m => m.type === "attack");
      const flags = attackMessage?.flags ?? {};
      return flags["dnd5e-combat"]?.modifiers ?? flags.modifiers ?? { advantage: [], disadvantage: [] };
    };
    const names = list => (list ?? []).map(r => `${r.who}.${r.key}`).join(", ") || "aucune";

    // 1. Tactique de meute
    await ctx.ensureItem(mage, "Compendium.dnd-monster-manual.features.Item.mmPackTactics000");
    await ctx.call("move-token", { tokenId: barbare.id, x: zPos.x + grid, y: zPos.y, elevation: zPos.elevation });
    await new Promise(r => setTimeout(r, 800));
    let m = await attack();
    ctx.expect((m.advantage ?? []).some(r => r.who === "content"), `Guerrier au contact du Zombi : avantage déclaré (${names(m.advantage)})`);
    // Far: five cells east of the Zombie (its usual place is diagonal to the Zombie, seen on 2026-09-25).
    await ctx.call("move-token", { tokenId: barbare.id, x: zPos.x + 5 * grid, y: zPos.y, elevation: zPos.elevation });
    await new Promise(r => setTimeout(r, 800));
    m = await attack();
    ctx.expect(!(m.advantage ?? []).some(r => r.who === "content"), `Guerrier loin : plus d'avantage déclaré (${names(m.advantage)})`);

    // 2. Faerie Fire
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplFaerieFire");
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    let lit = false;
    for ( let i = 0; i < 20 && !lit; i++ ) {
      const box = await ctx.box(zombi);
      const used = await ctx.use({ tokenId: mage.id, identifier: "faerie-fire", activityType: "save", area: { shape: "rectangle", ...box } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.name === "Zombi");
      if ( !t?.save ) { ctx.expect(false, "le Zombi n'est pas dans le cube"); return; }
      lit = t.save.success === false;
    }
    if ( !lit ) { ctx.expect(false, "aucun échec de sauvegarde en 20 essais"); return; }
    await new Promise(r => setTimeout(r, 800));
    const effects = await ctx.effects(zombi);
    ctx.expect(effects.length > 0, `effet de Lueurs féeriques posé sur le Zombi (${effects.map(e => e.name).join(", ")})`);
    m = await attack();
    ctx.expect((m.advantage ?? []).some(r => r.who === "content"), `cible nimbée : avantage déclaré (${names(m.advantage)})`);
    // Concentration drops → the effect too → no more Advantage.
    for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1000));
    m = await attack();
    ctx.expect(!(m.advantage ?? []).some(r => r.who === "content"), `concentration tombée : plus d'avantage déclaré (${names(m.advantage)})`);
  }
};
