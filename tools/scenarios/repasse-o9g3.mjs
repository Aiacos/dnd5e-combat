/**
 * §362, batch O9g of the item pass: Boots of Speed. Test arena (Fighter, Zombie).
 *  Boots created from the Guide (the data fix makes "Click Heels" target "self"), worn and attuned, the Zombie designated
 *  as the target: before, no Disadvantage on Opportunity Attacks; "Click Heels" — the effect is on the Fighter (not on the Zombie),
 *  its Speed doubles, and Opportunity Attacks against it have Disadvantage.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9g3 — Bottes de rapidité : talons claqués, Vitesse doublée, attaques d'opportunité au Désavantage",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const [fighter, zombi] = await Promise.all(["Guerrier", "Zombi"].map(n => ctx.token(n)));
    const fixes = await ctx.engine("setting", { key: "dataFixes" });
    ctx.restore(() => ctx.engine("setting", { key: "dataFixes", value: fixes.before }));
    await ctx.engine("setting", { key: "dataFixes", value: true });
    ctx.restore(async () => { for ( const t of [fighter, zombi] ) await ctx.removeEffectsNamed(t, /Boots of Speed|rapidit/i).catch(() => {}); });
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const boots = await ctx.ensureItem(fighter, `${DMG}dmgBootsOfSpeed0`);
    await pause(1500);
    await ctx.call("upsert-actor-item", { actorId: ftok.actorId, itemData: { system: { equipped: true, attuned: true } }, match: { path: "_id", value: boots } });
    await pause(500);
    const walk = async t => (await ctx.engine("stats", { tokenId: t.id }))?.speeds?.walk;
    const walk0 = await walk(fighter);
    const before = await ctx.engine("hampered", { tokenId: fighter.id });
    const used = await ctx.use({ tokenId: fighter.id, itemId: boots, activityId: "ffXywPJdVzwe6NId", consume: false, targetTokenIds: [zombi.id],
      usageConfig: { [MODULE_ID]: { confirmed: true } } }).catch(err => ({ error: err.message }));
    if ( used.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
    await pause(2000);
    const onFighter = (await ctx.effects(fighter)).some(e => /Boots of Speed/i.test(e.name ?? ""));
    const onZombi = (await ctx.effects(zombi)).some(e => /Boots of Speed/i.test(e.name ?? ""));
    ctx.expect(onFighter && !onZombi, `« Click Heels » : l'effet est sur le Guerrier (${onFighter}), pas sur le Zombi ciblé (${onZombi})`);
    const walk1 = await walk(fighter);
    ctx.expect(walk1 === 2 * walk0, `Vitesse doublée : ${walk0} → ${walk1}`);
    const after = await ctx.engine("hampered", { tokenId: fighter.id });
    ctx.expect(!before && /Speed|rapidit/i.test(after ?? ""), `attaques d'opportunité au Désavantage seulement talons claqués (${before} → ${after})`);
  }
};
