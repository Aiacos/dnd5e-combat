/**
 * §355, batch O9b of the item pass: conditional weapon damage and healing. Test arena (Fighter, Zombie, Cleric, Sorcerer).
 *  1. Ebony Bane (Ravenloft): the 3d6 necrotic on the Cleric (Humanoid), not on the Zombie (Undead).
 *  2. Blackrazor: the Cleric at 1 HP, hit, goes down — killed, the Fighter gains its maximum HP as Temporary Hit Points.
 *  3. Vampiric Sword (placed on a Longsword): an automatic Critical Hit (Paralyzed Cleric in contact) — 15 Temporary Hit Points.
 *  4. Iggwilv's Demonomicon carried by the Sorcerer: Fire Bolt on the Zombie made a Fiend — maximum damage.
 * The Zombie's HP, Temporary Hit Points, conditions and type restored; the Longsword's enchantment removed.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const RAV = "Compendium.dnd-ravenloft-horrors-within.items.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9b — Fléau d'ébène, Noirtranchant, Épée voleuse de vie, Demonomicon",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc", "Ensorceleur"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi, Clerc ou Ensorceleur absent : non applicable"); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-dungeon-masters-guide.equipment") ) { ctx.log("Guide du maître absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + g, at.y], Clerc: [at.x, at.y + g] } });
    const [zombi, cleric, sorc] = await Promise.all(["Zombi", "Clerc", "Ensorceleur"].map(n => ctx.token(n)));
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const hpZ = await ctx.hp(zombi), hpC = await ctx.hp(cleric);
    const temp0 = (await ctx.call("get-actor", { actorId: ftok.actorId })).system?.attributes?.hp?.temp ?? 0;
    const setTemp = v => ctx.call("update-actor", { actorId: ftok.actorId, actorData: { "system.attributes.hp.temp": v } });
    const tempOf = async () => (await ctx.call("get-actor", { actorId: ftok.actorId })).system?.attributes?.hp?.temp ?? 0;
    const clean = async () => {
      for ( const s of ["dead", "paralyzed", "unconscious", "prone"] ) await ctx.removeStatusEffects(cleric, s).catch(() => {});
      await ctx.setHp(zombi, hpZ); await ctx.setHp(cleric, hpC); await setTemp(temp0);
    };
    ctx.restore(clean);
    const fiddle = await ctx.engine("setting", { key: "dataFixes" });
    ctx.restore(() => ctx.engine("setting", { key: "dataFixes", value: fiddle.before }));
    await ctx.engine("setting", { key: "dataFixes", value: true });

    /** Attacks until a hit; returns the target and the lines of the damage message. */
    const hit = async (itemId, target, before=async () => {}) => {
      for ( let i = 0; i < 15; i++ ) {
        await before();
        const used = await ctx.use({ tokenId: fighter.id, itemId, activityType: "attack", consume: false, targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === target.name);
        if ( !t?.hit ) continue;
        await pause(2000);
        const damage = (await ctx.messagesSince(used.usageMessageId)).filter(m => m.type === "damage");
        return { t, formulas: damage.flatMap(m => (m.rolls ?? []).map(x => `${x.formula}`)).join(" | ") };
      }
      return null;
    };

    // 1. Ebony Bane.
    if ( packs.includes("dnd-ravenloft-horrors-within.items") ) {
      const ebon = await ctx.ensureItem(fighter, `${RAV}rhwEbonbane00000`);
      let h = await hit(ebon, zombi, clean);
      ctx.expect(!!h && !/3d6/.test(h.formulas), `Fléau d'ébène sur le Zombi : pas de 3d6 nécrotiques (${h?.formulas ?? "raté"})`);
      h = await hit(ebon, cleric, clean);
      ctx.expect(!!h && /3d6/.test(h.formulas), `Fléau d'ébène sur le Clerc : 3d6 nécrotiques (${h?.formulas ?? "raté"})`);
      // Known defect of the data (not the engine's): the description carries "[[/damage twoHanded average]]", which dnd5e's
      // enricher reads as a formula ("twohanded" is not an attack mode once lowercased) — an error on every render. Only that
      // one is tolerated here.
      const errors = (await ctx.clientErrors()).map(e => JSON.stringify(e));
      ctx.expect(errors.every(e => /twoHanded/.test(e)), `Fléau d'ébène : aucune autre erreur que celle de sa description (${errors.length} vue(s))`);
    } else ctx.log("Ravenloft absent : Fléau d'ébène sauté");
    await clean();

    // 2. Noirtranchant.
    const black = await ctx.ensureItem(fighter, `${DMG}dmgBlackrazor000`);
    const maxC = (await ctx.engine("stats", { tokenId: cleric.id }))?.hp?.max ?? 0;
    const fell = await hit(black, cleric, async () => { await clean(); await ctx.setHp(cleric, 1); });
    if ( ctx.expect(!!fell, "Noirtranchant touche le Clerc à 1 PV") ) {
      await pause(1500);
      const dead = ((await ctx.engine("stats", { tokenId: cleric.id }))?.statuses ?? []).includes("dead");
      ctx.expect(dead, "le Clerc est tué (âme dévorée)");
      ctx.expect((await tempOf()) === maxC, `le Guerrier gagne ${maxC} PV temporaires (${await tempOf()})`);
    }
    await clean();

    // 3. Vampiric Sword.
    const source = await ctx.ensureItem(fighter, `${DMG}dmgSwordOfLifeSt`);
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: source, activityId: "IvHRnKPwz1WWjFkN", targetItemId: sword }).catch(err => ({ error: err.message }));
    if ( done?.effectId ) ctx.restore(() => ctx.engine("removeItemEffect", { actorId: ftok.actorId, itemId: sword, effectId: done.effectId }).catch(() => {}));
    if ( ctx.expect(!!done?.effectId, `l'Épée voleuse de vie est posée sur l'Épée longue (${done?.error ?? "ok"})`) ) {
      const crit = await hit(sword, cleric, async () => { await clean(); await ctx.call("set-status", { tokenId: cleric.id, statusId: "paralyzed", active: true }); });
      ctx.expect(!!crit && crit.t.critical, `coup critique sur le Clerc Paralysé (${crit?.t?.reason ?? "raté"})`);
      await pause(1500);
      ctx.expect((await tempOf()) === 15, `15 PV temporaires (${await tempOf()})`);
    }
    await clean();

    // 4. Demonomicon.
    await ctx.ensureItem(sorc, `${DMG}dmgDemonomiconOf`);
    const { data: z } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const type0 = z.delta?.system?.details?.type?.value ?? null;
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.details.type.value": "fiend" } });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
      data: type0 === null ? { "delta.system.details.type.-=value": null } : { "delta.system.details.type.value": type0 } }).catch(() => {}));
    let maxed = null;
    for ( let i = 0; (i < 8) && !maxed; i++ ) {
      await ctx.setHp(zombi, hpZ);
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      if ( !r?.targets?.[0]?.hit ) continue;
      await pause(2000);
      const lost = hpZ - await ctx.hp(zombi);
      const dice = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage")?.rolls?.[0]?.formula ?? "?";
      maxed = { lost, dice, critical: r.targets[0].critical };
    }
    ctx.expect(!!maxed && (maxed.lost === (maxed.critical ? 20 : 10)), `Trait de feu sur un Fiélon : dégâts au maximum (${JSON.stringify(maxed)})`);
  }
};
