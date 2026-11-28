/**
 * §353: Oathbow against the sworn enemy (carried over from batch O5 then O8e). Test arena (Fighter, Zombie, Cleric). The Bow is
 * placed on a Shortbow of the Fighter (range 80/320 ft).
 *  1. Before the oath: the Cleric between the Fighter and the Zombie gives the Zombie Cover; no Advantage.
 *  2. "Swear Oath" on the Zombie: Advantage on the Bow's shot, the Cover ignored; a shot of the Bow at the Cleric, no Advantage.
 *  3. The Zombie at 17 cells (85 ft, long range): no long-range Disadvantage against the sworn enemy.
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-arc — Arc du serment : Avantage, abri et longue portée contre l'ennemi juré",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Clerc absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Clerc: [at.x + 2 * g, at.y], Zombi: [at.x + 4 * g, at.y] } });
    const [zombi, cleric] = await Promise.all(["Zombi", "Clerc"].map(n => ctx.token(n)));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Sworn Enemy|Ennemi juré/i));
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData: data, match: { path: "_id", value: itemId } });

    const oathbow = await ctx.ensureItem(fighter, `${DMG}dmgOathbow000000`);
    const bow = await ctx.ensureItem(fighter, `${PHB}phbwepShortbow00`);
    // The Shortbow may be the Fighter's: its state is noted, and the enchantment removed at the end (its additions leave with it).
    const was = await ctx.engine("itemData", { tokenId: fighter.id, itemId: bow, paths: ["system.equipped", "system.attuned"] });
    ctx.restore(() => set(bow, { system: { equipped: was?.["system.equipped"] ?? false, attuned: was?.["system.attuned"] ?? false } }).catch(() => {}));
    const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: oathbow, activityId: "hQyhQEtRT1J0ks2q", targetItemId: bow }).catch(err => ({ error: err.message }));
    if ( done?.effectId ) ctx.restore(() => ctx.engine("removeItemEffect", { actorId: tok.actorId, itemId: bow, effectId: done.effectId }).catch(() => {}));
    if ( !ctx.expect(!!done?.effectId, `l'Arc du serment est posé sur l'Arc court (${done?.error ?? "ok"})`) ) return;
    await set(bow, { system: { equipped: true, attuned: true } });
    await pause(400);
    const reasons = target => ctx.engine("attackReasons", { attackerId: fighter.id, targetId: target.id, itemId: bow });
    const cover = () => ctx.engine("cover", { attackerId: fighter.id, targetId: zombi.id, itemId: bow, effective: true });
    const swornAdv = r => (r?.advantage ?? []).some(n => /Oathbow|serment/i.test(n));

    // 1. Avant le serment.
    let c = await cover();
    if ( !ctx.expect(!!c, `avant le serment : le Clerc abrite le Zombi (${c?.degree ?? "aucun abri"})`) ) return;
    ctx.expect(!swornAdv(await reasons(zombi)), "avant le serment : pas d'Avantage");

    // 2. Serment.
    const oath = await ctx.use({ tokenId: fighter.id, itemId: bow, activityType: "utility", targetTokenIds: [zombi.id] });
    if ( oath.usageMessageId ) await ctx.settle(oath.usageMessageId).catch(() => null);
    await pause(1500);
    let r = await reasons(zombi);
    ctx.expect(swornAdv(r), `ennemi juré : Avantage (${(r?.advantage ?? []).join(", ") || "aucun"})`);
    c = await cover();
    ctx.expect(!c, `ennemi juré : l'abri du Clerc ignoré (${c?.degree ?? "aucun"})`);
    r = await reasons(cleric);
    ctx.expect(!swornAdv(r), `tir sur le Clerc : pas d'Avantage (${(r?.advantage ?? []).join(", ") || "aucun"})`);

    // 3. Long range.
    await ctx.call("move-token", { tokenId: cleric.id, x: at.x, y: at.y + 3 * g, elevation: 0 });
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 17 * g, y: at.y, elevation: 0 });
    await pause(1000);
    r = await reasons(zombi);
    ctx.expect(!(r?.disadvantage ?? []).some(n => /long/i.test(n)), `ennemi juré à 85 ft : pas de Désavantage de longue portée (${(r?.disadvantage ?? []).join(", ") || "aucun"})`);
    await ctx.call("move-token", { tokenId: cleric.id, x: at.x + 17 * g, y: at.y + g, elevation: 0 });
    await pause(1000);
    r = await reasons(cleric);
    ctx.expect((r?.disadvantage ?? []).some(n => /long/i.test(n)), `le Clerc à 85 ft : Désavantage de longue portée (${(r?.disadvantage ?? []).join(", ") || "aucun"})`);
  }
};
