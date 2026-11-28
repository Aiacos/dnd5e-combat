/**
 * Levels and Surfaces (P2, SPEC §14.2) on a scene with levels (Restored Keep): the Zombie is
 * lowered to the lowest level, head against its ceiling, just under the Sorcerer's floor.
 *  1. Burning Hands placed on its column from the upper floor does not reach it: the floor (Surface
 *     `move`) cuts the line of effect — "area placed on nobody", HP intact.
 *  2. Fire Bolt shot at it from the upper floor: Total Cover in the verdict (AC nil, automatic miss).
 * Restores the Zombie to its level, its elevation and its HP. Moves through `move-token` (0.27.0).
 * Without levels on the scene (a single level), the scenario declares itself not applicable.
 */
export default {
  scene: "keep",   // §83: floors and stairs, in Restored Keep
  name: "niveaux — un plancher arrête la zone et l'attaque",

  async run(ctx) {
    const { levels } = await ctx.call("list-levels", {});
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const sorted = [...levels].sort((a, b) => a.elevation.base - b.elevation.base);
    const lowest = sorted[0];
    const sorcLevel = levels.find(l => l.id === sorc.level) ?? sorted[1];
    if ( !lowest || !sorcLevel || (lowest.id === sorcLevel.id) ) { ctx.log("scène sans niveau sous celui de l'Ensorceleur : non applicable"); return; }
    const { surfaces } = await ctx.call("list-surfaces", { type: "move" });
    ctx.expect(surfaces.some(s => s.elevation === sorcLevel.elevation.base), `un plancher « move » à ${sorcLevel.elevation.base} (niveau ${sorcLevel.name})`);

    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const home = { x: zombi.x, y: zombi.y, elevation: zombi.elevation ?? 0, levelId: zombi.level };
    const move = async where => {
      const moved = await ctx.call("move-token", { tokenId: zombi.id, ...where });
      if ( !moved.moved ) throw new Error(`move-token : ${moved.warning ?? "refusé"} (${JSON.stringify(moved.after)})`);
      return moved.after;
    };
    ctx.restore(() => move(home));

    // Head against the ceiling of the level below: one cell high under the floor.
    const scene = await ctx.call("get-scene", {});
    const step = scene.grid?.distance ?? scene.scene?.grid?.distance ?? 5;
    const below = await move({ levelId: lowest.id, elevation: sorcLevel.elevation.base - step });
    ctx.expect(below.level === lowest.id, `Zombi descendu au niveau « ${lowest.name} », élévation ${below.elevation}`);

    // 1. Area from the upper floor on its column.
    const box = await ctx.box(zombi);
    const zone = await ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...box }, collectMs: 3000 });
    ctx.expect(zone.used && !!zone.regionId, "Mains brûlantes posée sur la colonne du Zombi, depuis l'étage");
    if ( zone.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone.regionId }).catch(() => {}));
    await new Promise(r => setTimeout(r, 2000));
    const r1 = await ctx.resolution(zone.usageMessageId);
    ctx.expect(!r1?.targets?.some(t => t.name === "Zombi"), `le plancher arrête la zone (cibles : ${r1?.targets?.map(t => t.name).join(", ") || "aucune"})`);
    ctx.expect((await ctx.hp(zombi)) === hp0, "PV intacts");

    // 2. Ranged attack from the upper floor: Total Cover.
    const shot = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
    ctx.expect(shot.used, "Trait de feu tiré sur le Zombi du dessous");
    const r2 = await ctx.settle(shot.usageMessageId);
    const target = r2.targets.find(t => t.name === "Zombi") ?? r2.targets[0];
    ctx.expect(target?.cover?.degree === "total", `abri total dans le verdict (${target?.cover?.degree ?? "aucun abri"})`);
    ctx.expect((target?.ac === null) && (target?.hit === false) && (r2.step === "missed"), `intouchable : CA ${target?.ac}, ${target?.hit ? "touché" : "raté"}, étape « ${r2.step} »`);
    ctx.expect((await ctx.hp(zombi)) === hp0, "PV intacts après le tir");
  }
};
