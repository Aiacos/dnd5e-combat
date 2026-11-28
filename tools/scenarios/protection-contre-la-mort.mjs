/**
 * Death Ward (§73, Player's Handbook 2024): "the first time the target would drop to 0 Hit Points before the spell ends,
 * the target instead drops to 1 Hit Point, and the spell ends".
 *  - a player character on the scene receives the spell (Player's Handbook compendium, no spell slot) and casts it on itself;
 *  - at 5 HP, 12 damage: it stays at 1 HP, the spell's effect is removed, no death condition;
 *  - 12 damage again: the ordinary rule (0 HP, Unconscious).
 * The safety net restores HP, effects and items.
 */
const SPELL = "Compendium.dnd-players-handbook.spells.Item.phbsplDeathWard0";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "protection contre la mort — à 1 PV au lieu de 0, puis le sort prend fin",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    let pcRef = null;
    for ( const t of tokens ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( a?.type === "character" ) { pcRef = t; break; }
    }
    if ( !pcRef ) { ctx.log("aucun personnage joueur sur la scène : non applicable"); return; }
    const pc = await ctx.token(pcRef.name);
    const itemId = await ctx.ensureItem(pc, SPELL, { system: { method: "atwill" } });
    // By the spell's identifier, not by the effect's name ("Protection from Death" in an English client).
    const ward = () => ctx.effectsFrom(pc, "death-ward");

    const used = await ctx.use({ tokenId: pc.id, itemId, targetTokenIds: [pc.id], usageConfig: { "dnd5e-combat": { autoReact: "none" } } });
    ctx.expect(used.used, "Protection contre la mort lancée sur lui-même");
    // The effect arrives at the end of the animation: we wait for it (10 s at most) rather than a fixed delay.
    for ( const until = Date.now() + 10000; (Date.now() < until) && !(await ward()).length; ) await sleep(500);
    ctx.expect((await ward()).length === 1, `l'effet du sort est posé (${(await ctx.effects(pc)).map(e => e.name).join(", ")})`);

    await ctx.setHp(pc, 5);
    const first = (await ctx.engine("hurt", { tokenId: pc.id, amount: 12 })).result ?? null;
    await sleep(2500);
    const hp1 = await ctx.hp(pc);
    ctx.expect(hp1 === 1, `12 dégâts à 5 PV : il reste à 1 PV (${hp1})`);
    ctx.expect((await ward()).length === 0, "le sort prend fin (effet retiré)");
    const statuses = new Set((await ctx.effects(pc)).flatMap(e => e.statuses ?? []));
    ctx.expect(!statuses.has("unconscious") && !statuses.has("dead"), `ni Inconscient ni Mort (${[...statuses].join(", ") || "aucun état"})`);

    await ctx.engine("hurt", { tokenId: pc.id, amount: 12 });
    await sleep(2500);
    const hp2 = await ctx.hp(pc);
    const after = new Set((await ctx.effects(pc)).flatMap(e => e.statuses ?? []));
    ctx.expect((hp2 === 0) && after.has("unconscious"), `sans le sort, 12 dégâts de plus : 0 PV, Inconscient (${hp2} PV, ${[...after].join(", ")})`);
    ctx.log(first ? `dégâts : ${JSON.stringify(first)}` : "");
  }
};
