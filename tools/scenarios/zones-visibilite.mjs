/**
 * §530 (Gabe's request, 2026-11-24) — the world setting `areaVisibility`: who sees an area placed from an activity. Both dnd5e's placement
 * (template-placement, `flags.dnd5e.activity`) and the engine's own areas (adapter/self-area.mjs) carry that flag; the scenario creates
 * regions carrying it, as a placement would, plus one drawn "by hand" (no flag), under each choice of the setting:
 *  1. "all" (default): the area keeps ALWAYS.
 *  2. "gm": an ALWAYS area is created GAMEMASTER; an area asked on the Region layer stays there (never shown more).
 *  3. "layer": an ALWAYS area is created LAYER.
 *  4. Under "layer", the hand-drawn region keeps ALWAYS.
 * Setting and regions restored.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));
const V = { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };

export default {
  name: "zones-visibilite — spell areas visible to everyone / GM / Region layer: the setting applies to activity areas only, never shows more (§530)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const anchor = tokens[0];
    if ( !anchor ) { ctx.log("no token on the scene: not applicable"); return; }
    const g = await ctx.gridSize();
    const at = await ctx.position(anchor);
    const before = (await ctx.engine("setting", { key: "areaVisibility" })).now;
    ctx.restore(() => ctx.engine("setting", { key: "areaVisibility", value: before }));

    const made = [];
    ctx.restore(async () => { for ( const id of made ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const shape = { type: "rectangle", x: at.x + 3 * g, y: at.y, width: g * 2, height: g * 2 };
    const create = async (name, { activity=true, visibility=V.ALWAYS }={}) => {
      const r = await ctx.call("create-region", { name, shapes: [shape], regionData: { visibility,
        ...(activity ? { flags: { dnd5e: { activity: "Actor.dasTestActor0000.Item.dasTestItem00000.Activity.dasTestAct000000" } } } : {}) } });
      const id = r?.data?.id ?? r?.data?._id ?? r?.id ?? r?._id ?? r?.region?.id;
      if ( !id ) throw new Error(`region not created: ${JSON.stringify(r).slice(0, 300)}`);
      made.push(id);
      const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: id });
      return data?.visibility;
    };

    await ctx.engine("setting", { key: "areaVisibility", value: "all" });
    ctx.expect(await create("DAS test area (all)") === V.ALWAYS, "everyone: the activity area stays visible to everyone");

    await ctx.engine("setting", { key: "areaVisibility", value: "gm" });
    await pause(300);
    ctx.expect(await create("DAS test area (gm)") === V.GAMEMASTER, "GM only: the activity area is created visible to the GM only");
    ctx.expect(await create("DAS test area (gm, layer)", { visibility: V.LAYER }) === V.LAYER,
      "GM only: an area asked on the Region layer stays there (never shown more)");

    await ctx.engine("setting", { key: "areaVisibility", value: "layer" });
    await pause(300);
    ctx.expect(await create("DAS test area (layer)") === V.LAYER, "Region layer only: the activity area is created on the Region layer");
    ctx.expect(await create("DAS test region by hand", { activity: false }) === V.ALWAYS, "a region drawn by hand keeps its own visibility");
  }
};
