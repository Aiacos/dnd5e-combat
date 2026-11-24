/**
 * Zone « sur soi » posée d'office (§47) : Esprits gardiens (PHB), prêté au lanceur (Alara dans `ravenloft`, sinon le Magicien),
 * utilisé comme au clic — pose de dnd5e comprise (`api.mcp.use`, pas `use-activity` du connecteur qui la coupe). dnd5e ouvre sa
 * fenêtre pour le niveau du sort, mais sans la case « Placer le gabarit ». Sans le moteur, dnd5e attendrait un clic sur un token ;
 * ici l'émanation naît d'elle-même, rattachée au lanceur (le Zombi, déplacé à côté, ne sauvegarde pas à la pose : §531).
 * Le même geste pour une capacité de créature (émanation sans emplacement) se joue dans le dépôt du module qui la livre.
 * §438 : Manuel 3.0.0 — l'émanation est posée par « Cast Spell » (`tevaatMC9LZxVPLS`).
 * §531 (issue #142): SRD 5.2 — nothing happens when the Emanation appears: the Zombie, already inside, makes no save at the cast;
 * it saves when the caster walks up and the attached Emanation enters its space ("whenever the Emanation enters a creature's space").
 */
export default {
  name: "zone sur soi — émanation posée sur le lanceur sans clic (Esprits gardiens)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const caster = tokens.find(t => t.name === "Alara") ?? tokens.find(t => t.name === "Magicien");
    if ( !caster || !tokens.some(t => t.name === "Zombi") ) { ctx.log("Alara ou Magicien, et Zombi, absents : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const itemId = await ctx.ensureItem(caster, "Compendium.dnd-players-handbook.spells.Item.phbsplSpiritGuar");
    const cPos = await ctx.position(caster);
    await ctx.call("move-token", { tokenId: zombi.id, x: cPos.x - 2 * grid, y: cPos.y, elevation: cPos.elevation });
    await ctx.setHp(zombi, 100);

    const v3 = !!((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === itemId)?.system?.activities?.tevaatMC9LZxVPLS;
    if ( v3 ) ctx.log("forme 3.0.0 : zone posée par « Cast Spell »");
    const since = await ctx.lastMessageId();
    const used = await ctx.engine("use", { tokenId: caster.id, itemId, ...(v3 ? { activityId: "tevaatMC9LZxVPLS" } : { activityType: "save" }) });
    for ( const r of used.regions ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: caster.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${caster.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });

    ctx.expect(!used.dialog?.templateBox, used.dialog ? "fenêtre du niveau de sort, sans case « Placer le gabarit »" : "aucune fenêtre de dnd5e");
    const [region] = used.regions;
    ctx.expect(used.regions.length === 1, `une zone posée sans clic (${used.regions.length})`);
    if ( !region ) return;
    ctx.expect(region.shapes.join() === "emanation", `forme : émanation (${region.shapes.join()})`);
    ctx.expect(region.attachedTo === caster.id, `rattachée à ${caster.name}`);
    ctx.expect(Number.isFinite(region.elevation.bottom) && Number.isFinite(region.elevation.top),
      `tranche d'élévation posée (${region.elevation.bottom} → ${region.elevation.top})`);

    // §531 (issue #142): SRD 5.2 — no save when the Emanation appears (only on entering it, its entering a space, or a turn end).
    await new Promise(r => setTimeout(r, 3000));
    const ticks = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "enter"));
    ctx.expect(!ticks.length, `no "enter" replay when the Emanation appears (${ticks.length})`);
    ctx.expect((await ctx.hp(zombi)) === 100, `the Zombie, two squares away, takes nothing at the cast (${await ctx.hp(zombi)} HP)`);

    // §531: the Zombie steps out of the Emanation, then the caster walks up to it — the attached Emanation enters its space.
    await ctx.call("move-token", { tokenId: zombi.id, x: cPos.x - 6 * grid, y: cPos.y, elevation: cPos.elevation });
    await new Promise(r => setTimeout(r, 1500));
    ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: cPos.x, y: cPos.y, elevation: cPos.elevation }).catch(() => {}));
    const beforeMove = await ctx.lastMessageId();
    await ctx.call("move-token", { tokenId: caster.id, x: cPos.x - 3 * grid, y: cPos.y, elevation: cPos.elevation });
    let entered = null;
    for ( let i = 0; i < 8 && !entered; i++ ) {
      await new Promise(r => setTimeout(r, 1000));
      entered = (await ctx.messagesSince(beforeMove)).find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "enter"));
    }
    ctx.expect(!!entered, `${caster.name} moves: the Emanation enters the Zombie's space and the save replays`);
    if ( !entered ) return;
    const r = await ctx.settle(entered.id);
    const e = r.targets.find(x => x.name === "Zombi");
    ctx.expect(!!e?.save, `the Zombie saves when the Emanation reaches it (${e?.save?.total ?? "—"}, ${e?.damage?.applied ?? 0} damage)`);
    ctx.expect(!r.targets.some(t => t.name === caster.name), "the caster is not affected");
  }
};
