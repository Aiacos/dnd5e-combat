/**
 * Zone qui dure (B1, déclarée depuis 0.6.0, vérifiée ici) : Esprits gardiens (PHB, ajouté au Magicien le temps du
 * scénario, sans emplacement) — émanation de 15 ft ; « chaque fois que l'émanation entre dans l'espace d'une créature et
 * chaque fois qu'une créature y entre ou y termine son tour », sauvegarde de Sagesse, une fois par tour. Contenu :
 * `{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }`. La zone est posée par l'outil du connecteur (un cercle
 * centré sur le Magicien).
 * §438 : Manuel 3.0.0 — l'émanation est posée par l'activité utilitaire « Cast Spell » (`tevaatMC9LZxVPLS`), la sauvegarde est une activité
 * sœur sans zone, rejouée par la zone.
 * §531 (issue #142): SRD 5.2 — nothing when the Emanation appears (unlike Moonbeam's "When the Cylinder appears"): the Zombie two
 * squares away makes no save at the cast, saves at the end of its turn inside, then saves again when the caster's move brings the
 * Emanation into its space ("whenever the Emanation enters a creature's space").
 */
export default {
  name: "esprits gardiens — rien à la pose, fin de tour du Zombi dans l'émanation, puis l'émanation entre dans son espace",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const spellId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplSpiritGuar");
    const spell = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => (i._id === spellId) || (i.system?.identifier === "spirit-guardians"));
    const v3 = !!spell?.system?.activities?.tevaatMC9LZxVPLS;
    if ( v3 ) ctx.log("forme 3.0.0 : zone posée par « Cast Spell », sauvegarde rejouée à la pose");
    const mPos = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - 2 * grid, y: mPos.y, elevation: mPos.elevation });
    await ctx.setHp(zombi, 100);

    const center = { x: mPos.x + grid / 2, y: mPos.y + grid / 2 };
    const used = await ctx.use({ tokenId: mage.id, identifier: "spirit-guardians", ...(v3 ? { activityId: "tevaatMC9LZxVPLS" } : { activityType: "save" }), consume: false,
      area: { shape: "circle", ...center, radius: 3.5 * grid } });
    ctx.expect(used.used && !!used.regionId, "Esprits gardiens posés");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: mage.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    // §531 (issue #142): nothing when the Emanation appears — no "enter" replay, no damage for the Zombie already inside.
    await new Promise(r => setTimeout(r, 3000));
    const atCast = (await ctx.messagesSince(used.usageMessageId)).filter(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "enter"));
    ctx.expect(!atCast.length, `no save when the Emanation appears (${atCast.length} "enter" replay(s))`);
    ctx.expect((await ctx.hp(zombi)) === 100, `the Zombie, two squares away, takes nothing at the cast (${await ctx.hp(zombi)} HP)`);

    const since = used.usageMessageId;
    await ctx.startCombat([mage, zombi]);
    let replayed = null;
    for ( let i = 0; i < 4 && !replayed; i++ ) {
      await ctx.nextTurn();
      await new Promise(r => setTimeout(r, 2500));
      replayed = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "turnEnd"));
    }
    ctx.expect(!!replayed, "fin du tour du Zombi dans l'émanation : l'activité rejoue");
    if ( !replayed ) return;
    const r = await ctx.settle(replayed.id);
    const t = r.targets.find(x => x.name === "Zombi");
    ctx.expect(!!t?.save && (t.save.success === (t.save.total >= r.plan.save.dc)), `sauvegarde ${t?.save?.total} contre DD ${r.plan.save.dc}`);
    // The caster's own allies are spared on every replay (§16.23).
    ctx.expect(!r.targets.some(x => (x.name === "Magicien") || ["Guerrier", "Paladin", "Clerc", "Roublard", "Occultiste", "Ensorceleur"].includes(x.name)),
      `neither the caster nor an ally is affected (${r.targets.map(x => x.name).join(", ")})`);

    // §531: "whenever the Emanation enters a creature's space" — the Zombie steps out, a new turn starts, the caster walks up to it.
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - 6 * grid, y: mPos.y, elevation: mPos.elevation });
    await ctx.nextTurn();
    await new Promise(r => setTimeout(r, 1500));
    ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: mPos.x, y: mPos.y, elevation: mPos.elevation }).catch(() => {}));
    const beforeMove = await ctx.lastMessageId();
    await ctx.call("move-token", { tokenId: mage.id, x: mPos.x - 3 * grid, y: mPos.y, elevation: mPos.elevation });
    let entered = null;
    for ( let i = 0; i < 6 && !entered; i++ ) {
      await new Promise(r => setTimeout(r, 1000));
      entered = (await ctx.messagesSince(beforeMove)).find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "enter"));
    }
    ctx.expect(!!entered, "the caster moves: the Emanation enters the Zombie's space and the save replays");
    if ( !entered ) return;
    const e = (await ctx.settle(entered.id)).targets.find(x => x.name === "Zombi");
    ctx.expect(!!e?.save, `the Zombie saves when the Emanation reaches it (${e?.save?.total ?? "—"}, ${e?.damage?.applied ?? 0} damage)`);
  }
};
