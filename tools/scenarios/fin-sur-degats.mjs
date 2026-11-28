/**
 * Brick B8 "effect that ends on damage" and B4 on damage (SPEC §16.7), carried by the effect placed on the Zombie:
 *  1. Hypnotic Pattern (spells24, given to the Wizard for the scenario's duration), area reduced to the Zombie's cell, replayed
 *     until a failure: the Zombie is Charmed and Incapacitated. A Ray of Frost that hits it → the effect ends, "ends"
 *     card (`flags["dnd5e-combat"].ended`).
 *  2. Tasha's Hideous Laughter, replayed until a failure (Incapacitated, Prone). A Ray of Frost that hits it → it replays
 *     its save (message `resave`, moment `isDamaged`); the effect stays on a failure, ends on a success.
 * The Wizard concentrates on one then the other: Concentration is broken between the two and at the end.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "fin sur dégâts — Motif hypnotique cesse, Fou rire rejoue sa sauvegarde",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const endConcentration = () => ctx.removeStatusEffects(mage, "concentrating");
    const clearZombi = async () => { for ( const s of ["charmed", "incapacitated", "prone"] ) await ctx.removeStatusEffects(zombi, s); };
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(clearZombi);
    ctx.restore(endConcentration);
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplHypnoticPa");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplTashasHide");
    const statusesOf = async () => (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);

    /** Casts the spell until the Zombie fails its save; returns the resolution, or null. */
    const until = async (identifier, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await endConcentration();
        await clearZombi();
        await pause(600);
        const used = await ctx.use({ tokenId: mage.id, identifier, activityType: "save", ...extra });
        const r = await ctx.settle(used.usageMessageId);
        const target = r.targets.find(t => t.name === "Zombi");
        if ( target?.save?.success === false ) { await pause(1200); return r; }
      }
      return null;
    };

    /** Ray of Frost until it hits the Zombie; returns the message from before the shot (to read what followed). */
    const hurt = async () => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId);
        if ( r.targets.find(t => t.name === "Zombi")?.hit ) { await pause(2000); return since; }
      }
      return null;
    };

    // 1. Hypnotic Pattern: ends on damage.
    const box = await ctx.box(zombi);
    const hp = await until("hypnotic-pattern", { area: { shape: "rectangle", ...box } });
    if ( !ctx.expect(!!hp, "Motif hypnotique : le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
    const before = await statusesOf();
    ctx.expect(before.includes("charmed") && before.includes("incapacitated"), `Zombi Charmé et Neutralisé (${before.join(", ")})`);
    const since = await hurt();
    if ( !ctx.expect(!!since, "le Rayon de givre touche le Zombi (20 essais au plus)") ) return;
    const after = await statusesOf();
    ctx.expect(!after.includes("charmed"), `blessé, le Zombi n'est plus charmé (${after.join(", ") || "aucun état"})`);
    const ended = (await ctx.messagesSince(since)).find(m => m.flags?.["dnd5e-combat"]?.ended);
    ctx.expect(!!ended, `le chat dit que le sort cesse (${ended ? "carte « cesse »" : "aucune carte"})`);

    // 2. Tasha's Hideous Laughter: save replayed on damage.
    const hl = await until("hideous-laughter", { targetTokenIds: [zombi.id] });
    if ( !ctx.expect(!!hl, "Fou rire : le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
    ctx.expect((await statusesOf()).includes("incapacitated"), "Zombi Neutralisé par le Fou rire");
    const since2 = await hurt();
    if ( !ctx.expect(!!since2, "le Rayon de givre touche le Zombi (20 essais au plus)") ) return;
    const resave = (await ctx.messagesSince(since2)).find(m => m.flags?.["dnd5e-combat"]?.resave?.moment === "isDamaged");
    if ( !ctx.expect(!!resave, "blessé, le Zombi rejoue sa sauvegarde (message « resave », moment isDamaged)") ) return;
    const r = await ctx.settle(resave.id);
    const saved = r.targets.find(t => t.name === "Zombi")?.save?.success;
    await pause(1500);
    const still = (await statusesOf()).includes("incapacitated");
    ctx.expect(saved === !still, `sauvegarde ${saved ? "réussie : le Fou rire tombe" : "ratée : le Fou rire reste"} (Neutralisé : ${still})`);
  }
};
