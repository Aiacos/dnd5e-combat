/**
 * §369 (GitHub issue #27): flanking, a house rule off by default — the Fighter and the Paladin of `dnd-6` around the Arena's
 * Zombie.
 *  1. "Advantage" setting: Fighter on the left, Paladin on the right → reason "situation.flanking" on the Fighter's melee attack.
 *  2. Paladin above (adjacent sides) → no more flanking.
 *  3. Paladin opposite again but Incapacitated → no more flanking.
 *  4. "NPCs only" → the Fighter (PC) no longer benefits; setting off → nothing.
 * Resets the settings, conditions and positions.
 */
const SETTINGS = ["flanking", "flankingSide", "flankingConga"];

export default {
  name: "prise en tenaille — Avantage de part et d'autre, pas sur des côtés voisins, ni avec un allié Neutralisé",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Paladin", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Paladin et Zombi requis : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const paladin = await ctx.token("Paladin");
    const zombie = await ctx.token("Zombi");
    const size = await ctx.gridSize();
    const z = await ctx.position(zombie);
    // La distribution d'abord : sa remise passe en dernier.
    if ( !(await ctx.stage({ tokens: { Guerrier: [z.x - size, z.y], Paladin: [z.x + size, z.y] } })) ) { ctx.log("distribution refusée"); return; }
    const before = {};
    for ( const key of SETTINGS ) before[key] = (await ctx.engine("setting", { key })).before;
    ctx.restore(async () => { for ( const key of SETTINGS ) await ctx.engine("setting", { key, value: before[key] }).catch(() => {}); });
    const set = (key, value) => ctx.engine("setting", { key, value });
    await set("flanking", "advantage");
    await set("flankingSide", "all");
    await set("flankingConga", false);

    const weapon = ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? []).find(i => (i.type === "weapon")
      && Object.values(i.system?.activities ?? {}).some(a => (a.type === "attack") && (a.attack?.type?.value !== "ranged"))
      && !i.flags?.["dnd5e-combat"]?.basicAction);
    if ( !weapon ) { ctx.log("pas d'arme de corps à corps sur le Guerrier : non applicable"); return; }
    const reasons = async () => (await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: zombie.id, itemId: weapon._id })).advantage;
    const flanked = async () => (await reasons()).includes("situation.flanking");
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

    ctx.expect(await flanked(), `Guerrier et Paladin de part et d'autre : Avantage « prise en tenaille » (${(await reasons()).join(", ") || "aucun"})`);

    await ctx.call("move-token", { tokenId: paladin.id, x: z.x, y: z.y - size, elevation: 0 });
    await pause(600);
    ctx.expect(!(await flanked()), "Paladin au-dessus (côtés voisins) : pas de tenaille");

    await ctx.call("move-token", { tokenId: paladin.id, x: z.x + size, y: z.y, elevation: 0 });
    await pause(600);
    ctx.restore(() => ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: false }));
    await ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: true });
    await pause(600);
    ctx.expect(!(await flanked()), "Paladin en face mais Neutralisé : pas de tenaille");
    await ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: false });
    await pause(600);
    ctx.expect(await flanked(), "Paladin remis d'aplomb : la tenaille revient");

    await set("flankingSide", "npc");
    ctx.expect(!(await flanked()), "« PNJ seulement » : le Guerrier (PJ) n'en profite pas");
    await set("flankingSide", "all");
    await set("flanking", "off");
    ctx.expect(!(await flanked()), "règle désactivée : pas de tenaille");
  }
};
