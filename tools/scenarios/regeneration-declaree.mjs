/**
 * B04 (§18.13) — Régénération déclarée : `regeneration: { amount, stoppedBy, stoppedWhile }` posée en drapeaux sur l'item (couche
 * « item » du contenu), qui l'emporte sur la lecture du texte anglais. La Régénération du Troll (Monster Manual) prêtée à l'Ours brun,
 * déclarée : 7 PV, coupée par les dégâts radiants (et plus par le feu), sans effet au soleil.
 *  1. Au début de son tour, l'Ours regagne exactement 7 PV (`amount` à la place de la formule de l'activité).
 *  2. Un Trait de feu de Kaalisti le touche : le feu n'est plus déclaré, il régénère quand même.
 *  3. La scène en plein jour (illumination globale vive, obscurité 0) : au début de son tour, pas de régénération.
 * Initiative imposée : Kaalisti, puis l'Ours. La scène et l'Ours sont remis comme avant.
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

    // La Régénération du Troll, déclarée par les drapeaux de l'item.
    const { data: troll } = await ctx.call("get-compendium-entry", { uuid: TROLL });
    const { _id, folder, ownership, _stats, ...itemData } = troll.items.find(i => i.system?.identifier === "regeneration");
    itemData.flags = { ...(itemData.flags ?? {}), "dnd5e-combat": { regeneration: { amount: 7, stoppedBy: ["radiant"], stoppedWhile: ["sunlight"] } } };
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "regeneration" } });
    const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(bear.id, "regeneration"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    // La scène de nuit pour les parties 1 et 2 (pas de soleil), remise comme avant à la fin.
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

    // 1. Le montant déclaré.
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 17, `début du tour de l'Ours : +7 PV déclarés (10 → ${await ctx.hp(bear)} PV)`);

    // 2. Le feu n'est plus ce qui la coupe.
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

    // 3. Au soleil : le trait ne fonctionne pas.
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
