/**
 * Creature types and Immunities (SPEC §16.8), on the Zombie: Undead, immune to Exhaustion and Poisoned.
 *  1. Hold Person ("a Humanoid"): not affected, type — no saving throw, nothing placed.
 *  2. Sleep ("Immunity to Exhaustion: automatic success"): not affected, content rule.
 *  3. Ray of Sickness (attack, poison damage AND Poisoned): the damage goes through the system (the sheet's poison
 *     Immunity included), but the Poisoned effect is not placed — condition Immunity.
 * The spells are given to the Wizard for the scenario's duration.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "types et immunités — pas un humanoïde, immunisé contre l'Épuisement, contre Empoisonné",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(async () => { for ( const s of ["paralyzed", "incapacitated", "poisoned"] ) await ctx.removeStatusEffects(zombi, s); });
    ctx.restore(() => ctx.removeStatusEffects(mage, "concentrating"));
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplHoldPerson");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplSleep00000");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplRayofSickn");
    const statuses = async () => (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);

    // 1. Not a Humanoid.
    const hold = await ctx.use({ tokenId: mage.id, identifier: "hold-person", activityType: "save", targetTokenIds: [zombi.id] });
    const r1 = await ctx.settle(hold.usageMessageId);
    const t1 = r1.targets.find(t => t.name === "Zombi");
    ctx.expect(t1?.unaffected?.reason === "type", `Immobilisation de personne : Zombi non affecté (${JSON.stringify(t1?.unaffected ?? null)})`);
    ctx.expect(!t1?.save, "aucune sauvegarde demandée au Zombi");
    await pause(800);
    ctx.expect(!(await statuses()).includes("paralyzed"), "le Zombi n'est pas Paralysé");
    await ctx.removeStatusEffects(mage, "concentrating");

    // 2. Immune to Exhaustion: Sleep does not reach it (area reduced to its cell).
    const box = await ctx.box(zombi);
    const sleep = await ctx.use({ tokenId: mage.id, identifier: "sleep", activityType: "save", area: { shape: "rectangle", ...box } });
    const r2 = await ctx.settle(sleep.usageMessageId);
    const t2 = r2.targets.find(t => t.name === "Zombi");
    ctx.expect(t2?.unaffected?.reason === "content", `Sommeil : Zombi non affecté (${JSON.stringify(t2?.unaffected ?? null)})`);
    ctx.expect(!t2?.save, "aucune sauvegarde demandée au Zombi");
    await pause(800);
    ctx.expect(!(await statuses()).includes("incapacitated"), "le Zombi n'est pas Neutralisé");
    await ctx.removeStatusEffects(mage, "concentrating");

    // 3. Immune to Poisoned: Ray of Sickness, replayed until a hit.
    let hit = null;
    for ( let i = 0; i < 20 && !hit; i++ ) {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-sickness", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.name === "Zombi");
      if ( t?.hit ) hit = { r, t };
    }
    if ( !ctx.expect(!!hit, "Rayon empoisonné : touché (20 essais au plus)") ) return;
    await pause(1500);
    ctx.expect(!hit.t.unaffected, "des dégâts : la cible reste affectée par l'action");
    ctx.expect((hit.t.effects ?? []).length === 0, `aucun effet posé (${(hit.t.effects ?? []).length})`);
    ctx.expect(!(await statuses()).includes("poisoned"), "le Zombi n'est pas Empoisonné");
    ctx.log(`dégâts de poison appliqués au Zombi (immunité de la fiche comprise) : ${hit.t.damage?.applied ?? "aucun"}`);
  }
};
