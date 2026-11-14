/**
 * Renvoi des morts-vivants par la Calcination (SPEC §16.25) : seuls les morts-vivants sont affectés (un humanoïde hostile
 * dans la zone ne l'est pas) ; un mort-vivant qui rate sa sauvegarde est Renvoyé (Effrayé, Neutralisé) et subit les
 * dégâts radiants, qui ne mettent pas fin au renvoi ; des dégâts subis ensuite y mettent fin.
 * Alara (la clerc de `dnd-6`, qui a la Calcination), un Zombi et un humanoïde du SRD 2024 posés pour l'occasion (`ctx.cast` ;
 * le monde `ravenloft` avait un « Zombie Plague Spreader » de Ravenloft et un PNJ de campagne), le Guerrier pour les dégâts
 * qui mettent fin au renvoi. Sans Alara : non applicable.
 */
const UNDEAD = "Zombi du renvoi";
const HUMANOID = "Cible humanoïde";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "renvoi — Calcination des morts-vivants",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Alara") ) { ctx.log("pas d'Alara sur la scène : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const cast = await ctx.cast({ [UNDEAD]: "mmZombie00000000", [HUMANOID]: "mmBanditCaptain0" }, { near: "Alara", disposition: -1 });
    const undeadToken = cast[UNDEAD];
    if ( !undeadToken ) { ctx.log("pas de fiche de Zombi (SRD 2024) : non applicable"); return; }

    const grid = await ctx.gridSize();
    const at = await ctx.position(alara);
    const zombieId = undeadToken.id;
    await ctx.call("move-token", { tokenId: zombieId, x: at.x + (2 * grid), y: at.y, elevation: at.elevation });
    ctx.expect((await ctx.position(undeadToken)).x === at.x + (2 * grid), `${UNDEAD} posé à 10 ft d'Alara`);
    const zombie = { id: zombieId, name: UNDEAD, actorId: undeadToken.actorId };
    const undeadActor = { id: undeadToken.actorId };
    const humanoid = cast[HUMANOID] ? await ctx.token(HUMANOID) : null;
    if ( humanoid ) await ctx.call("move-token", { tokenId: humanoid.id, x: at.x - (2 * grid), y: at.y });

    // La Calcination, lancée jusqu'à ce que le mort-vivant rate sa sauvegarde (Sagesse 5 : presque toujours).
    const center = { x: at.x + grid / 2, y: at.y + grid / 2 };
    let r = null;
    for ( let n = 1; n <= 6; n++ ) {
      await ctx.setHp(zombie, 78);
      for ( const e of await ctx.effects(zombie) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombieId}.Actor.${undeadActor.id}`, effectId: e._id }).catch(() => {});
      }
      const used = await ctx.use({ tokenId: alara.id, identifier: "sear-undead", activityType: "save", consume: false,
        area: { shape: "circle", ...center, radius: 6.5 * grid } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      r = await ctx.settle(used.usageMessageId);
      if ( r.targets.find(t => t.token.endsWith(zombieId))?.save?.success === false ) break;
    }
    const z = r.targets.find(t => t.token.endsWith(zombieId));
    const h = humanoid ? r.targets.find(t => t.token.endsWith(humanoid.id)) : null;
    ctx.expect(!!z && (z.save?.success === false), `le mort-vivant rate sa sauvegarde (${z?.save?.total ?? "—"})`);
    if ( humanoid ) ctx.expect(!h || !!h.unaffected, `${HUMANOID}, humanoïde, n'est pas affecté${h ? ` (${h.unaffected?.reason})` : " (hors des cibles)"}`);
    ctx.expect((z?.damage?.applied ?? 0) > 0, `dégâts radiants appliqués (${z?.damage?.applied ?? 0})`);
    await pause(1500);
    const turned = async () => (await ctx.effects(zombie)).some(e => (e.statuses ?? []).includes("frightened"));
    ctx.expect(await turned(), "Renvoyé : l'effet tient malgré les dégâts de la Calcination");

    // Des dégâts ensuite : le renvoi cesse (le Guerrier et son épée à deux mains, au contact).
    const fighter = tokens.some(t => t.name === "Guerrier") ? await ctx.token("Guerrier") : null;
    if ( !fighter ) return;
    await ctx.call("move-token", { tokenId: fighter.id, x: at.x + (3 * grid), y: at.y });
    for ( let n = 1; n <= 8; n++ ) {
      const used = await ctx.use({ tokenId: fighter.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [zombieId] });
      const hit = await ctx.settle(used.usageMessageId);
      if ( hit.targets[0]?.hit ) break;
    }
    await pause(2000);
    ctx.expect(!(await turned()), "touché par le Guerrier : le renvoi cesse");
  }
};
