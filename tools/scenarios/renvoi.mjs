/**
 * Turning of the Undead by Sear Undead (SPEC §16.25): only the Undead are affected (a hostile Humanoid
 * in the area is not); an Undead that fails its save is Turned (Frightened, Incapacitated) and takes the
 * radiant damage, which does not end the turning; damage taken afterwards ends it.
 * Alara (the `dnd-6` cleric, who has Sear Undead), a Zombie and a 2024 SRD Humanoid placed for the occasion (`ctx.cast`;
 * the `ravenloft` world had a Ravenloft "Zombie Plague Spreader" and a campaign NPC), the Fighter for the damage
 * that ends the turning. Without Alara: not applicable.
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

    // Sear Undead, cast until the Undead fails its save (Wisdom 5: almost always).
    // §469: on a sheet at Handbook 3.0.0 (or SRD 6.1), the Sear Undead item no longer has an activity: "Sear Undead" is on Channel
    // Divinity (content/cleric.mjs, SEAR_UNDEAD_61).
    const items = (await ctx.call("get-actor", { actorId: alara.actorId })).items ?? [];
    const searItem = items.find(i => i.system?.identifier === "sear-undead");
    const oldForm = Object.keys(searItem?.system?.activities ?? {}).length > 0;
    const channel = items.find(i => i.system?.identifier === "channel-divinity-cleric");
    // New form: with no area ("the Undead of your choice within 9 m") — Channel Divinity's Turn Undead, Sear Undead checked in
    // its place (like renvoi-choix), the Zombie and the Humanoid designated.
    ctx.log(`Calcination : ${oldForm ? "activité de l'item Calcination (ancienne forme)" : "« Sear Undead » du Conduit divin, à la place du Renvoi"}`);
    const searUse = async () => {
      if ( oldForm ) return ctx.use({ tokenId: alara.id, identifier: "sear-undead", activityType: "save", consume: false,
        area: { shape: "circle", ...center, radius: 6.5 * grid } });
      const targetIds = [zombieId, ...(humanoid ? [humanoid.id] : [])];
      return ctx.engine("castPicked", { tokenId: alara.id, itemId: channel?._id, activityId: "aOptL5pMaj3WtR8S", targetIds, upgrade: true });
    };
    const center = { x: at.x + grid / 2, y: at.y + grid / 2 };
    let r = null;
    for ( let n = 1; n <= 6; n++ ) {
      // The SRD Zombie has only 15 HP: its maximum is raised (unlinked token, removed at the end), otherwise Sear Undead kills it.
      await ctx.call("update-scene-object", { type: "Token", objectId: zombieId, data: { "delta.system.attributes.hp.max": 200 } });
      await ctx.setHp(zombie, 78);
      for ( const e of await ctx.effects(zombie) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombieId}.Actor.${undeadActor.id}`, effectId: e._id }).catch(() => {});
      }
      const used = await searUse();
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

    // Damage afterwards: the turning ends (the Fighter and his two-handed sword, in melee).
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
