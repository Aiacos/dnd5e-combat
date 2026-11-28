/**
 * Concentration Breaker (§133, DF #244 of 2026-11-23, §521): the concentrating creature that the author has just wounded has
 * Disadvantage on its Concentration check. The mark was never placed (the wounded actor arrived by its uuid): Mage Slayer
 * did nothing. Test arena, Fighter and Zombie in contact. The Zombie concentrates on a lent Moonbeam (`concentrate`), the
 * Fighter strikes until a hit; the engine rolls the Zombie's Concentration saving throw (runtime/concentration.mjs): its roll
 * is read.
 *  1. control, with nothing: saving throw without Disadvantage;
 *  2. a `mage-slayer` feat (minimal test item: it is the identifier the engine reads): Disadvantage, whatever the weapon;
 *  A mark left from a previous hit is erased before each hit: the one from a hit must hold for ITS saving throw (§523).
 *  3. without the feat, `concentrationBreaker: "item"` on the greatsword (world overlay, #240): Disadvantage with the greatsword,
 *     not with a dagger.
 * Restored: HP, the Zombie's Concentration, feat, lent dagger, overlay, the Zombie's position.
 */
const MODULE_ID = "dnd5e-combat";
const DAGGER = "Compendium.dnd-players-handbook.equipment.Item.phbwepDagger0000";
// A Concentration spell lent to the Zombie: dnd5e refuses `beginConcentrating` on an item that does not ask for it.
const MOONBEAM = "Compendium.dnd-players-handbook.spells.Item.phbsplMoonbeam00";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "briseur de concentration — Tueur de mages, forme limitée à l'arme (#244, #240)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    const warrior = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const wPos = await ctx.position(warrior);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    const unconcentrate = () => script(`const a = canvas.tokens.get(args.id)?.actor; if ( a?.concentration?.effects?.size ) await a.endConcentration();
      await a?.unsetFlag("dnd5e-combat", "concentrationBreaker"); return true;`, { id: zombi.id });
    ctx.restore(() => unconcentrate().catch(() => {}));
    await ctx.call("move-token", { tokenId: zombi.id, x: wPos.x + grid, y: wPos.y, elevation: wPos.elevation });
    await pause(800);

    const zItem = { _id: await ctx.ensureItem(zombi, MOONBEAM, { system: { method: "atwill" } }) };
    if ( !ctx.expect(!!zItem._id, "le Zombi a un sort à concentration (Rayon de lune)") ) return;
    const { data: wTok } = await ctx.call("get-scene-object", { type: "Token", objectId: warrior.id });
    const dagger = await ctx.ensureItem(warrior, DAGGER, { ready: true });

    /**
     * The Zombie concentrating, the Fighter strikes with `identifier` until a hit (20 tries); returns the roll of the
     * Concentration saving throw that follows: `{ mode, formula }` (`mode`: -1 Disadvantage), or null.
     */
    const strike = async (identifier, label) => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, 200);
        await unconcentrate();
        const c = await ctx.engine("concentrate", { tokenId: zombi.id, itemId: zItem._id });
        if ( !c?.effectId ) { ctx.expect(false, `${label} : le Zombi ne se concentre pas`); return null; }
        await pause(500);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: warrior.id, identifier, activityType: "attack", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === "Zombi")?.hit ) continue;
        for ( let w = 0; w < 16; w++ ) {
          await pause(500);
          const msgs = await ctx.messagesSince(since);
          const save = msgs.filter(m => m.type !== "attack").flatMap(m => (m.rolls ?? []).map(roll => ({ m, roll })))
            .find(({ roll }) => /d20/.test(roll.formula ?? "") && (roll.options?.advantageMode !== undefined));
          if ( save ) {
            const out = { mode: save.roll.options.advantageMode, formula: save.roll.formula, type: save.m.type };
            ctx.log(`${label} : sauvegarde de concentration ${JSON.stringify(out)}`);
            return out;
          }
        }
        ctx.log(`${label} : touché, mais aucune sauvegarde de concentration lue`);
        return null;
      }
      ctx.expect(false, `${label} : aucun toucher en 20 essais`);
      return null;
    };
    const disadvantaged = s => !!s && ((s.mode === -1) || /kl/.test(s.formula));

    // 1. Control.
    const plain = await strike("greatsword", "témoin");
    ctx.expect(!!plain && !disadvantaged(plain), `sans briseur : sauvegarde de concentration normale (${plain?.formula})`);

    // 2. Tueur de mages (item d'essai).
    const feat = { name: "Tueur de mages (essai)", type: "feat", img: "icons/svg/aura.svg", system: { identifier: "mage-slayer" } };
    const up = await ctx.call("upsert-actor-item", { actorId: wTok.actorId, itemData: feat, match: { path: "system.identifier", value: "mage-slayer" } });
    const featId = up.itemId ?? up.id ?? up.item?._id ?? await ctx.itemId(warrior.id, "mage-slayer");
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: wTok.actorId, itemId: featId }).catch(() => {}));
    const slayer = await strike("greatsword", "Tueur de mages, épée");
    ctx.expect(disadvantaged(slayer), `Tueur de mages : Désavantage à la sauvegarde de concentration (${slayer?.formula})`);
    const slayerDagger = await strike("dagger", "Tueur de mages, dague");
    ctx.expect(disadvantaged(slayerDagger), `Tueur de mages : aussi avec une autre arme (${slayerDagger?.formula})`);
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: wTok.actorId, itemId: featId }).catch(() => {});

    // 3. Limited to the weapon: the greatsword only.
    const { before } = await ctx.engine("overrideContent", { identifier: "greatsword", entry: { concentrationBreaker: "item" } });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "greatsword", entry: before }).catch(() => {}));
    const sword = await strike("greatsword", "forme « item », épée");
    ctx.expect(disadvantaged(sword), `forme « item » : Désavantage quand l'épée blesse (${sword?.formula})`);
    const other = await strike("dagger", "forme « item », dague");
    ctx.expect(!!other && !disadvantaged(other), `forme « item » : rien quand la dague blesse (${other?.formula})`);
    ctx.log(`dague prêtée : ${dagger}`);
  }
};
