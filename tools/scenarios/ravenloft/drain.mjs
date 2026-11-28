/**
 * M8 (SPEC §18.16) — maximum HP drain. World `ravenloft`, Monster Manual abilities lent:
 *  1. Life Drain (Wight; a Constitution save in the MM 2024) from the Wolf, against the Zombie: failed, the
 *     Zombie's maximum drops by the damage taken
 *     (`hp.tempmax` of the token delta).
 *  2. Vampire's Bite (Constitution save, piercing + necrotic) from the Zombie, against the Wolf: failed, the maximum of the
 *     Wolf drops by the necrotic damage alone, and the Zombie regains as many HP.
 *  3. Energy Drain (Demilich) from the Zombie, against the Wolf brought down to an effective maximum of 3: failed, the
 *     maximum drops by 4d6, so to 0 — the Wolf dies.
 *  4. §105: Draining Swipe (Shadow) from the Zombie, against the Wolf: on a hit, a "Strength −1d4" effect on the Wolf.
 *  5. §105: Life Drain of the "Vampiric Mist" (world sheet made by hand, 2014 format in French: attack then chained
 *     save) from the Zombie, against the Wolf: hit and failed save, maximum HP effect = damage taken.
 * Since §105, each drain is an effect on the target (flag `dnd5e-combat.drain`), no longer a write to `hp.tempmax`.
 * The rolls are random: we replay until a hit or a failure (20 tries at most).
 */
const WIGHT = "Compendium.dnd-monster-manual.actors.Actor.mmWight000000000";
const VAMPIRE = "Compendium.dnd-monster-manual.actors.Actor.mmVampire0000000";
const DEMILICH = "Compendium.dnd-monster-manual.actors.Actor.mmDemilich000000";
const SHADOW = "Compendium.dnd-monster-manual.actors.Actor.mmShadow00000000";
const MIST = "lcCmYY4WnuhxMDSs";   // "Vampiric Mist", actor of the `ravenloft` world
const DRAIN_EFFECT = /maximum de PV|Hit Point maximum|: (Force|Strength) −/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "drain du maximum de PV — Absorption de vie, Morsure du Vampire, Drain d'énergie",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Zombi absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const tempmax = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.delta?.system?.attributes?.hp?.tempmax ?? 0;
    const drained = async (t, kind="hp") => (await ctx.effects(t)).filter(e => e.flags?.["dnd5e-combat"]?.drain?.kind === kind)
      .reduce((n, e) => n + (e.flags["dnd5e-combat"].drain.total ?? 0), 0);
    const clearDrains = t => ctx.removeEffectsNamed(t, DRAIN_EFFECT);
    const setTempmax = (t, v) => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.tempmax": v } });
    for ( const t of [wolf, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      const tm = await tempmax(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => setTempmax(t, tm));
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
      ctx.restore(() => clearDrains(t));
    }
    const lend = async (uuid, identifier, token, activityType, { name }={}) => {
      const source = uuid.startsWith("Compendium.") ? (await ctx.call("get-compendium-entry", { uuid })).data : await ctx.call("get-actor", { actorId: uuid });
      const found = source.items.find(i => name ? (i.name === name) : (i.system?.identifier === identifier));
      const { _id, folder, ownership, _stats, ...itemData } = { ...found, system: { ...found.system, identifier } };
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
      return itemId;
    };
    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });

    // 1. Absorption de vie.
    const lifeDrain = await lend(WIGHT, "life-drain", wolf);
    await setTempmax(zombi, 0);
    let hit = null;
    for ( let i = 0; (i < 20) && !hit; i++ ) {
      await ctx.setHp(zombi, 100);
      const used = await ctx.use({ tokenId: wolf.id, itemId: lifeDrain, activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(zombi.id));
      if ( (t?.save?.success === false) && (t.damage?.applied > 0) ) hit = t;
    }
    if ( ctx.expect(!!hit, "Absorption de vie : sauvegarde ratée") ) {
      await sleep(1000);
      ctx.expect((await drained(zombi)) >= hit.damage.applied, `effet : maximum du Zombi -${await drained(zombi)} (PV perdus ${hit.damage.applied})`);
    }
    await clearDrains(zombi);

    // 2. Morsure du Vampire.
    const bite = await lend(VAMPIRE, "bite", zombi);
    await setTempmax(wolf, 0);
    let failed = null;
    let zombiBefore = 0;
    let since = null;
    for ( let i = 0; (i < 20) && !failed; i++ ) {
      await ctx.setHp(wolf, 100);
      await ctx.setHp(zombi, 1);
      await clearDrains(wolf);
      zombiBefore = await ctx.hp(zombi);
      since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: bite, activityType: "save", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( (t?.save?.success === false) && (t.damage?.applied > 0) ) failed = t;
    }
    if ( ctx.expect(!!failed, "Morsure du Vampire : sauvegarde ratée") ) {
      await sleep(1200);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const necrotic = (damage?.rolls ?? []).filter(x => /necrotic/i.test(JSON.stringify(x.options ?? {}))).reduce((n, x) => n + (x.total ?? 0), 0);
      const necroticDrained = await drained(wolf);
      // "equal to the necrotic damage taken": the damage (dnd5e, after resistances), not the HP lost — a Wolf at 11 HP who
      // takes 18 necrotic sees its maximum drop by 18.
      ctx.expect((necroticDrained > 0) && (!necrotic || necroticDrained <= necrotic),
        `effet : maximum du Loup -${necroticDrained} : la part nécrotique (jet nécrotique ${necrotic || "?"}, subi en tout ${failed.damage.applied})`);
      ctx.expect((await ctx.hp(zombi)) > zombiBefore, `le Zombi regagne des PV (${zombiBefore} → ${await ctx.hp(zombi)})`);
    }
    await clearDrains(wolf);

    // 3. Energy Drain.
    const energy = await lend(DEMILICH, "energy-drain", zombi);
    // Effective maximum brought down to 3 (the `ravenloft` Wolf's delta carries a maximum of 100): 4d6 surely puts it at 0.
    const { data: wolfTok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const baseMax = wolfTok.delta?.system?.attributes?.hp?.max ?? 11;
    const start = -(baseMax - 3);
    let energized = null;
    for ( let i = 0; (i < 20) && !energized; i++ ) {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);
      await clearDrains(wolf);
      await setTempmax(wolf, start);
      await ctx.setHp(wolf, 3);
      const used = await ctx.use({ tokenId: zombi.id, itemId: energy, activityType: "save", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( t?.save?.success === false ) energized = t;
    }
    if ( ctx.expect(!!energized, "Drain d'énergie : sauvegarde ratée") ) {
      await sleep(1500);
      const tm = await drained(wolf);
      ctx.expect(tm >= 4, `effet : maximum du Loup réduit de 4d6 (${tm})`);
      const dead = (await ctx.effects(wolf)).some(e => !e.disabled && (e.statuses ?? []).includes("dead"));
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
      ctx.log(`Loup : drain ${tm}, PV ${data.delta?.system?.attributes?.hp?.value}, Mort ${dead}`);
      ctx.expect(dead, "maximum effectif ramené à 0 : le Loup meurt");
    }
    await setTempmax(wolf, 0);
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);
    await clearDrains(wolf);

    // 4. Draining Swipe (Shadow).
    const swipe = await lend(SHADOW, "draining-swipe", zombi);
    let struck = null;
    for ( let i = 0; (i < 20) && !struck; i++ ) {
      await ctx.setHp(wolf, 100);
      const used = await ctx.use({ tokenId: zombi.id, itemId: swipe, activityType: "attack", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( t?.hit === true ) struck = t;
    }
    if ( ctx.expect(!!struck, "Caresse dévitalisante : touché") ) {
      await sleep(1500);
      const str = await drained(wolf, "str");
      ctx.expect((str >= 1) && (str <= 4), `effet : Force du Loup -${str} (1d4)`);
    }
    await clearDrains(wolf);
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);

    // 5. Life Drain of the Vampiric Mist (hand-made sheet, in French).
    const mist = await lend(MIST, "drain-de-vie-test", zombi, null, { name: "Drain de vie" }).catch(() => null);
    if ( !mist ) { ctx.log("Brume vampirique absente du monde : partie 5 non applicable"); return; }
    let sucked = null;
    for ( let i = 0; (i < 20) && !sucked; i++ ) {
      await ctx.setHp(wolf, 100);
      await clearDrains(wolf);
      const used = await ctx.use({ tokenId: zombi.id, itemId: mist, activityType: "attack", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( (t?.hit === true) && (t.save?.success === false) && (t.damage?.applied > 0) ) sucked = t;
      else if ( (t?.hit === true) && (t.save?.success === true) ) {
        await sleep(800);
        ctx.expect((await drained(wolf)) === 0, "Drain de vie, sauvegarde réussie : pas de drain");
      }
    }
    if ( ctx.expect(!!sucked, "Drain de vie : touché, sauvegarde ratée") ) {
      await sleep(1500);
      const n = await drained(wolf);
      ctx.expect(n >= sucked.damage.applied, `effet : maximum du Loup -${n} (PV perdus ${sucked.damage.applied})`);
    }
  }
};
