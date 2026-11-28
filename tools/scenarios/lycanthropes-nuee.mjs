/**
 * Two monster rules of 2026-11-23 (§521):
 *  - DF #252, Lycanthropes: the Werewolf's Bite (Monster Manual 2024 or SRD 2024, `mmWerewolf000000.mmBite0000000000`)
 *    curses only a Humanoid — the item's effective entry (`api.content.of`) carries
 *    `effectsIf: { "target.creatureType": "humanoid" }`. The Bite of an ordinary wolf, under the shared identifier `bite`,
 *    does not. Read on the real sheets placed for the scenario.
 *  - DF #248, Swarm: a `swarm` feature without effect applies to the creature that carries it — no Hit Points regained,
 *    no Temporary Hit Points. The Test Arena's Zombi gets a test `swarm` feature (the identifier the engine reads): a healing
 *    of 10 changes nothing, 10 Temporary Hit Points neither; without the feature, both go through.
 * Restored: the Zombi's HP and Temporary HP, feature removed, placed creatures removed.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "lycanthropes (malédiction pour un Humanoïde seul) et nuée (ni soins ni PV temporaires) — #252, #248",

  async run(ctx) {
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    /** The effective entry of each item of a token that carries an attack activity named "Bite" / identifier `bite`. */
    const biteEntry = tokenId => script(`
      const actor = canvas.tokens.get(args.id)?.actor;
      const api = game.modules.get("dnd5e-combat").api;
      const item = actor?.items.find(i => (i.system.identifier === "bite") || /^bite$/i.test(i.name) || (i.id === "mmBite0000000000"));
      if ( !item ) return { found: false, items: actor?.items.map(i => i.name) ?? [] };
      const of = api.content.of(item);
      return { found: true, item: item.name, id: item.id, identifier: of?.identifier ?? null, effectsIf: of?.entry?.effectsIf ?? null };`,
      { id: tokenId });

    // --- Lycanthropes ---------------------------------------------------------------------------------------------------------
    const cast = await ctx.cast({ "Loup-garou (essai)": "mmWerewolf000000", "Loup (essai)": "mmWolf0000000000" });
    const were = cast["Loup-garou (essai)"];
    if ( ctx.expect(!!were, "un loup-garou du Monster Manual ou du SRD posé") ) {
      const e = await biteEntry(were.id);
      ctx.log(`Morsure du loup-garou : ${JSON.stringify(e)}`);
      ctx.expect(e?.found && (e.effectsIf?.["target.creatureType"] === "humanoid"),
        `sa Morsure ne maudit qu'un Humanoïde (identifiant ${e?.identifier}, effectsIf ${JSON.stringify(e?.effectsIf)})`);
    }
    const wolf = cast["Loup (essai)"];
    if ( wolf ) {
      const e = await biteEntry(wolf.id);
      ctx.log(`Morsure du loup : ${JSON.stringify(e)}`);
      ctx.expect(e?.found && !e.effectsIf?.["target.creatureType"], `la Morsure d'un loup ordinaire n'a pas cette condition (${e?.identifier})`);
    }
    else ctx.log("pas de loup ordinaire parmi les fiches : comparaison non applicable");

    // --- Swarm ------------------------------------------------------------------------------------------------------------
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Zombi") ) { ctx.log("Zombi absent : partie nuée non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const { data: zTok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const temp = async () => (await script(`return canvas.tokens.get(args.id)?.actor?.system.attributes.hp.temp ?? 0;`, { id: zombi.id })) ?? 0;
    const setTemp = v => script(`await canvas.tokens.get(args.id)?.actor?.update({ "system.attributes.hp.temp": args.v }); return true;`, { id: zombi.id, v });
    const temp0 = await temp();
    ctx.restore(() => setTemp(temp0).catch(() => {}));
    ctx.restore(() => ctx.setHp(zombi, hp0));

    /** A healing of 10 and 10 Temporary HP (`applyDamage`): returns what changed. */
    const tryHeal = async label => {
      await ctx.setHp(zombi, 5);
      await setTemp(0);
      await pause(500);
      const h = await ctx.engine("heal", { tokenId: zombi.id, amount: 10 });
      const t = await ctx.engine("hurt", { tokenId: zombi.id, amount: 10, type: "temphp" });
      await pause(500);
      const out = { before: h?.before, after: h?.after, temp: await temp(), tempCall: t };
      ctx.log(`${label} : ${JSON.stringify(out)}`);
      return out;
    };

    const plain = await tryHeal("sans le trait");
    ctx.expect(plain.after > plain.before, `sans le trait : le soin passe (${plain.before} → ${plain.after})`);
    ctx.expect(plain.temp >= 10, `sans le trait : les PV temporaires passent (${plain.temp})`);

    const trait = { name: "Nuée (essai)", type: "feat", img: "icons/svg/aura.svg", system: { identifier: "swarm", type: { value: "monster" } } };
    const up = await ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData: trait, match: { path: "system.identifier", value: "swarm" } });
    const traitId = up.itemId ?? up.id ?? up.item?._id ?? await ctx.itemId(zombi.id, "swarm");
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: zTok.actorId, itemId: traitId }).catch(() => {}));
    await pause(800);
    const swarm = await tryHeal("avec le trait Nuée");
    ctx.expect(swarm.after === swarm.before, `Nuée : le soin ne rend rien (${swarm.before} → ${swarm.after})`);
    ctx.expect(swarm.temp === 0, `Nuée : pas de PV temporaires (${swarm.temp})`);
  }
};
