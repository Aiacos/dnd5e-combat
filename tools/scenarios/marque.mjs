/**
 * Brick B10 "consumed mark" (SPEC §16.12):
 *  1. Guiding Bolt (PHB, given to the Wizard for the scenario) hits the Zombie → mark (effect "Guiding Bolt");
 *     the Fighter attacks the Zombie → their roll has the declared advantage (reason `content`) and the mark falls.
 *  2. Vicious Mockery (PHB): the Zombie fails its saving throw → effect "Mocked"; it attacks the Wizard → its roll has the
 *     declared disadvantage and the effect falls.
 * The consumption is played by the active GM; the advantage reasons are written under the roll by the client that USES
 * the attack (the GM's one that carries the connector): this part requires that client to have code ≥ 0.39.0 (F5).
 * The items are given BEFORE registering the restorations: the effects fall before their items are removed.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "marque — Rayon traçant consommé par l'attaque suivante, Moquerie cruelle par la sienne",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const boltId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplGuidingBol");
    const mockId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplViciousMoc");
    const hp0 = { z: await ctx.hp(zombi), m: await ctx.hp(mage), f: await ctx.hp(fighter) };
    ctx.restore(() => ctx.setHp(zombi, hp0.z));
    ctx.restore(() => ctx.setHp(mage, hp0.m));
    ctx.restore(() => ctx.setHp(fighter, hp0.f));
    // By origin (the spell's item), not by name: Babele translates effect names on the connector's client.
    const zombiEffects = async itemId => (await ctx.effects(zombi)).filter(e => JSON.stringify([e.origin, e.system?.origin]).includes(itemId));
    const modifiersOf = async usageId => {
      const m = (await ctx.messagesSince(usageId)).find(x => x.type === "attack");
      return m?.flags?.["dnd5e-combat"]?.modifiers ?? { advantage: [], disadvantage: [] };
    };
    const weaponOf = async token => {
      const items = (await ctx.call("get-actor", { actorId: token.actorId })).items ?? [];
      return items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack")
        && (i.system?.equipped !== false));
    };

    // 1. Guiding Bolt.
    let marked = false;
    for ( let i = 0; i < 20 && !marked; i++ ) {
      await ctx.setHp(zombi, hp0.z);
      const used = await ctx.use({ tokenId: mage.id, identifier: "guiding-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      marked = !!r.targets.find(t => t.name === "Zombi")?.hit;
    }
    if ( !ctx.expect(marked, "Rayon traçant touche le Zombi (20 essais au plus)") ) return;
    await pause(1200);
    ctx.expect((await zombiEffects(boltId)).length === 1, "marque posée sur le Zombi");
    const sword = await weaponOf(fighter);
    const second = await ctx.use({ tokenId: fighter.id, itemId: sword._id, activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(second.usageMessageId);
    await pause(1500);
    const m1 = await modifiersOf(second.usageMessageId);
    ctx.expect((m1.advantage ?? []).some(r => r.who === "content"), `le Guerrier attaque avec l'avantage déclaré (${(m1.advantage ?? []).map(r => r.key).join(", ") || "aucun"})`);
    ctx.expect((await zombiEffects(boltId)).length === 0, "la marque est consommée par cette attaque");

    // 2. Moquerie cruelle.
    let mocked = false;
    for ( let i = 0; i < 20 && !mocked; i++ ) {
      await ctx.setHp(zombi, hp0.z);
      const used = await ctx.use({ tokenId: mage.id, identifier: "vicious-mockery", activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      mocked = r.targets.find(t => t.name === "Zombi")?.save?.success === false;
    }
    if ( !ctx.expect(mocked, "le Zombi rate sa sauvegarde contre la Moquerie cruelle (20 essais au plus)") ) return;
    await pause(1200);
    ctx.expect((await zombiEffects(mockId)).length === 1, "effet « Mocked » sur le Zombi");
    const slam = await weaponOf(zombi);
    const bite = await ctx.use({ tokenId: zombi.id, itemId: slam._id, activityType: "attack", targetTokenIds: [mage.id] });
    await ctx.settle(bite.usageMessageId);
    await pause(1500);
    const m2 = await modifiersOf(bite.usageMessageId);
    ctx.expect((m2.disadvantage ?? []).some(r => r.who === "content"), `le Zombi attaque avec le désavantage déclaré (${(m2.disadvantage ?? []).map(r => r.key).join(", ") || "aucun"})`);
    ctx.expect((await zombiEffects(mockId)).length === 0, "l'effet est consommé par son attaque");
  }
};
