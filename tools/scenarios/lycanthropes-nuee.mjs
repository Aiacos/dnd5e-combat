/**
 * Deux règles de monstres du 2026-11-23 (§521) :
 *  - DF #252, Lycanthropes : la Morsure du loup-garou (Monster Manual 2024 ou SRD 2024, `mmWerewolf000000.mmBite0000000000`) ne maudit
 *    qu'un Humanoïde — l'entrée effective de l'item (`api.content.of`) porte `effectsIf: { "target.creatureType": "humanoid" }`. La
 *    Morsure d'un loup ordinaire, sous l'identifiant partagé `bite`, n'en porte pas. Lu sur les vraies fiches posées pour le scénario.
 *  - DF #248, Nuée : un trait `swarm` sans effet vaut pour la créature qui le porte — ni points de vie regagnés, ni points de vie
 *    temporaires. Le Zombi de l'Arène de test reçoit un trait d'essai `swarm` (c'est l'identifiant que lit le moteur) : un soin de 10 ne
 *    change rien, 10 PV temporaires non plus ; sans le trait, les deux passent.
 * Remis en état : PV et PV temporaires du Zombi, trait retiré, créatures posées retirées.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "lycanthropes (malédiction pour un Humanoïde seul) et nuée (ni soins ni PV temporaires) — #252, #248",

  async run(ctx) {
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    /** L'entrée effective de chaque item d'un token qui porte une activité d'attaque nommée « Bite » / identifiant `bite`. */
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

    // --- Nuée ----------------------------------------------------------------------------------------------------------------
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

    /** Un soin de 10 et 10 PV temporaires (`applyDamage`) : rend ce qui a changé. */
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
