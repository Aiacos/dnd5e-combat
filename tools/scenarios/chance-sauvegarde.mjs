/**
 * Chance of failing a saving throw (SPEC §15.3, debt settled on 2026-09-27): what the badge computes must be the roll the
 * target will make. The Cleric casts (at will) Command (Wisdom) and Hold Person (Wisdom) on the Zombie and the Fighter: the
 * computed bonus (`api.mcp.saveChance`) = the fixed part of the real roll (total − die), the DC = the plan's; then Bless on the
 * Fighter: the computation carries +1d4 and the chance of failing drops; finally the Paralyzed Zombie automatically fails a
 * Dexterity saving throw ("Snowstorm"): 100 %.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };

export default {
  name: "chance de sauvegarde — calcul = vrai jet, Bénédiction, échec d'office",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbsplCommand000", "phbsplHoldPerson", "phbsplBless00000", "phbsplSleetStorm"] ) await ctx.ensureItem(cleric, SRD + id, atWill);
    const pattern = /Béni|Bless|Paralys|Injonction|Command|Immobil|Hold|concentr/i;
    const cleanup = async () => {
      for ( const t of [cleric, fighter, zombi] ) {
        await ctx.removeEffectsNamed(t, pattern);
        await ctx.removeEffectsFrom(t, "bless", "command", "hold-person", "sleet-storm");   // quelle que soit la langue
      }
      await ctx.removeStatusEffects(zombi, "paralyzed");
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: false }).catch(() => {});
    };
    ctx.restore(cleanup);
    const chance = async (target, identifier) => ctx.engine("saveChance", { casterId: cleric.id, targetId: target.id, itemId: await ctx.itemId(cleric.id, identifier) });

    /** The real roll: rolled, read; returns { total, die, dc }. */
    const realSave = async (target, identifier) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, activityType: "save", consume: false, targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { order: "halt" } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      const save = (await ctx.messagesSince(used.usageMessageId)).find(m => (m.type === "save") && (m.alias === target.name));
      const roll = rollOf(save);
      // The connector returns the summarized rolls (`dice`: faces and results), plus their `terms` (seen on 2026-09-28).
      const die = (roll?.terms ?? roll?.dice)?.find(t => (t.class === "D20Die") || (t.faces === 20))?.results?.find(x => x.active !== false)?.result ?? null;
      await pause(800);
      await cleanup();
      return { total: roll?.total ?? null, die, dc: r?.plan?.save?.dc ?? null, formula: roll?.formula ?? "" };
    };

    for ( const [target, identifier] of [[zombi, "command"], [fighter, "command"], [fighter, "hold-person"]] ) {
      const c = await chance(target, identifier);
      const real = await realSave(target, identifier);
      if ( !ctx.expect(!!c && (real.total !== null) && (real.die !== null), `${identifier} sur ${target.name} : calcul et vrai jet lus (${real.formula})`) ) continue;
      ctx.expect(c.dc === real.dc, `${identifier} sur ${target.name} : DD calculé ${c.dc} = DD du plan ${real.dc}`);
      ctx.expect(!c.dice.length && (c.bonus === real.total - real.die), `${identifier} sur ${target.name} : bonus calculé ${c.bonus >= 0 ? "+" : ""}${c.bonus} = vrai jet ${real.total} − dé ${real.die} (${real.formula})`);
      ctx.log(`${identifier} sur ${target.name} : ${Math.round(c.fail * 100)} % d'échec (DD ${c.dc}, ${c.ability} ${c.bonus})`);
    }

    // Bless: +1d4 in the computation, the chance of failing drops.
    const before = await chance(fighter, "command");
    await ctx.use({ tokenId: cleric.id, identifier: "bless", consume: false, targetTokenIds: [fighter.id] });
    // The effect arrives at the end of the animation: we wait for it (10 s at most).
    for ( const until = Date.now() + 10000; (Date.now() < until) && !(await ctx.effectsFrom(fighter, "bless")).length; ) await pause(500);
    const blessed = await chance(fighter, "command");
    ctx.expect(blessed?.dice?.some(d => (d.faces === 4) && (d.sign !== -1)) && (blessed.fail < before.fail),
      `Bénédiction : +1d4 compté, échec ${Math.round(before.fail * 100)} % → ${Math.round(blessed.fail * 100)} %`);
    await cleanup();

    // Paralyzed: Dexterity saving throw automatically failed.
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: true });
    await pause(1000);
    const para = await chance(zombi, "sleet-storm");
    ctx.expect(para?.autoFail === "paralyzed" && para.fail === 1, `Zombi Paralysé, Tempête de neige (Dex) : échec d'office, ${Math.round((para?.fail ?? 0) * 100)} %`);
  }
};
