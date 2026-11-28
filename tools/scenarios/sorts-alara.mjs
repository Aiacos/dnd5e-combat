/**
 * Spell rules (SPEC §16.47), world `ravenloft`: Alara (cleric), Bramo, the Zombie.
 *  1. Invisibility on self, then Sacred Flame on the Zombie: the invisibility ends (casting a spell).
 *  2. Guidance on Bramo, Perception profile chosen outright: a single effect placed.
 *  3. Spare the Dying on Bramo standing: nothing (he is not at 0 HP); at 0 HP: Stable; healed: Stable removed.
 *  4. Lesser Restoration on Poisoned Bramo: the condition ends, with no window (a single condition to end).
 *  5. Pass without Trace on self: Bramo, within 9 m, receives the aura copy; Concentration removed, it goes away.
 * Arms of Hadar (Reactions) and Charm Person (Advantage in combat): judged at the moment of a Reaction or a
 * saving throw, outside the scenario. Puts back HP, conditions and Concentration.
 */
const MODULE_ID = "dnd5e-combat";
const PERCEPTION = "qPowjrduxnzKpH8x";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sorts d'Alara — Invisibilité, Assistance, Stabilisation, Restauration partielle, Passage sans trace",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Bramo", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara, Bramo ou le Zombi absent : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const bramo = await ctx.token("Bramo");
    const zombi = await ctx.token("Zombi");
    const hpBramo = await ctx.hp(bramo);
    const hpZombi = await ctx.hp(zombi);
    const names = async token => (await ctx.effects(token)).filter(e => !e.disabled).map(e => e.name);
    const statuses = async token => (await ctx.effects(token)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const dropConcentration = async () => { await ctx.removeEffectsNamed(alara, /concentr/i); await pause(1200); };
    ctx.restore(async () => {
      await ctx.setHp(bramo, hpBramo);
      await ctx.setHp(zombi, hpZombi);
      await ctx.removeEffectsNamed(alara, /Invisib|concentr|Camoufl|Passage/i);
      await ctx.removeEffectsNamed(bramo, /Assistance|Stabilis|Passage|Camoufl/i);
      for ( const s of ["poisoned", "stable", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(bramo, s);
      await ctx.call("update-actor", { actorId: bramo.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } });
    });

    // 1. Invisibility broken by a spell.
    await ctx.use({ tokenId: alara.id, identifier: "invisibility", targetTokenIds: [alara.id] });
    await pause(1500);
    ctx.expect((await statuses(alara)).includes("invisible"), "Invisibilité sur Alara");
    const flame = await ctx.use({ tokenId: alara.id, identifier: "sacred-flame", targetTokenIds: [zombi.id] });
    await ctx.settle(flame.usageMessageId).catch(() => null);
    await pause(1500);
    ctx.expect(!(await statuses(alara)).includes("invisible"), "Flamme sacrée lancée : l'invisibilité cesse");
    await dropConcentration();

    // 2. Assistance : un seul profil.
    await ctx.use({ tokenId: alara.id, identifier: "guidance", targetTokenIds: [bramo.id], usageConfig: { [MODULE_ID]: { choice: PERCEPTION } } });
    await pause(1500);
    const guided = (await names(bramo)).filter(n => /Assistance|Guidance/.test(n));
    ctx.expect(guided.length === 1, `Assistance : un seul effet (${guided.join(", ")})`);
    await dropConcentration();
    await ctx.removeEffectsNamed(bramo, /Assistance|Guidance/);

    // 3. Spare the Dying.
    // The effect is placed at the end of the animation (BLFX, ~2.4 s in `dnd-6`): we wait for the resolution, not a fixed delay.
    const spare = async () => {
      const used = await ctx.use({ tokenId: alara.id, identifier: "spare-the-dying", targetTokenIds: [bramo.id] });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(800);
    };
    await spare();
    ctx.expect(!(await statuses(bramo)).includes("stable"), "Stabilisation sur Bramo debout : rien");
    await ctx.setHp(bramo, 0);
    await pause(1500);
    await spare();
    ctx.expect((await statuses(bramo)).includes("stable"), "Stabilisation sur Bramo à 0 PV : Stabilisé");
    await ctx.setHp(bramo, hpBramo);
    await pause(1500);
    ctx.expect(!(await statuses(bramo)).includes("stable"), "Bramo soigné : Stabilisé retiré");
    for ( const s of ["unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(bramo, s);

    // 4. Restauration partielle.
    await ctx.call("set-status", { tokenId: bramo.id, statusId: "poisoned", active: true });
    await pause(800);
    await ctx.use({ tokenId: alara.id, identifier: "lesser-restoration", targetTokenIds: [bramo.id] });
    await pause(2000);
    ctx.expect(!(await statuses(bramo)).includes("poisoned"), "Restauration partielle : Empoisonné cesse");

    // 5. Pass without Trace (in combat: the "auras in combat only" setting may be active). Bramo near Alara (two cells): these
    //    two are not repositioned by the caster (outside the arena's layout), Bramo may have been left at 50 ft (seen 2026-10-20).
    const bramoHome = await ctx.position(bramo);
    const alaraAt = await ctx.position(alara);
    const g = await ctx.gridSize();
    ctx.restore(() => ctx.call("move-token", { tokenId: bramo.id, x: bramoHome.x, y: bramoHome.y, elevation: bramoHome.elevation ?? 0 }).catch(() => {}));
    await ctx.call("move-token", { tokenId: bramo.id, x: alaraAt.x + (2 * g), y: alaraAt.y, elevation: 0 });
    await pause(800);
    await ctx.startCombat([alara, bramo]);
    await ctx.use({ tokenId: alara.id, identifier: "pass-without-trace", targetTokenIds: [alara.id] });
    await pause(2500);
    const copy = (await ctx.effects(bramo)).find(e => e.flags?.[MODULE_ID]?.aura);
    ctx.expect(!!copy, `Bramo dans l'aura : ${copy?.name ?? "aucune copie"}`);
    await dropConcentration();
    await pause(1500);
    ctx.expect(!(await ctx.effects(bramo)).some(e => e.flags?.[MODULE_ID]?.aura), "concentration retirée : la copie part");
    for ( const l of (await ctx.engineLog()).filter(l => /cesse|ends|aura|Assistance|Aid|Stabilis|Stabiliz/.test(l)).slice(-8) ) ctx.log(l);
  }
};
