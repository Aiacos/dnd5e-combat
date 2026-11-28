/**
 * Dark One's Blessing (SPEC §16.25, `onFell`): an enemy reduced to 0 HP by the warlock — or by another within 10 ft of
 * him — gives him Temporary Hit Points (Charisma + warlock level). World `ravenloft`: Kaalisti, Rahadin left at 1 HP;
 * the other killer is Sylaene. World `dnd-6`: not applicable as long as no Fiend warlock is there.
 */
const VICTIMS = ["Rahadin, chambellan du château", "Zombi"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "ennemi tombé — Bénédiction du Ténébreux",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const victimName = VICTIMS.find(n => tokens.some(t => t.name === n));
    if ( !tokens.some(t => t.name === "Kaalisti") || !victimName ) { ctx.log("ni Kaalisti ni victime sur la scène : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    const victim = await ctx.token(victimName);
    const grid = await ctx.gridSize();
    const at = await ctx.position(warlock);
    const actor = await ctx.call("get-actor", { actorId: warlock.actorId });
    const expected = Math.max(1, Math.floor((actor.system.abilities.cha.value - 10) / 2) + 5);
    const temp = async () => (await ctx.call("get-actor", { actorId: warlock.actorId })).system.attributes.hp.temp ?? 0;
    const setTemp = value => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.attributes.hp.temp": value } });
    const temp0 = await temp();
    ctx.restore(() => setTemp(temp0));

    /** Drops the victim (1 HP) under `killer`'s blows; returns the resolution of the blow that felled it. */
    const fell = async (killer, identifier) => {
      for ( let n = 1; n <= 12; n++ ) {
        await ctx.setHp(victim, 1);
        const used = await ctx.use({ tokenId: killer.id, identifier, activityType: "attack", targetTokenIds: [victim.id] });
        // 60 s: when the GM's chat log is not displayed, each 3D dice wait goes to its maximum (8 s).
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 });
        if ( r.targets[0]?.hit && ((await ctx.hp(victim)) === 0) ) return r;
      }
      return null;
    };

    // 1. Kaalisti abat Rahadin au contact.
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + grid, y: at.y });
    await setTemp(0);
    const own = await fell(warlock, "greatsword");
    ctx.expect(!!own, `${victimName} tombe sous les coups de Kaalisti`);
    if ( own ) {
      await pause(3000);
      ctx.expect((await temp()) === expected, `Kaalisti gagne ${expected} PV temporaires (${await temp()})`);
    }

    // 2. Another fells it within 10 ft of Kaalisti: the blessing plays too.
    const other = tokens.find(t => (t.name === "Sylaene")) ?? null;
    if ( !other ) return;
    const sylaene = await ctx.token("Sylaene");
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + (2 * grid), y: at.y });
    await ctx.call("move-token", { tokenId: sylaene.id, x: at.x + (3 * grid), y: at.y });
    await setTemp(0);
    const items = (await ctx.call("get-actor", { actorId: sylaene.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    ctx.expect(!!weapon, `Sylaene a une arme (${weapon?.name})`);
    if ( !weapon ) return;
    const near = await fell(sylaene, weapon.system.identifier);
    ctx.expect(!!near, `${victimName} tombe sous les coups de Sylaene, à 10 ft de Kaalisti`);
    if ( near ) {
      await pause(3000);
      ctx.expect((await temp()) === expected, `Kaalisti gagne ${expected} PV temporaires (${await temp()})`);
    }
  }
};
