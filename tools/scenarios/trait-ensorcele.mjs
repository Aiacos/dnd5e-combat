/**
 * Witch Bolt (SPEC §16.43, keys `tether` and `ranges`). World `ravenloft`: Kaalisti (Warlock 5) and the Zombie.
 *  1. The attack links the Zombie, hit or miss (`flags["dnd5e-combat"].tethers.<id d'item>` on Kaalisti).
 *  2. The "1d12 lightning" Bonus Action (activity `ffuqn0xdclG9YAQt`) targets it (its damage: by hand, the connector does not
 *     roll it).
 *  3. The Zombie moved away beyond 60 ft: the link breaks, Concentration ends, the link is forgotten.
 * Not applicable without Kaalisti and the Zombie. Resets HP, position and Concentration.
 */
const MODULE_ID = "dnd5e-combat";
const FOLLOW = "ffuqn0xdclG9YAQt";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Trait ensorcelé — lien, action Bonus, rupture hors de portée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Kaalisti", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Kaalisti ou le Zombi absent : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    const start = await ctx.position(zombi);
    const at = await ctx.position(warlock);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: start.x, y: start.y }).catch(() => {}));
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Foudre continue|Witch Bolt/i));

    // The Zombie 20 ft from Kaalisti.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + (4 * grid), y: at.y });
    const itemId = await ctx.itemId(warlock.id, "witch-bolt");
    const tethered = async () => (await ctx.call("get-actor", { actorId: warlock.actorId })).flags?.[MODULE_ID]?.tethers?.[itemId] ?? null;

    // 1. L'attaque lie le Zombi.
    const used = await ctx.use({ tokenId: warlock.id, identifier: "witch-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
    const r = await ctx.settle(used.usageMessageId).catch(() => null);
    await pause(1500);
    const bound = await tethered();
    ctx.expect(!!bound && bound.endsWith(zombi.id), `lien noté (${r?.targets?.[0]?.hit ? "touché" : "raté"}) : ${bound}`);

    // 2. The Bonus Action: 1d12 automatically.
    // The connector cuts dnd5e's chain (`subsequentActions: false`): the damage roll of a "damage" activity is never
    // rolled here. We check that the Bonus Action targets the linked creature; the damage is checked by hand.
    const follow = await ctx.use({ tokenId: warlock.id, identifier: "witch-bolt", activityId: FOLLOW, targetTokenIds: [zombi.id] });
    await pause(1500);
    const rf = await ctx.resolution(follow.usageMessageId);
    const names = (rf?.targets ?? []).map(t => t.name);
    ctx.expect(follow.used && names.includes("Zombi") && !(rf?.targets ?? []).some(t => t.unaffected), `action Bonus : vise le Zombi (${names.join(", ") || "aucune cible"})`);

    // 3. Beyond 60 ft: the spell ends.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + (14 * grid), y: at.y });
    await pause(2500);
    const concentration = ((await ctx.call("get-actor", { actorId: warlock.actorId })).effects ?? []).some(e => (e.statuses ?? []).includes("concentrating"));
    ctx.expect(!concentration, "Zombi à 70 ft : la concentration de Kaalisti tombe");
    ctx.expect(!(await tethered()), "le lien est oublié");
  }
};
