/**
 * Wild Shape (SPEC §16.39). World `ravenloft`: Sylaene (druid 5, Circle of the Moon).
 *  1. Circle forms as Brown Bear (CR 1 = level / 3): the token switches to the transformed actor, which carries the end time,
 *     the circle's Temporary Hit Points (3 × druid level) and the "Revert form" action.
 *  2. "Revert form": return to the original actor.
 *  3. Wild Shape as Wolf, then 0 HP: the form ends by itself.
 * The form is passed directly (`wildForm`), without the known-forms window. Everything is restored.
 */
const MODULE_ID = "dnd5e-combat";
const BEAR = "Compendium.dnd-monster-manual.actors.mmBrownBear00000";
const WOLF = "Compendium.dnd-monster-manual.actors.mmWolf0000000000";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Forme sauvage — prendre une forme, la quitter, la perdre à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Sylaene") ) { ctx.log("Sylaene absente : non applicable"); return; }
    const druid = await ctx.token("Sylaene");
    const original = druid.actorId;
    const tokenData = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: druid.id })).data;
    const actorOf = id => ctx.call("get-actor", { actorId: id }).catch(() => null);
    const start = await actorOf(original);
    const hp0 = start.system.attributes.hp.value;
    const temp0 = start.system.attributes.hp.temp ?? null;

    const revertItemOf = actor => (actor?.items ?? []).find(i => i.flags?.[MODULE_ID]?.revertForm);
    const leave = async () => {
      const t = await tokenData();
      if ( t.actorId === original ) return;
      const item = revertItemOf(await actorOf(t.actorId));
      if ( item ) await ctx.use({ tokenId: druid.id, itemId: item._id, activityType: "utility" });
      await pause(3000);
    };
    ctx.restore(async () => {
      await leave();
      await ctx.call("update-actor", { actorId: original, actorData: { "system.attributes.hp.value": hp0, "system.attributes.hp.temp": temp0 } });
      for ( const s of ["unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(druid, s).catch(() => {});
    });

    const shape = async (identifier, form) => {
      const used = await ctx.use({ tokenId: druid.id, identifier, activityType: "transform",
        usageConfig: { transform: { profile: MODULE_ID }, [MODULE_ID]: { wildForm: form } } });
      ctx.expect(used.used, `${identifier} utilisé`);
      for ( let i = 0; i < 10; i++ ) { await pause(1000); if ( (await tokenData()).actorId !== original ) break; }
      const t = await tokenData();
      return { token: t, actor: t.actorId !== original ? await actorOf(t.actorId) : null };
    };

    // 1. Formes du cercle : Ours brun.
    const bear = await shape("circle-forms", BEAR);
    ctx.expect(!!bear.actor, `le token passe sur l'acteur transformé (${bear.token.name})`);
    if ( !bear.actor ) return;
    const flag = bear.actor.flags?.[MODULE_ID]?.wildShape;
    ctx.expect(Number.isFinite(flag?.expiresAt), `heure de fin notée (${flag?.expiresAt})`);
    ctx.expect(bear.actor.system.attributes.hp.temp === 15, `PV temporaires du cercle : 3 × 5 = ${bear.actor.system.attributes.hp.temp}`);
    ctx.expect(!!revertItemOf(bear.actor), "l'action « Reprendre sa forme » est sur la fiche");

    // 2. Reprendre sa forme.
    await leave();
    const back = await tokenData();
    ctx.expect(back.actorId === original, `« Reprendre sa forme » : retour à Sylaene (${back.name})`);
    ctx.expect(!(await actorOf(bear.token.actorId)), "l'acteur transformé est retiré");

    // 3. Forme sauvage : Loup, puis 0 PV.
    const wolf = await shape("wild-shape", WOLF);
    ctx.expect(!!wolf.actor, `Forme sauvage en Loup (${wolf.token.name})`);
    if ( !wolf.actor ) return;
    await ctx.call("update-actor", { actorId: wolf.token.actorId, actorData: { "system.attributes.hp.temp": 0, "system.attributes.hp.value": 0 } });
    for ( let i = 0; i < 10; i++ ) { await pause(1000); if ( (await tokenData()).actorId === original ) break; }
    ctx.expect((await tokenData()).actorId === original, "à 0 PV, la forme cesse d'elle-même");
  }
};
