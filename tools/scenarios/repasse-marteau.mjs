/**
 * §352: Thunder Hammer (carried over from batch O8b). Test arena (Fighter, Zombie, Cleric). The Zombie 3 cells east of the
 * Fighter, the Cleric 2 cells further (9 m from the Zombie). The Hammer is placed on a Fighter's War Maul.
 *  1. "Hurl Hammer" that hits the Zombie: the Zombie and the Cleric each make a Constitution saving throw DC 17, not the Fighter;
 *     a successful saving throw leaves no Stunned (the data's, with no saving throw, does not go through), a failed one places one.
 *  2. A melee Maul strike that hits: no saving throw.
 *  3. Guide 3.0.0: the book's "Thunderclap" activity (the same saving throw, by hand) is refused, forceable — the engine already
 *     played it on the hit (a single saving throw). Absent from Guide 2.0.0: not applicable.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-marteau — Marteau de tonnerre : coup de tonnerre autour de la cible touchée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Clerc absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + 3 * g, at.y], Clerc: [at.x + 5 * g, at.y] } });
    const [zombi, cleric] = await Promise.all(["Zombi", "Clerc"].map(n => ctx.token(n)));
    const hpZ = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    // The thunderclap takes every creature of the Arena within 9 m: the Stunned is removed from each.
    const unstun = async () => { for ( const t of await ctx.liveTokens() ) if ( t.actorId ) await ctx.removeStatusEffects(t, "stunned").catch(() => {}); };
    ctx.restore(unstun);
    const stunned = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses?.includes("stunned") ?? false;

    const hammer = await ctx.ensureItem(fighter, `${DMG}dmgHammerOfThund`);
    const maul = await ctx.ensureItem(fighter, `${PHB}phbwepMaul000000`);
    const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: hammer, activityId: "sOG5DXs2HNhx1U5m", targetItemId: maul,
      profile: "RSpASIW4HbToM7yC" }).catch(err => ({ error: err.message }));
    if ( !ctx.expect(!!done?.effectId && (done.riders > 0), `le Marteau de tonnerre est posé sur le Maillet (${done?.error ?? `${done?.riders} ajout(s)`})`) ) return;
    // Guide 3.0.0: the throw is only visible when attuned (`visibility.requireAttunement`) — the enchanted Maul is
    // equipped and attuned.
    const { data: tokData } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    await ctx.call("upsert-actor-item", { actorId: tokData.actorId, itemData: { "system.equipped": true, "system.attuned": true },
      match: { path: "_id", value: maul } });
    await pause(500);
    const data = await ctx.engine("itemData", { tokenId: fighter.id, itemId: maul, paths: ["system.activities"] });
    const activities = Object.values(data?.["system.activities"] ?? {});
    const hurl = activities.find(a => (a.type === "attack") && (a.attack?.type?.value === "ranged"))?._id;
    const swing = activities.find(a => (a.type === "attack") && (a.attack?.type?.value !== "ranged"))?._id;
    if ( !ctx.expect(!!hurl && !!swing, `activités du Maillet : lancer ${hurl ?? "?"}, frappe ${swing ?? "?"}`) ) return;

    /** Attacks until a hit; returns the log lines of that attack. */
    const hit = async activityId => {
      for ( let i = 0; i < 15; i++ ) {
        await ctx.setHp(zombi, hpZ);
        await unstun();
        const before = (await ctx.engineLog()).length;
        const used = await ctx.use({ tokenId: fighter.id, itemId: maul, activityId, consume: false, targetTokenIds: [zombi.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.hit !== true ) continue;
        await pause(5000);
        return (await ctx.engineLog()).slice(before);
      }
      return null;
    };

    // 1. Lancer.
    const lines = await hit(hurl);
    if ( !ctx.expect(!!lines, "le Marteau lancé touche le Zombi") ) return;
    const save = name => lines.find(l => l.includes(`: ${name} con saving throw`));
    for ( const l of lines.filter(l => /saving throw|receives/.test(l)) ) ctx.log(l);
    ctx.expect(!!save("Zombi") && !!save("Clerc"), "le Zombi et le Clerc (à 9 m) font chacun la sauvegarde de Constitution DD 17");
    ctx.expect(!save("Guerrier"), "le lanceur ne fait pas de sauvegarde");
    for ( const [name, token] of [["Zombi", zombi], ["Clerc", cleric]] ) {
      const line = save(name);
      if ( !line ) continue;
      const failed = /failed$/.test(line);
      ctx.expect((await stunned(token)) === failed, `${name} : sauvegarde ${failed ? "ratée → Étourdi" : "réussie → pas d'Étourdi"}`);
    }

    // 2. Melee strike: the Zombie in contact.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + g, y: at.y, elevation: 0 });
    await pause(800);
    const melee = await hit(swing);
    if ( ctx.expect(!!melee, "le Maillet touche le Zombi au corps à corps") ) {
      ctx.expect(!melee.some(l => /con saving throw/.test(l)), "au corps à corps : aucune sauvegarde");
    }

    // 3. "Thunderclap" (Guide 3.0.0) cast by hand: refused, forceable.
    // The activity added by the enchantment gets a new id (dnd5e): found again by its name (English client on the test bench).
    const clap = activities.find(a => (a.type === "save") && (a.name === "Thunderclap"));
    if ( !clap ) ctx.log("« Thunderclap » absent (Guide 2.0.0) : étape 3 non applicable");
    else {
      const lines3 = await ctx.engine("issues", { tokenId: fighter.id, itemId: maul, activityId: clap._id });
      ctx.expect(lines3.some(l => /DAS/.test(l) && /Thunderclap/.test(l)),
        `« Thunderclap » à la main : refusé, forçable (${lines3.join(" ; ") || "aucun souci"})`);
    }
  }
};
