/**
 * "Bonus damage" building block (B2, SPEC §16, written in 0.31.0, verified here) on two declarations of the inventory:
 *  - Great Weapon Master (`great-weapon-master`, PHB): the Fighter hits the Zombie with the two-handed sword (Heavy) →
 *    the damage roll additionally carries its proficiency bonus, of the weapon's type;
 *  - Spirit Shroud (`spirit-shroud`, Tasha: absent from `dnd-6`): a minimal item carrying that identifier and an effect
 *    transferred to the Wizard — that is all the declaration reads (`source.hasEffect`) — then Ray of Frost on the Zombie at
 *    5 ft → +1d8 necrotic; the same shot at 15 ft does not carry it.
 * The rolls are random: we replay until a hit.
 */
export default {
  name: "dégâts bonus — Maître d'armes lourdes (+ maîtrise), Voile spirituel (+1d8 nécrotique à 10 ft)",

  async run(ctx) {
    const warrior = await ctx.token("Guerrier");
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));

    /** Shoots until it hits; returns the resolution and the damage roll formula. */
    const hitWith = async (token, identifier, activityType) => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: token.id, identifier, activityType, targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId);
        const target = r.targets.find(t => t.name === "Zombi");
        if ( !target?.hit ) continue;
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        // Bonus damage is added as a separate roll in the same message (runtime/triggers.mjs): all the rolls.
        return { r, target, formula: (damage?.rolls ?? []).map(x => x.formula).join(" | "), damages: r.damageRoll?.damages ?? [] };
      }
      return null;
    };

    // --- Great Weapon Master -------------------------------------------------------------------------------------
    await ctx.ensureItem(warrior, "Compendium.dnd-players-handbook.feats.Item.phbftGreatWeapon");
    const wPos = await ctx.position(warrior);
    await ctx.call("move-token", { tokenId: zombi.id, x: wPos.x + grid, y: wPos.y, elevation: wPos.elevation });
    const prof = (await ctx.call("get-actor", { actorId: warrior.actorId })).system?.attributes?.prof ?? 2;
    // The bonus only applies on its own turn (`source.onOwnTurn`, content/triggers.mjs): a combat, on the Fighter's turn.
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    await ctx.startCombat([warrior, zombi]);
    const combat = await state();
    for ( const [t, v] of [[warrior, 20], [zombi, 1]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    }
    for ( let i = 0; (i < 3) && ((await current()) !== warrior.id); i++ ) {
      await ctx.call("previous-turn", { combatId: ctx.ownCombat });
      await new Promise(r => setTimeout(r, 1500));
    }
    ctx.expect((await current()) === warrior.id, "combat : au tour du Guerrier");
    const gwm = await hitWith(warrior, "greatsword", "attack");
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    if ( !gwm ) ctx.expect(false, "Maître d'armes lourdes : aucun toucher en 20 essais");
    else ctx.expect(gwm.formula.split(" | ").slice(1).some(f => f.trim() === String(prof)),
      `Maître d'armes lourdes : un jet de + ${prof} (bonus de maîtrise) s'ajoute — « ${gwm.formula} »`);

    // --- Voile spirituel -----------------------------------------------------------------------------------------
    const itemData = {
      name: "Voile spirituel (scénario)", type: "feat", img: "icons/svg/aura.svg",
      system: { identifier: "spirit-shroud" },
      effects: [{ name: "Voile spirituel", img: "icons/svg/aura.svg", transfer: true, disabled: false, changes: [] }]
    };
    const up = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "system.identifier", value: "spirit-shroud" } });
    const shroudId = up.itemId ?? up.id ?? up.item?._id ?? await ctx.itemId(mage.id, "spirit-shroud");
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: shroudId }).catch(() => {}));
    const mPos = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - grid, y: mPos.y, elevation: mPos.elevation });
    const near = await hitWith(mage, "ray-of-frost", "attack");
    if ( !near ) ctx.expect(false, "Voile spirituel : aucun toucher à 5 ft en 20 essais");
    else ctx.expect(near.damages.some(d => d.type === "necrotic") || /necrotic/.test(near.formula),
      `Voile spirituel à 5 ft : dégâts nécrotiques ajoutés (${JSON.stringify(near.damages.map(d => d.type))}, « ${near.formula} »)`);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - 3 * grid, y: mPos.y, elevation: mPos.elevation });
    const far = await hitWith(mage, "ray-of-frost", "attack");
    if ( !far ) ctx.expect(false, "Voile spirituel : aucun toucher à 15 ft en 20 essais");
    else ctx.expect(!far.damages.some(d => d.type === "necrotic") && !/necrotic/.test(far.formula),
      `Voile spirituel à 15 ft : rien d'ajouté (${JSON.stringify(far.damages.map(d => d.type))})`);
  }
};
