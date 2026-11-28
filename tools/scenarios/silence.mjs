/**
 * Silence (SPEC §37.4), world `dnd-6`. The Cleric receives Silence (Player's Handbook, at will) and places the Sphere (6 m) on the
 * Zombie, itself outside the area. Checks:
 *  - the Zombie, already inside at placement, carries the effect (Deafened, `silenced`);
 *  - it leaves the area: the effect goes away (the core's `applyActiveEffect` behavior); it comes back: the effect comes back;
 *  - the Cleric's Concentration removed: the area disappears, and so does the effect;
 *  - §226: the Zombie designated as target on use does not receive a second copy (the activity is a utility: before, the engine
 *    also placed its effects on each target, a copy that leaving the area did not remove).
 * Puts back positions, effects, area and Concentration.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "silence — effet porté dans la zone, entrée, sortie, fin",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const silenceId = await ctx.ensureItem(cleric, PHB + "phbsplSilence000", { system: { method: "atwill" } });
    const home = await ctx.position(zombi);
    const effects0 = new Map();
    for ( const t of [cleric, zombi] ) effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura);
    const silenced = async () => (await added(zombi)).filter(e => (e.statuses ?? []).includes("silenced"));
    let regionId = null;
    const reset = async () => {
      if ( regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {});
      for ( const t of [cleric, zombi] ) {
        const target = await targetOf(t);
        for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await pause(600);
    };
    ctx.restore(reset);

    const used = await ctx.use({ tokenId: cleric.id, itemId: silenceId, activityType: "utility", consume: false, targetTokenIds: [zombi.id],
      area: { shape: "circle", x: home.x + grid / 2, y: home.y + grid / 2, radius: 4 * grid } });
    regionId = used.regionId ?? null;
    if ( !ctx.expect(!!regionId, "la Sphère est posée sur le Zombi") ) return;
    await pause(2500);
    const atCast = await silenced();
    ctx.expect(atCast.length === 1 && (atCast[0].statuses ?? []).includes("deafened"),
      `déjà dedans à la pose, désigné comme cible : l'effet est porté, une seule fois (${atCast.map(e => `${e.name} [${(e.statuses ?? []).join(", ")}]`).join(" ; ")})`);
    const region = (await ctx.call("get-scene-object", { type: "Region", objectId: regionId })).data;
    // §438: Handbook 3.0.0 — the data carries its own behavior (`dnd5e.applyActiveEffect`, the "Silenced" effect of the effects
    // compendium); the engine no longer places its own (the effect is carried only once, checked above).
    const kinds = (region.behaviors ?? []).map(b => b.type);
    ctx.expect(kinds.some(t => ["applyActiveEffect", "dnd5e.applyActiveEffect"].includes(t)),
      `la région porte un comportement « appliquer un effet », du cœur ou de dnd5e (${kinds.join(", ")})`);

    // Sortie, puis retour.
    await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y - 6 * grid, elevation: home.elevation });
    await pause(2500);
    const out = await silenced();
    ctx.expect(!out.length, `sorti de la zone : l'effet part (${out.length})`);
    await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation });
    await pause(2500);
    const back = await silenced();
    ctx.expect(back.length === 1, `revenu dans la zone : l'effet revient (${back.length})`);

    // End of Concentration: the area disappears, and so does the effect.
    const target = await targetOf(cleric);
    for ( const e of (await added(cleric)).filter(e => (e.statuses ?? []).includes("concentrating")) ) {
      await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id });
    }
    await pause(3000);
    const gone = !(await ctx.call("get-scene-object", { type: "Region", objectId: regionId }).catch(() => null))?.data;
    if ( gone ) regionId = null;
    const after = await silenced();
    ctx.expect(gone && !after.length, `concentration retirée : zone disparue (${gone}), effet retiré (${after.length})`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
