/**
 * §340, batch O5b of the item pass: extra damage against a creature type, including through enchantment. Test arena
 * (Fighter, Zombie — an Undead).
 *  1. Holy Avenger placed on a Longsword (Guide enchantment): on a hit, the Zombie takes 2d10 extra radiant.
 *  2. Radiant Blade (its own identifier): 1d8 extra radiant against the Zombie.
 *  3. The ordinary Longsword, without enchantment: nothing extra.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };

export default {
  name: "repasse-o5b — dégâts en plus contre un type de créature (Vengeresse sacrée enchantée, Épée radieuse)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    /** Attacks until a hit (20 tries at most); returns the damage roll formula, or null. */
    const hitFormula = async itemId => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: fighter.id, itemId, activityType: "attack", consume: false, targetTokenIds: [zombi.id],
          usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.hit !== true ) continue;
        await pause(800);
        const damage = (await ctx.messagesSince(since)).filter(m => (m.type === "damage") || /damage/i.test(m.flags?.dnd5e?.roll?.type ?? ""));
        return damage.flatMap(m => (m.rolls ?? []).map(r => ((typeof r === "string") ? JSON.parse(r) : r)?.formula ?? "")).join(" + ");
      }
      return null;
    };

    // 1. Holy Avenger enchanting a Longsword.
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    // Guide 3.0.0: the activities of attunement items are hidden while the item is not attuned (`visibility.requireMagic`,
    // dnd5e refuses "Using this activity isn't currently possible") — items lent equipped and attuned (`ready`).
    const avenger = await ctx.ensureItem(fighter, `${DMG}dmgHolyAvenger00`, { ready: true });
    const { effectId } = await ctx.engine("enchant", { tokenId: fighter.id, itemId: avenger, activityId: "IMVUc41lxWG8Hyq3", targetItemId: sword });
    if ( !ctx.expect(!!effectId, "la Vengeresse sacrée enchante l'Épée longue") ) return;
    const enchanted = await hitFormula(sword);
    ctx.expect(/2d10/.test(enchanted ?? ""), `touché, le Zombi prend 2d10 radiants de plus (${enchanted})`);
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    // The enchanted sword removed; a new Longsword, without enchantment.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: sword }).catch(() => null);
    await pause(500);
    const fresh = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);

    // 3. Sans enchantement.
    const plain = await hitFormula(fresh);
    ctx.expect(plain !== null && !/2d10/.test(plain), `sans l'enchantement, rien de plus (${plain})`);

    // 2. Radiant Blade.
    const sun = await ctx.ensureItem(fighter, `${DMG}dmgSunBlade00000`, { ready: true });
    const radiant = await hitFormula(sun);
    // 1d8 extra, doubled to 2d8 on a Critical Hit.
    ctx.expect(/\+ [12]d8$/.test(radiant ?? ""), `Épée radieuse : 1d8 radiant de plus (${radiant})`);
  }
};
