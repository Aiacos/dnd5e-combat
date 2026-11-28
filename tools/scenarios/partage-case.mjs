/**
 * §105 — sharing another creature's cell. Wolf and Zombie side by side:
 *  1. without a feature, the Wolf cannot end in the Zombie's cell (the engine finds no path that gets there);
 *  2. Air Form (Air Elemental) lent to the Wolf: it enters and stops there — engine path, then real movement;
 *  3. Swarm (Swarm of Rats) lent to the Zombie: "and vice versa", the Wolf without a feature enters the swarm's cell.
 */
const AIR = "Compendium.dnd-monster-manual.actors.Actor.mmAirElemental00";
const RATS = "Compendium.dnd-monster-manual.actors.Actor.mmSwarmOfRats000";

export default {
  name: "partage de case — Forme d'air, Nuée",

  async run(ctx) {
    // Absent from `dnd-6`: placed for the scenario from their sheet (Monster Manual 2024, otherwise dnd5e's 2024 SRD).
    await ctx.cast({ "Loup": "mmWolf0000000000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Zombi absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, zombi] ) {
      const home = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    }
    const lend = async (uuid, identifier, token) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(token.id, identifier));
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {});
      ctx.restore(remove);
      return remove;
    };
    const place = async () => {
      const at = await ctx.position(wolf);
      await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
      return { i: Math.round(at.y / grid), j: Math.round(at.x / grid) + 1 };
    };
    const cellOfZombi = await place();
    const planTo = cell => ctx.engine("plan", { tokenId: wolf.id, cell, maxCost: 1e9 });
    const endsAt = (plan, cell) => {
      const w = plan.waypoints?.at(-1);
      return !!w && (Math.round(w.x / grid) === cell.j) && (Math.round(w.y / grid) === cell.i);
    };

    // 1. Without a feature.
    const blocked = await planTo(cellOfZombi);
    ctx.expect(!(blocked.found && blocked.arrives && endsAt(blocked, cellOfZombi)), "sans capacité : pas d'arrivée dans la case du Zombi");

    // 2. Forme d'air au Loup.
    const removeAir = await lend(AIR, "air-form", wolf);
    const air = await planTo(cellOfZombi);
    ctx.expect(air.found && air.arrives && endsAt(air, cellOfZombi), "Forme d'air : le chemin du moteur finit dans la case du Zombi");
    const walked = await ctx.engine("move", { tokenId: wolf.id, cell: cellOfZombi });
    ctx.expect((walked.after.cell?.i === cellOfZombi.i) && (walked.after.cell?.j === cellOfZombi.j),
      `Forme d'air : le Loup s'arrête dans la case du Zombi (${JSON.stringify(walked.after.cell)})`);
    await removeAir();
    const back = walked.before;
    await ctx.call("move-token", { tokenId: wolf.id, x: back.x, y: back.y, elevation: back.elevation });

    // 3. Swarm on the Zombie: the reverse.
    await lend(RATS, "swarm", zombi);
    const swarm = await planTo(cellOfZombi);
    ctx.expect(swarm.found && swarm.arrives && endsAt(swarm, cellOfZombi), "Nuée : le Loup peut finir dans la case de la nuée");
  }
};
