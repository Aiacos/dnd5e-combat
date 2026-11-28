/**
 * §225: the Ethereal plane, batch 1 — an Ethereal creature affects and is affected only by what is also in the Ethereal. Arena.
 *  1. The Ethereal Zombie: the Sorcerer's Fire Bolt does not affect it ("plane"), HP intact.
 *  2. The Ethereal Zombie: an area (Sleep, reduced to its cell) does not affect it.
 *  3. Both Ethereal: Fire Bolt affects it again (same plane).
 *  4. In combat, the Fighter in contact: the Ethereal Zombie moving away provokes no Opportunity Attack; material, yes.
 *  5. The Fighter can end his movement on the Ethereal Zombie's cell; not on the material Zombie's.
 *  6. Perception (batch 2): the Fighter does not see the Ethereal Zombie; the Wizard, under See Invisibility, does; the Ethereal
 *     Zombie sees the Fighter next to it, no longer beyond 60 ft.
 * Restores positions, HP, conditions, combat.
 */
const SPELLS = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "plan Éthéré — ni cible, ni zone, ni attaque d'opportunité, ni case bloquée d'un plan à l'autre",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Ensorceleur", "Magicien", "Guerrier", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [sorc, mage, fighter, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    const home = { fighter: await ctx.position(fighter), zombi: await ctx.position(zombi) };
    const hp0 = await ctx.hp(zombi);
    const ethereal = (t, active) => ctx.call("set-status", { tokenId: t.id, statusId: "ethereal", active });
    ctx.restore(async () => {
      for ( const t of [sorc, zombi] ) await ethereal(t, false).catch(() => {});
      await ctx.removeStatusEffects(zombi, "unconscious").catch(() => {});
      await ctx.removeStatusEffects(mage, "concentrating").catch(() => {});
      for ( const e of (await ctx.effects(mage)).filter(e => /invisib/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: mage.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("move-token", { tokenId: fighter.id, ...home.fighter }).catch(() => {});
      await ctx.call("move-token", { tokenId: zombi.id, ...home.zombi }).catch(() => {});
      await ctx.setHp(zombi, hp0);
    });

    const fireBolt = async () => {
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      return r.targets.find(t => t.name === "Zombi");
    };

    // 1. The Zombie is Ethereal, the Sorcerer is not.
    await ethereal(zombi, true);
    await pause(500);
    const t1 = await fireBolt();
    ctx.expect(t1?.unaffected?.reason === "plane", `Trait de feu sur le Zombi Éthéré : non affecté (${JSON.stringify(t1?.unaffected ?? null)})`);
    await pause(800);
    ctx.expect((await ctx.hp(zombi)) === hp0, `PV du Zombi intacts (${await ctx.hp(zombi)} / ${hp0})`);

    // 2. An area placed from the material plane.
    await ctx.ensureItem(mage, SPELLS + "phbsplSleep00000");
    const box = await ctx.box(zombi);
    const sleep = await ctx.use({ tokenId: mage.id, identifier: "sleep", activityType: "save", area: { shape: "rectangle", ...box } });
    // Alone in the area and on another plane, the Zombie is not a target of it: no resolution to wait for.
    await pause(3000);
    const saves = (await ctx.messagesSince(sleep.usageMessageId)).filter(m => (m.type === "save") || /save/i.test(m.flags?.dnd5e?.roll?.type ?? ""));
    ctx.expect(!saves.length, `Sommeil : aucune sauvegarde demandée au Zombi Éthéré (${saves.length})`);
    const statuses = (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);
    ctx.expect(!statuses.includes("unconscious") && !statuses.includes("incapacitated"), `Sommeil : le Zombi Éthéré n'est pas touché (${statuses.join(", ") || "aucun état"})`);
    await ctx.removeStatusEffects(mage, "concentrating").catch(() => {});

    // 3. Same plane: the Ethereal Sorcerer too.
    await ethereal(sorc, true);
    await pause(500);
    const t3 = await fireBolt();
    ctx.expect(!!t3 && !t3.unaffected, `les deux Éthérés : le Trait de feu vise le Zombi (${t3 ? (t3.hit ? "touché" : "raté") : "—"})`);
    await ethereal(sorc, false);
    await ctx.setHp(zombi, hp0);

    // 4. Opportunity Attack: the Fighter in contact with the Zombie.
    await ctx.call("move-token", { tokenId: fighter.id, x: home.zombi.x - grid, y: home.zombi.y });
    await ctx.startCombat([fighter, zombi]);
    await pause(800);
    const away = { x: home.zombi.x + (3 * grid) + (grid / 2), y: home.zombi.y + (grid / 2) };
    const etherealThreats = await ctx.engine("threats", { tokenId: zombi.id, point: away });
    ctx.expect(!etherealThreats.includes("Guerrier"), `Zombi Éthéré qui s'éloigne : pas d'attaque d'opportunité (${etherealThreats.join(", ") || "aucune"})`);
    await ethereal(zombi, false);
    await pause(500);
    const materialThreats = await ctx.engine("threats", { tokenId: zombi.id, point: away });
    ctx.expect(materialThreats.includes("Guerrier"), `Zombi matériel : le Guerrier peut faire son attaque d'opportunité (${materialThreats.join(", ") || "aucune"})`);
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;

    // 5. The Zombie's cell.
    const onZombi = { x: home.zombi.x + (grid / 2), y: home.zombi.y + (grid / 2) };
    const blocked = await ctx.engine("plan", { tokenId: fighter.id, point: onZombi });
    ctx.expect(!blocked.found || !blocked.arrives, `Zombi matériel : le Guerrier ne finit pas sur sa case (${JSON.stringify({ found: blocked.found, arrives: blocked.arrives })})`);
    await ethereal(zombi, true);
    await pause(500);
    const free = await ctx.engine("plan", { tokenId: fighter.id, point: onZombi });
    ctx.expect(free.found && free.arrives, `Zombi Éthéré : le Guerrier peut finir sur sa case (${JSON.stringify({ found: free.found, arrives: free.arrives })})`);

    // 6. Perception: the Zombie is still Ethereal, the Fighter still next to it.
    const sees = async (a, b) => (await ctx.engine("sees", { observerId: a.id, targetId: b.id })).sees;
    ctx.expect((await sees(fighter, zombi)) === false, "le Guerrier ne voit pas le Zombi Éthéré");
    ctx.expect((await sees(zombi, fighter)) === true, "le Zombi Éthéré voit le Guerrier à côté de lui");
    const seeId = await ctx.ensureItem(mage, SPELLS + "phbsplSeeInvisib", { system: { method: "atwill" } });
    const seeInv = await ctx.use({ tokenId: mage.id, itemId: seeId, targetTokenIds: [mage.id], consume: false });
    await ctx.settle(seeInv.usageMessageId).catch(() => {});
    await pause(1500);
    ctx.expect(seeInv.used, "le Magicien lance Détection de l'invisibilité");
    const special = (await ctx.call("get-actor", { actorId: mage.actorId })).system?.attributes?.senses?.special ?? "";
    ctx.log(`sens spéciaux du Magicien : « ${special} » ; effets : ${(await ctx.effects(mage)).map(e => e.name).join(", ")}`);
    ctx.expect((await sees(mage, zombi)) === true, "le Magicien, sous Détection de l'invisibilité, voit le Zombi Éthéré");
    await ctx.call("move-token", { tokenId: fighter.id, x: home.zombi.x - (14 * grid), y: home.zombi.y });
    await pause(800);
    const far = await ctx.engine("sees", { observerId: zombi.id, targetId: fighter.id });
    ctx.expect(far.sees === false, `le Guerrier à 70 ft : le Zombi Éthéré ne le voit plus (${JSON.stringify(far.sees)})`);
  }
};
