/**
 * §187: objects scattered on the ground (Player's Handbook 2024), in the arena. The Wizard scatters the object on the adjacent
 * cell (its resource spent: the caltrops leave his inventory, the ball bearings lose their use), then:
 *  1. the area stays, with its image on the ground, and touches no one at placement;
 *  2. the Zombie, walking (`walk`) through it, stops on its first cell; the area replays the saving throw; a failure gives
 *     the object's effect (Speed 0 and 1 piercing; Prone) — we start again until we see a failure and a success (10 tries at most,
 *     each entry counts outside combat);
 *  3. the Wizard, in contact, picks up: the area and the image disappear, the object comes back (caltrops recreated; ball
 *     bearings: their use returned).
 * Resets positions, HP, effects and items (the caster's safety net), and the world clock (each pickup advances it by 10 minutes).
 */
const MODULE_ID = "dnd5e-combat";
const EQUIPMENT = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "chausse-trapes et billes — la zone reste, on s'arrête dessus, on la ramasse",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const g = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const hp0 = await ctx.hp(zombi);
    const { data: mageTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const itemsOf = async () => (await ctx.call("get-actor", { actorId: mageTok.actorId })).items ?? [];

    // The object's cell: two cells west of the Zombie; the Wizard just above (in contact).
    const spot = { x: home.x - (2 * g), y: home.y };
    await ctx.call("move-token", { tokenId: mage.id, x: spot.x, y: spot.y - g });
    await pause(600);
    const placeZombi = async () => { await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y }); await pause(500); };

    const scatterCase = async ({ label, id, identifier, size, effectFrom, status=null }) => {
      const itemId = await ctx.ensureItem(mage, EQUIPMENT + id);
      ctx.restore(async () => {
        for ( const i of (await itemsOf()).filter(i => i.system?.identifier === identifier) ) {
          await ctx.call("remove-embedded-item", { documentType: "Actor", id: mageTok.actorId, itemId: i._id }).catch(() => {});
        }
      });
      const used = await ctx.use({ tokenId: mage.id, itemId, activityType: "save", consume: true,
        area: { shape: "rectangle", x: spot.x, y: spot.y, width: size * g, height: size * g } });
      if ( !ctx.expect(!!used.regionId, `${label} : zone posée`) ) return;
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await pause(2000);

      // 1. The area stays, with its image; the resource is spent.
      const state = await ctx.engine("scatter", { tokenId: mage.id });
      const zone = state.zones.find(z => z.id === used.regionId);
      ctx.expect(!!zone, `${label} : la zone reste au sol (${state.zones.length} zone(s) d'objets répandus)`);
      ctx.expect(!!zone?.tile, `${label} : son image au sol (tuile ${zone?.tile ?? "—"})`);
      ctx.expect(state.near.some(z => z.id === used.regionId), `${label} : le Magicien, au contact, peut la ramasser`);
      const spent = (await itemsOf()).find(i => i.system?.identifier === identifier);
      ctx.expect(!spent || (Number(spent.system?.uses?.spent) > 0), `${label} : l'objet est dépensé (${spent ? `utilisation ${spent.system.uses.spent}/${spent.system.uses.max}` : "plus dans l'inventaire"})`);

      // 2. The Zombie crosses it: stop on the first cell, saving throw; a failure and a success.
      const seen = { fail: false, success: false };
      for ( let n = 0; (n < 10) && !(seen.fail && seen.success); n++ ) {
        await placeZombi();
        await ctx.removeEffectsFrom(zombi, identifier).catch(() => {});
        if ( status ) await ctx.removeStatusEffects(zombi, status).catch(() => {});
        const hp = await ctx.hp(zombi);
        const since = await ctx.lastMessageId();
        await ctx.call("move-token", { tokenId: zombi.id, x: home.x - (5 * g), y: home.y, action: "walk" }).catch(() => null);
        await pause(2500);
        const at = await ctx.position(zombi);
        const first = { x: spot.x + ((size - 1) * g), y: spot.y };   // the area cell closest to the Zombie
        if ( !ctx.expect((at.x === first.x) && (at.y === first.y), `${label} : le Zombi s'arrête sur la première case (${at.x}, ${at.y} ; attendu ${first.x}, ${first.y})`) ) return;
        const m = (await ctx.messagesSince(since)).find(x => (x.type === "usage") && (x.flags?.[MODULE_ID]?.areaTick ?? x.flags?.areaTick));
        if ( !ctx.expect(!!m, `${label} : la zone rejoue sa sauvegarde à l'entrée`) ) return;
        const r = await ctx.settle(m.id, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        const t = r?.targets?.find(x => x.name === zombi.name);
        const failed = t?.save?.success === false;
        if ( failed ? seen.fail : seen.success ) continue;
        seen[failed ? "fail" : "success"] = true;
        const marks = await ctx.effectsFrom(zombi, effectFrom);
        const statuses = (await ctx.effects(zombi)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
        const has = status ? statuses.includes(status) : (marks.length > 0);
        ctx.expect(has === failed, `${label} : sauvegarde ${t?.save?.total} ${failed ? "ratée" : "réussie"} → ${has ? "effet posé" : "pas d'effet"}`);
        if ( identifier === "caltrops" ) {
          const lost = hp - (await ctx.hp(zombi));
          ctx.expect(lost === (failed ? 1 : 0), `${label} : ${lost} dégât(s) (attendu ${failed ? 1 : 0})`);
        }
      }
      ctx.expect(seen.fail && seen.success, `${label} : un échec et une réussite vus (${JSON.stringify(seen)})`);
      await ctx.removeEffectsFrom(zombi, identifier).catch(() => {});
      if ( status ) await ctx.removeStatusEffects(zombi, status).catch(() => {});
      await placeZombi();

      // 2 bis. In combat, via the engine's path (click on the ground: A*, one cell per point) — if it passes through the area,
      // it stops there, once.
      if ( await ctx.startCombat([zombi]) ) {
        const since = await ctx.lastMessageId();
        await ctx.engine("move", { tokenId: zombi.id, point: { x: home.x - (4 * g) + (g / 2), y: home.y + (g / 2) } });
        await pause(3000);
        const r = { after: await ctx.position(zombi) };
        const ticks = (await ctx.messagesSince(since)).filter(x => (x.type === "usage") && (x.flags?.[MODULE_ID]?.areaTick ?? x.flags?.areaTick));
        const first = { x: spot.x + ((size - 1) * g), y: spot.y };
        const stopped = (r.after.x === first.x) && (r.after.y === first.y);
        ctx.expect(ticks.length <= 1 && (!ticks.length || stopped),
          `${label} : en combat, chemin du moteur → ${ticks.length ? (stopped ? "arrêt sur la première case, une sauvegarde" : `traversée sans arrêt (${r.after.x}, ${r.after.y})`) : "la zone est contournée"}`);
        for ( const m of ticks ) await ctx.settle(m.id, { timeoutMs: 45000 }).catch(() => null);
        await pause(1000);
        if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
        ctx.ownCombat = null;
        await ctx.removeEffectsFrom(zombi, identifier).catch(() => {});
        if ( status ) await ctx.removeStatusEffects(zombi, status).catch(() => {});
        await placeZombi();
      }

      // 3. Le Magicien ramasse : la zone part, l'objet revient.
      const t0 = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      const picked = await ctx.engine("scatter", { tokenId: mage.id, pickUp: true });
      ctx.expect(picked.picked === true, `${label} : ramassé par le Magicien`);
      await pause(1500);
      const t1 = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      ctx.expect((t1 - t0) === 600, `${label} : 10 minutes passent (${t1 - t0} s)`);
      if ( t1 > t0 ) await ctx.engine("advanceTime", { seconds: t0 - t1 });   // the test world's clock resumes where it was
      const after = await ctx.engine("scatter", { tokenId: mage.id });
      ctx.expect(!after.zones.some(z => z.id === used.regionId), `${label} : la zone a disparu`);
      const { data: tiles } = await ctx.call("list-scene-objects", { type: "Tile" }).catch(() => ({ data: null }));
      if ( Array.isArray(tiles) ) ctx.expect(!tiles.some(t => t.id === zone?.tile || t._id === zone?.tile), `${label} : son image aussi`);
      const back = (await itemsOf()).find(i => i.system?.identifier === identifier);
      ctx.expect(!!back && !(Number(back.system?.uses?.spent) > 0), `${label} : l'objet est revenu, prêt (${back ? `quantité ${back.system.quantity}, utilisation ${back.system.uses?.spent ?? 0}` : "absent"})`);
    };

    await scatterCase({ label: "Chausse-trapes", id: "phbagCaltrops000", identifier: "caltrops", size: 1, effectFrom: "caltrops" });
    await ctx.setHp(zombi, hp0);
    await scatterCase({ label: "Billes", id: "phbagBallBearing", identifier: "ball-bearings", size: 2, effectFrom: "ball-bearings", status: "prone" });
    await ctx.setHp(zombi, hp0);
  }
};
