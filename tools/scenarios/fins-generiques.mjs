/**
 * §258 : fins génériques (`endsWhen`), relevées par l'audit CAT / CPR.
 *  1. Armure du mage sur le Magicien, puis une armure de cuir enfilée : l'effet tombe (`armor: "any"`).
 *  2. Immobilisation de personne sur le Guerrier jusqu'à une sauvegarde réussie : la concentration du Magicien tombe aussitôt
 *     (`unaffected`, réglage `endUnaffected`) ; sur un échec, elle reste.
 *  3. Lien de garde du Magicien sur le Guerrier, puis le Guerrier emmené à plus de 18 m : le lien tombe (`apart`, `spell`).
 *  4. Issue #150 — Warding Bond again: the warded Fighter drops to 0 HP and stays warded (SRD 5.2: "if you drop to 0 Hit Points",
 *     the caster only); then the Wizard drops to 0 HP and the bond ends (`zeroHp: "caster"`).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DOWNED = ["unconscious", "prone", "dead"];

export default {
  name: "fins génériques — armure enfilée, personne d'affecté, lien trop loin",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");
    const concentrations = async () => (await ctx.effects(mage)).filter(e => (e.statuses ?? []).includes("concentrating"));
    const dropConcentration = async () => {
      for ( const e of await concentrations() ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(dropConcentration);
    ctx.restore(() => ctx.removeStatusEffects(guerrier, "paralyzed"));
    ctx.restore(() => ctx.removeEffectsFrom(mage, "mage-armor"));
    ctx.restore(() => ctx.removeEffectsFrom(guerrier, "warding-bond"));
    ctx.restore(() => ctx.removeEffectsFrom(mage, "warding-bond"));
    const endedSince = async (since, reason) => (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.ended?.reason === reason);

    // 1. Armure du mage, puis une armure enfilée.
    await ctx.ensureItem(mage, `${PHB}phbsplMageArmor0`, { system: { method: "atwill" } });
    let since = await ctx.lastMessageId();
    await ctx.use({ tokenId: mage.id, identifier: "mage-armor", targetTokenIds: [mage.id] });
    await pause(2000);
    const warded = await ctx.effectsFrom(mage, "mage-armor");
    ctx.expect(warded.length > 0, `Armure du mage posée sur le Magicien (${warded.length})`);
    const { data } = await ctx.call("get-compendium-entry", { uuid: "Compendium.dnd5e.equipment24.Item.phbarmLeatherArm" });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    itemData.system = { ...itemData.system, equipped: false };
    itemData.flags = { ...(itemData.flags ?? {}), [MODULE_ID]: { scenarioArmor: "leather" } };
    const lent = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: `flags.${MODULE_ID}.scenarioArmor`, value: "leather" } });
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: lent.id }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": true }, match: { path: "_id", value: lent.id } });
    await pause(2500);
    ctx.expect(!(await ctx.effectsFrom(mage, "mage-armor")).length, "armure de cuir enfilée : Armure du mage tombe");
    ctx.expect((await endedSince(since, "armor")).length > 0, "une carte de chat le dit à la table");

    // 2. Immobilisation de personne : réussie, la concentration tombe ; ratée, elle reste.
    await ctx.ensureItem(mage, `${PHB}phbsplHoldPerson`, { system: { method: "atwill" } });
    let sawSuccess = false, sawFailure = false;
    for ( let i = 0; (i < 20) && !(sawSuccess && sawFailure); i++ ) {
      await dropConcentration();
      await ctx.removeStatusEffects(guerrier, "paralyzed");
      await pause(500);
      since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: mage.id, identifier: "hold-person", activityType: "save", targetTokenIds: [guerrier.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.name === "Guerrier");
      if ( !t?.save ) { ctx.expect(false, "le Guerrier n'a pas fait de sauvegarde"); return; }
      await pause(2000);
      const held = (await concentrations()).length > 0;
      if ( t.save.success && !sawSuccess ) {
        sawSuccess = true;
        ctx.expect(!held, `sauvegarde réussie (${t.save.total}) : plus de concentration`);
        ctx.expect((await endedSince(since, "unaffected")).length > 0, "une carte de chat dit pourquoi");
      }
      else if ( !t.save.success && !sawFailure ) {
        sawFailure = true;
        ctx.expect(held, `sauvegarde ratée (${t.save.total}) : la concentration reste`);
      }
    }
    ctx.expect(sawSuccess, "au moins une sauvegarde réussie en 20 essais");
    await dropConcentration();
    await ctx.removeStatusEffects(guerrier, "paralyzed");

    // 3. Lien de garde, puis le Guerrier emmené à plus de 18 m.
    await ctx.ensureItem(mage, `${PHB}phbsplWardingBon`, { system: { method: "atwill" } });
    since = await ctx.lastMessageId();
    await ctx.use({ tokenId: mage.id, identifier: "warding-bond", targetTokenIds: [guerrier.id] });
    await pause(2000);
    const bond = await ctx.effectsFrom(guerrier, "warding-bond");
    ctx.expect(bond.length > 0, `Lien de garde posé sur le Guerrier (${bond.length})`);
    if ( !bond.length ) return;
    const home = await ctx.position(guerrier);
    const magePos = await ctx.position(mage);
    const size = await ctx.gridSize();
    ctx.restore(() => ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    // 14 cases (70 ft) du Magicien, du côté où la scène a de la place.
    const dx = (magePos.x > 14 * size) ? -14 : 14;
    await ctx.call("move-token", { tokenId: guerrier.id, x: magePos.x + (dx * size), y: magePos.y });
    await pause(2500);
    ctx.expect(!(await ctx.effectsFrom(guerrier, "warding-bond")).length, "à plus de 18 m : le Lien de garde tombe");
    ctx.expect((await endedSince(since, "apart")).length > 0, "une carte de chat le dit à la table");

    // 4. Issue #150: only the caster dropping to 0 HP ends Warding Bond.
    await ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y, elevation: home.elevation });
    await pause(1000);
    for ( const token of [mage, guerrier] ) {
      const hp0 = await ctx.hp(token);
      ctx.restore(async () => {
        await ctx.setHp(token, hp0);
        await pause(500);
        for ( const s of DOWNED ) await ctx.removeStatusEffects(token, s);
      });
      ctx.restore(() => ctx.call("update-actor", { actorId: token.actorId, actorData: {
        "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }));
    }
    await ctx.use({ tokenId: mage.id, identifier: "warding-bond", targetTokenIds: [guerrier.id] });
    await pause(2000);
    ctx.expect((await ctx.effectsFrom(guerrier, "warding-bond")).length > 0, "Warding Bond on the Fighter again");
    const fighterHp = await ctx.hp(guerrier);
    since = await ctx.lastMessageId();
    await ctx.setHp(guerrier, 0);
    await pause(2500);
    ctx.expect((await ctx.effectsFrom(guerrier, "warding-bond")).length > 0, "warded Fighter at 0 HP: Warding Bond stays (issue #150)");
    ctx.expect(!(await endedSince(since, "zeroHp")).length, "no ending card for the warded creature's 0 HP");
    await ctx.setHp(guerrier, fighterHp);
    await pause(500);
    for ( const s of DOWNED ) await ctx.removeStatusEffects(guerrier, s);
    since = await ctx.lastMessageId();
    await ctx.setHp(mage, 0);
    await pause(2500);
    ctx.expect(!(await ctx.effectsFrom(guerrier, "warding-bond")).length, "Wizard at 0 HP: Warding Bond ends");
    ctx.expect((await endedSince(since, "zeroHp")).length > 0, "a chat card tells the table");
  }
};
