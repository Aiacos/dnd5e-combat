/**
 * §182: vision cones outside combat. The Zombie looks downward (rotation 0): the Fighter in front of it is seen, behind its
 * back not; setting turned off, or combat started: 360°. Restores: rotation, positions, setting, combat.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "cones — hors combat, une créature du MJ ne voit que devant elle",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    // The NPC AI, if present, would turn the Zombie toward what it sees: we turn it off for the duration of the scenario.
    const npc = await ctx.call("call-module-api", { moduleId: "darsh-npc", fn: "reglage", args: { key: "aiEnabled", value: false } }).catch(() => null);
    if ( npc?.result ) ctx.restore(() => ctx.call("call-module-api", { moduleId: "darsh-npc", fn: "reglage", args: { key: "aiEnabled", value: npc.result.before } }));
    const cones = await ctx.engine("setting", { key: "visionCones", value: true });
    ctx.restore(() => ctx.engine("setting", { key: "visionCones", value: cones.before }));
    const { data: z } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { rotation: z.rotation ?? 0 } }));
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { rotation: 0 } });
    const grid = await ctx.gridSize();
    const sees = () => ctx.engine("sees", { observerId: zombi.id, targetId: guerrier.id });

    // In front (below), three cells away.
    await ctx.stage({ tokens: { Guerrier: [z.x, z.y + (grid * 3)] } });
    await pause(400);
    const front = await sees();
    ctx.expect(front.cone?.angle > 0 && front.cone.angle < 360, `cône du Zombi : ${JSON.stringify(front.cone)}`);
    ctx.expect(front.sees === true, `devant : vu (${front.sees})`);

    // Behind its back (above), three cells away.
    await ctx.call("move-token", { tokenId: guerrier.id, x: z.x, y: z.y - (grid * 3), elevation: 0 });
    await pause(500);
    const back = await sees();
    ctx.expect(back.sees === false, `dans son dos : pas vu (${back.sees})`);
    ctx.expect(back.sighting?.seeable === false, "dans son dos : la Perception passive ne le voit pas non plus");

    // Setting turned off: 360°.
    await ctx.engine("setting", { key: "visionCones", value: false });
    const off = await sees();
    ctx.expect(off.cone === null && off.sees === true, `réglage coupé : vu (${off.sees})`);
    await ctx.engine("setting", { key: "visionCones", value: true });

    // Combat started: 360°.
    await ctx.startCombat([zombi, guerrier]);
    await pause(500);
    const fight = await sees();
    ctx.expect(fight.cone === null && fight.sees === true, `en combat : vu dans son dos (${fight.sees})`);
  }
};
