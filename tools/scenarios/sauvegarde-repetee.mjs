/**
 * "Repeated saving throw" brick (SPEC §16): Hold Person (added to the Wizard for the
 * scenario) on the Fighter — a Humanoid, as the spell requires (§16.8: on the Zombie, an Undead, it has no
 * effect) —, until a failure (Paralyzed placed). Then a combat: at the END of each of the Fighter's turns,
 * the engine rolls the saving throw again (use message marked `resave`); succeeded, the effect is removed;
 * failed, it stays. Content `hold-person`: `{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }`.
 */
export default {
  name: "sauvegarde répétée — Immobilisation de personne, fin de tour du Guerrier",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");   // PC without a player: the engine rolls for him
    ctx.restore(() => ctx.removeStatusEffects(guerrier, "paralyzed"));
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplHoldPerson");

    let held = null;
    for ( let i = 0; i < 20 && !held; i++ ) {
      const used = await ctx.use({ tokenId: mage.id, identifier: "hold-person", activityType: "save", targetTokenIds: [guerrier.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Guerrier");
      if ( !target?.save ) { ctx.expect(false, "le Guerrier n'a pas fait de sauvegarde"); return; }
      if ( !target.save.success ) held = { r, target };
    }
    if ( !held ) { ctx.expect(false, "aucun échec en 20 essais"); return; }
    const paralyzed = (await ctx.effects(guerrier)).find(e => (e.statuses ?? []).includes("paralyzed"));
    ctx.expect(!!paralyzed, `échec (${held.target.save.total} < DD ${held.r.plan.save.dc}) : Paralysé posé sur le Guerrier`);
    if ( !paralyzed ) return;

    await ctx.startCombat([mage, guerrier]);
    const since = held.r.origin;
    let removed = false;
    let resaves = 0;
    // The Fighter (Wisdom +0) succeeds on ~40 % of his Wisdom saving throws: thirty turns (fifteen tries) leave under one
    // chance in a thousand of never succeeding (six failures in a row seen on 2026-09-24 with twelve turns).
    for ( let turn = 0; turn < 30 && !removed; turn++ ) {
      await ctx.nextTurn();
      await new Promise(res => setTimeout(res, 2500));
      const messages = await ctx.messagesSince(since);
      const resave = messages.filter(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.resave ?? m.flags?.resave)).at(-1);
      if ( !resave || resave.__seen ) continue;
      const r = await ctx.settle(resave.id);
      const t = r.targets.find(x => x.name === "Guerrier");
      if ( !t?.save || (resaves && (resave.id === ctx._lastResave)) ) continue;
      ctx._lastResave = resave.id;
      resaves++;
      ctx.expect(r.plan.effects.length === 0 && r.plan.damage === null, "le rejeu ne demande que la sauvegarde (ni effet ni dégâts)");
      ctx.expect(t.save.success === (t.save.total >= r.plan.save.dc), `sauvegarde répétée ${t.save.total} contre DD ${r.plan.save.dc} : ${t.save.success ? "réussie" : "ratée"}`);
      await new Promise(res => setTimeout(res, 800));
      const still = (await ctx.effects(guerrier)).some(e => (e.statuses ?? []).includes("paralyzed"));
      if ( t.save.success ) { ctx.expect(!still, "réussie : Paralysé retiré du Guerrier"); removed = !still; }
      else ctx.expect(still, "ratée : Paralysé toujours là");
    }
    ctx.expect(resaves > 0, `au moins une sauvegarde répétée jouée (${resaves})`);
    ctx.expect(removed, "l'effet a fini par tomber sur une réussite (en 30 tours au plus)");
  }
};
