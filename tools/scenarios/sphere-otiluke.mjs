/**
 * Otiluke's Resilient Sphere (SPEC §232), `dnd-6` arena. Checks:
 *  - cast on an ally (the Fighter), the caster says he consents: failed saving throw outright ("willing"), no roll, he is enclosed;
 *  - the Zombie's attack on the enclosed Fighter: not affected ("enclosed"); the enclosed Fighter's attack on the
 *    Zombie: not affected;
 *  - cast on an enemy (the Zombie): no question, a real saving throw.
 * Puts back effects, HP and positions.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sphère d'Otiluke — cible consentante, rien ne traverse",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Guerrier", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, fighter, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, fighter, zombi];
    const sceneId = (await ctx.scene()).sceneId;
    const effects0 = new Map();
    const hp0 = new Map();
    for ( const t of all ) {
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
      hp0.set(t.id, await ctx.hp(t));
    }
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura);
    const reset = async () => {
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        await ctx.setHp(t, hp0.get(t.id));
      }
      await pause(800);
    };
    ctx.restore(reset);
    const sphereId = await ctx.ensureItem(mage, PHB + "phbsplOtilukesRe", { system: { method: "atwill" } });
    const settle = async used => (used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null);
    const weaponOf = async t => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"))?._id ?? null;

    // 1. On the Fighter, willing: the question arrives on the GM's side (the Wizard's player is not connected).
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const using = ctx.use({ tokenId: mage.id, itemId: sphereId, activityType: "save", targetTokenIds: [fighter.id], consume: false });
    let answered = null;
    for ( const stop = Date.now() + 15000; !answered && (Date.now() < stop); ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1500, details: true }).catch(() => null);
      for ( const d of r?.windows ?? [] ) {
        const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
        if ( !/consent|willing/i.test(text) ) continue;
        const b = (d.buttons ?? []).find(x => /^(Consentante|Willing)/i.test(x.label ?? ""));
        if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); answered = b.label; }
      }
    }
    ctx.expect(!!answered, `la question « consentante ? » est posée au lanceur (${answered ?? "aucune"})`);
    const willing = await settle(await using);
    const save = willing?.targets?.find(t => t.name === "Guerrier")?.save;
    ctx.expect(save?.auto === "willing" && save.success === false, `consentant : sauvegarde ratée d'office, sans jet (${JSON.stringify(save)})`);
    await pause(1500);
    const enclosed = (await added(fighter)).some(e => /sphere|sphère/i.test(e.name ?? ""));
    ctx.expect(enclosed, `le Guerrier est enfermé (${(await added(fighter)).map(e => e.name).join(", ") || "aucun effet"})`);

    // 2. Nothing goes through: from the Zombie to the Fighter, from the Fighter to the Zombie.
    const zWeapon = await weaponOf(zombi);
    const fWeapon = await weaponOf(fighter);
    for ( const [from, to, weapon, label] of [[zombi, fighter, zWeapon, "dehors → dedans"], [fighter, zombi, fWeapon, "dedans → dehors"]] ) {
      if ( !ctx.expect(!!weapon, `${label} : une arme`) ) continue;
      const hp = await ctx.hp(to);
      const r = await settle(await ctx.use({ tokenId: from.id, itemId: weapon, activityType: "attack", targetTokenIds: [to.id],
        usageConfig: { "dnd5e-combat": { confirmed: true } } }));
      const t = r?.targets?.find(x => x.name === to.name);
      ctx.expect(t?.unaffected?.reason === "enclosed", `${label} : non affecté, séparé par la sphère (${JSON.stringify(t?.unaffected ?? null)})`);
      ctx.expect((await ctx.hp(to)) === hp, `${label} : aucun PV perdu (${hp} → ${await ctx.hp(to)})`);
    }
    await reset();

    // 3. On the Zombie, enemy: no question, a real saving throw.
    const known2 = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const hostile = await settle(await ctx.use({ tokenId: mage.id, itemId: sphereId, activityType: "save", targetTokenIds: [zombi.id], consume: false }));
    const asked = ((await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known2, details: true }).catch(() => null))?.windows ?? [])
      .some(d => /consent|willing/i.test(`${d.title ?? ""} ${d.content ?? d.text ?? ""}`));
    const zSave = hostile?.targets?.find(t => t.name === "Zombi")?.save;
    ctx.expect(!asked && Number.isFinite(zSave?.total) && !zSave?.auto, `ennemi : pas de question, un jet (${JSON.stringify(zSave)})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
