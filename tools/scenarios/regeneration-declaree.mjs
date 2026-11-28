/**
 * B04 (§18.13) — Declared Regeneration: `regeneration: { amount, stoppedBy, stoppedWhile }` set as flags on the item (the
 * "item" layer of the content), which takes precedence over reading the English text. The Troll's Regeneration (Monster
 * Manual) lent to the Brown Bear, declared: 7 HP, stopped by radiant damage (and no longer by fire), no effect in sunlight.
 *  1. At the start of its turn, the Bear regains exactly 7 HP (`amount` instead of the activity's formula).
 *  2. Kaalisti's Fire Bolt hits it: fire is no longer declared, it regenerates anyway.
 *  3. The scene in broad daylight (bright global illumination, darkness 0): at the start of its turn, no regeneration.
 * Initiative forced: Kaalisti, then the Bear. The scene and the Bear are restored as before.
 */
const TROLL = "Compendium.dnd-monster-manual.actors.Actor.mmTroll000000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "régénération déclarée — montant, types de dégâts déclarés, arrêtée au soleil",

  async run(ctx) {
    await ctx.cast({ "Ours brun": "mmBrownBear00000" }, { near: "Zombi" });
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Ours brun", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun ou Kaalisti absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const warlock = await ctx.token("Kaalisti");
    const hp0 = await ctx.hp(bear);
    ctx.restore(() => ctx.setHp(bear, hp0));
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(bear, s));
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: bear.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bear.id,
      data: { "delta.flags.dnd5e-combat.-=regenerationStopped": null } }).catch(() => {}));

    // The Troll's Regeneration, declared by the item's flags.
    const { data: troll } = await ctx.call("get-compendium-entry", { uuid: TROLL });
    const { _id, folder, ownership, _stats, ...itemData } = troll.items.find(i => i.system?.identifier === "regeneration");
    itemData.flags = { ...(itemData.flags ?? {}), "dnd5e-combat": { regeneration: { amount: 7, stoppedBy: ["radiant"], stoppedWhile: ["sunlight"] } } };
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "regeneration" } });
    const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(bear.id, "regeneration"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    // The night scene for parts 1 and 2 (no sunlight), restored as before at the end.
    const env = (await ctx.call("get-scene", { sceneId })).environment ?? {};
    const was = { "environment.globalLight.enabled": env.globalLight?.enabled ?? false, "environment.globalLight.bright": env.globalLight?.bright ?? false,
      "environment.darknessLevel": env.darknessLevel ?? 0 };
    ctx.restore(() => ctx.call("update-scene", { sceneId, sceneData: was }).catch(() => {}));
    await ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": false } });

    await ctx.startCombat([warlock, bear]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[warlock, 20], [bear, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1500); }
      return (await current()) === token.id;
    };
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;

    // 1. The declared amount.
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 17, `début du tour de l'Ours : +7 PV déclarés (10 → ${await ctx.hp(bear)} PV)`);

    // 2. Fire is no longer what stops it.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 12);   // l'Ours n'a que 22 PV max : 12 - feu + 7 reste en dessous
    let hit = false;
    for ( let i = 0; (i < 20) && !hit; i++ ) {
      const bolt = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [bear.id] });
      hit = !!(await ctx.settle(bolt.usageMessageId).catch(() => null))?.targets?.[0]?.hit;
    }
    if ( !ctx.expect(hit, "Trait de feu : touché") ) return;
    await sleep(1000);
    const burnt = await ctx.hp(bear);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === burnt + 7, `brûlé, mais seuls les dégâts radiants sont déclarés : régénère (${burnt} → ${await ctx.hp(bear)} PV)`);

    // 3. In sunlight: the trait does not work.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": true, "environment.globalLight.bright": true, "environment.darknessLevel": 0 } });
    await sleep(2000);
    await ctx.setHp(bear, 20);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 20, `au soleil : pas de régénération (20 → ${await ctx.hp(bear)} PV)`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
