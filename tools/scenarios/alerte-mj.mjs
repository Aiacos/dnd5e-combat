/**
 * §364–§366: GM alert. Test arena (Wizard, Zombie).
 *  1. Telekinesis (alert table, §365) cast by the Wizard: a card whispered to the GMs, marked `gmAlert`, and the text in
 *     the GM's banner.
 *  2. Staff of the Magi: "Spell Absorption" alerts, another activity (the attack) does not (the `activities` filter).
 *  3. "GM Alerts" world setting off: "Spell Absorption" no longer posts any card.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "alerte MJ — bandeau, carte chuchotée, filtre d'activité, réglage",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(async () => { for ( const s of ["restrained"] ) await ctx.removeStatusEffects(zombi, s).catch(() => {}); });
    const banner = await ctx.engine("setting", { key: "gmAlertBanner" }).catch(() => null);
    if ( banner ) ctx.restore(() => ctx.engine("setting", { key: "gmAlertBanner", value: banner.before }));
    await ctx.engine("setting", { key: "gmAlertBanner", value: true }).catch(() => null);
    const alertsSince = async id => (await ctx.messagesSince(id)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);

    // 1. Telekinesis
    const tk = await ctx.ensureItem(mage, `${PHB}phbsplTelekinesi`, { system: { method: "atwill" } });
    const cast = await ctx.use({ tokenId: mage.id, itemId: tk, targetTokenIds: [zombi.id], consume: false });
    await pause(2500);
    const cards = await alertsSince(cast.usageMessageId);
    ctx.expect(cards.length === 1, `Télékinésie : une carte d'alerte (${cards.map(c => c.flags[MODULE_ID].gmAlert.text).join(" / ") || "aucune"})`);
    ctx.expect(cards[0]?.whisper === true || (Array.isArray(cards[0]?.whisper) && cards[0].whisper.length > 0) || !!cards[0]?.whisperTo,
      `chuchotée aux MJ (${JSON.stringify(cards[0]?.whisper ?? cards[0]?.whisperTo ?? null)})`);
    const shown = await ctx.engine("gmAlerts", {});
    ctx.expect((shown ?? []).some(t => /9 m|30 ft/.test(t)), `dans le bandeau du MJ (${(shown ?? []).join(" / ") || "rien"})`);

    // 2. Staff of the Magi: the activity filter
    if ( JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      const staff = await ctx.ensureItem(mage, `${DMG}dmgStaffOfTheMag`, { ready: true });   // DMG 3.0.0: activities visible, attuned
      const absorb = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "QcfPhLX9LBvOnShu", consume: false, targetTokenIds: [] });
      await pause(2500);
      ctx.expect((await alertsSince(absorb.usageMessageId)).length === 1, "Bâton : « Spell Absorption » alerte");
      const strike = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "RddG208UbA6B1flD", consume: false, targetTokenIds: [zombi.id] });
      await ctx.settle(strike.usageMessageId).catch(() => {});
      await pause(1500);
      ctx.expect(!(await alertsSince(strike.usageMessageId)).length, "Bâton : son attaque n'alerte pas");
    }

    // 3. Setting off (Staff: "Spell Absorption")
    const on = await ctx.engine("setting", { key: "gmAlerts", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "gmAlerts", value: on.before }));
    const staff = await ctx.ensureItem(mage, `${DMG}dmgStaffOfTheMag`, { ready: true });   // DMG 3.0.0: activities visible, attuned
    const off = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "QcfPhLX9LBvOnShu", consume: false, targetTokenIds: [] });
    await pause(2500);
    const silent = await alertsSince(off.usageMessageId);
    ctx.expect(!silent.length, `alertes éteintes : aucune carte (${silent.length})`);
    await ctx.engine("setting", { key: "gmAlerts", value: on.before });
  }
};
