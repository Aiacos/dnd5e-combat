/**
 * At 0 Hit Points (SPEC §17): the Fighter (PC without player) is brought to 0 HP in a scenario combat.
 *  1. The Wizard's Ray of Frost on the Fighter, replayed until a hit: damage at 0 HP = one failed death saving throw
 *     (two on a Critical Hit), written by the engine's resolution, and said in the chat.
 *  2. Start of its turn: the engine rolls its death saving throw (no player owns it).
 * Reset: HP, counters, conditions.
 */
const deathOf = async (ctx, token) => {
  const actor = await ctx.call("get-actor", { actorId: token.actorId });
  const system = actor.system ?? actor.actor?.system ?? {};
  return { success: system.attributes?.death?.success ?? 0, failure: system.attributes?.death?.failure ?? 0 };
};

export default {
  name: "0 PV — dégâts à 0 PV (échec), jet contre la mort au début du tour",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");
    const hp0 = await ctx.hp(guerrier);
    const resetDeath = () => ctx.call("update-actor", { actorId: guerrier.actorId, actorData: {
      "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } });
    ctx.restore(async () => {
      await ctx.setHp(guerrier, hp0);
      await resetDeath();
      for ( const s of ["unconscious", "incapacitated", "prone", "dead", "stable", "bloodied"] ) await ctx.removeStatusEffects(guerrier, s);
    });

    await ctx.startCombat([guerrier, mage]);
    await ctx.setHp(guerrier, 0);
    await resetDeath();

    // 1. Damage at 0 HP, through a real engine resolution.
    let hit = null;
    for ( let i = 0; i < 20 && !hit; i++ ) {
      await resetDeath();
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [guerrier.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Guerrier");
      if ( !target?.hit ) continue;
      await new Promise(res => setTimeout(res, 1500));
      const messages = await ctx.messagesSince(since);
      // A Critical Hit at least equal to max HP kills outright (2024 rule): case not checked here, hit replayed.
      if ( messages.some(m => m.flags?.["dnd5e-combat"]?.death?.kind === "massive") ) {
        for ( const s of ["dead", "unconscious", "incapacitated", "prone"] ) await ctx.removeStatusEffects(guerrier, s);
        await ctx.setHp(guerrier, 0);
        continue;
      }
      hit = { target, death: await deathOf(ctx, guerrier), messages };
    }
    if ( !ctx.expect(!!hit, "le Rayon de givre touche le Guerrier (20 essais au plus)") ) return;
    const expected = hit.target.critical ? 2 : 1;
    ctx.expect(hit.death.failure === expected,
      `dégâts à 0 PV${hit.target.critical ? " (critique)" : ""} : ${hit.death.failure} échec(s) contre la mort, attendu ${expected}`);
    const said = hit.messages.find(m => m.flags?.["dnd5e-combat"]?.death?.kind === "failure");
    ctx.expect(!!said, `le chat le dit (${said ? "carte « échec »" : "aucune carte"})`);

    // 2. Start of its turn: the engine rolls its death saving throw.
    await resetDeath();
    const combat = await ctx.combat();
    const turns = combat.turns ?? combat.combat?.turns ?? combat.combatants ?? [];
    let rolled = null;
    for ( let i = 0; i < Math.max(2, turns.length) + 1 && !rolled; i++ ) {
      await ctx.nextTurn();
      await new Promise(res => setTimeout(res, 2500));
      const death = await deathOf(ctx, guerrier);
      // A natural 20 restores 1 HP and resets the counters to zero: it is also a roll made.
      if ( ((death.success + death.failure) > 0) || ((await ctx.hp(guerrier)) > 0) ) rolled = death;
    }
    ctx.expect(!!rolled, `au début de son tour, un jet contre la mort a été lancé (${rolled ? `${rolled.success} réussite / ${rolled.failure} échec` : "rien"})`);
  }
};
