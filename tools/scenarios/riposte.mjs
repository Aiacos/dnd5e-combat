/**
 * Brick B9 "damage returned to the attacker" (SPEC §16.9), on the Wizard attacked in melee by the Zombie:
 *  1. Fire Shield (spells24, given to the Wizard for the scenario), WARM shield chosen in advance: a Zombie hit that
 *     lands → retaliation card (`flags["dnd5e-combat"].retaliation`), 2d8 fire applied to the Zombie, and the
 *     retaliation logged in the attack's resolution (cancelable with it).
 *  2. Armor of Agathys (PHB): 5 Temporary Hit Points and a mark placed on the Wizard; a hit that lands → 5 cold damage to the
 *     Zombie (the item's damage activity); the mark stays only as long as Temporary Hit Points remain.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));
const WARM = "YbUr13GTnMrootmf";

export default {
  name: "riposte — Bouclier de feu (chaud), Armure d'Agathys",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const mageHp = await ctx.hp(mage);
    const zombiHp = await ctx.hp(zombi);
    const grid = await ctx.gridSize();
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    const before = new Set((await ctx.effects(mage)).map(e => e._id ?? e.id));
    const tempOf = async () => {
      const a = await ctx.call("get-actor", { actorId: mage.actorId });
      return (a.system ?? a.actor?.system)?.attributes?.hp?.temp ?? 0;
    };
    const setTemp = value => ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.attributes.hp.temp": value } });
    const newEffects = async () => (await ctx.effects(mage)).filter(e => !before.has(e._id ?? e.id));
    const clearNew = async () => {
      for ( const e of await newEffects() ) await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
    };
    ctx.restore(() => ctx.setHp(mage, mageHp));
    ctx.restore(() => setTemp(0));
    ctx.restore(clearNew);
    ctx.restore(() => ctx.setHp(zombi, zombiHp));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    // The Zombie in contact with the Wizard (on the left), to strike in melee.
    await ctx.call("move-token", { tokenId: zombi.id, x: magePos.x - grid, y: magePos.y, elevation: zHome.elevation });
    await pause(800);
    const items = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque au corps à corps (${weapon?.name})`) ) return;

    /** The Zombie strikes until it hits; returns the resolution and the messages that followed. */
    const strike = async prepare => {
      for ( let i = 0; i < 20; i++ ) {
        await prepare?.();
        await ctx.setHp(zombi, zombiHp);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [mage.id] });
        const r = await ctx.settle(used.usageMessageId);
        if ( !r.targets.find(t => t.name === "Magicien")?.hit ) continue;
        await pause(2500);
        return { r, messages: await ctx.messagesSince(since), zombi: await ctx.hp(zombi) };
      }
      return null;
    };

    // 1. Bouclier de feu, chaud.
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplFireShield");
    const cast = await ctx.use({ tokenId: mage.id, identifier: "fire-shield", activityType: "utility", targetTokenIds: [mage.id],
      usageConfig: { "dnd5e-combat": { choice: WARM } } });
    await ctx.settle(cast.usageMessageId).catch(() => null);
    await pause(1200);
    const shields = await newEffects();
    ctx.expect(shields.length === 1, `un seul bouclier posé sur le Magicien (${shields.map(e => e.name).join(", ")})`);
    const hit = await strike(() => ctx.setHp(mage, mageHp));
    if ( !ctx.expect(!!hit, "le Zombi touche le Magicien (20 essais au plus)") ) return;
    const card = hit.messages.find(m => m.flags?.["dnd5e-combat"]?.retaliation?.item === "fire-shield");
    ctx.expect(!!card, `carte de riposte du Bouclier de feu (${card ? "présente" : "absente"})`);
    const lost = zombiHp - hit.zombi;
    ctx.expect(lost >= 2 && lost <= 16, `le Zombi subit 2d8 de feu : ${lost} PV perdus`);
    const logged = (hit.r.log ?? []).find(l => l.kind === "retaliation");
    ctx.expect(!!logged, "la riposte est journalisée dans la résolution de l'attaque (annulable avec elle)");
    await clearNew();
    await pause(600);

    // 2. Armure d'Agathys.
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplArmorofAga");
    const armor = async () => {
      await clearNew();
      await setTemp(0);
      await ctx.setHp(mage, mageHp);
      await ctx.use({ tokenId: mage.id, identifier: "armor-of-agathys", activityType: "heal", targetTokenIds: [mage.id] });
      await pause(1500);
      // The connector cuts the chained actions of every activity (`subsequentActions: false`, use-activity): the healing roll
      // that dnd5e would make on its own on use does not go out. The 5 Temporary Hit Points are therefore given here.
      await setTemp(5);
      await pause(500);
    };
    await armor();
    const trace = (await newEffects()).find(e => e.flags?.["dnd5e-combat"]?.trace);
    ctx.expect(!!trace, `trace posée sur le Magicien (${trace?.name ?? "aucune"}, durée ${trace?.duration?.value ?? "?"} s)`);
    const hit2 = await strike(armor);
    if ( !ctx.expect(!!hit2, "le Zombi touche le Magicien sous l'Armure (20 essais au plus)") ) return;
    const card2 = hit2.messages.find(m => m.flags?.["dnd5e-combat"]?.retaliation?.item === "armor-of-agathys");
    ctx.expect(!!card2, `carte de riposte de l'Armure d'Agathys (${card2 ? "présente" : "absente"})`);
    ctx.expect(zombiHp - hit2.zombi === 5, `le Zombi subit 5 dégâts de froid (${zombiHp - hit2.zombi})`);
    const temp = await tempOf();
    const still = (await newEffects()).some(e => e.flags?.["dnd5e-combat"]?.trace);
    ctx.expect(still === (temp > 0), `trace ${still ? "toujours là" : "tombée"}, PV temporaires restants : ${temp}`);

    // 3. Armor of Agathys at level 3 (session feedback, 2026-10-08): "the Temporary Hit Points and the cold damage increase
    // by 5 for each spell slot level above 1st" — 15 damage. The level goes through the spell slot (`spell.slot`,
    // dnd5e activity/mixin.mjs:533-535), then through the mark (`flags.dnd5e.scaling`) up to the retaliation.
    await clearNew();
    const armor3 = async () => {
      await clearNew();
      await setTemp(0);
      await ctx.setHp(mage, mageHp);
      await ctx.use({ tokenId: mage.id, identifier: "armor-of-agathys", activityType: "heal", targetTokenIds: [mage.id],
        usageConfig: { spell: { slot: "spell3" } } });
      await pause(1500);
      await setTemp(15);
      await pause(500);
    };
    await armor3();
    const trace3 = (await newEffects()).find(e => e.flags?.["dnd5e-combat"]?.trace);
    ctx.expect(trace3?.flags?.dnd5e?.scaling === 2, `trace au niveau 3 (scaling ${trace3?.flags?.dnd5e?.scaling ?? "?"})`);
    const hit3 = await strike(armor3);
    if ( !ctx.expect(!!hit3, "le Zombi touche le Magicien sous l'Armure de niveau 3 (20 essais au plus)") ) return;
    ctx.expect(zombiHp - hit3.zombi === 15, `le Zombi subit 15 dégâts de froid (${zombiHp - hit3.zombi})`);
  }
};
