/**
 * §181: the factions. The Bandit and the Zombie, both Hostile, are allies as long as nothing is set; put in factions
 * hostile to each other, they become enemies for the engine's rules (Opportunity Attack), with no change for the
 * Fighter. Then: neutral relation, the Bandit hits the Zombie → grudge on the scene (hostile); explicit relation with the PCs →
 * the Bandit's disposition follows. Restores: factions setting, grudges, flags, disposition, HP, positions.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "factions — bandit et zombi ennemis par la matrice, rancune, disposition déduite",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Bandit absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const f = args => ctx.engine("factions", args);
    // Vision cones (§182) are not the subject: out of combat, the Zombie would not see the Bandit placed next to it.
    const cones = await ctx.engine("setting", { key: "visionCones", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "visionCones", value: cones.before }));

    const snap = await f({ op: "snapshot" });
    ctx.restore(() => f({ op: "restore", value: snap.value, clear: true }));
    ctx.restore(() => f({ op: "assign", tokenIds: [bandit.id], faction: null }));
    const { data: banditData } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { disposition: banditData.disposition } }));
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // A test world that already had factions: we start from a blank setting (the default, no relation).
    await f({ op: "restore", value: { factions: snap.value?.factions ?? [], relations: {} }, clear: true });

    // The Bandit in contact with the Zombie, to its right.
    const grid = await ctx.gridSize();
    const { data: z } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    await ctx.stage({ tokens: { Bandit: [z.x + grid, z.y] } });
    await pause(400);
    // Opportunity Attacks are only judged in a combat that has started.
    await ctx.startCombat([zombi, bandit]);
    await pause(400);
    const away = { x: z.x + (grid * 5.5), y: z.y + (grid / 2) };
    const threatened = async () => (await ctx.engine("threats", { tokenId: bandit.id, point: away })).includes("Zombi");

    // 1. Nothing set: the disposition decides (two Hostiles = same side).
    const before = await f({ op: "between", aId: bandit.id, bId: zombi.id });
    const pc = (await f({ op: "between", aId: guerrier.id, bId: zombi.id })).relation;
    ctx.expect(before.relation === "allied", `sans faction réglée : Bandit et Zombi « ${before.relation} » (attendu allied)`);
    ctx.expect(!(await threatened()), "sans faction réglée : le Zombi ne menace pas le Bandit qui s'éloigne");

    // 2. Bandits' faction, hostile to the Undead (the Zombie is in it by the type rule).
    const { id } = await f({ op: "add", name: "Bandits (test)" });
    await f({ op: "assign", tokenIds: [bandit.id], faction: id });
    const state = await f({ tokenIds: [bandit.id, zombi.id, guerrier.id] });
    ctx.expect(state.tokens[0].faction === id && state.tokens[1].faction === "undead" && state.tokens[2].faction === "party",
      `factions : ${state.tokens.map(t => `${t.name} = ${t.faction}`).join(", ")}`);
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "allied", "faction posée sans relation : toujours la disposition");
    await f({ op: "relation", a: id, b: "undead", relation: "hostile" });
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "hostile", "matrice bandits ↔ morts-vivants hostile : ennemis");
    ctx.expect(await threatened(), "le Zombi menace maintenant le Bandit qui s'éloigne (attaque d'opportunité)");
    ctx.expect((await f({ op: "between", aId: guerrier.id, bId: zombi.id })).relation === pc, `Guerrier ↔ Zombi inchangé (${pc})`);

    // 3. Neutral; the Bandit hits the Zombie: grudge, they become hostile again on this scene.
    await f({ op: "relation", a: id, b: "undead", relation: "neutral" });
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "neutral", "matrice neutre : neutres");
    ctx.expect(!(await threatened()), "neutres : pas d'attaque d'opportunité");
    const used = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [zombi.id] }).catch(err => ({ error: err.message }));
    if ( used.used ) {
      await ctx.settle(used.usageMessageId).catch(() => null);
      let grudges = [];
      for ( let i = 0; (i < 20) && !grudges.length; i++ ) { await pause(300); grudges = (await f({ op: "grudges" })).grudges; }
      ctx.expect(grudges.some(g => g.includes(id) && g.includes("undead")), `rancune notée : ${JSON.stringify(grudges)}`);
      ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "hostile", "après l'attaque : hostiles (rancune)");
      await f({ op: "grudges", clear: true });
    }
    else ctx.log(`attaque du Bandit impossible (${used.error ?? "pas d'activité scimitar"}) : rancune non vérifiée`);

    // 4. Explicit relation with the PCs: the Bandit's disposition follows.
    await f({ op: "relation", a: id, b: "party", relation: "neutral" });
    await pause(500);
    const after = await f({ tokenIds: [bandit.id] });
    ctx.expect(after.tokens[0].disposition === 0, `bandits ↔ PJ neutres : disposition du Bandit ${after.tokens[0].disposition} (attendu 0)`);
    ctx.expect((await f({ op: "between", aId: guerrier.id, bId: bandit.id })).relation === "neutral", "Guerrier ↔ Bandit neutres");
  }
};
